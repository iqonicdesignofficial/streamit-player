import { SimidConfig, SimidCreative, SimidDiagnostics, SimidCapabilities, SimidPublicSession, SimidAdInput } from './types';
import { SimidSession } from './SimidSession';

export class SimidManager {
  private activeSession: SimidSession | null = null;
  private diagnostics: SimidDiagnostics;
  private config: SimidConfig;

  constructor(config?: SimidConfig) {
    // Note: allowedOrigins is intentionally omitted here - SimidSession
    // derives a safe per-creative default (the interactiveCreativeFile's own
    // origin) when it isn't explicitly configured, rather than defaulting to
    // an insecure wildcard.
    this.config = config || {
      handshakeTimeoutMs: 8000,
      creativeTimeoutMs: 10000,
      maxDurationExtensionSec: 30,
      allowClickThru: true,
    };

    const caps = this.detectCapabilities();
    this.diagnostics = {
      simidAvailable: caps.iframeSupported,
      creativeDetected: false,
      sessionCreatedCount: 0,
      bridgeInitSuccess: false,
      messagesRoutedCount: 0,
      capabilities: caps,
      errorLog: [],
    };
  }

  /** Package-internal accessor used by SimidRuntime to read developer-set
   * options (onSimidClickThru, allowClickThru, maxDurationExtensionSec)
   * without reaching into a private field. */
  public getConfig(): SimidConfig {
    return this.config;
  }

  public detectCapabilities(): SimidCapabilities {
    const isBrowser = typeof window !== 'undefined';
    const hasDoc = isBrowser && typeof document !== 'undefined';
    return {
      simidVersion: '1.0',
      iframeSupported: hasDoc && typeof document.createElement === 'function',
      secureMessagingSupported: isBrowser && typeof window.postMessage === 'function',
      postMessageSupported: isBrowser && typeof window.postMessage === 'function',
      clickThruSupported: true,
      durationChangeSupported: true,
    };
  }

  public hasSimidCreative(ad: SimidAdInput | null | undefined): boolean {
    const hasCreative = !!(ad && ad.interactiveCreativeFile);
    if (hasCreative) {
      this.diagnostics.creativeDetected = true;
    }
    return hasCreative;
  }

  public createSession(ad: SimidAdInput): SimidSession | null {
    if (!this.hasSimidCreative(ad) || !ad.interactiveCreativeFile) {
      return null;
    }

    const creative: SimidCreative = {
      interactiveCreativeFile: ad.interactiveCreativeFile,
      creativeType: ad.contentType || 'text/html',
      creativeParameters: ad.creativeParameters || ad.adParameters || '',
      adId: ad.id,
      clickThruUrl: ad.clickThroughUrl || ad.clickThruUrl || '',
      clickTrackingUrls: (ad.clickTrackingUrls || [])
        .map((u) => (typeof u === 'string' ? u : u.url))
        .filter(Boolean),
    };

    if (this.activeSession) {
      this.activeSession.destroy();
    }

    this.activeSession = new SimidSession(creative, this.config, (state) => {
      if (state === 'initialized') {
        this.diagnostics.bridgeInitSuccess = true;
      }
    });

    this.diagnostics.sessionCreatedCount++;
    return this.activeSession;
  }

  public getActiveSession(): SimidSession | null {
    return this.activeSession;
  }

  public getPublicSession(): SimidPublicSession | null {
    if (!this.activeSession) return null;
    return {
      sessionId: this.activeSession.sessionId,
      state: this.activeSession.getSessionState(),
      creative: this.activeSession.creative,
      errors: this.activeSession.getErrors(),
    };
  }

  public getDiagnostics(): SimidDiagnostics {
    if (this.activeSession) {
      const activeErrors = this.activeSession.getErrors();
      // Avoid duplicate logs in the audit array
      activeErrors.forEach((err) => {
        if (!this.diagnostics.errorLog.some((e) => e.code === err.code && e.message === err.message)) {
          this.diagnostics.errorLog.push(err);
        }
      });
    }
    return this.diagnostics;
  }

  public destroy() {
    if (this.activeSession) {
      this.activeSession.destroy();
      this.activeSession = null;
    }
  }
}
