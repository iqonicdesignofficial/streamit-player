import { SimidMessage, SimidConfig } from './types';

/** Shape of a still-unparsed inbound `postMessage` payload, after the
 * `typeof data === 'object'` guard below has ruled out primitives - every
 * field is read defensively since it originates from the (untrusted)
 * creative iframe. */
interface RawInboundSimidMessage {
  type?: unknown;
  sessionId?: unknown;
  args?: { sessionId?: unknown } & Record<string, unknown>;
  data?: { sessionId?: unknown } & Record<string, unknown>;
  messageId?: unknown;
  correlationId?: unknown;
}

export class SimidBridge {
  private allowedOrigins: Set<string>;
  private pendingRequests = new Map<string, {
    resolve: (msg: SimidMessage) => void;
    reject: (err: Error) => void;
    timeoutId: ReturnType<typeof setTimeout>;
  }>();
  private messageListeners = new Set<(msg: SimidMessage) => void>();
  private globalListener: ((event: MessageEvent) => void) | null = null;
  private targetWindow: Window | null = null;
  private sessionId: string | null = null;
  private messageCounter = 0;
  private creativeOrigin: string | null = null;
  private readonly debugLogging: boolean;

  constructor(private config: SimidConfig) {
    this.allowedOrigins = new Set(config.allowedOrigins || ['*']);
    this.debugLogging = config.debug !== false;
  }

  /**
   * @param creativeOrigin - the actual origin the creative iframe was loaded
   * from (derived from its URL). Used to pick a correct, specific
   * postMessage targetOrigin when allowedOrigins lists more than one
   * non-'*' origin - without this, outbound messages would only ever be
   * addressed to whichever origin happened to be first in that list.
   */
  public init(targetWindow: Window, sessionId: string, creativeOrigin?: string) {
    this.targetWindow = targetWindow;
    this.sessionId = sessionId;
    this.creativeOrigin = creativeOrigin || null;
    this.setupGlobalListener();
  }

  /**
   * Update the sessionId used in outbound messages.
   * Called after receiving 'createSession' from the creative to adopt the creative's sessionId.
   */
  public updateSessionId(sessionId: string) {
    this.sessionId = sessionId;
  }

  public postMessage(type: string, data?: unknown, correlationId?: string): string {
    if (!this.targetWindow || !this.sessionId) {
      throw new Error('SIMID Bridge is not initialized or has been destroyed');
    }

    const messageId = String(++this.messageCounter);
    const envelope: {
      sessionId: string;
      messageId: string;
      timestamp: number;
      type: string;
      args: unknown; // SIMID 1.0 spec uses 'args'
      correlationId?: string;
    } = {
      sessionId: this.sessionId,
      messageId,
      timestamp: Date.now(),
      type,
      args: data,
    };
    if (correlationId !== undefined) {
      envelope.correlationId = correlationId;
    }

    // Use '*' if allowed origins contains '*'; otherwise prefer the
    // creative's actual origin (if it's in the allow-list) so a developer
    // who configures multiple trusted origins doesn't get outbound
    // messages silently misaddressed to whichever origin was listed first.
    // 'null' is only ever valid as an inbound event.origin (an opaque-origin
    // iframe, e.g. one deliberately sandboxed without allow-same-origin -
    // see resolveSafeSandbox) - postMessage() itself rejects "null" as an
    // outbound targetOrigin, so that case falls back to '*' for sending;
    // the inbound allowlist check below is what actually restricts which
    // origin's messages get accepted, so this doesn't weaken validation.
    const targetOrigin = (this.allowedOrigins.has('*') || this.allowedOrigins.has('null'))
      ? '*'
      : (this.creativeOrigin && this.allowedOrigins.has(this.creativeOrigin))
        ? this.creativeOrigin
        : Array.from(this.allowedOrigins)[0];
    if (this.debugLogging) {
      console.log('[SIMID Protocol] 📤 Player -> Creative:', {
        timestamp: new Date().toISOString(),
        type,
        messageId,
        correlationId,
        sessionId: this.sessionId,
        payload: envelope,
      });
    }
    // Serialize as JSON string for cross-origin SIMID creatives (Google SDK uses JSON.parse(event.data))
    this.targetWindow.postMessage(JSON.stringify(envelope), targetOrigin);
    return messageId;
  }

  /**
   * Post a SIMID 1.0 compliant 'resolve' response.
   * Per SIMID 1.0 §3.2 and Google SDK, resolve message args MUST be { messageId: <originalId>, value: <data> }.
   */
  public postResolve(originalMessageId: string | number, value: unknown = {}): string {
    const numericId = typeof originalMessageId === 'string' ? parseInt(originalMessageId, 10) || originalMessageId : originalMessageId;
    const args = {
      messageId: numericId,
      value: value || {},
    };
    return this.postMessage('resolve', args, String(originalMessageId));
  }

  /**
   * Post a SIMID 1.0 compliant 'reject' response.
   */
  public postReject(originalMessageId: string | number, errorData: unknown = {}): string {
    const numericId = typeof originalMessageId === 'string' ? parseInt(originalMessageId, 10) || originalMessageId : originalMessageId;
    const args = {
      messageId: numericId,
      value: errorData || {},
    };
    return this.postMessage('reject', args, String(originalMessageId));
  }

  public async sendRequest(type: string, data?: unknown, timeoutMs = 5000): Promise<SimidMessage> {
    if (!this.targetWindow || !this.sessionId) {
      throw new Error('SIMID Bridge is not initialized or has been destroyed');
    }

    return new Promise<SimidMessage>((resolve, reject) => {
      const messageId = this.postMessage(type, data);

      const timeoutId = setTimeout(() => {
        this.pendingRequests.delete(messageId);
        reject(new Error(`SIMID request timeout for messageId ${messageId} (${type})`));
      }, timeoutMs);

      this.pendingRequests.set(messageId, { resolve, reject, timeoutId });
    });
  }

  public addMessageListener(listener: (msg: SimidMessage) => void) {
    this.messageListeners.add(listener);
  }

  public removeMessageListener(listener: (msg: SimidMessage) => void) {
    this.messageListeners.delete(listener);
  }

  private setupGlobalListener() {
    if (typeof window === 'undefined') return;

    this.globalListener = (event: MessageEvent) => {
      // Source Window Verification: Reject messages not originating from the SIMID iframe contentWindow
      if (this.targetWindow && event.source) {
        try {
          if (event.source !== this.targetWindow && this.targetWindow.self !== event.source) {
            return;
          }
        } catch (_) {
          // Cross-origin access error is expected for sandboxed iframes; allow message
        }
      }

      // Validate origin if not wildcard
      if (!this.allowedOrigins.has('*') && !this.allowedOrigins.has(event.origin)) {
        return;
      }

      // SIMID 1.0: Creatives may postMessage a JSON string (Google SDK) or a plain object
      let rawData: unknown = event.data;
      if (typeof rawData === 'string') {
        try {
          rawData = JSON.parse(rawData);
        } catch {
          return; // Not a JSON message
        }
      }
      if (!rawData || typeof rawData !== 'object' || !(rawData as RawInboundSimidMessage).type) {
        return;
      }
      const data = rawData as RawInboundSimidMessage;

      const msgType = String(data.type);
      const normalizedType = msgType.replace(/^simid:(creative|player|media):/i, '').replace(/^simid:/i, '').toLowerCase();

      const isHandshakeMsg = (
        normalizedType === 'createsession' ||
        normalizedType === 'creativeready' ||
        normalizedType === 'creativeloaded' ||
        normalizedType === 'startcreative' ||
        normalizedType === 'handshake'
      );

      const msgSessionId = data.sessionId || data.args?.sessionId || data.data?.sessionId || this.sessionId;

      // Validate session ID unless it's a handshake message
      if (!isHandshakeMsg && this.sessionId && msgSessionId !== this.sessionId) {
        return;
      }

      const simidMessage: SimidMessage = {
        sessionId: String(msgSessionId || this.sessionId || ''),
        messageId: String(data.messageId || Math.random().toString(36).substring(2, 11)),
        correlationId: data.correlationId !== undefined ? String(data.correlationId) : undefined,
        type: msgType,
        data: data.data || data.args || data,
      };

      if (this.debugLogging) {
        console.log('[SIMID Protocol] 📥 Creative -> Player:', {
          timestamp: new Date().toISOString(),
          type: msgType,
          normalizedType,
          messageId: simidMessage.messageId,
          correlationId: simidMessage.correlationId,
          sessionId: simidMessage.sessionId,
          payload: data,
        });
      }

      // Handle Correlation / Request Resolution
      if (simidMessage.correlationId) {
        const pending = this.pendingRequests.get(simidMessage.correlationId);
        if (pending) {
          clearTimeout(pending.timeoutId);
          this.pendingRequests.delete(simidMessage.correlationId);
          pending.resolve(simidMessage);
        }
      }

      // Distribute to session / manager listeners
      this.messageListeners.forEach((listener) => {
        try {
          listener(simidMessage);
        } catch (err) {
          console.error('[SIMID Bridge] Error in message listener:', err);
        }
      });
    };

    window.addEventListener('message', this.globalListener);
  }

  public destroy() {
    if (typeof window !== 'undefined' && this.globalListener) {
      window.removeEventListener('message', this.globalListener);
    }
    this.globalListener = null;

    // Reject all pending requests
    this.pendingRequests.forEach((pending, msgId) => {
      clearTimeout(pending.timeoutId);
      pending.reject(new Error(`SIMID Bridge destroyed for pending message ${msgId}`));
    });
    this.pendingRequests.clear();
    this.messageListeners.clear();
    this.targetWindow = null;
    this.sessionId = null;
  }
}
