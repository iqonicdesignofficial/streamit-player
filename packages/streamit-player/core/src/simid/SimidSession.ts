import { SimidSessionState, SimidCreative, SimidConfig, SimidError, SimidErrorCode, SimidMessage } from './types';
import { SimidBridge } from './SimidBridge';
import { isSameOriginAsHost } from '../utils';

export class SimidSession {
  public sessionId: string;  // mutable - may be replaced by creative's sessionId
  private state: SimidSessionState = 'idle';
  private bridge: SimidBridge;
  private handshakeTimer: ReturnType<typeof setTimeout> | null = null;
  private creativeTimer: ReturnType<typeof setTimeout> | null = null;
  private errors: SimidError[] = [];
  private initMessageId: string | null = null;  // messageId of the 'init' we sent

  constructor(
    public readonly creative: SimidCreative,
    private config: SimidConfig,
    private onStateChange?: (state: SimidSessionState, session: SimidSession) => void
  ) {
    this.sessionId = Math.random().toString(36).substring(2, 15);
    this.config = SimidSession.resolveEffectiveConfig(creative, config);
    this.bridge = new SimidBridge(this.config);
  }

  /**
   * When the developer hasn't explicitly set allowedOrigins, default to the
   * interactive creative's own origin rather than an insecure wildcard - an
   * explicit ['*'] from the developer is still honored as an opt-in choice.
   *
   * If the creative is same-origin with the host page, SimidRuntime's iframe
   * sandboxing (resolveSafeSandbox) deliberately forces it into an opaque
   * origin to close the allow-scripts+allow-same-origin escape - so the
   * postMessage events it actually sends will report `event.origin` as the
   * literal string "null", not its nominal URL origin. The default must
   * match that, or every message from that (correctly sandboxed) creative
   * gets rejected by the allowlist check in SimidBridge.
   */
  private static resolveEffectiveConfig(creative: SimidCreative, config: SimidConfig): SimidConfig {
    if (config.allowedOrigins) return config;
    if (isSameOriginAsHost(creative.interactiveCreativeFile)) {
      return { ...config, allowedOrigins: ['null'] };
    }
    try {
      const origin = new URL(creative.interactiveCreativeFile, window.location.href).origin;
      return { ...config, allowedOrigins: [origin] };
    } catch (e) {
      console.warn(
        '[SimidSession] Could not resolve creative origin for allowedOrigins default; falling back to wildcard.',
        e
      );
      return { ...config, allowedOrigins: ['*'] };
    }
  }

  public getSessionState(): SimidSessionState {
    return this.state;
  }

  public getBridge(): SimidBridge {
    return this.bridge;
  }

  public getErrors(): SimidError[] {
    return this.errors;
  }

  public init(targetWindow: Window, creativeOrigin?: string) {
    if (this.state !== 'idle') {
      throw new Error(`Cannot initialize SIMID session in state: ${this.state}`);
    }

    this.transitionTo('available');
    this.bridge.init(targetWindow, this.sessionId, creativeOrigin);
    
    // Register message router hook
    this.bridge.addMessageListener(this.handleIncomingMessage.bind(this));
  }

  public start() {
    if (this.state !== 'available') {
      throw new Error(`Cannot start SIMID session in state: ${this.state}`);
    }

    this.transitionTo('loading');

    // Setup handshake timeout
    const timeout = this.config.handshakeTimeoutMs || 8000;
    this.handshakeTimer = setTimeout(() => {
      this.handleError(SimidErrorCode.HANDSHAKE_TIMEOUT, 'Handshake timeout expired', true);
    }, timeout);
  }

  public complete() {
    if (this.state === 'destroyed' || this.state === 'completed') return;
    this.transitionTo('completed');
    this.cleanupTimers();
  }

  public destroy() {
    if (this.state === 'destroyed') return;
    
    this.transitionTo('destroyed');
    this.cleanupTimers();
    this.bridge.destroy();
  }

  public transitionTo(newState: SimidSessionState) {
    this.state = newState;
    if (this.onStateChange) {
      try {
        this.onStateChange(newState, this);
      } catch (err) {
        console.error('[SIMID Session] Error in state change handler:', err);
      }
    }
  }

  /**
   * Record the messageId of the 'init' we sent, so we can match the creative's 'resolve'.
   * Called by SimidRuntime immediately after sending 'init'.
   */
  public setInitMessageId(messageId: string) {
    this.initMessageId = messageId;
  }

  private handleIncomingMessage(msg: SimidMessage) {
    if (this.state === 'destroyed' || this.state === 'completed') return;

    const t = String(msg.type || '');
    const normalizedType = t.replace(/^simid:(creative|player|media):/i, '').replace(/^simid:/i, '').toLowerCase();

    const dataObj = msg.data as Record<string, unknown> | undefined;
    const argsObj = msg.args as Record<string, unknown> | undefined;

    // -------------------------------------------------------------------
    // SIMID 1.0 §3.1: Creative sends 'createSession' to initiate handshake
    // Player must: (a) adopt creative's sessionId, (b) send 'resolve' back
    // -------------------------------------------------------------------
    const isCreateSession = (
      normalizedType === 'createsession' ||
      normalizedType === 'handshake'
    );

    if (isCreateSession && (this.state === 'loading' || this.state === 'available')) {
      this.clearHandshakeTimer();

      // Adopt the creative's sessionId (the creative's SDK uses its own)
      const creativeSessionId = msg.sessionId || dataObj?.sessionId || argsObj?.sessionId;
      if (creativeSessionId && creativeSessionId !== this.sessionId) {
        this.sessionId = String(creativeSessionId);
        // Reinit bridge with the creative's sessionId so outbound messages match
        this.bridge.updateSessionId(String(creativeSessionId));
      }

      // Send 'resolve' back to acknowledge createSession per SIMID 1.0 spec §3.2 & Google SDK
      try {
        const msgId = msg.messageId;
        if (msgId !== undefined && msgId !== null) {
          this.bridge.postResolve(msgId, {});
        }
      } catch (_) { /* bridge may not be ready */ }

      this.transitionTo('initialized');
      return;
    }

    // -------------------------------------------------------------------
    // SIMID 1.0 §3.3: Creative sends 'resolve' in response to our 'init'
    // Player advances to 'running' state
    // -------------------------------------------------------------------
    const isResolve = (normalizedType === 'resolve');
    if (isResolve && this.state === 'initialized') {
      const resolvedMsgId = argsObj?.messageId ?? msg.correlationId;
      if (!resolvedMsgId || String(resolvedMsgId) === String(this.initMessageId) || this.initMessageId === null) {
        this.transitionTo('running');
      }
      return;
    }

    // -------------------------------------------------------------------
    // Legacy / fallback: creativeReady / creativeLoaded
    // -------------------------------------------------------------------
    const isLegacyHandshake = (
      normalizedType === 'creativeready' ||
      normalizedType === 'creativeloaded'
    );
    if (isLegacyHandshake && (this.state === 'loading' || this.state === 'available')) {
      this.clearHandshakeTimer();
      this.transitionTo('initialized');
    }
  }

  private handleError(code: number, message: string, fatal: boolean) {
    const error: SimidError = { code, message, fatal };
    this.errors.push(error);
    
    if (fatal) {
      this.destroy();
    }
  }

  private cleanupTimers() {
    this.clearHandshakeTimer();
    if (this.creativeTimer) {
      clearTimeout(this.creativeTimer);
      this.creativeTimer = null;
    }
  }

  private clearHandshakeTimer() {
    if (this.handshakeTimer) {
      clearTimeout(this.handshakeTimer);
      this.handshakeTimer = null;
    }
  }
}
