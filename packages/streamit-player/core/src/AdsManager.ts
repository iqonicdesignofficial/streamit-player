import { PlayerController } from './PlayerController';
import { HtmlOverlayRenderer } from './html-overlay/HtmlOverlayRenderer';
import { defaultHtmlSanitizer } from './utils';
import {
  PlaybackInterceptor,
  PlayerPlugin,
  AdBreak,
  Advertisement,
  HtmlOverlayConfig,
  AdState,
  AdProvider,
  CapabilityInfo,
  PlayerState,
  ProviderContext,
  AdError,
  AdErrorType,
  CompanionSlot,
  PlayerSource,
} from './types';

export function matchCompanionsToSlots(
  companions: Advertisement[],
  slots: CompanionSlot[]
): Array<{ slot: CompanionSlot; companion: Advertisement }> {
  const used = new Set<number>();
  const result: Array<{ slot: CompanionSlot; companion: Advertisement }> = [];

  for (const slot of slots) {
    const slotArea = slot.width * slot.height;
    let bestIndex = -1;
    let bestDiff = Infinity;
    companions.forEach((c, i) => {
      if (used.has(i)) return;
      const w = c.width ?? 0;
      const h = c.height ?? 0;
      const diff = Math.abs(w * h - slotArea);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestIndex = i;
      }
    });
    if (bestIndex >= 0) {
      used.add(bestIndex);
      result.push({ slot, companion: companions[bestIndex] });
    }
  }

  return result;
}

// --- Transition Table ---
const TRANSITION_TABLE: Record<AdState, AdState[]> = {
  [AdState.IDLE]: [AdState.REQUESTING, AdState.LOADED, AdState.PLAYING, AdState.ERROR, AdState.CONTENT_RESUMING],
  [AdState.REQUESTING]: [AdState.LOADED, AdState.PLAYING, AdState.ERROR, AdState.CONTENT_RESUMING, AdState.IDLE],
  [AdState.LOADED]: [AdState.REQUESTING, AdState.PLAYING, AdState.PAUSED, AdState.BUFFERING, AdState.ERROR, AdState.CONTENT_RESUMING, AdState.IDLE],
  [AdState.PLAYING]: [AdState.REQUESTING, AdState.PAUSED, AdState.BUFFERING, AdState.SKIPPING, AdState.ENDED, AdState.ERROR, AdState.CONTENT_RESUMING, AdState.IDLE],
  [AdState.PAUSED]: [AdState.REQUESTING, AdState.PLAYING, AdState.BUFFERING, AdState.SKIPPING, AdState.ENDED, AdState.ERROR, AdState.CONTENT_RESUMING, AdState.IDLE],
  [AdState.BUFFERING]: [AdState.REQUESTING, AdState.PLAYING, AdState.PAUSED, AdState.ENDED, AdState.ERROR, AdState.CONTENT_RESUMING, AdState.IDLE],
  [AdState.SKIPPING]: [AdState.REQUESTING, AdState.PLAYING, AdState.LOADED, AdState.CONTENT_RESUMING, AdState.ERROR, AdState.IDLE],
  [AdState.ENDED]: [AdState.REQUESTING, AdState.PLAYING, AdState.LOADED, AdState.CONTENT_RESUMING, AdState.ERROR, AdState.IDLE],
  [AdState.ERROR]: [AdState.REQUESTING, AdState.CONTENT_RESUMING, AdState.IDLE],
  [AdState.CONTENT_RESUMING]: [AdState.REQUESTING, AdState.IDLE],
};

// --- Provider Manager ---
export class ProviderManager {
  private providers = new Map<string, AdProvider>();
  private activeProviderName: string | null = null;

  public registerProvider(name: string, provider: AdProvider) {
    this.providers.set(name, provider);
  }

  public getProvider(name: string): AdProvider | undefined {
    return this.providers.get(name);
  }

  public unregisterProvider(name: string) {
    if (this.activeProviderName === name) {
      this.activeProviderName = null;
    }
    this.providers.delete(name);
  }

  public selectProvider(name: string | null) {
    this.activeProviderName = name;
  }

  public getActiveProvider(): AdProvider | undefined {
    return this.activeProviderName ? this.providers.get(this.activeProviderName) : undefined;
  }

  public getActiveProviderName(): string | null {
    return this.activeProviderName;
  }

  public getCapabilities(name: string): CapabilityInfo | null {
    const provider = this.providers.get(name);
    return provider ? provider.capabilities : null;
  }

  public onSourceLoaded(source?: PlayerSource) {
    this.providers.forEach(p => {
      try {
        if (typeof p.onSourceLoaded === 'function') {
          p.onSourceLoaded(source);
        }
      } catch (e) {
        console.error('[ProviderManager] Error running onSourceLoaded for provider:', p.name, e);
      }
    });
  }

  public destroy() {
    this.providers.forEach(p => {
      try {
        p.destroy();
      } catch (e) {
        console.error('[ProviderManager] Error destroying provider:', e);
      }
    });
    this.providers.clear();
    this.activeProviderName = null;
  }
}

// --- Content Snapshot ---
export interface SnapshotState {
  readonly currentTime: number;
  readonly paused: boolean;
  readonly playbackRate: number;
  readonly muted: boolean;
  readonly volume: number;
  readonly activeAudioTrack: number;
  readonly activeSubtitleTrackId: string | null;
  readonly activeQuality: number;
  readonly isFullscreen: boolean;
  readonly pictureInPicture: boolean;
  readonly isAtLiveEdge: boolean;
  readonly liveLatency: number | null;
}

export class ContentSnapshot {
  private snapshot: SnapshotState | null = null;

  public capture(controller: PlayerController): void {
    const s = controller.getState();
    this.snapshot = {
      currentTime: s.currentTime,
      paused: !s.isPlaying,
      playbackRate: s.playbackRate,
      muted: s.isMuted,
      volume: s.volume,
      activeAudioTrack: s.activeAudioTrack,
      activeSubtitleTrackId: s.activeSubtitleTrackId,
      activeQuality: s.qualities.indexOf(s.activeQuality),
      isFullscreen: s.isFullscreen,
      pictureInPicture: s.pictureInPicture,
      isAtLiveEdge: s.isAtLiveEdge,
      liveLatency: s.liveLatency,
    };
  }

  public restore(controller: PlayerController): void {
    if (!this.snapshot) return;
    const state = this.snapshot;
    try {
      controller.setVolume(state.volume);
      controller.setMuted(state.muted);
      controller.setPlaybackRate(state.playbackRate);

      if (state.activeSubtitleTrackId !== null) {
        controller.setSubtitleTrack(state.activeSubtitleTrackId);
      }
      if (state.activeAudioTrack !== -1) {
        controller.setAudioTrack(state.activeAudioTrack);
      }
      // Both setQuality() and seek() are real operations for HLS/DASH - they
      // flush buffers and re-evaluate fragment loading in hls.js/dash.js,
      // unlike native MP4 where re-applying the same value is a cheap no-op.
      // An ad break only pauses the video; quality and position shouldn't
      // have actually changed, so unconditionally re-applying them here was
      // causing a visible stall/rebuffer on every ad break for adaptive
      // sources while being invisible on MP4. Only act if something's
      // actually different from where content already is.
      const postAdState = controller.getState();
      const currentQualityIndex = postAdState.qualities.indexOf(postAdState.activeQuality);
      if (state.activeQuality !== -1 && state.activeQuality !== currentQualityIndex) {
        controller.setQuality(state.activeQuality);
      }

      if (!postAdState.isLive && Math.abs(postAdState.currentTime - state.currentTime) > 0.35) {
        controller.seek(state.currentTime);
      }

      if (state.isFullscreen && !controller.getState().isFullscreen) {
        controller.toggleFullscreen();
      }

      if (state.pictureInPicture && !controller.getState().pictureInPicture) {
        controller.enterPictureInPicture().catch(() => {});
      }

      // Trigger content play when returning from ad break
      try {
        // controller.play() is typed void, but defensively tolerate a
        // Promise-returning override (e.g. a plugin/interceptor) that
        // doesn't match the public signature exactly.
        const res = controller.play() as unknown;
        if (res && typeof (res as { catch?: unknown }).catch === 'function') {
          (res as Promise<unknown>).catch((err: unknown) => {
            console.warn('[ContentSnapshot] Failed to resume content playback:', err);
          });
        }
      } catch (err) {
        console.warn('[ContentSnapshot] Failed to trigger content playback:', err);
      }
    } catch (e) {
      console.error('[ContentSnapshot] Error restoring content state:', e);
    } finally {
      this.snapshot = null;
    }
  }

  public clear(): void {
    this.snapshot = null;
  }

  public exists(): boolean {
    return this.snapshot !== null;
  }
}

// --- Ad Break Queue Manager ---
export class AdBreakManager {
  private activeBreak: AdBreak | null = null;
  private pendingBreaks: AdBreak[] = [];
  private completedBreaks: AdBreak[] = [];
  private cancelledBreaks: AdBreak[] = [];

  public registerBreak(adBreak: AdBreak) {
    this.pendingBreaks.push(adBreak);
    this.pendingBreaks.sort((a, b) => a.timeOffset - b.timeOffset);
  }

  public activateBreak(adBreak: AdBreak) {
    this.activeBreak = adBreak;
    this.pendingBreaks = this.pendingBreaks.filter(b => b.id !== adBreak.id);
  }

  public completeBreak() {
    if (this.activeBreak) {
      this.completedBreaks.push(this.activeBreak);
      this.activeBreak = null;
    }
  }

  public cancelBreak(id: string) {
    if (this.activeBreak?.id === id) {
      this.cancelledBreaks.push(this.activeBreak);
      this.activeBreak = null;
    } else {
      const idx = this.pendingBreaks.findIndex(b => b.id === id);
      if (idx !== -1) {
        this.cancelledBreaks.push(this.pendingBreaks[idx]);
        this.pendingBreaks.splice(idx, 1);
      }
    }
  }

  public clearBreaks() {
    this.activeBreak = null;
    this.pendingBreaks = [];
    this.completedBreaks = [];
    this.cancelledBreaks = [];
  }

  public getActiveBreak(): AdBreak | null {
    return this.activeBreak;
  }

  public getPendingBreaks(): AdBreak[] {
    return this.pendingBreaks;
  }

  public getCompletedBreaks(): AdBreak[] {
    return this.completedBreaks;
  }

  public getCancelledBreaks(): AdBreak[] {
    return this.cancelledBreaks;
  }
}

// --- Async Callbacks Guard ---
export class AsyncGuard {
  private activeToken = 0;

  public generateToken(): number {
    this.activeToken++;
    return this.activeToken;
  }

  public isValid(token: number): boolean {
    return token === this.activeToken;
  }

  public invalidateAll(): void {
    this.activeToken++;
  }
}

// --- Timeout Manager ---
export class TimeoutManager {
  private timers = new Map<string, ReturnType<typeof setTimeout>>();

  public set(id: string, callback: () => void, delayMs: number) {
    this.clear(id);
    const timer = setTimeout(() => {
      this.timers.delete(id);
      callback();
    }, delayMs);
    this.timers.set(id, timer);
  }

  public clear(id: string) {
    const timer = this.timers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(id);
    }
  }

  public clearAll() {
    this.timers.forEach(t => clearTimeout(t));
    this.timers.clear();
  }
}

// --- Diagnostics Statistics ---
export interface ExtendedDiagnosticsStats {
  totalAdsRequested: number;
  totalAdsPlayed: number;
  totalAdsCompleted: number;
  totalAdsSkipped: number;
  totalAdErrors: number;
  recoveryCount: number;
  timeoutCount: number;
  cancelledAdsCount: number;
  providerFailures: number;
  averageLoadTimeMs: number;
  averageResumeTimeMs: number;
  activeOperationsCount: number;
}

// --- Core Ads Lifecycle Manager ---
export class AdsManager implements PlayerPlugin, PlaybackInterceptor {
  public readonly name = 'ads-manager';
  private controller!: PlayerController;
  private state: AdState = AdState.IDLE;
  
  // Hardened Components
  private providerManager = new ProviderManager();
  private contentSnapshot = new ContentSnapshot();
  private adBreakManager = new AdBreakManager();
  private asyncGuard = new AsyncGuard();
  private timeoutManager = new TimeoutManager();
  
  private htmlOverlayRenderer: HtmlOverlayRenderer | null = null;
  private companionRenderers: HtmlOverlayRenderer[] = [];
  private concurrentOverlayRenderers: HtmlOverlayRenderer[] = [];
  private adContainer: HTMLElement | null = null;

  // Synchronization indicators
  private isInterceptionActive = false;
  private currentAd: Advertisement | null = null;
  
  // Expanded diagnostics metrics
  private requestedCount = 0;
  private playedCount = 0;
  private completedCount = 0;
  private skippedCount = 0;
  private errorCount = 0;
  private recoveryCount = 0;
  private timeoutCount = 0;
  private cancelledCount = 0;
  private providerFailuresCount = 0;
  private activeOperations = 0;

  public install(controller: PlayerController) {
    this.controller = controller;
    this.controller.registerPlaybackInterceptor(this);

    // Listen to htmloverlayclosed to end the ad break
    this.controller.on('htmloverlayclosed', () => {
      if (this.currentAd && this.isHtmlOverlayCreative(this.currentAd)) {
        this.endAdBreak();
      }
    });

    this.updatePlayerState();
    this.triggerLifecycleHook('onProviderLoaded');
  }

  public destroy() {
    this.triggerLifecycleHook('onDestroy');
    this.timeoutManager.clearAll();
    this.asyncGuard.invalidateAll();
    this.clearCompanions();
    this.clearConcurrentOverlays();

    if (this.htmlOverlayRenderer) {
      try {
        this.htmlOverlayRenderer.destroy();
      } catch (e) {
        // ignore
      }
      this.htmlOverlayRenderer = null;
    }
    
    if (this.controller) {
      this.controller.unregisterPlaybackInterceptor(this);
    }
    
    this.providerManager.destroy();
    this.adBreakManager.clearBreaks();
    this.contentSnapshot.clear();
    this.currentAd = null;
    this.state = AdState.IDLE;
    this.isInterceptionActive = false;
  }

  public getProviderManager(): ProviderManager {
    return this.providerManager;
  }

  public getAdBreakManager(): AdBreakManager {
    return this.adBreakManager;
  }

  public getAdState(): AdState {
    return this.state;
  }

  public getSavedContentSnapshot(): ContentSnapshot {
    return this.contentSnapshot;
  }

  // --- State Transitions Matrix ---
  public transitionTo(newState: AdState): boolean {
    if (this.state === newState) return true;

    if (newState === AdState.IDLE) {
      const oldState = this.state;
      this.state = newState;
      this.isInterceptionActive = false;
      this.updatePlayerState();
      this.triggerLifecycleHook('onStateChanged', oldState, newState);
      return true;
    }

    const allowed = TRANSITION_TABLE[this.state];
    if (allowed && allowed.includes(newState)) {
      const oldState = this.state;
      this.state = newState;
      
      this.updateDiagnosticsMetrics(oldState, newState);
      this.updatePlayerState();
      this.dispatchStateEvents(oldState, newState);
      this.triggerLifecycleHook('onStateChanged', oldState, newState);
      return true;
    } else {
      console.warn(`[AdsManager] Rejected state transition: ${this.state} -> ${newState}`);
      return false;
    }
  }

  private updateDiagnosticsMetrics(oldState: AdState, newState: AdState) {
    if (newState === AdState.REQUESTING) {
      this.requestedCount++;
    } else if (newState === AdState.PLAYING && oldState !== AdState.PAUSED && oldState !== AdState.BUFFERING) {
      this.playedCount++;
    } else if (newState === AdState.ENDED) {
      this.completedCount++;
    } else if (newState === AdState.SKIPPING) {
      this.skippedCount++;
    } else if (newState === AdState.ERROR) {
      this.errorCount++;
    }
  }

  private dispatchStateEvents(oldState: AdState, newState: AdState) {
    if (!this.controller) return;

    switch (newState) {
      case AdState.REQUESTING:
        this.controller.emit('adloadstart', { adTagUrl: this.controller.config?.ads?.tagUrl ?? '' });
        break;
      case AdState.LOADED:
        if (this.currentAd) {
          this.controller.emit('adloaded', { ad: this.currentAd });
        }
        break;
      case AdState.PLAYING:
        if (oldState === AdState.PAUSED) {
          if (this.currentAd) this.controller.emit('adresume', { ad: this.currentAd });
        } else {
          if (this.currentAd) this.controller.emit('adstart', { ad: this.currentAd });
        }
        break;
      case AdState.PAUSED:
        if (this.currentAd) this.controller.emit('adpause', { ad: this.currentAd });
        break;
      case AdState.SKIPPING:
        if (this.currentAd) this.controller.emit('adskip', { ad: this.currentAd });
        break;
      case AdState.ENDED:
        if (this.currentAd) this.controller.emit('adcomplete', { ad: this.currentAd });
        break;
      case AdState.ERROR:
        break;
    }
  }

  // --- Ad Break Lifecycles ---
  public startAdBreak(adBreak: AdBreak, options?: { skipVideoOwnership?: boolean }) {
    if (this.controller.getState().sourceType === 'embed') {
      this.triggerAdError({
        type: AdErrorType.CONFIGURATION,
        code: 900,
        message: 'VAST ads are not supported for embed (YouTube/Vimeo) sources.',
      });
      return;
    }

    this.activeOperations++;
    this.triggerLifecycleHook('onBreakStarted', adBreak);
    this.adBreakManager.activateBreak(adBreak);

    const firstAd = adBreak.ads[0];
    const isOverlay = firstAd && this.isHtmlOverlayCreative(firstAd);
    const isCompanionOnly = !!firstAd && !firstAd.linear && !isOverlay && !!firstAd.companions && firstAd.companions.length > 0;

    if (isCompanionOnly) {
      // Companion-only ad (no Linear/NonLinear creative of its own - see
      // VastProvider.normalizeCompanionOnlyAdNode): render its companions
      // into the configured slot without pausing content or capturing a
      // snapshot, matching the non-blocking nature companion ads already
      // have during normal linear playback (see showCompanions() below).
      // Deliberately skips endAdBreak()'s clearCompanions() so the banner
      // persists - same lifecycle as a companion attached to a linear ad,
      // which stays up until that ad's own break naturally ends.
      this.isInterceptionActive = false;
      this.currentAd = firstAd;
      this.controller.emit('adbreakstart', { adId: adBreak.id, duration: adBreak.duration });
      this.transitionTo(AdState.REQUESTING);
      this.transitionTo(AdState.LOADED);
      this.showCompanions(firstAd.companions!);
      this.adBreakManager.completeBreak();
      this.controller.emit('adbreakend');
      this.transitionTo(AdState.IDLE);
      this.activeOperations = Math.max(0, this.activeOperations - 1);
    } else if (isOverlay) {
      // Non-linear overlay path: Do NOT pause content or capture snapshot.
      this.isInterceptionActive = false;
      // Set currentAd (linear: false) before the REQUESTING transition so
      // updatePlayerState()'s isAdPlaying computation already knows this is a
      // non-blocking overlay from the very first state update - otherwise
      // isAdPlaying briefly defaults to true for a frame while currentAd is
      // still null, causing a flicker where controls hide then reappear.
      this.currentAd = firstAd;
      this.controller.emit('adbreakstart', { adId: adBreak.id, duration: adBreak.duration });
      this.transitionTo(AdState.REQUESTING);

      this.playHtmlOverlay(firstAd);
    } else {
      this.isInterceptionActive = true;
      
      // Immutable Capture Snapshot
      this.contentSnapshot.capture(this.controller);
      this.triggerLifecycleHook('onContentPaused');

      if (!options?.skipVideoOwnership) {
        // Pause primary VOD/Live stream cleanly bypassing pause interception.
        // Skipped when the provider renders the ad through the main video
        // element itself (e.g. Google IMA) - pausing it here would fight
        // with the provider's own playback of the ad on that same element.
        this.isInterceptionActive = false;
        try {
          this.controller.getVideoElement().pause();
        } catch (e) {
          console.error('[AdsManager] Pause main content error:', e);
        }
        this.isInterceptionActive = true;
      }

      this.controller.emit('adbreakstart', { adId: adBreak.id, duration: adBreak.duration });
      this.transitionTo(AdState.REQUESTING);
    }
  }

  public skipAd(): void {
    const provider = this.providerManager.getActiveProvider();
    if (provider) {
      try {
        if (typeof provider.skipAd === 'function') {
          provider.skipAd();
        } else if (typeof provider.destroy === 'function') {
          provider.destroy();
        }
      } catch (e) {
        console.error('[AdsManager] Error skipping provider ad:', e);
      }
    }
    this.transitionTo(AdState.SKIPPING);
    this.controller.emit('adskip');
    this.endAdBreak();
  }

  public endAdBreak() {
    this.transitionTo(AdState.CONTENT_RESUMING);
    this.triggerLifecycleHook('onBreakCompleted');
    this.clearCompanions();
    this.clearConcurrentOverlays();
    this.adBreakManager.completeBreak();
    
    // Snapshot Restoration
    if (this.contentSnapshot.exists()) {
      this.isInterceptionActive = false;
      this.contentSnapshot.restore(this.controller);
      this.triggerLifecycleHook('onContentResumed');
    }

    this.isInterceptionActive = false;
    this.controller.emit('adbreakend');
    this.transitionTo(AdState.IDLE);
    this.activeOperations = Math.max(0, this.activeOperations - 1);
  }

  // --- Recovery Framework ---
  public recover(reason: string) {
    this.recoveryCount++;
    console.warn(`[AdsManager] Entering recovery path due to: ${reason}`);
    this.triggerLifecycleHook('onRecovery', reason);
    
    this.timeoutManager.clearAll();
    this.asyncGuard.invalidateAll();

    if (this.htmlOverlayRenderer) {
      try {
        this.htmlOverlayRenderer.destroy();
      } catch (e) {
        // ignore
      }
      this.htmlOverlayRenderer = null;
    }

    this.currentAd = null;
    this.endAdBreak();
  }

  public triggerAdError(error: AdError) {
    this.errorCount++;
    this.providerFailuresCount++;
    this.controller.emit('aderror', { error });
    this.recover(`aderror: ${error.message}`);
  }

  // --- Timeout Framework Interface ---
  public scheduleTimeout(id: string, delayMs: number, reason: string) {
    const token = this.asyncGuard.generateToken();
    this.timeoutManager.set(id, () => {
      if (this.asyncGuard.isValid(token)) {
        this.timeoutCount++;
        console.warn(`[TimeoutManager] Expired operation timeout: "${id}"`);
        this.recover(reason);
      }
    }, delayMs);
  }

  public cancelTimeout(id: string) {
    this.timeoutManager.clear(id);
  }

  public setAdContainer(container: HTMLElement) {
    this.adContainer = container;
  }

  public getAdContainer(): HTMLElement | null {
    return this.adContainer || this.controller?.getVideoElement()?.parentElement || null;
  }

  // --- Provider Handshake context helper ---
  public createProviderContext(adContainer?: HTMLElement): ProviderContext {
    const container = adContainer || this.getAdContainer() || (typeof document !== 'undefined' ? document.body : null);
    if (container && container instanceof HTMLElement) {
      this.adContainer = container;
    }
    return {
      videoElement: this.controller.getVideoElement(),
      adContainer: this.adContainer || (container as HTMLElement),
      controller: this.controller,
      config: this.controller.config?.ads || {},
    };
  }

  public setCurrentAd(ad: Advertisement | null) {
    const isAdChanged = this.currentAd !== ad;
    this.currentAd = ad;
    if (isAdChanged && ad) {
      this.controller.updateStatePublic({
        adCurrentTime: 0,
        adRemainingTime: ad.duration,
        adDuration: ad.duration,
      });
    }
    this.updatePlayerState();
  }

  // --- State Synchronization ---
  private updatePlayerState() {
    if (!this.controller) return;

    // HTML Overlay/NonLinear ads (linear: false) never take over the main video -
    // content keeps playing normally underneath them - so they must not trigger
    // the UI's ad mode (hiding controls, showing the ad badge/countdown, etc).
    // Only actual video-occupying Linear ads should set isAdPlaying.
    const isAdLinearOrLoading = this.currentAd ? this.currentAd.linear !== false : true;
    const isAdPlaying = (
      this.state === AdState.REQUESTING ||
      this.state === AdState.LOADED ||
      this.state === AdState.PLAYING ||
      this.state === AdState.PAUSED ||
      this.state === AdState.BUFFERING ||
      this.state === AdState.SKIPPING ||
      this.state === AdState.ENDED
    ) && isAdLinearOrLoading;
    const isAdLoading = (this.state === AdState.REQUESTING || this.state === AdState.LOADED);

    const activeBreak = this.adBreakManager.getActiveBreak();
    const activeProvider = this.providerManager.getActiveProviderName();
    const currentState = this.controller.getState();

    this.controller.updateStatePublic({
      isAdPlaying,
      isAdLoading,
      currentAd: this.currentAd,
      currentAdBreak: activeBreak,
      adProvider: activeProvider,
      adCurrentTime: isAdPlaying && this.currentAd ? (currentState.adCurrentTime ?? 0) : null,
      adRemainingTime: isAdPlaying && this.currentAd ? (currentState.adRemainingTime ?? this.currentAd.duration) : null,
      adDuration: isAdPlaying && this.currentAd ? (this.currentAd.duration || currentState.adDuration || 0) : null,
      canSkipAd: currentState.canSkipAd ?? (this.currentAd?.skippable ?? false),
      skipAvailableAt: currentState.skipAvailableAt ?? (this.currentAd?.skipOffset ?? null),
      adPosition: this.currentAd ? (activeBreak?.ads.indexOf(this.currentAd) ?? null) : null,
      adLinear: this.currentAd?.linear ?? null,
      adMuted: this.controller.getState().isMuted,
    });
  }

  // --- Playback Interceptor Implementation ---
  public play(): Promise<boolean> | boolean {
    if (!this.isInterceptionActive) return false;
    
    const provider = this.providerManager.getActiveProvider();
    if (provider) {
      try {
        provider.resumeAd();
        this.transitionTo(AdState.PLAYING);
      } catch (e) {
        console.error('[AdsManager] Play ad execution failed:', e);
      }
      return true;
    }
    return true;
  }

  public pause(): boolean {
    if (!this.isInterceptionActive) return false;
    
    const provider = this.providerManager.getActiveProvider();
    if (provider) {
      try {
        provider.pauseAd();
        this.transitionTo(AdState.PAUSED);
      } catch (e) {
        console.error('[AdsManager] Pause ad execution failed:', e);
      }
      return true;
    }
    return true;
  }

  public seek(time: number): boolean {
    if (!this.isInterceptionActive) return false;
    return true; // block main content seek
  }

  public setVolume(vol: number): boolean {
    if (!this.isInterceptionActive) return false;
    const provider = this.providerManager.getActiveProvider();
    if (provider) {
      try {
        provider.setVolume(vol);
      } catch (e) {
        // ignore
      }
    }
    return false;
  }

  public setMuted(muted: boolean): boolean {
    if (!this.isInterceptionActive) return false;
    const provider = this.providerManager.getActiveProvider();
    if (provider) {
      try {
        provider.setMuted(muted);
      } catch (e) {
        // ignore
      }
    }
    this.controller.updateStatePublic({ adMuted: muted });
    return false;
  }

  // --- Internal Extension Hook points ---
  private triggerLifecycleHook(hookName: string, ...args: unknown[]) {
    // Hooks reserved for provider adapters
    switch (hookName) {
      case 'onProviderLoaded':
      case 'onProviderDestroyed':
      case 'onBreakStarted':
      case 'onBreakCompleted':
      case 'onContentPaused':
      case 'onContentResumed':
      case 'onRecovery':
      case 'onSourceChanged':
      case 'onDestroy':
        break;
    }
  }

  // --- Live Extension Hooks (Reserved) ---
  public liveEdgeSyncHook() {}
  public dvrPositionHook() {}
  public catchUpPlaybackHook() {}
  public liveSourceSwitchHook() {}

  // --- Playlist Extension Hooks (Reserved) ---
  public playlistItemStartHook() {}
  public playlistItemEndHook() {}
  public autoplayNextItemHook() {}
  public playlistRepeatHook() {}
  public playlistNavigationHook() {}

  // --- Source Switch Lifecycle ---
  public getHtmlOverlayRenderer(): HtmlOverlayRenderer | null {
    return this.htmlOverlayRenderer;
  }

  private applyDefaultSanitizer(ad: Advertisement): Advertisement {
    if (ad.sanitizeHtml || !ad.htmlContent) return ad;
    const defaultSanitizer = this.controller.config?.ads?.ui?.sanitizeHtml || defaultHtmlSanitizer;
    return { ...ad, sanitizeHtml: defaultSanitizer };
  }

  public isHtmlOverlayCreative(ad: Advertisement): boolean {
    return (
      ad &&
      !ad.linear &&
      (!!ad.htmlContent || !!ad.htmlUrl || !!ad.htmlTemplateId || !!ad.imageUrl)
    );
  }

  public showCompanions(companions: Advertisement[]) {
    if (!companions || companions.length === 0) return;

    this.clearCompanions();

    const uiConfig = this.controller.config?.ads?.ui;
    const companionSlots = uiConfig?.companionSlots;

    if (companionSlots && companionSlots.length > 0) {
      const matches = matchCompanionsToSlots(companions, companionSlots);
      matches.forEach(({ slot, companion }) => {
        const container = document.getElementById(slot.elementId);
        if (!container) {
          this.controller.emit('companionerror', { adId: companion.id, slotId: slot.id, reason: `elementId "${slot.elementId}" not found` });
          return;
        }
        const renderer = new HtmlOverlayRenderer(this.controller, container, undefined, true);
        this.companionRenderers.push(renderer);
        companion = this.applyDefaultSanitizer(companion);
        renderer.loadAd(companion).then((success) => {
          if (success) {
            renderer.show();
            this.controller.emit('companionshown', { adId: companion.id, slotId: slot.id });
          } else {
            // Non-fatal: the linear ad keeps playing, the companion is just not shown.
            this.fireOverlayErrorPixels(companion);
            this.controller.emit('companionerror', { adId: companion.id, slotId: slot.id, reason: 'load failed' });
          }
        });
      });
      return;
    }

    // Fallback: original single-slot behavior (unchanged when companionSlots isn't configured)
    const companion = this.applyDefaultSanitizer(companions[0]);
    const slotSelector = uiConfig?.adOverlaySlot;
    const externalSlot = slotSelector
      ? (document.querySelector(slotSelector) as HTMLElement | null)
      : null;

    // Companion ads are out-of-stream display creatives meant for external page slots.
    // They must NEVER fall back to rendering inside the video player container over playing linear video ads.
    if (!slotSelector) {
      console.warn(
        '[AdsManager] VAST response included a Companion ad, but no "ads.ui.companionSlots" or ' +
        '"ads.ui.adOverlaySlot" is configured, so it cannot be displayed. Configure one to show companion ads.'
      );
      this.controller.emit('companionerror', { adId: companion.id, reason: 'no companionSlots or adOverlaySlot configured' });
      return;
    }
    if (!externalSlot) {
      console.warn(`[AdsManager] "ads.ui.adOverlaySlot" ("${slotSelector}") did not match any element in the DOM.`);
      this.controller.emit('companionerror', { adId: companion.id, reason: `adOverlaySlot "${slotSelector}" not found in DOM` });
      return;
    }

    const container = externalSlot;

    const renderer = new HtmlOverlayRenderer(this.controller, container as HTMLElement, undefined, true);
    this.companionRenderers.push(renderer);

    renderer.loadAd(companion).then((success) => {
      if (success) {
        renderer.show();
      } else {
        // Non-fatal: the linear ad keeps playing, the companion is just not shown.
        this.fireOverlayErrorPixels(companion);
      }
    });
  }

  private clearCompanions() {
    this.companionRenderers.forEach((renderer) => {
      try {
        renderer.destroy();
      } catch (e) {
        // ignore
      }
    });
    this.companionRenderers = [];
  }

  /**
   * Renders NonLinear overlay ads declared inside the SAME VAST <Ad> as the
   * Linear creative currently playing - i.e. an overlay banner shown ON TOP
   * of the ad video while it plays, per the standard IAB VAST pattern. Unlike
   * `playHtmlOverlay()`, this does NOT touch `currentAd` or the AdState
   * machine - it's a passive, fire-and-forget render alongside the Linear ad,
   * exactly like `showCompanions()` except targeting the player container
   * instead of an external page slot.
   */
  public showConcurrentOverlays(nonLinearAds: Advertisement[]) {
    if (!nonLinearAds || nonLinearAds.length === 0) return;
    this.clearConcurrentOverlays();

    const container = this.adContainer || this.controller.getVideoElement()?.parentElement;
    if (!container) return;

    nonLinearAds.forEach((ad) => {
      const sanitizedAd = this.applyDefaultSanitizer(ad);
      const renderer = new HtmlOverlayRenderer(this.controller, container as HTMLElement, undefined, false);
      this.concurrentOverlayRenderers.push(renderer);
      renderer.loadAd(sanitizedAd).then((success) => {
        if (success) {
          renderer.show();
        } else {
          this.fireOverlayErrorPixels(sanitizedAd);
        }
      });
    });
  }

  /**
   * Clears both companion ads and concurrent NonLinear overlays. Providers
   * call this before playing the next ad in a pod, so a previous ad's
   * companion/overlay isn't left stuck on screen if the next ad has none of
   * its own (showCompanions/showConcurrentOverlays only run when there IS
   * something new to show, so a previous render would otherwise never clear).
   */
  public clearAuxiliaryOverlays() {
    this.clearCompanions();
    this.clearConcurrentOverlays();
  }

  private clearConcurrentOverlays() {
    this.concurrentOverlayRenderers.forEach((renderer) => {
      try {
        renderer.destroy();
      } catch (e) {
        // ignore
      }
    });
    this.concurrentOverlayRenderers = [];
  }

  private fireOverlayErrorPixels(ad: Advertisement | null) {
    const errorUrls = ad?.errorUrls;
    if (!errorUrls || errorUrls.length === 0) return;
    errorUrls.forEach((url) => {
      const replaced = url.replace(/\[ERRORCODE\]/g, '900');
      try {
        if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
          navigator.sendBeacon(replaced);
        } else if (typeof fetch !== 'undefined') {
          fetch(replaced, { method: 'GET', mode: 'no-cors', keepalive: true }).catch(() => {});
        }
      } catch (e) {
        // ignore
      }
    });
  }

  public async showOverlay(adOrConfig: Advertisement | HtmlOverlayConfig): Promise<boolean> {
    const ad: Advertisement = {
      id: adOrConfig.id || `overlay-${Date.now()}`,
      title: adOrConfig.title || 'HTML Overlay Ad',
      duration: adOrConfig.duration || 0,
      linear: false,
      skippable: false,
      ...adOrConfig,
    };
    await this.playHtmlOverlay(ad);
    return this.htmlOverlayRenderer?.getLifecycleState() === 'visible';
  }

  public hideOverlay(): void {
    if (this.htmlOverlayRenderer) {
      this.htmlOverlayRenderer.hide();
    }
  }

  public closeOverlay(): void {
    if (this.htmlOverlayRenderer) {
      this.htmlOverlayRenderer.close();
      this.htmlOverlayRenderer = null;
    }
  }

  public updateOverlay(patch: Partial<HtmlOverlayConfig>): void {
    if (this.htmlOverlayRenderer) {
      this.htmlOverlayRenderer.updateOverlay(patch);
    }
  }

  public async playHtmlOverlay(ad: Advertisement) {
    const container =
      this.adContainer || (this.controller.getVideoElement()?.parentNode as HTMLElement | null | undefined);
    if (!container) {
      this.triggerAdError({
        type: AdErrorType.PLAYBACK,
        code: 400,
        message: 'Ad container not found for HTML overlay rendering',
      });
      return;
    }

    if (this.htmlOverlayRenderer) {
      try {
        this.htmlOverlayRenderer.destroy();
      } catch (e) {
        // ignore
      }
    }

    this.htmlOverlayRenderer = new HtmlOverlayRenderer(this.controller, container);
    ad = this.applyDefaultSanitizer(ad);
    this.setCurrentAd(ad);

    this.transitionTo(AdState.LOADED);

    const success = await this.htmlOverlayRenderer.loadAd(ad);
    if (!success) {
      this.fireOverlayErrorPixels(ad);
      return;
    }

    this.transitionTo(AdState.PLAYING);
    this.htmlOverlayRenderer.show();
  }

  public onSourceLoaded(source?: PlayerSource) {
    this.triggerLifecycleHook('onSourceChanged', source);
    this.handleSourceSwitch();
  }

  public handleSourceSwitch() {
    this.timeoutManager.clearAll();
    this.asyncGuard.invalidateAll();
    this.adBreakManager.clearBreaks();
    this.contentSnapshot.clear();
    this.clearCompanions();
    this.clearConcurrentOverlays();

    if (this.htmlOverlayRenderer) {
      try {
        this.htmlOverlayRenderer.destroy();
      } catch (e) {
        // ignore
      }
      this.htmlOverlayRenderer = null;
    }

    this.providerManager.onSourceLoaded();

    this.currentAd = null;
    this.state = AdState.IDLE;
    this.isInterceptionActive = false;
    this.activeOperations = 0;
    this.updatePlayerState();
  }

  public getDiagnosticsStats(): ExtendedDiagnosticsStats {
    return {
      totalAdsRequested: this.requestedCount,
      totalAdsPlayed: this.playedCount,
      totalAdsCompleted: this.completedCount,
      totalAdsSkipped: this.skippedCount,
      totalAdErrors: this.errorCount,
      recoveryCount: this.recoveryCount,
      timeoutCount: this.timeoutCount,
      cancelledAdsCount: this.cancelledCount,
      providerFailures: this.providerFailuresCount,
      averageLoadTimeMs: 0,
      averageResumeTimeMs: 0,
      activeOperationsCount: this.activeOperations,
    };
  }
}
