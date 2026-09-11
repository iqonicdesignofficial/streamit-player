import { SimidConfig, SimidCreative, SimidMessage, SimidSessionState, SimidDiagnostics, SimidDiagnosticsData, SimidPublicSession, SimidAdInput, SimidClickThruArgs, SimidChangeDurationArgs, SimidFatalErrorArgs } from './types';
import { SimidSession } from './SimidSession';
import { SimidManager } from './SimidManager';
import { resolveSafeSandbox } from '../utils';
import type { PlayerController } from '../PlayerController';
import type { PlayerEvents } from '../types';

/** Args shape for the SIMID 'requestResize' command - not part of `types.ts`
 * since it's specific to this one handler. */
interface SimidResizeArgs {
  width?: number | string;
  height?: number | string;
}

/** Args shape for the SIMID 'requestChangeVolume'/'requestVolume' command. */
interface SimidVolumeArgs {
  volume?: number;
  muted?: boolean;
}

/** Args shape for the SIMID 'reportTracking' command. */
interface SimidTrackingArgs {
  trackingUrls?: string[];
}

/**
 * SimidRuntime - Production runtime execution layer for SIMID interactive creatives.
 *
 * This class coordinates:
 *  - Iframe creation / teardown inside the existing ad overlay container
 *  - The full handshake flow (playerInit → creativeReady → playerReady → running)
 *  - Interactive command handling (pause, resume, resize, volume, mute, etc.)
 *  - Runtime event emission via the player controller's existing event system
 *  - Memory-safe cleanup on destroy, source switch, skip, error, and completion
 *
 * It does NOT own the ad lifecycle - that remains with AdsManager and the providers.
 * It activates only when a VAST creative contains an interactiveCreativeFile.
 */
export class SimidRuntime {
  private simidManager: SimidManager;
  private iframe: HTMLIFrameElement | null = null;
  private adContainer: HTMLElement | null = null;
  private controller: PlayerController | null = null;
  private handshakeStartTime = 0;
  private messagesSent = 0;
  private messagesReceived = 0;
  private validationFailures = 0;
  private processedMessageIds = new Set<string>();

  private config?: SimidConfig;

  constructor(config?: SimidConfig) {
    this.config = config;
    this.simidManager = new SimidManager(config);
  }

  // --- Public API ---

  /**
   * Detect whether a normalized VAST ad contains an interactive creative.
   * Delegates to SimidManager.hasSimidCreative(). No XML re-parsing.
   */
  public hasSimidCreative(ad: SimidAdInput | null | undefined): boolean {
    return this.simidManager.hasSimidCreative(ad);
  }

  /**
   * Start the SIMID runtime for a given ad.
   * Creates the iframe, initiates the session, runs the handshake.
   * Returns true if SIMID is successfully activated.
   *
   * @param ad - The normalized VAST advertisement with interactiveCreativeFile
   * @param container - The existing ad overlay container element
   * @param controller - The PlayerController (for event emission & state queries)
   */
  public async startRuntime(
    ad: SimidAdInput,
    container: HTMLElement,
    controller: PlayerController,
  ): Promise<boolean> {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return false;
    }

    if (!this.simidManager.hasSimidCreative(ad)) {
      return false;
    }

    const caps = this.simidManager.detectCapabilities();
    if (!caps.iframeSupported || !caps.postMessageSupported) {
      return false;
    }

    this.adContainer = container;
    this.controller = controller;

    // Destroy any prior session
    this.destroyRuntime();

    const session = this.simidManager.createSession(ad);
    if (!session) {
      return false;
    }

    // createSession() returned non-null only after validating
    // ad.interactiveCreativeFile is a non-empty string - session.creative
    // carries that already-narrowed value.
    const interactiveCreativeFile = session.creative.interactiveCreativeFile;

    try {
      // 1. Create sandboxed iframe node (DO NOT set src yet to prevent race condition)
      this.iframe = this.createIframe(container, interactiveCreativeFile);

      const iframeWindow = this.iframe.contentWindow;
      if (!iframeWindow) {
        throw new Error('SIMID iframe contentWindow is null');
      }

      // 2. Initialize session & register bridge message listener BEFORE loading creative URL
      //    (this puts the session in 'available' state, which already accepts
      //    an incoming 'createSession' - see SimidSession.handleIncomingMessage -
      //    so no message can be missed even before the handshake timer starts).
      let creativeOrigin: string | undefined;
      try {
        creativeOrigin = new URL(interactiveCreativeFile, window.location.href).origin;
      } catch (_) {
        // Keep the bridge's configured fallback for malformed or non-web URLs.
      }
      session.init(iframeWindow, creativeOrigin);
      session.getBridge().addMessageListener(this.handleRuntimeMessage.bind(this));

      this.handshakeStartTime = Date.now();
      this.emitEvent('simidavailable', { sessionId: session.sessionId });

      // 3. Now load creative URL in iframe so createSession postMessage is captured instantly
      this.iframe.src = interactiveCreativeFile;

      // 4. Wait for the iframe to finish loading BEFORE starting the fatal
      //    handshake timer. Starting it earlier (as this used to) meant a real
      //    ad-server-hosted creative's network fetch + bootstrap time ate into
      //    the handshake budget before its own code ever got to run - a fast
      //    local test file never hit this, but a real creative easily could,
      //    silently killing the iframe while the ad video kept playing.
      await this.waitForIframeLoad(this.iframe);

      // The creative may have already sent 'createSession' while the iframe
      // was loading (state already advanced past 'available') - only start
      // the timer if a handshake is still actually pending.
      if (session.getSessionState() === 'available') {
        session.start();
      }

      const handshakeWaitMs = this.config?.handshakeTimeoutMs || 8000;
      await this.waitForState(session, 'initialized', handshakeWaitMs);

      // 5. SIMID 1.0: Send 'SIMID:Player:init' (and 'init') with args per spec §4.1
      //    Google SIMID SDK registers listeners for 'SIMID:Player:init'.
      const width = Math.round(this.adContainer?.offsetWidth || 640);
      const height = Math.round(this.adContainer?.offsetHeight || 480);
      const playerState = controller.getState();
      const isSkippable = !!(ad.skippable);
      const skippableState = isSkippable ? 'playerHandles' : 'notSkippable';

      const initArgs = {
        environmentData: {
          videoDimensions: { x: 0, y: 0, width, height },
          creativeDimensions: { x: 0, y: 0, width, height },
          fullscreen: !!playerState.isFullscreen,
          fullscreenAllowed: true,
          variableDurationAllowed: true,
          skippableState,
          version: '1.0',
          muted: !!playerState.isMuted,
          volume: playerState.volume ?? 1,
        },
        creativeData: {
          adParameters: ad.creativeParameters || ad.adParameters || '',
          clickThruUrl: ad.clickThroughUrl || ad.clickThruUrl || '',
        },
      };

      const initMsgId = this.sendToCreative(session, 'SIMID:Player:init', initArgs);
      // Register the init messageId so session can match the creative's 'resolve'
      session.setInitMessageId(initMsgId);

      // 6. Wait for creative to resolve 'init' (session transitions to 'running')
      await this.waitForState(session, 'running', handshakeWaitMs);

      // 7. Send 'SIMID:Player:startCreative' to activate the interactive experience
      this.sendToCreative(session, 'SIMID:Player:startCreative', {});

      this.emitEvent('simidstart', { sessionId: session.sessionId });
      this.emitEvent('simidready', { sessionId: session.sessionId });

      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn('[SimidRuntime] Startup failed:', message);
      this.emitEvent('simiderror', { message });
      this.destroyRuntime();
      return false;
    }
  }

  /**
   * Clean up all SIMID runtime resources.
   * Safe to call multiple times and from any state.
   */
  public destroyRuntime() {
    this.clearDurationCutoff();
    const session = this.simidManager.getActiveSession();
    if (session) {
      const wasRunning = session.getSessionState() === 'running';
      if (wasRunning) {
        try {
          this.sendToCreative(session, 'SIMID:Player:adStopped', {});
        } catch (_) { /* bridge may already be destroyed */ }
      }
    }

    this.simidManager.destroy();
    this.removeIframe();
    this.processedMessageIds.clear();

    if (this.controller) {
      this.emitEvent('simidcomplete', {});
    }
  }

  /**
   * Get the underlying SimidManager (for diagnostics access).
   */
  public getSimidManager(): SimidManager {
    return this.simidManager;
  }

  /**
   * Get extended runtime diagnostics.
   */
  public getRuntimeDiagnostics(): SimidDiagnostics & {
    iframeLoaded: boolean;
    handshakeDurationMs: number;
    messagesSent: number;
    messagesReceived: number;
    validationFailures: number;
    sessionState: SimidSessionState | null;
    sessionLifetimeMs: number;
  } {
    const base = this.simidManager.getDiagnostics();
    const session = this.simidManager.getActiveSession();
    return {
      ...base,
      iframeLoaded: this.iframe !== null,
      handshakeDurationMs: this.handshakeStartTime ? Date.now() - this.handshakeStartTime : 0,
      messagesSent: this.messagesSent,
      messagesReceived: this.messagesReceived,
      validationFailures: this.validationFailures,
      sessionState: session?.getSessionState() || null,
      sessionLifetimeMs: this.handshakeStartTime ? Date.now() - this.handshakeStartTime : 0,
    };
  }

  // --- Iframe Management ---

  // `intendedSrc` is the creative URL that will be assigned to `.src` shortly
  // after this returns (see startCreative's "DO NOT set src yet" step) - it's
  // taken here only to compute the correct sandbox before the iframe starts
  // loading; actually assigning `.src` stays the caller's responsibility so
  // the session/listener setup ordering is preserved.
  private createIframe(container: HTMLElement, intendedSrc: string): HTMLIFrameElement {
    const iframe = document.createElement('iframe');

    // Sandboxing - allow scripts, same-origin, popups, and forms for SIMID postMessage & interactive CTAs.
    // allow-same-origin is dropped when it would resolve to the host page's own origin (see resolveSafeSandbox).
    const sandbox = resolveSafeSandbox('allow-scripts allow-same-origin allow-popups allow-forms', { srcUrl: intendedSrc || null });
    iframe.setAttribute('sandbox', sandbox);
    iframe.setAttribute('allow', 'autoplay; fullscreen');
    iframe.setAttribute('referrerpolicy', 'no-referrer');

    // Ensure parent container has positioning context so overlay aligns over video
    if (container && typeof getComputedStyle === 'function' && getComputedStyle(container).position === 'static') {
      container.style.position = 'relative';
    }

    // Styling - overlay on top of ad video, within existing ad container
    iframe.style.position = 'absolute';
    iframe.style.top = '0';
    iframe.style.left = '0';
    iframe.style.width = '100%';
    iframe.style.height = '100%';
    iframe.style.border = 'none';
    iframe.style.zIndex = '1001'; // Above ad video (z-index 1000)
    iframe.style.pointerEvents = 'auto';
    iframe.style.backgroundColor = 'transparent';

    container.appendChild(iframe);

    return iframe;
  }

  private waitForIframeLoad(iframe: HTMLIFrameElement): Promise<void> {
    const timeoutMs = this.config?.creativeTimeoutMs ?? 10000;
    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('SIMID iframe load timeout'));
      }, timeoutMs);

      iframe.addEventListener('load', () => {
        clearTimeout(timeout);
        resolve();
      }, { once: true });

      iframe.addEventListener('error', () => {
        clearTimeout(timeout);
        reject(new Error('SIMID iframe load failed'));
      }, { once: true });
    });
  }

  private removeIframe() {
    if (this.iframe) {
      this.iframe.src = 'about:blank';
      if (this.iframe.parentNode) {
        this.iframe.parentNode.removeChild(this.iframe);
      }
      this.iframe = null;
    }
  }

  // --- Message Handling ---

  private sendToCreative(session: SimidSession, type: string, data: unknown): string {
    const messageId = session.getBridge().postMessage(type, data);
    this.messagesSent++;
    return messageId;
  }

  private handleRuntimeMessage(msg: SimidMessage) {
    this.messagesReceived++;

    // Duplicate message guard
    if (this.processedMessageIds.has(msg.messageId)) {
      this.validationFailures++;
      return;
    }
    this.processedMessageIds.add(msg.messageId);

    // Cap processed set size for memory safety
    if (this.processedMessageIds.size > 1000) {
      const first = this.processedMessageIds.values().next().value;
      if (first) this.processedMessageIds.delete(first);
    }

    const session = this.simidManager.getActiveSession();
    if (!session || session.sessionId !== msg.sessionId) {
      this.validationFailures++;
      return;
    }

    const t = String(msg.type || '');
    const norm = t.replace(/^simid:(creative|player|media):/i, '').replace(/^simid:/i, '').toLowerCase();

    switch (norm) {
      // --- Handshake messages (handled by SimidSession internally) ---
      case 'createsession':
      case 'handshake':
      case 'creativeready':
      case 'creativeloaded':
      case 'resolve':   // Creative's resolve response to 'init' - handled by SimidSession
      case 'reject':    // Creative's reject response - handled by SimidSession
        break;

      case 'requestclickthru':
      case 'requestclickthrough':
        this.handleRequestClickThru(session, msg);
        break;

      case 'requestchangeadduration':
      case 'requestchangeduration':
        this.handleRequestChangeAdDuration(session, msg);
        break;

      case 'requestunmute':
        this.handleRequestMute(session, msg, false);
        break;

      case 'requestfatalerror':
        this.handleRequestFatalError(session, msg);
        break;

      case 'requestadparameters':
        this.handleRequestAdParameters(session, msg);
        break;

      case 'getmediastate':
      case 'requestmediastate':
        this.handleGetMediaState(session, msg);
        break;

      case 'requestpause':
        this.handleRequestPause(session, msg);
        break;

      case 'requestplay':
      case 'requestresume':
        this.handleRequestResume(session, msg);
        break;

      case 'requestchangevolume':
      case 'requestvolume':
        this.handleRequestVolume(session, msg);
        break;

      case 'requestmute':
        this.handleRequestMute(session, msg, true);
        break;

      case 'requestresize':
        this.handleRequestResize(session, msg);
        break;

      case 'requestfullscreen':
        this.handleRequestFullscreen(session, msg);
        break;

      case 'requestexitfullscreen':
        this.handleRequestExitFullscreen(session, msg);
        break;

      case 'requestcollapse':
        this.handleRequestCollapse(session, msg);
        break;

      case 'requestexpand':
        this.handleRequestExpand(session, msg);
        break;

      case 'requestduration':
        this.handleRequestDuration(session, msg);
        break;

      case 'requestcurrenttime':
        this.handleRequestCurrentTime(session, msg);
        break;

      case 'requestremainingtime':
        this.handleRequestRemainingTime(session, msg);
        break;

      case 'requestplayerstate':
        this.handleRequestPlayerState(session, msg);
        break;

      case 'requestcreativedata':
        this.handleRequestCreativeData(session, msg);
        break;

      case 'requestskip':
        this.handleRequestSkip(session, msg);
        break;

      case 'requeststop':
        this.handleRequestStop(session, msg);
        break;

      case 'reporttracking':
        this.handleReportTracking(session, msg);
        break;

      case 'creativeinteraction':
        this.respond(session, msg, {});
        this.emitEvent('simidinteraction', msg.data || msg.args || {});
        break;

      case 'creativeclosed':
        this.respond(session, msg, {});
        session.complete();
        this.emitEvent('simidcomplete', {});
        break;

      default:
        // Always resolve unknown request to prevent creative handshake timeout
        this.respond(session, msg, {});
        break;
    }
  }

  // --- Command Handlers ---

  private handleRequestClickThru(session: SimidSession, msg: SimidMessage) {
    const args = (msg.args || msg.data || {}) as SimidClickThruArgs;
    let targetUrl = args.clickUrl || session.creative.clickThruUrl || '';
    const trackingUrls = session.creative.clickTrackingUrls || [];

    if (typeof targetUrl !== 'string' || !targetUrl.trim()) {
      this.rejectRequest(session, msg, 'No valid click-through URL specified');
      return;
    }

    targetUrl = targetUrl.trim();

    // Security check: Only allow HTTP and HTTPS protocols to prevent script injection
    try {
      const parsed = new URL(targetUrl, typeof window !== 'undefined' ? window.location.href : undefined);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        this.rejectRequest(session, msg, 'Invalid URL scheme. Only HTTP and HTTPS are permitted.');
        this.emitEvent('simidsecurityerror', { reason: 'Blocked unsafe click-through URL', url: targetUrl });
        return;
      }
    } catch (_) {
      this.rejectRequest(session, msg, 'Malformed click-through URL');
      return;
    }

    // Developer override hook
    let defaultPrevented = false;
    const onSimidClickThru = this.simidManager.getConfig().onSimidClickThru;
    if (typeof onSimidClickThru === 'function') {
      try {
        const result = onSimidClickThru(targetUrl, trackingUrls);
        if (result === false) {
          defaultPrevented = true;
        }
      } catch (err) {
        console.warn('[SimidRuntime] Error in onSimidClickThru developer callback:', err);
      }
    }

    // Fire VAST click tracking pings via keepalive fetch
    trackingUrls.forEach((url) => {
      if (typeof url === 'string' && url) {
        try {
          fetch(url, { method: 'GET', mode: 'no-cors', keepalive: true }).catch(() => {});
        } catch (_) {}
      }
    });

    // Popup navigation (if permitted and not developer overridden)
    if (!defaultPrevented && this.simidManager.getConfig().allowClickThru !== false && typeof window !== 'undefined') {
      try {
        window.open(targetUrl, '_blank', 'noopener,noreferrer');
      } catch (e) {
        console.warn('[SimidRuntime] Popup open failed:', e);
      }
    }

    this.emitEvent('simidclick', { url: targetUrl, trackingUrls, playerHandled: !defaultPrevented });
    this.respond(session, msg, { success: true, url: targetUrl });
  }

  private handleRequestChangeAdDuration(session: SimidSession, msg: SimidMessage) {
    const args = (msg.args || msg.data || {}) as SimidChangeDurationArgs;
    const currentDuration = this.controller?.getState?.()?.adDuration || 0;

    // SIMID 1.0 spec: 'duration' is the new absolute total duration for the
    // ad. Some creatives instead send a legacy 'extensionSec' delta - accept
    // both, normalized to an absolute target duration.
    let newDuration: number | undefined;
    if (typeof args.duration === 'number') {
      newDuration = args.duration;
    } else if (typeof args.extensionSec === 'number') {
      newDuration = currentDuration + args.extensionSec;
    }

    if (newDuration === undefined) {
      this.rejectRequest(session, msg, 'requestChangeAdDuration missing a numeric duration/extensionSec');
      return;
    }

    const extensionSec = newDuration - currentDuration;
    const maxExtension = this.simidManager.getConfig().maxDurationExtensionSec ?? 30;
    if (extensionSec > maxExtension) {
      this.rejectRequest(session, msg, `Requested duration extension (${extensionSec}s) exceeds maximum permitted limit (${maxExtension}s)`);
      return;
    }

    this.emitEvent('simiddurationchange', { duration: newDuration, extensionSec, maxAllowed: maxExtension });
    this.respond(session, msg, { success: true, duration: newDuration });

    // A shortened duration must actually be enforced - otherwise the
    // creative's own countdown/UI ends while the underlying ad video just
    // keeps playing to its original length (this was a real bug: a
    // "select a shorter ad" interaction had no effect on real playback).
    if (newDuration < currentDuration) {
      this.scheduleAdDurationCutoff(newDuration);
    }
  }

  private durationCutoffListener:
    | ((detail?: { currentTime: number; duration: number; remainingTime?: number }) => void)
    | null = null;

  private scheduleAdDurationCutoff(targetDuration: number) {
    this.clearDurationCutoff();
    if (!this.controller?.on) return;

    const onTimeUpdate = (e?: { currentTime: number; duration: number; remainingTime?: number }) => {
      if (e && e.currentTime >= targetDuration) {
        this.clearDurationCutoff();
        try {
          // .skip() (not endAdBreak() directly) - it calls the active
          // provider's own skipAd() first, which actually removes/cleans up
          // the ad's video element, before ending the break. Calling
          // endAdBreak() alone clears ad state/UI but leaves the ad video
          // itself on screen, since nothing ever tore it down.
          this.controller?.ads?.skip?.();
        } catch (_) { /* best-effort */ }
      }
    };
    this.durationCutoffListener = onTimeUpdate;
    this.controller.on('adtimeupdate', onTimeUpdate);
  }

  private clearDurationCutoff() {
    if (this.durationCutoffListener && this.controller?.off) {
      this.controller.off('adtimeupdate', this.durationCutoffListener);
    }
    this.durationCutoffListener = null;
  }

  private handleRequestFatalError(session: SimidSession, msg: SimidMessage) {
    const args = (msg.args || msg.data || {}) as SimidFatalErrorArgs;
    const code = args.code || 1005;
    const message = args.message || 'Creative reported fatal error';
    this.emitEvent('simidcreativeerror', { code, message, fatal: true });
    this.emitEvent('simiderror', { code, message, fatal: true });
    this.respond(session, msg, { acknowledged: true });
    this.destroyRuntime();
  }

  private handleRequestMute(session: SimidSession, msg: SimidMessage, mute: boolean) {
    if (this.controller?.setMuted) {
      this.controller.setMuted(mute);
    }
    this.respond(session, msg, { success: true, muted: mute });
  }

  private handleRequestAdParameters(session: SimidSession, msg: SimidMessage) {
    this.respond(session, msg, {
      adParameters: session.creative.creativeParameters || '',
    });
  }

  private getSafeDuration(): number {
    const duration = this.controller?.getState?.()?.duration;
    if (duration === undefined || duration === null || isNaN(duration) || duration === Infinity || duration < 0) {
      return Infinity;
    }
    return duration;
  }

  private getSafeRemainingTime(): number {
    const duration = this.getSafeDuration();
    if (duration === Infinity) return Infinity;
    const currentTime = this.controller?.getState?.()?.currentTime || 0;
    return Math.max(0, duration - currentTime);
  }

  private handleGetMediaState(session: SimidSession, msg: SimidMessage) {
    const video = this.controller?.getVideoElement?.();
    const state = this.controller?.getState?.();
    const duration = this.getSafeDuration();
    this.respond(session, msg, {
      currentSrc: video?.currentSrc || video?.src || '',
      currentTime: video?.currentTime || state?.currentTime || 0,
      duration: duration,
      isLive: duration === Infinity,
      ended: video?.ended || false,
      muted: video ? video.muted : (state?.isMuted ?? false),
      paused: video ? video.paused : (state?.isPlaying ? !state.isPlaying : true),
      volume: video?.volume ?? state?.volume ?? 1,
      fullscreen: !!state?.isFullscreen,
    });
  }

  private handleRequestPause(session: SimidSession, msg: SimidMessage) {
    if (this.controller?.getVideoElement) {
      this.controller.getVideoElement().pause();
    }
    this.respond(session, msg, { success: true });
    this.emitEvent('simidpause', {});
  }

  private handleRequestResume(session: SimidSession, msg: SimidMessage) {
    if (this.controller?.getVideoElement) {
      this.controller.getVideoElement().play().catch(() => {});
    }
    this.respond(session, msg, { success: true });
    this.emitEvent('simidresume', {});
  }

  private handleRequestResize(session: SimidSession, msg: SimidMessage) {
    const { width, height } = (msg.data || msg.args || {}) as SimidResizeArgs;
    if (this.iframe && width && height) {
      this.iframe.style.width = typeof width === 'number' ? `${width}px` : width;
      this.iframe.style.height = typeof height === 'number' ? `${height}px` : height;
    }
    this.respond(session, msg, { success: true });
    this.emitEvent('simidresize', { width, height });
  }

  private handleRequestFullscreen(session: SimidSession, msg: SimidMessage) {
    if (this.controller?.toggleFullscreen) {
      this.controller.toggleFullscreen();
    }
    this.respond(session, msg, { success: true });
    this.emitEvent('simidfullscreen', {});
  }

  private handleRequestExitFullscreen(session: SimidSession, msg: SimidMessage) {
    // PlayerController has no dedicated exitFullscreen() - only a
    // toggleFullscreen() - so only toggle when actually fullscreen, to
    // avoid entering fullscreen instead of exiting it.
    if (this.controller?.getState().isFullscreen) {
      this.controller.toggleFullscreen();
    }
    this.respond(session, msg, { success: true });
    this.emitEvent('simidexitfullscreen', {});
  }

  private handleRequestCollapse(session: SimidSession, msg: SimidMessage) {
    if (this.iframe) {
      this.iframe.style.pointerEvents = 'none';
      this.iframe.style.opacity = '0';
    }
    this.respond(session, msg, { success: true });
    this.emitEvent('simidcollapse', {});
  }

  private handleRequestExpand(session: SimidSession, msg: SimidMessage) {
    if (this.iframe) {
      this.iframe.style.pointerEvents = 'auto';
      this.iframe.style.opacity = '1';
    }
    this.respond(session, msg, { success: true });
    this.emitEvent('simidexpand', {});
  }

  private handleRequestVolume(session: SimidSession, msg: SimidMessage) {
    const args = (msg.args || msg.data || {}) as SimidVolumeArgs;
    const volume = args.volume;
    const muted = args.muted;

    if (this.controller?.setVolume && typeof volume === 'number') {
      this.controller.setVolume(volume);
    }
    if (this.controller?.setMuted && typeof muted === 'boolean') {
      this.controller.setMuted(muted);
    }
    this.respond(session, msg, {
      success: true,
      volume: this.controller?.getState?.()?.volume,
      muted: this.controller?.getState?.()?.isMuted,
    });
  }

  private handleRequestDuration(session: SimidSession, msg: SimidMessage) {
    const duration = this.getSafeDuration();
    this.respond(session, msg, { duration, isLive: duration === Infinity });
  }

  private handleRequestCurrentTime(session: SimidSession, msg: SimidMessage) {
    const currentTime = this.controller?.getState?.()?.currentTime || 0;
    this.respond(session, msg, { currentTime });
  }

  private handleRequestRemainingTime(session: SimidSession, msg: SimidMessage) {
    const remaining = this.getSafeRemainingTime();
    this.respond(session, msg, { remainingTime: remaining, isLive: remaining === Infinity });
  }

  private handleRequestPlayerState(session: SimidSession, msg: SimidMessage) {
    const state = this.controller?.getState?.();
    const duration = this.getSafeDuration();
    this.respond(session, msg, {
      currentTime: state?.currentTime || 0,
      duration: duration,
      isLive: duration === Infinity,
      volume: state?.volume || 1,
      muted: state?.isMuted || false,
      isPlaying: state?.isPlaying || false,
      isFullscreen: state?.isFullscreen || false,
    });
  }

  private handleRequestCreativeData(session: SimidSession, msg: SimidMessage) {
    this.respond(session, msg, {
      creative: session.creative,
    });
  }

  private handleRequestSkip(session: SimidSession, msg: SimidMessage) {
    this.respond(session, msg, {});
    this.emitEvent('simidskip', {});
    this.destroyRuntime();
    // Per SIMID spec, requestSkip means the creative wants the underlying ad
    // itself skipped, not just its own interactive overlay torn down -
    // route through the normal skip path (which already handles pod
    // advance-vs-end-break correctly) rather than leaving the ad video
    // playing on with no interactive layer.
    try {
      this.controller?.ads?.skip?.();
    } catch (_) { /* best-effort */ }
  }

  private handleRequestStop(session: SimidSession, msg: SimidMessage) {
    this.respond(session, msg, {});
    this.emitEvent('simidstop', {});
    this.destroyRuntime();
    // .skip() (not endAdBreak() directly) so the active provider actually
    // tears down its ad video element - see scheduleAdDurationCutoff for
    // why calling endAdBreak() alone leaves the ad video on screen.
    try {
      this.controller?.ads?.skip?.();
    } catch (_) { /* best-effort */ }
  }

  private handleReportTracking(session: SimidSession, msg: SimidMessage) {
    const args = (msg.args || {}) as SimidTrackingArgs;
    const data = (msg.data || {}) as SimidTrackingArgs;
    const urls = args.trackingUrls || data.trackingUrls || [];
    if (Array.isArray(urls)) {
      urls.forEach((url: string) => {
        if (typeof url === 'string' && url) {
          try {
            fetch(url, { method: 'GET', mode: 'no-cors', keepalive: true }).catch(() => {});
          } catch (_) {}
        }
      });
    }
    this.respond(session, msg, {});
  }

  // --- Helpers ---

  public getPublicDiagnostics(): SimidDiagnosticsData {
    return this.getRuntimeDiagnostics();
  }

  public getPublicSession(): SimidPublicSession | null {
    return this.simidManager.getPublicSession();
  }

  public isRuntimeActive(): boolean {
    const session = this.simidManager.getActiveSession();
    return !!session && session.getSessionState() === 'running';
  }

  private respond(session: SimidSession, originalMsg: SimidMessage, data: unknown = {}) {
    try {
      if (originalMsg.messageId !== undefined && originalMsg.messageId !== null) {
        session.getBridge().postResolve(originalMsg.messageId, data);
      }
      this.messagesSent++;
    } catch (_) {
      // Bridge may be destroyed
    }
  }

  private rejectRequest(session: SimidSession, originalMsg: SimidMessage, reason: string) {
    try {
      if (originalMsg.messageId !== undefined && originalMsg.messageId !== null) {
        session.getBridge().postReject(originalMsg.messageId, { message: reason });
      }
      this.messagesSent++;
    } catch (_) {
      // Bridge may be destroyed
    }
  }

  /**
   * `event`/`detail` are constrained to `PlayerEvents` (every `simid*` event
   * is declared there with its own detail shape), but individual call sites
   * above pass a loosely-shaped object per SIMID command handler rather than
   * each exact declared shape - `as never` is a narrow, targeted escape for
   * that mismatch, not a general `any`.
   */
  private emitEvent(event: keyof PlayerEvents, detail: unknown) {
    if (this.controller?.emit) {
      try {
        this.controller.emit(event, detail as never);
      } catch (_) { /* safety */ }
    }
  }

  private waitForState(session: SimidSession, targetState: SimidSessionState, timeoutMs: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const stateOrder: Record<SimidSessionState, number> = {
        idle: 0,
        available: 1,
        loading: 2,
        initialized: 3,
        running: 4,
        completed: 5,
        destroyed: 6,
      };

      const targetRank = stateOrder[targetState] ?? 0;
      const initialRank = stateOrder[session.getSessionState()] ?? 0;

      if (initialRank >= targetRank && session.getSessionState() !== 'destroyed') {
        resolve();
        return;
      }

      const timeout = setTimeout(() => {
        reject(new Error(`SIMID session did not reach state '${targetState}' within ${timeoutMs}ms (current state: '${session.getSessionState()}')`));
      }, timeoutMs);

      // Poll session state at short interval
      const interval = setInterval(() => {
        const current = session.getSessionState();
        const currentRank = stateOrder[current] ?? 0;

        if (currentRank >= targetRank && current !== 'destroyed') {
          clearTimeout(timeout);
          clearInterval(interval);
          resolve();
        } else if (current === 'destroyed' || current === 'completed') {
          clearTimeout(timeout);
          clearInterval(interval);
          reject(new Error(`SIMID session entered terminal state '${current}' before reaching '${targetState}'`));
        }
      }, 50);
    });
  }
}
