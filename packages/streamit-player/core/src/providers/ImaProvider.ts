import {
  AdProvider,
  ProviderContext,
  ProviderResult,
  CapabilityInfo,
  AdBreak,
  AdError,
  AdErrorType,
  AdState,
} from '../types';
import { AdsManager } from '../AdsManager';

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/**
 * Shape of the `providerOptions.ima` opaque payload this provider reads.
 * `AdsConfig.providerOptions` is intentionally `Record<string, unknown>` in
 * `types.ts` (its shape varies per ad provider) - this is the IMA-specific
 * narrowing applied at the point of consumption.
 */
interface ImaProviderOptions {
  publisherProvidedId?: string;
  sessionId?: string;
  language?: string;
  locale?: string;
  customTargeting?: Record<string, string>;
}

/**
 * Minimal structural typings for the parts of the Google IMA SDK
 * (`google.ima`, loaded dynamically at runtime from a CDN script - no npm
 * package/types exist for it) that this provider actually touches. Verified
 * against how each is constructed/consumed below, and Google's published
 * IMA3 HTML5 SDK reference.
 */
interface ImaAdPodInfo {
  getAdPosition?: () => number;
  getTotalAds?: () => number;
  isBumper?: () => boolean;
}

interface ImaCompanionAd {
  getWidth?: () => number;
  getHeight?: () => number;
  getContent?: () => string;
  getClickThroughUrl?: () => string;
}

interface ImaAd {
  getAdId: () => string;
  getTitle: () => string;
  getDuration: () => number;
  getWidth: () => number;
  getHeight: () => number;
  isLinear: () => boolean;
  isSkippable?: () => boolean;
  getSkippable?: () => boolean;
  getSkipTimeOffset?: () => number;
  getContentType: () => string;
  getClickThroughUrl?: () => string;
  getAdPodInfo?: () => ImaAdPodInfo;
  getCompanionAds?: () => ImaCompanionAd[];
}

interface ImaAdData {
  currentTime?: number;
  duration?: number;
  skippable?: boolean;
  skipTimeOffset?: number;
  clickThroughUrl?: string;
}

/** Payload passed to AdEvent listeners (LOADED, AD_PROGRESS, CLICK, etc). */
interface ImaAdEventLike {
  getAd?: () => ImaAd;
  getAdData?: () => ImaAdData;
}

interface ImaAdErrorLike {
  getErrorCode?: () => number;
  getMessage?: () => string;
}

/** Payload passed to AdErrorEvent listeners, and the shape onAdError() takes
 * (including the synthetic literals this file constructs for internal
 * watchdog/config errors that don't come from a real IMA event). */
interface ImaAdErrorEventLike {
  getError: () => ImaAdErrorLike;
}

interface ImaAdsRequest {
  adTagUrl: string;
  linearAdSlotWidth?: number;
  linearAdSlotHeight?: number;
  nonLinearAdSlotWidth?: number;
  nonLinearAdSlotHeight?: number;
  publisherProvidedId?: string;
  sessionId?: string;
  customParameters?: string;
  setAdWillAutoPlay?: (val: boolean) => void;
  setAdWillPlayMuted?: (val: boolean) => void;
}

interface ImaAdDisplayContainer {
  initialize: () => void;
  destroy: () => void;
}

interface ImaAdsRenderingSettings {
  restorePlayerStateOnAdComplete: boolean;
}

interface ImaAdsManager {
  addEventListener: <E>(type: string, listener: (e: E) => void, useCapture?: boolean) => void;
  removeEventListener: <E>(type: string, listener: (e: E) => void) => void;
  init: (width: number, height: number, viewMode: string) => void;
  start: () => void;
  pause: () => void;
  resume: () => void;
  skip: () => void;
  destroy: () => void;
  resize: (width: number, height: number, viewMode: string) => void;
  setVolume: (volume: number) => void;
}

interface ImaAdsManagerLoadedEvent {
  getAdsManager: (video: HTMLVideoElement, settings: ImaAdsRenderingSettings) => ImaAdsManager;
}

interface ImaAdsLoader {
  addEventListener: <E>(type: string, listener: (e: E) => void, useCapture?: boolean) => void;
  removeEventListener: <E>(type: string, listener: (e: E) => void) => void;
  requestAds: (request: ImaAdsRequest) => void;
  destroy: () => void;
}

interface ImaSettings {
  getLocale?: () => string;
  setLanguage: (lang: string) => void;
  setLocale: (locale: string) => void;
}

interface ImaNamespace {
  AdDisplayContainer: new (container: HTMLElement, video: HTMLVideoElement) => ImaAdDisplayContainer;
  AdsLoader: new (container: ImaAdDisplayContainer) => ImaAdsLoader;
  AdsRequest: new () => ImaAdsRequest;
  AdsRenderingSettings: new () => ImaAdsRenderingSettings;
  AdsManagerLoadedEvent: { Type: { ADS_MANAGER_LOADED: string } };
  AdErrorEvent: { Type: { AD_ERROR: string } };
  AdEvent: {
    Type: {
      CONTENT_PAUSE_REQUESTED: string;
      CONTENT_RESUME_REQUESTED: string;
      ALL_ADS_COMPLETED?: string;
      LOADED: string;
      AD_PROGRESS: string;
      STARTED: string;
      PAUSED: string;
      RESUMED: string;
      COMPLETE: string;
      SKIPPED: string;
      CLICK: string;
      AD_BREAK_READY: string;
    };
  };
  ViewMode: { FULLSCREEN: string; NORMAL: string };
  settings: ImaSettings;
}

declare global {
  interface Window {
    google?: { ima?: ImaNamespace };
  }
}

export interface ImaDiagnostics {
  sdkLoaded: boolean;
  sdkVersion: string;
  sdkLoadDurationMs: number;
  adsLoaderState: 'idle' | 'requesting' | 'ready' | 'error';
  adsManagerState: 'idle' | 'ready' | 'playing' | 'paused' | 'destroyed';
  lastErrorMsg: string;
  lastErrorCode: number;
  eventsLogged: string[];
  /**
   * True once loadImaSdk() has failed in a way consistent with a browser
   * or extension ad blocker (script.onerror, or the tag never resolving at
   * all within SDK_LOAD_TIMEOUT_MS - some blockers hang the request instead
   * of erroring). This can't be proven from JS (that's the point of an ad
   * blocker), so treat it as "likely", not certain.
   */
  sdkBlockedLikely: boolean;
}

/** Interface for errors annotated with the ad-blocker heuristic below. */
interface LikelyBlockedError extends Error {
  likelyBlocked?: boolean;
}

const SDK_LOAD_TIMEOUT_MS = 8000;

let sdkLoadPromise: Promise<void> | null = null;
let sdkLoadTime = 0;
let sdkBlockedLikely = false;

function loadImaSdk(): Promise<void> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return Promise.reject(new Error('IMA SDK can only be loaded in a browser environment'));
  }
  if (window.google?.ima) {
    return Promise.resolve();
  }
  if (sdkLoadPromise) {
    return sdkLoadPromise;
  }

  const start = Date.now();
  sdkLoadPromise = new Promise<void>((resolve, reject) => {
    let settled = false;
    const script = document.createElement('script');
    script.src = 'https://imasdk.googleapis.com/js/sdkloader/ima3.js';
    script.async = true;

    // Some blockers silently drop the request instead of firing onerror -
    // if neither onload nor onerror has fired within the timeout, treat it
    // as a blocked load rather than leaving the caller hanging indefinitely.
    const timeoutId = setTimeout(() => {
      if (settled) return;
      settled = true;
      sdkBlockedLikely = true;
      const err: LikelyBlockedError = new Error(
        `Google IMA SDK did not load within ${SDK_LOAD_TIMEOUT_MS}ms. This commonly means the request to ` +
        `imasdk.googleapis.com was blocked by a browser-level or extension ad blocker (e.g. Opera's built-in ` +
        `blocker, uBlock Origin, AdGuard) rather than a real network failure - check the Network tab for a ` +
        `canceled/blocked request to that domain.`
      );
      err.likelyBlocked = true;
      reject(err);
    }, SDK_LOAD_TIMEOUT_MS);

    script.onload = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      if (window.google?.ima) {
        sdkLoadTime = Date.now() - start;
        sdkBlockedLikely = false;
        resolve();
      } else {
        reject(new Error('IMA SDK script loaded but google.ima is not available'));
      }
    };
    script.onerror = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      sdkBlockedLikely = true;
      const err: LikelyBlockedError = new Error(
        'Failed to load Google IMA SDK script from imasdk.googleapis.com. This commonly indicates the request ' +
        'was blocked by a browser-level or extension ad blocker rather than an actual network outage.'
      );
      err.likelyBlocked = true;
      reject(err);
    };
    document.head.appendChild(script);
  }).catch((err) => {
    // Let the next requestAds() call retry the load instead of caching a
    // failed promise forever (e.g. the user disables their ad blocker).
    sdkLoadPromise = null;
    throw err;
  });

  return sdkLoadPromise;
}

// Google IMA SDK documented error codes (google.ima.AdError.ErrorCode)
export function mapImaErrorCode(code: number): AdErrorType {
  if ([1005, 1009, 1010, 1011, 1012, 1020].includes(code)) return AdErrorType.PARSING;
  if ([100, 101, 102, 1006, 1007].includes(code)) return AdErrorType.CONFIGURATION;
  if ([301, 303, 1021, 1022, 1023].includes(code)) return AdErrorType.NETWORK;
  if ([400, 401, 402, 403, 405].includes(code)) return AdErrorType.PLAYBACK;
  return AdErrorType.UNKNOWN;
}

export class ImaProvider implements AdProvider {
  public readonly name = 'IMA';
  public readonly capabilities: CapabilityInfo = {
    supportsLinear: true,
    supportsNonLinear: true,
    supportsCompanion: true,
    supportsSkippable: true,
    supportsVMAP: true,
    supportsVAST: true,
    supportsSSAI: false,
    supportsIMA: true,
  };

  private context: ProviderContext | null = null;
  private manager: AdsManager | null = null;

  // IMA Native Instances
  private adDisplayContainer: ImaAdDisplayContainer | null = null;
  private adsLoader: ImaAdsLoader | null = null;
  private adsManager: ImaAdsManager | null = null;

  // States
  private loaderState: 'idle' | 'requesting' | 'ready' | 'error' = 'idle';
  private managerState: 'idle' | 'ready' | 'playing' | 'paused' | 'destroyed' = 'idle';
  private currentTag = '';

  // Watches for the ad break silently hanging: IMA can render its own UI
  // chrome (ad badge, skip countdown - driven off AD_PROGRESS, which the
  // SDK can emit even when the underlying ad video never actually attaches/
  // paints) while STARTED, the event that actually confirms real playback,
  // never fires. Without this, that failure mode is completely silent -
  // no console error, no network anomaly - exactly the symptom that's hard
  // to diagnose from outside. Converts it into a real, visible AdError.
  private startWatchdogTimer: ReturnType<typeof setTimeout> | null = null;
  private static readonly START_WATCHDOG_MS = 6000;

  // Once STARTED has fired, IMA believes it's genuinely playing - but that
  // belief is based on its own internal state, not on whether its ad
  // container element is still actually attached to the visible page. If a
  // host app's rendering framework (Lit, React, etc.) ever replaces or
  // removes the ads-overlay container after IMA has already attached its
  // iframe to it, IMA keeps ticking along internally (AD_PROGRESS, eventual
  // COMPLETE) while nothing is visible - the same dead-end "badge shows,
  // nothing plays" symptom as the pre-STARTED case the watchdog above
  // covers, just occurring later in the lifecycle. This polls for exactly
  // that and surfaces it as a clear, diagnosable error instead of silence.
  private containerWatchTimer: ReturnType<typeof setInterval> | null = null;
  private static readonly CONTAINER_WATCH_INTERVAL_MS = 1000;

  // Diagnostics
  private diagnostics: ImaDiagnostics = {
    sdkLoaded: false,
    sdkVersion: 'Unknown',
    sdkLoadDurationMs: 0,
    adsLoaderState: 'idle',
    adsManagerState: 'idle',
    lastErrorMsg: '',
    lastErrorCode: 0,
    eventsLogged: [],
    sdkBlockedLikely: false,
  };

  public init(context: ProviderContext): ProviderResult {
    this.context = context;
    if (context.controller && context.controller.ads) {
      this.manager = context.controller.ads.manager;
    }
    // Eagerly start loading the IMA SDK script (fire-and-forget) so it's
    // likely already available by the time a real ad is requested - this
    // matters because AdDisplayContainer.initialize() must run
    // synchronously in response to the user's gesture, and can't wait on
    // an in-flight script load without losing that gesture context.
    if (typeof window !== 'undefined') {
      loadImaSdk().catch(() => {
        /* real failures surface later, when requestAds() awaits it directly */
      });
    }
    return { success: true };
  }

  public async requestAds(adTagUrl: string, config?: Record<string, unknown>): Promise<ProviderResult> {
    const providedContext = config?.context as ProviderContext | undefined;
    if ((!this.context || !this.manager) && providedContext) {
      this.init(providedContext);
    }
    if (!this.context || !this.manager) {
      return {
        success: false,
        error: {
          type: AdErrorType.CONFIGURATION,
          code: 100,
          message: 'ImaProvider not initialized.',
        },
      };
    }

    this.currentTag = adTagUrl;

    // If the SDK is already loaded (typical, since init() preloads it), arm
    // the display container synchronously, right here, before any `await` -
    // this is what preserves the calling user gesture. If the SDK isn't
    // ready yet, this falls through to the awaited path below, which still
    // works but risks losing gesture context on a slow first load.
    if (window.google?.ima) {
      this.initializeImaLoader();
    }

    try {
      this.loaderState = 'requesting';
      this.diagnostics.adsLoaderState = 'requesting';

      // Safe lazy loading
      await loadImaSdk();

      const ima = window.google!.ima!;
      this.diagnostics.sdkLoaded = true;
      this.diagnostics.sdkLoadDurationMs = sdkLoadTime;
      this.diagnostics.sdkBlockedLikely = false;
      if (ima.settings) {
        this.diagnostics.sdkVersion = String(ima.settings.getLocale?.() || '3.x');
      }

      this.initializeImaLoader();

      // Create request payload
      const adsRequest = new ima.AdsRequest();
      adsRequest.adTagUrl = adTagUrl;

      // Required by IMA for correct linear/non-linear creative selection and
      // rendering size - every Google IMA sample sets these; omitting them
      // can result in an ad that "plays" per its own internal state/events
      // but never actually paints visible video.
      const slotWidth = this.context.videoElement.clientWidth || 640;
      const slotHeight = this.context.videoElement.clientHeight || 360;
      adsRequest.linearAdSlotWidth = slotWidth;
      adsRequest.linearAdSlotHeight = slotHeight;
      adsRequest.nonLinearAdSlotWidth = slotWidth;
      adsRequest.nonLinearAdSlotHeight = Math.round(slotHeight / 3);

      // Tell IMA upfront that the ad will autoplay muted, so it initializes
      // its internal ad video correctly for the browser's autoplay policy.
      // Matching this to content's *current* mute state (tried previously)
      // isn't good enough: the later `await requestPromise` below is a real
      // network round trip to fetch/parse the ad tag, which can burn
      // through the page's brief "recent user gesture" window - so even an
      // *unmuted* hint that matches unmuted content can still get silently
      // blocked by the browser once .start() actually runs, with no
      // console error and no network anomaly (autoplay-policy blocks don't
      // produce either). IMA's own UI chrome (skip button, countdown)
      // renders regardless, since that's independent of the ad video's
      // play() actually succeeding - producing exactly "ad badge and skip
      // countdown show, video never plays, nothing to debug." Browsers
      // never block *muted* autoplay, so always starting muted is the only
      // way to guarantee the ad actually plays; see the matching
      // adsManager.setVolume(0) in playAdBreak() below.
      if (typeof adsRequest.setAdWillAutoPlay === 'function') {
        adsRequest.setAdWillAutoPlay(true);
      }
      if (typeof adsRequest.setAdWillPlayMuted === 'function') {
        adsRequest.setAdWillPlayMuted(true);
      }

      // Map dynamic request features
      const options = this.context.config.providerOptions?.ima as ImaProviderOptions | undefined;
      if (options) {
        if (options.publisherProvidedId) adsRequest.publisherProvidedId = options.publisherProvidedId;
        if (options.sessionId) adsRequest.sessionId = options.sessionId;
        if (options.language) ima.settings.setLanguage(options.language);
        if (options.locale) ima.settings.setLocale(options.locale);
        if (options.customTargeting) {
          // Custom tag variables mapping
          const parts: string[] = [];
          for (const key in options.customTargeting) {
            parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(options.customTargeting[key])}`);
          }
          adsRequest.customParameters = parts.join('&');
        }
      }

      // Execute request and wait for ADS_MANAGER_LOADED
      const adsLoader = this.adsLoader!;
      const requestPromise = new Promise<void>((resolve, reject) => {
        const loadedHandler = () => {
          adsLoader.removeEventListener(ima.AdsManagerLoadedEvent.Type.ADS_MANAGER_LOADED, loadedHandler);
          adsLoader.removeEventListener(ima.AdErrorEvent.Type.AD_ERROR, errorHandler);
          resolve();
        };
        const errorHandler = (e: ImaAdErrorEventLike) => {
          adsLoader.removeEventListener(ima.AdsManagerLoadedEvent.Type.ADS_MANAGER_LOADED, loadedHandler);
          adsLoader.removeEventListener(ima.AdErrorEvent.Type.AD_ERROR, errorHandler);
          reject(e?.getError?.() || new Error('IMA Ad Error'));
        };

        adsLoader.addEventListener(ima.AdsManagerLoadedEvent.Type.ADS_MANAGER_LOADED, loadedHandler);
        adsLoader.addEventListener(ima.AdErrorEvent.Type.AD_ERROR, errorHandler);

        adsLoader.requestAds(adsRequest);
      });

      await requestPromise;
      this.loaderState = 'ready';
      this.diagnostics.adsLoaderState = 'ready';

      return { success: true };
    } catch (e) {
      this.loaderState = 'error';
      this.diagnostics.adsLoaderState = 'error';
      const message = e instanceof Error ? e.message : 'IMA Loader failed';
      this.diagnostics.lastErrorMsg = message;

      const likelyBlocked = !!(e as LikelyBlockedError)?.likelyBlocked;
      this.diagnostics.sdkBlockedLikely = likelyBlocked;

      const err: AdError = {
        type: likelyBlocked ? AdErrorType.BLOCKED : AdErrorType.NETWORK,
        code: likelyBlocked ? 901 : 301,
        message: message || 'Google IMA loader request failed',
        originalError: e,
      };
      this.manager.triggerAdError(err);
      return { success: false, error: err };
    }
  }

  private resizeListener: (() => void) | null = null;

  private initializeImaLoader() {
    if (this.adsLoader) return;

    const ima = window.google!.ima!;

    // AdDisplayContainer initialization
    this.adDisplayContainer = new ima.AdDisplayContainer(
      this.context!.adContainer,
      this.context!.videoElement
    );
    // Must happen synchronously within the same call stack as the user
    // gesture that led here (see requestAds()) - done once, here, rather
    // than later in playAdBreak() where that gesture context may be lost.
    this.adDisplayContainer.initialize();

    this.adsLoader = new ima.AdsLoader(this.adDisplayContainer);

    // Bind loaded and error trackers
    this.adsLoader.addEventListener(
      ima.AdsManagerLoadedEvent.Type.ADS_MANAGER_LOADED,
      (e: ImaAdsManagerLoadedEvent) => this.onAdsManagerLoaded(e),
      false
    );

    this.adsLoader.addEventListener(
      ima.AdErrorEvent.Type.AD_ERROR,
      (e: ImaAdErrorEventLike) => this.onAdError(e),
      false
    );

    this.setupResizeListener();
  }

  private setupResizeListener() {
    if (typeof window === 'undefined') return;
    this.resizeListener = () => this.resize();
    window.addEventListener('resize', this.resizeListener);
  }

  public resize(width?: number, height?: number): void {
    if (!this.adsManager || !this.context) return;
    const ima = window.google?.ima;
    if (!ima) return;

    const w = width || this.context.videoElement.clientWidth || 640;
    const h = height || this.context.videoElement.clientHeight || 360;
    const isFullscreen = !!(this.context.controller?.getState?.()?.isFullscreen);
    const viewMode = isFullscreen ? ima.ViewMode.FULLSCREEN : ima.ViewMode.NORMAL;

    try {
      this.adsManager.resize(w, h, viewMode);
    } catch (e) {
      console.warn('[ImaProvider] Failed to resize IMA AdsManager:', e);
    }
  }

  private onAdsManagerLoaded(adsManagerLoadedEvent: ImaAdsManagerLoadedEvent) {
    const ima = window.google!.ima!;
    const settings = new ima.AdsRenderingSettings();
    settings.restorePlayerStateOnAdComplete = false;

    this.adsManager = adsManagerLoadedEvent.getAdsManager(
      this.context!.videoElement,
      settings
    );

    this.managerState = 'ready';
    this.diagnostics.adsManagerState = 'ready';

    // Map all target events
    this.setupAdsManagerListeners();
  }

  private setupAdsManagerListeners() {
    const ima = window.google!.ima!;
    const manager = this.adsManager;
    if (!manager) return;

    const logEvent = (name: string) => {
      this.diagnostics.eventsLogged.push(`${name} at ${now()}`);
    };

    // Error
    manager.addEventListener(ima.AdErrorEvent.Type.AD_ERROR, (e: ImaAdErrorEventLike) => {
      logEvent('AD_ERROR');
      this.onAdError(e);
    });

    // Content pause/resume
    manager.addEventListener(ima.AdEvent.Type.CONTENT_PAUSE_REQUESTED, () => {
      logEvent('CONTENT_PAUSE_REQUESTED');
      if (this.manager && this.manager.getAdState() === AdState.IDLE) {
        this.manager.startAdBreak({
          id: `ima-break-${Date.now()}`,
          timeOffset: this.context!.videoElement.currentTime,
          type: 'midroll',
          ads: [],
          duration: 0,
        });
      } else {
        try {
          if (this.context?.videoElement && !this.context.videoElement.paused) {
            this.context.videoElement.pause();
          }
        } catch (_) {}
      }
    });

    manager.addEventListener(ima.AdEvent.Type.CONTENT_RESUME_REQUESTED, () => {
      logEvent('CONTENT_RESUME_REQUESTED');
      this.manager?.endAdBreak();
    });

    if (ima.AdEvent.Type.ALL_ADS_COMPLETED) {
      manager.addEventListener(ima.AdEvent.Type.ALL_ADS_COMPLETED, () => {
        logEvent('ALL_ADS_COMPLETED');
        this.manager?.endAdBreak();
      });
    }

    // Loaded metadata
    manager.addEventListener(ima.AdEvent.Type.LOADED, (e: ImaAdEventLike) => {
      logEvent('LOADED');
      const ad = e.getAd?.();
      if (!ad) return;

      const isSkippable = typeof ad.isSkippable === 'function' ? ad.isSkippable() : (typeof ad.getSkippable === 'function' ? ad.getSkippable() : false);
      const clickUrl = typeof ad.getClickThroughUrl === 'function' ? ad.getClickThroughUrl() : '';

      const podInfo = typeof ad.getAdPodInfo === 'function' ? ad.getAdPodInfo() : null;
      const podPosition = podInfo && typeof podInfo.getAdPosition === 'function' ? podInfo.getAdPosition() : undefined;
      const podSize = podInfo && typeof podInfo.getTotalAds === 'function' ? podInfo.getTotalAds() : undefined;
      const isBumper = podInfo && typeof podInfo.isBumper === 'function' ? podInfo.isBumper() : undefined;

      const mappedAd = {
        id: ad.getAdId() || `ima-${Date.now()}`,
        title: ad.getTitle() || 'IMA Ad',
        duration: ad.getDuration() || 0,
        width: ad.getWidth() || 0,
        height: ad.getHeight() || 0,
        linear: ad.isLinear(),
        skippable: isSkippable,
        skipOffset: ad.getSkipTimeOffset ? (ad.getSkipTimeOffset() || 0) : 0,
        contentType: ad.getContentType() || 'video/mp4',
        clickThroughUrl: clickUrl,
        podPosition,
        podSize,
        isBumper,
      };

      // Extract companion ads if present
      const imaCompanions = typeof ad.getCompanionAds === 'function' ? ad.getCompanionAds() : [];
      if (imaCompanions && imaCompanions.length > 0) {
        const mappedCompanions = imaCompanions.map((comp: ImaCompanionAd, idx: number) => ({
          id: `ima-companion-${idx}`,
          title: 'IMA Companion Ad',
          duration: 0,
          width: typeof comp.getWidth === 'function' ? comp.getWidth() : undefined,
          height: typeof comp.getHeight === 'function' ? comp.getHeight() : undefined,
          linear: false,
          skippable: false,
          htmlContent: typeof comp.getContent === 'function' ? comp.getContent() : undefined,
          clickThroughUrl: typeof comp.getClickThroughUrl === 'function' ? comp.getClickThroughUrl() : '',
        }));
        this.manager?.showCompanions(mappedCompanions);
      }
      
      this.manager?.setCurrentAd(mappedAd);
      this.context?.controller.emit('adloaded', { ad: mappedAd });
    });

    // State transitions
    manager.addEventListener(ima.AdEvent.Type.AD_PROGRESS, (e: ImaAdEventLike) => {
      const adData = e.getAdData ? e.getAdData() : null;
      if (adData) {
        const currentTime = adData.currentTime || 0;
        const duration = adData.duration || this.context?.controller.getState().adDuration || 0;
        const remainingTime = Math.max(0, duration - currentTime);
        const canSkip = !!adData.skippable && currentTime >= (adData.skipTimeOffset || 0);
        const skipAvailableAt = adData.skippable ? Math.max(0, (adData.skipTimeOffset || 0) - currentTime) : null;

        this.context?.controller.updateStatePublic({
          adCurrentTime: currentTime,
          adRemainingTime: remainingTime,
          adDuration: duration,
          canSkipAd: canSkip,
          skipAvailableAt,
        });
        this.context?.controller.emit('adtimeupdate', { currentTime, duration, remainingTime });
      }
    });

    manager.addEventListener(ima.AdEvent.Type.STARTED, () => {
      logEvent('STARTED');
      this.clearStartWatchdog();
      this.managerState = 'playing';
      this.diagnostics.adsManagerState = 'playing';
      this.manager?.transitionTo(AdState.PLAYING);
      this.context?.controller.emit('adstart');
      this.startContainerWatch();
    });

    manager.addEventListener(ima.AdEvent.Type.PAUSED, () => {
      logEvent('PAUSED');
      this.managerState = 'paused';
      this.diagnostics.adsManagerState = 'paused';
      this.manager?.transitionTo(AdState.PAUSED);
      this.context?.controller.emit('adpaused');
    });

    manager.addEventListener(ima.AdEvent.Type.RESUMED, () => {
      logEvent('RESUMED');
      this.managerState = 'playing';
      this.diagnostics.adsManagerState = 'playing';
      this.manager?.transitionTo(AdState.PLAYING);
      this.context?.controller.emit('adresumed');
    });

    manager.addEventListener(ima.AdEvent.Type.COMPLETE, () => {
      logEvent('COMPLETE');
      this.clearContainerWatch();
      this.manager?.transitionTo(AdState.ENDED);
      this.context?.controller.emit('adcomplete');
    });

    manager.addEventListener(ima.AdEvent.Type.SKIPPED, () => {
      logEvent('SKIPPED');
      this.clearContainerWatch();
      this.context?.controller.emit('adskip');
      this.manager?.endAdBreak();
    });

    // Clicks
    manager.addEventListener(ima.AdEvent.Type.CLICK, (e: ImaAdEventLike) => {
      logEvent('CLICK');
      const adData = e?.getAdData ? e.getAdData() : null;
      const ad = e?.getAd ? e.getAd() : null;
      const clickUrl = adData?.clickThroughUrl || (typeof ad?.getClickThroughUrl === 'function' ? ad.getClickThroughUrl() : '');
      this.context?.controller.emit('adclick', { clickUrl });
    });
  }

  private onAdError(adErrorEvent: ImaAdErrorEventLike) {
    const error = adErrorEvent.getError();
    const code = error.getErrorCode?.() || 300;
    const msg = error.getMessage?.() || 'Unknown Google IMA SDK error';

    this.diagnostics.lastErrorCode = code;
    this.diagnostics.lastErrorMsg = msg;

    const mappedErr: AdError = {
      type: mapImaErrorCode(code),
      code,
      message: msg,
      originalError: error,
    };

    this.manager?.triggerAdError(mappedErr);
  }

  public async playAdBreak(breakType: 'preroll' | 'midroll' | 'postroll' = 'preroll'): Promise<void> {
    if (!this.adsManager) return;
    if (this.context?.controller.getState().sourceType === 'embed') {
      this.onAdError({
        getError: () => ({
          getErrorCode: () => 900,
          getMessage: () => 'Google IMA ads are not supported for embed (YouTube/Vimeo) sources.',
        }),
      });
      return;
    }
    try {
      // Already initialized synchronously in initializeImaLoader() during
      // requestAds() - do not call again here.
      const width = this.context!.videoElement.clientWidth || 640;
      const height = this.context!.videoElement.clientHeight || 360;
      const isFullscreen = !!(this.context!.controller?.getState?.()?.isFullscreen);
      const viewMode = isFullscreen ? window.google!.ima!.ViewMode.FULLSCREEN : window.google!.ima!.ViewMode.NORMAL;
      this.adsManager.init(width, height, viewMode);

      // Defensive belt-and-suspenders alongside the setAdWillPlayMuted(true)
      // hint set in requestAds() - force the ad to actually start muted
      // (guaranteed playable under every browser's autoplay policy) rather
      // than trusting the request-time hint alone to have taken effect. The
      // developer can unmute afterward via player.ads.setMuted(false) -
      // an already-playing muted video CAN be unmuted freely, since
      // autoplay policies only ever block the *unmuted start*.
      try {
        this.adsManager.setVolume(0);
      } catch (_) {}
      // IMA's AdDisplayContainer was constructed with our content
      // videoElement as its second argument, which some IMA rendering
      // paths use directly for ad playback rather than an internally
      // created element. Chrome's autoplay policy specifically checks the
      // native `muted` DOM property - not just an effective volume of 0 -
      // so if IMA ends up reusing this element, setAdsManager.setVolume(0)
      // alone may not satisfy it. Setting the real property directly closes
      // that gap regardless of which element IMA actually plays into.
      try {
        if (this.context?.videoElement) {
          this.context.videoElement.muted = true;
        }
      } catch (_) {}

      // skipVideoOwnership was previously set here on the assumption that
      // IMA plays ads through the shared content <video> element, making
      // our own pause redundant/conflicting. Confirmed false in practice:
      // IMA renders into its own overlay iframe (bridge3...html, visible
      // separately from the content video) and does not pause content
      // itself - leaving skipVideoOwnership true meant nothing paused it,
      // so content kept playing underneath the ad the whole time.
      this.manager?.startAdBreak({
        id: `ima-break-${Date.now()}`,
        timeOffset: 0,
        type: breakType,
        ads: [],
        duration: 0,
      });

      if (breakType === 'preroll') {
        this.adsManager.start();
        this.startStartWatchdog();
      } else {
        const ima = window.google!.ima!;
        const adsManager = this.adsManager;
        const onBreakReady = () => {
          adsManager.removeEventListener(ima.AdEvent.Type.AD_BREAK_READY, onBreakReady);
          adsManager.start();
          this.startStartWatchdog();
        };
        adsManager.addEventListener(ima.AdEvent.Type.AD_BREAK_READY, onBreakReady);
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : 'IMA playAdBreak failed';
      this.onAdError({ getError: () => ({ getErrorCode: () => 400, getMessage: () => message }) });
    }
  }

  private startStartWatchdog() {
    this.clearStartWatchdog();
    this.startWatchdogTimer = setTimeout(() => {
      this.startWatchdogTimer = null;
      if (this.managerState === 'playing') return;
      this.onAdError({
        getError: () => ({
          getErrorCode: () => 402,
          getMessage: () =>
            `Google IMA: adsManager.start() was called ${ImaProvider.START_WATCHDOG_MS}ms ago but the STARTED ` +
            `event never fired - the ad video never actually began playing, even though IMA's own UI chrome ` +
            `(ad badge / skip countdown, driven by AD_PROGRESS) may still be visible. This usually means the ` +
            `underlying ad media failed to decode/attach - check the ad tag's returned media file (codec/format ` +
            `support), or the ad server response itself, rather than autoplay/mute policy (already handled).`,
        }),
      });
    }, ImaProvider.START_WATCHDOG_MS);
  }

  private clearStartWatchdog() {
    if (this.startWatchdogTimer) {
      clearTimeout(this.startWatchdogTimer);
      this.startWatchdogTimer = null;
    }
  }

  private startContainerWatch() {
    this.clearContainerWatch();
    const container = this.context?.adContainer;
    if (!container || typeof document === 'undefined') return;
    this.containerWatchTimer = setInterval(() => {
      if (this.managerState !== 'playing') return;
      if (document.contains(container)) return;
      this.clearContainerWatch();
      this.onAdError({
        getError: () => ({
          getErrorCode: () => 403,
          getMessage: () =>
            'Google IMA: the ad container element was detached from the page while the ad was still playing ' +
            '(IMA reported STARTED but its container is no longer in the live DOM). This means something in ' +
            'the host app re-rendered/removed the element IMA attached its iframe to - the ad kept running ' +
            'internally (progress/complete events) but nothing was visible. Check for conditional rendering ' +
            'or re-creation of the ads-overlay container while an ad is active.',
        }),
      });
    }, ImaProvider.CONTAINER_WATCH_INTERVAL_MS);
  }

  private clearContainerWatch() {
    if (this.containerWatchTimer) {
      clearInterval(this.containerWatchTimer);
      this.containerWatchTimer = null;
    }
  }

  public pauseAd(): void {
    if (this.adsManager && this.managerState === 'playing') {
      this.adsManager.pause();
    }
  }

  public resumeAd(): void {
    if (this.adsManager && this.managerState === 'paused') {
      this.adsManager.resume();
    }
  }

  public setVolume(volume: number): void {
    if (this.adsManager) {
      this.adsManager.setVolume(volume);
    }
  }

  public setMuted(muted: boolean): void {
    if (this.adsManager) {
      this.adsManager.setVolume(muted ? 0 : 1);
    }
  }

  public getImaDiagnostics(): ImaDiagnostics {
    return this.diagnostics;
  }

  public skipAd(): void {
    if (this.adsManager) {
      try {
        this.adsManager.skip();
      } catch (e) {
        this.destroy();
      }
    }
  }

  public destroy(): void {
    this.clearStartWatchdog();
    this.clearContainerWatch();
    if (this.resizeListener && typeof window !== 'undefined') {
      window.removeEventListener('resize', this.resizeListener);
      this.resizeListener = null;
    }

    if (this.adsManager) {
      try {
        this.adsManager.destroy();
      } catch (e) {
        // suppress
      }
      this.adsManager = null;
    }
    if (this.adsLoader) {
      try {
        this.adsLoader.destroy();
      } catch (e) {
        // suppress
      }
      this.adsLoader = null;
    }
    if (this.adDisplayContainer) {
      try {
        this.adDisplayContainer.destroy();
      } catch (e) {
        // suppress
      }
      this.adDisplayContainer = null;
    }

    this.managerState = 'destroyed';
    this.diagnostics.adsManagerState = 'destroyed';
    this.context = null;
    this.manager = null;
  }
}
