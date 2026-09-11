import {
  PlayerConfiguration,
  PlayerState,
  PlayerSource,
  TextTrackSource,
  SourceType,
  ThumbnailProvider,
  Chapter,
  TimelineMarker,
  PlayerPlugin,
  SubtitleTrack,
  SubtitleAppearance,
  PlayerEvents,
  PlayerStatistics,
  PlaybackInterceptor,
  Advertisement,
  AdBreak,
  AdsConfig,
  SleepTimerFullState,
  OverlayOptions,
} from './types';
import { SourceManager } from './SourceManager';
import type { SourceHandler } from './SourceManager';
import type { DrmManager } from './DrmManager';
import { KeyboardManager } from './KeyboardManager';
import { AdsController } from './AdsController';
import type { ScheduledAdRequest } from './AdScheduler';
import { AutoThumbnailProvider } from './providers/ThumbnailProviders';
import { sanitizeAndConvertEmbedUrl } from './utils';
import { TimelineMath } from './TimelineMath';
import { PlaylistManager } from './PlaylistManager';
import { SubtitleManager } from './SubtitleManager';
import { PictureInPictureManager } from './PictureInPictureManager';
import { safeStorage } from './storage';

/**
 * Some `SourceHandler` implementations (currently `DashHandler`) support a
 * native `seek()` that returns whether it handled the seek itself, without
 * that being part of the shared `SourceHandler` interface every handler
 * implements.
 */
interface SeekCapableSourceHandler extends SourceHandler {
  seek?(time: number): boolean;
}

/**
 * `_zombie` is an internal marker this class stamps onto native `TextTrack`
 * objects being torn down on source change, so `SubtitleManager` can skip
 * them while they're still lingering in `video.textTracks` (not a standard
 * `TextTrack` property).
 */
interface ZombieTextTrack extends TextTrack {
  _zombie?: boolean;
}

/**
 * `AutoThumbnailProvider` (and the providers it wraps) support being
 * reconfigured in place after construction, via either an `updateConfig()`
 * method or a directly-assignable `config` property - neither of which is
 * part of the public `ThumbnailProvider` contract every provider implements.
 */
interface ConfigurableThumbnailProvider extends ThumbnailProvider {
  updateConfig?(config: PlayerConfiguration): void;
  config?: PlayerConfiguration;
}

/**
 * Media Session metadata (title/artist/album/artwork/poster) isn't part of
 * the documented `PlayerSource` shape, but consumers commonly attach it to
 * their source objects for lock-screen/OS media control display purposes.
 */
interface MediaSessionSourceMeta {
  src?: string;
  title?: string;
  artist?: string;
  album?: string;
  artwork?: MediaImage[];
  poster?: string;
}

/** Legacy/vendor-prefixed fullscreen APIs not present in the standard DOM lib types. */
interface VendorPrefixedFullscreenDocument extends Document {
  webkitFullscreenElement?: Element | null;
  mozFullScreenElement?: Element | null;
  msFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => void;
}

interface VendorPrefixedFullscreenElement extends HTMLElement {
  webkitRequestFullscreen?: () => void;
}

/** Legacy WebKit (Safari) video element extensions not present in the standard DOM lib types. */
interface WebkitVideoElement extends HTMLVideoElement {
  webkitEnterFullscreen?: () => void;
  webkitExitFullscreen?: () => void;
  webkitDecodedFrameCount?: number;
  webkitDroppedFrameCount?: number;
}

function isStateValueEqual(key: keyof PlayerState, a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return a === b;

  if (key === 'seekableRange') {
    const ra = a as PlayerState['seekableRange'];
    const rb = b as PlayerState['seekableRange'];
    return ra.start === rb.start && ra.end === rb.end;
  }

  if (key === 'bufferedRanges') {
    const ra = a as PlayerState['bufferedRanges'];
    const rb = b as PlayerState['bufferedRanges'];
    if (ra.length !== rb.length) return false;
    for (let i = 0; i < ra.length; i++) {
      if (ra[i].start !== rb[i].start || ra[i].end !== rb[i].end) return false;
    }
    return true;
  }

  if (key === 'subtitleAppearance') {
    const sa = a as PlayerState['subtitleAppearance'];
    const sb = b as PlayerState['subtitleAppearance'];
    return (
      sa.fontFamily === sb.fontFamily &&
      sa.fontSize === sb.fontSize &&
      sa.fontColor === sb.fontColor &&
      sa.backgroundColor === sb.backgroundColor &&
      sa.backgroundOpacity === sb.backgroundOpacity &&
      sa.windowColor === sb.windowColor &&
      sa.windowOpacity === sb.windowOpacity &&
      sa.characterEdgeStyle === sb.characterEdgeStyle &&
      sa.fontOpacity === sb.fontOpacity
    );
  }

  if (key === 'qualities' || key === 'audioTracks') {
    const ra = a as PlayerState['qualities'] | PlayerState['audioTracks'];
    const rb = b as PlayerState['qualities'] | PlayerState['audioTracks'];
    if (ra.length !== rb.length) return false;
    for (let i = 0; i < ra.length; i++) {
      if (ra[i] !== rb[i]) return false;
    }
    return true;
  }

  if (key === 'subtitleTracks') {
    const ra = a as PlayerState['subtitleTracks'];
    const rb = b as PlayerState['subtitleTracks'];
    if (ra.length !== rb.length) return false;
    for (let i = 0; i < ra.length; i++) {
      const ta = ra[i];
      const tb = rb[i];
      if (
        ta.id !== tb.id ||
        ta.language !== tb.language ||
        ta.label !== tb.label ||
        ta.default !== tb.default ||
        ta.forced !== tb.forced ||
        ta.kind !== tb.kind ||
        ta.source !== tb.source ||
        ta.index !== tb.index
      ) {
        return false;
      }
    }
    return true;
  }

  if (key === 'chapters') {
    const ra = a as PlayerState['chapters'];
    const rb = b as PlayerState['chapters'];
    if (ra.length !== rb.length) return false;
    for (let i = 0; i < ra.length; i++) {
      const ca = ra[i];
      const cb = rb[i];
      if (
        ca.id !== cb.id ||
        ca.title !== cb.title ||
        ca.startTime !== cb.startTime ||
        ca.endTime !== cb.endTime ||
        ca.description !== cb.description
      ) {
        return false;
      }
    }
    return true;
  }

  if (key === 'markers') {
    const ra = a as PlayerState['markers'];
    const rb = b as PlayerState['markers'];
    if (ra.length !== rb.length) return false;
    for (let i = 0; i < ra.length; i++) {
      const ma = ra[i];
      const mb = rb[i];
      if (
        ma.id !== mb.id ||
        ma.time !== mb.time ||
        ma.label !== mb.label ||
        ma.type !== mb.type ||
        ma.color !== mb.color
      ) {
        return false;
      }
    }
    return true;
  }

  if (key === 'playlist') {
    const ra = a as PlayerState['playlist'];
    const rb = b as PlayerState['playlist'];
    if (ra.length !== rb.length) return false;
    for (let i = 0; i < ra.length; i++) {
      const sa = ra[i];
      const sb = rb[i];
      if (sa.src !== sb.src || sa.type !== sb.type) return false;
    }
    return true;
  }

  if (typeof a === 'object' && typeof b === 'object') {
    return JSON.stringify(a) === JSON.stringify(b);
  }

  return false;
}

/**
 * `config.plugins` is declared as `PlayerPlugin[] | undefined` in the public
 * type, but plain-JS consumers may also pass `{ list: PlayerPlugin[] }` (the
 * same "object-with-list" shape used elsewhere for enable/list config
 * sections). Narrowed via `unknown` rather than trusted blindly.
 */
function extractPluginsList(pluginsConfig: unknown): PlayerPlugin[] | undefined {
  if (Array.isArray(pluginsConfig)) {
    return pluginsConfig as PlayerPlugin[];
  }
  if (pluginsConfig && typeof pluginsConfig === 'object') {
    const list = (pluginsConfig as { list?: unknown }).list;
    if (Array.isArray(list)) {
      return list as PlayerPlugin[];
    }
  }
  return undefined;
}

export class PlayerController {
  private video: HTMLVideoElement;
  private sourceManager: SourceManager = new SourceManager();
  private stateCallbacks: Set<(state: PlayerState) => void> = new Set();
  public readonly shortcuts: KeyboardManager;
  public readonly ads: AdsController;
  public config: PlayerConfiguration;
  /**
   * The UI-layer player instance (e.g. `@player/web-components`'s `<player-player>`)
   * that wired itself up to this controller, if any. `@player/core` has zero UI
   * dependencies, so the concrete shape is intentionally unknown here - only the
   * minimal duck-typed surface this class actually calls is declared.
   */
  public player?: { registerOverlay?: (id: string, options: OverlayOptions) => void };
  private analyticsHandlers: Set<(event: string, detail: unknown) => void> = new Set();
  private playbackInterceptors: Set<PlaybackInterceptor> = new Set();
  public pendingOverlays: Map<string, OverlayOptions> = new Map();
  private thumbnailProvider?: ThumbnailProvider;
  private plugins: Map<string, PlayerPlugin> = new Map();
  private eventListeners: Map<keyof PlayerEvents, Set<(detail: unknown) => void>> = new Map();
  private isDestroyed = false;
  private readonly playlistManager: PlaylistManager;
  private readonly subtitleManager: SubtitleManager;
  private readonly pictureInPictureManager: PictureInPictureManager;
  public preSeekVolume: number | null = null;

  private lastFpsTimestamp: number = 0;
  private lastDecodedFrames: number = 0;
  private lastCalculatedFps: number = 0;
  private sleepTimerEndTimeMs?: number;

  private handleVisibilityChange = () => {
    if (
      typeof document !== 'undefined' &&
      document.visibilityState === 'visible' &&
      this.sleepTimerEndTimeMs &&
      !this.state.sleepTimerExpired
    ) {
      this.tickSleepTimer();
    }
  };

  private state: PlayerState = {
    status: 'idle',
    isPlaying: false,
    currentTime: 0,
    duration: 0,
    volume: 1.0,
    isMuted: false,
    isFullscreen: false,
    bufferedRanges: [],
    playbackRate: 1.0,
    captionsEnabled: false,
    currentSource: null,
    sourceType: 'unknown',
    isBuffering: false,
    isSeeking: false,
    hasCaptions: false,
    error: null,
    qualities: [],
    activeQuality: 'Auto',
    audioTracks: [],
    activeAudioTrack: -1,
    subtitleTracks: [],
    activeSubtitleTrack: -1,
    activeSubtitleTrackId: null,
    subtitleAppearance: {
      fontFamily: 'default',
      fontSize: 100,
      fontColor: 'white',
      backgroundColor: 'black',
      backgroundOpacity: 75,
      windowColor: 'black',
      windowOpacity: 0,
      characterEdgeStyle: 'none',
      fontOpacity: 100,
    },
    isLive: null,
    isLowLatency: false,
    isAtLiveEdge: false,
    liveLatency: null,
    hasDvr: false,
    dvrWindow: 0,
    canSeekInDvr: false,
    seekableRange: { start: 0, end: 0 },
    liveMode: 'live-dvr',
    thumbnailProvider: undefined,
    pictureInPicture: false,
    pictureInPictureSupported: false,
    loop: false,
    sleepTimerSetting: 'off',
    sleepTimerSecondsRemaining: null,
    sleepTimerExpired: false,
    chapters: [],
    activeChapterIndex: -1,
    markers: [],
    visibleMarkerTypes: null,
    displayMode: 'standard',
    playlist: [],
    activePlaylistIndex: 0,
    playlistRepeatMode: 'off',
    autoScroll: false,
    isAdPlaying: false,
    isAdLoading: false,
    currentAd: null,
    currentAdBreak: null,
    adCurrentTime: null,
    adRemainingTime: null,
    adDuration: null,
    canSkipAd: false,
    skipAvailableAt: null,
    adPosition: null,
    adProvider: null,
    adLinear: null,
    adMuted: null,
  };

  private hlsRetryCount = 0;
  private stallTimer?: number;
  private lastNonZeroVolume = 1.0;
  private bufferingTimeout?: number;
  private sleepTimerId?: number;

  private createUnifiedConfig(config: PlayerConfiguration): PlayerConfiguration {
    if (!config) config = {};
    if (!config.controls) config.controls = {};
    if (!config.settings) config.settings = {};

    let settingsOrder = config.settings.order;

    const getCanonicalKey = (prop: string | symbol): string => {
      const p = prop as string;
      if (p === 'enabled') return 'settings';
      if (p === 'speed') return 'playbackSpeed';
      if (p === 'audio' || p === 'audioTracks') return 'audioTracks';
      if (p === 'captions' || p === 'subtitles') return 'subtitles';
      if (p === 'pip' || p === 'pictureInPicture') return 'pictureInPicture';
      return p;
    };

    const backingStore: Record<string, unknown> = {};

    // Copy initial values to backing store using canonical names
    Object.keys(config.controls).forEach((k) => {
      backingStore[getCanonicalKey(k)] = (config.controls as Record<string, unknown>)[k];
    });
    Object.keys(config.settings).forEach((k) => {
      backingStore[getCanonicalKey(k)] = (config.settings as Record<string, unknown>)[k];
    });

    const handler: ProxyHandler<Record<string, unknown>> = {
      get: (target, prop) => {
        if (prop === 'toJSON') {
          return () => {
            const obj: Record<string, unknown> = { ...backingStore };
            if (settingsOrder !== undefined) {
              obj.order = settingsOrder;
            }
            return obj;
          };
        }
        if (prop === 'order') return settingsOrder;
        const key = getCanonicalKey(prop);
        return backingStore[key];
      },
      set: (target, prop, value) => {
        if (prop === 'order') {
          settingsOrder = value as string[] | undefined;
          return true;
        }
        const key = getCanonicalKey(prop);
        backingStore[key] = value;
        if (rootProxy) {
          this.dispatchEvent('config-change', rootProxy);
        }
        return true;
      },
      has: (target, prop) => {
        if (prop === 'order') return settingsOrder !== undefined;
        const key = getCanonicalKey(prop);
        return key in backingStore;
      },
      ownKeys: () => {
        const keys = new Set(Object.keys(backingStore));
        if (settingsOrder !== undefined) keys.add('order');
        return Array.from(keys);
      },
      getOwnPropertyDescriptor: (target, prop) => {
        const key = getCanonicalKey(prop);
        if (prop === 'order') {
          if (settingsOrder === undefined) return undefined;
          return { enumerable: true, configurable: true, writable: true, value: settingsOrder };
        }
        if (!(key in backingStore)) return undefined;
        return {
          enumerable: true,
          configurable: true,
          writable: true,
          value: backingStore[key]
        };
      }
    };

    config.controls = new Proxy(config.controls as Record<string, unknown>, handler) as PlayerConfiguration['controls'];
    config.settings = new Proxy(config.settings as Record<string, unknown>, handler) as PlayerConfiguration['settings'];

    // Proxy root config to alias crossOrigin and playsInline properties
    const rootHandler: ProxyHandler<Record<string, unknown>> = {
      get: (target, prop) => {
        if (prop === 'toJSON') {
          return () => {
            const obj: Record<string, unknown> = {};
            Object.keys(target).forEach((k) => {
              const val = target[k];
              if (val && typeof (val as { toJSON?: unknown }).toJSON === 'function') {
                obj[k] = (val as { toJSON: () => unknown }).toJSON();
              } else {
                obj[k] = val;
              }
            });
            return obj;
          };
        }
        const p = prop as string;
        if (p === 'crossOrigin') return target.crossorigin;
        if (p === 'playsInline') return target.playsinline;
        return target[prop as string];
      },
      set: (target, prop, value) => {
        const p = prop as string;
        if (p === 'crossOrigin') {
          target.crossorigin = value;
        } else if (p === 'playsInline') {
          target.playsinline = value;
        } else {
          target[prop as string] = value;
        }
        if (rootProxy) {
          this.dispatchEvent('config-change', rootProxy);
        }
        return true;
      },
      has: (target, prop) => {
        const p = prop as string;
        if (p === 'crossOrigin') return target.crossorigin !== undefined;
        if (p === 'playsInline') return target.playsinline !== undefined;
        return prop in target;
      }
    };

    const rootProxy = new Proxy(config as unknown as Record<string, unknown>, rootHandler) as unknown as PlayerConfiguration;
    return rootProxy;
  }

  private validateConfig(config: Partial<PlayerConfiguration>) {
    if (!config || typeof config !== 'object') return;

    const warn = (msg: string) => {
      console.warn(`[Player SDK Configuration Warning] ${msg}`);
    };

    if ('crossOrigin' in config) {
      warn("Property 'crossOrigin' is deprecated. Use 'crossorigin' instead.");
    }
    if ('playsInline' in config) {
      warn("Property 'playsInline' is deprecated. Use 'playsinline' instead.");
    }

    if (config.autoplay !== undefined && typeof config.autoplay !== 'boolean') {
      warn(`'autoplay' must be a boolean, got ${typeof config.autoplay}.`);
    }
    if (config.muted !== undefined && typeof config.muted !== 'boolean') {
      warn(`'muted' must be a boolean, got ${typeof config.muted}.`);
    }
    if (config.volume !== undefined && (typeof config.volume !== 'number' || config.volume < 0 || config.volume > 1)) {
      warn(`'volume' must be a number between 0 and 1, got ${config.volume}.`);
    }
    if (config.displayMode !== undefined) {
      const allowedModes = ['standard', 'vertical', 'audio-only', 'custom', 'mini', 'floating'];
      if (!allowedModes.includes(config.displayMode)) {
        warn(`Invalid displayMode '${config.displayMode}'. Must be one of: ${allowedModes.join(', ')}.`);
      }
    }

    if (config.controls && typeof config.controls === 'object') {
      const knownControlKeys = [
        'play', 'playButton', 'pause', 'seekbar', 'timeline', 'currentTime', 'duration',
        'volume', 'mute', 'settings', 'subtitles', 'captions', 'audioTracks', 'quality',
        'playbackSpeed', 'sleepTimer', 'pictureInPicture', 'pip', 'fullscreen', 'liveBadge',
        'markers', 'chapters', 'timelinePreview', 'replayButton', 'loadingSpinner',
        'feedbackOverlay', 'volumeOverlay', 'contextMenu', 'actionRail', 'liveDVR',
        'liveEdgeButton', 'emptyState', 'controlsBar', 'verticalControls', 'plugins',
        'loop', 'autoScroll', 'order', 'groups', 'layout'
      ];
      Object.keys(config.controls).forEach((key) => {
        if (!knownControlKeys.includes(key)) {
          warn(`Unknown control config option '${key}'.`);
        }
      });
    }

    if (config.settings && typeof config.settings === 'object') {
      const knownSettingsKeys = [
        'order', 'playbackSpeed', 'quality', 'audioTracks', 'subtitles', 'loop',
        'sleepTimer', 'chapters', 'markers', 'autoScroll', 'pictureInPicture',
        'pip', 'fullscreen', 'enabled', 'customItems', 'groups', 'labels', 'icons'
      ];
      Object.keys(config.settings).forEach((key) => {
        if (!knownSettingsKeys.includes(key)) {
          warn(`Unknown settings config option '${key}'.`);
        }
      });
    }
  }

  constructor(video: HTMLVideoElement, config: PlayerConfiguration = {}) {
    this.video = video;
    this.validateConfig(config);
    this.config = this.createUnifiedConfig(config);
    this.shortcuts = new KeyboardManager(this);
    this.ads = new AdsController(this);
    this.playlistManager = new PlaylistManager(this);
    this.subtitleManager = new SubtitleManager(this, this.sourceManager);
    this.pictureInPictureManager = new PictureInPictureManager(this);
    if (config.shortcuts && config.shortcuts.enabled === false) {
      this.shortcuts.disable();
    }
    if (this.isPluginsEnabled() && config.plugins) {
      const pluginsList = extractPluginsList(config.plugins);
      if (pluginsList) {
        for (const plugin of pluginsList) {
          this.use(plugin);
        }
      }
    }
    if (this.isAnalyticsEnabled() && config.analytics && Array.isArray(config.analytics.handlers)) {
      for (const handler of config.analytics.handlers) {
        this.registerAnalyticsHandler(handler);
      }
    }
    const smartSeek = config.smartSeek;
    const isSmartSeekEnabled =
      smartSeek !== false && (typeof smartSeek !== 'object' || smartSeek.enabled !== false);
    if (isSmartSeekEnabled) {
      if (!config.thumbnailProvider) {
        this.thumbnailProvider = new AutoThumbnailProvider(config);
      } else {
        this.thumbnailProvider = config.thumbnailProvider;
      }
    }
    this.state.thumbnailProvider = this.thumbnailProvider;

    // Check Picture-in-Picture browser support dynamically (including Safari WebKit)
    this.state.pictureInPictureSupported = this.pictureInPictureManager.detectSupport();

    // Apply initial configurations
    if (this.config.live && this.config.live.mode) {
      this.state.liveMode = this.config.live.mode;
    }
    if (this.config.autoplay) this.video.autoplay = true;
    if (this.config.playsinline !== false) this.video.setAttribute('playsinline', 'true');
    if (this.config.preload) {
      this.video.preload = this.config.preload;
    }
    if (this.config.poster) {
      this.video.setAttribute('poster', this.config.poster);
    }
    const configCrossorigin = this.config.crossorigin;
    if (configCrossorigin) {
      this.video.setAttribute('crossorigin', configCrossorigin);
    }

    // Load persisted volume & mute status
    try {
      const savedVolume = safeStorage.getItem('player_volume');
      if (savedVolume !== null) {
        const parsedVolume = parseFloat(savedVolume);
        if (!isNaN(parsedVolume) && parsedVolume >= 0 && parsedVolume <= 1) {
          this.video.volume = parsedVolume;
          this.state.volume = parsedVolume;
        }
      } else if (config.volume !== undefined) {
        this.video.volume = config.volume;
        this.state.volume = config.volume;
      }

      const savedMuted = safeStorage.getItem('player_muted');
      if (savedMuted !== null) {
        const isMuted = savedMuted === 'true';
        this.video.muted = isMuted;
        this.state.isMuted = isMuted;
      } else if (config.muted !== undefined) {
        this.video.muted = config.muted;
        this.state.isMuted = config.muted;
      }
    } catch (e) {
      if (config.volume !== undefined) this.video.volume = config.volume;
      if (config.muted !== undefined) this.video.muted = config.muted;
    }

    // Load persisted loop status
    try {
      const savedLoop = safeStorage.getItem('player_loop');
      if (savedLoop !== null) {
        const isLoop = savedLoop === 'true';
        this.video.loop = isLoop;
        this.state.loop = isLoop;
      } else if (config.loop) {
        this.video.loop = true;
        this.state.loop = true;
      }
    } catch (e) {
      if (config.loop) this.video.loop = true;
    }

    // Load persisted autoScroll status
    try {
      const savedAutoScroll = safeStorage.getItem('player_auto_scroll');
      if (savedAutoScroll !== null) {
        this.state.autoScroll = savedAutoScroll === 'true';
      } else if (config.autoScroll !== undefined) {
        this.state.autoScroll = config.autoScroll;
      }
    } catch (e) {
      if (config.autoScroll !== undefined) this.state.autoScroll = config.autoScroll;
    }

    // Sync initial state volume
    this.state.volume = this.video.volume;
    this.state.isMuted = this.video.muted;
    this.lastNonZeroVolume = this.video.volume > 0 ? this.video.volume : 0.5;

    // Load persisted playback rate
    try {
      const savedRate = safeStorage.getItem('player_playback_rate');
      if (savedRate) {
        const parsed = parseFloat(savedRate);
        if (!isNaN(parsed) && parsed > 0 && parsed <= 4.0) {
          this.state.playbackRate = parsed;
          this.video.playbackRate = parsed;
        }
      }
    } catch (e) {
      // Ignore
    }

    // Load persisted subtitles settings
    const persistedSubtitles = this.subtitleManager.readPersistedSettings();
    this.state.captionsEnabled = persistedSubtitles.captionsEnabled;
    this.state.subtitleAppearance = persistedSubtitles.appearance;

    const initialDisplayMode = config.displayMode !== undefined ? config.displayMode : config.layout?.mode;
    if (initialDisplayMode !== undefined) {
      const allowedModes = ['standard', 'vertical', 'audio-only', 'custom', 'mini', 'floating'];
      if (allowedModes.includes(initialDisplayMode)) {
        this.state.displayMode = initialDisplayMode;
        this.config.displayMode = initialDisplayMode;
        if (!this.config.layout) this.config.layout = {};
        this.config.layout.mode = initialDisplayMode;
      }
    }

    if (config.playlistRepeatMode !== undefined) {
      this.state.playlistRepeatMode = config.playlistRepeatMode;
    }

    this.setupEventListeners();

    this.on('metadata', (e) => {
      if (this.state.isLive && !this.state.hasDvr) {
        return; // Do NOT generate timeline markers for Live Only streams
      }
      const parsedTitle = typeof e.parsedData?.title === 'string' ? e.parsedData.title : undefined;
      const parsedDescription =
        typeof e.parsedData?.description === 'string' ? e.parsedData.description : undefined;
      const label = parsedTitle || parsedDescription || e.type;
      const id = `meta-${e.timestamp}-${e.type}-${Math.random().toString(36).substr(2, 9)}`;
      this.addMarker({
        id,
        time: e.timestamp,
        label,
        type: 'metadata',
        color: '#a855f7',
        metadata: e,
      });
    });
  }

  // --- State Subscriptions ---
  public onStateChange(callback: (state: PlayerState) => void): () => void {
    this.stateCallbacks.add(callback);
    // Immediately emit current state to the subscriber
    callback({ ...this.state });
    return () => this.stateCallbacks.delete(callback);
  }

  private updateState(changes: Partial<PlayerState>) {
    if (!this.isAudioTracksEnabled()) {
      if (changes.audioTracks) changes.audioTracks = [];
      if (changes.activeAudioTrack !== undefined) changes.activeAudioTrack = -1;
    }
    if (!this.isQualityEnabled()) {
      if (changes.qualities) changes.qualities = [];
      if (changes.activeQuality !== undefined) changes.activeQuality = 'Auto';
    }
    if (!this.isChaptersEnabled()) {
      if (changes.chapters) changes.chapters = [];
      if (changes.activeChapterIndex !== undefined) changes.activeChapterIndex = -1;
    }
    if (!this.isMarkersEnabled()) {
      if (changes.markers) changes.markers = [];
    }

    const prevAudioTracks = this.state.audioTracks;
    const prevActiveAudioTrack = this.state.activeAudioTrack;

    // Check if anything actually changes to avoid redundant callbacks and rerenders
    let hasChanges = false;
    for (const key of Object.keys(changes) as Array<keyof PlayerState>) {
      const prevVal = this.state[key];
      const newVal = changes[key];
      if (newVal === undefined) {
        continue;
      }
      if (typeof newVal === 'object' && newVal !== null) {
        if (!isStateValueEqual(key, prevVal, newVal)) {
          hasChanges = true;
          break;
        }
      } else if (prevVal !== newVal) {
        hasChanges = true;
        break;
      }
    }

    if (!hasChanges && changes.error === undefined) {
      return;
    }

    // Auto-restore saved audio language preference if audioTracks are being populated
    if (
      changes.audioTracks !== undefined &&
      changes.audioTracks.length > 0 &&
      (this.state.audioTracks.length === 0 ||
        !isStateValueEqual('audioTracks', prevAudioTracks, changes.audioTracks))
    ) {
      try {
        const savedAudioTrack = safeStorage.getItem('player_audio_language');
        if (savedAudioTrack) {
          const matchIdx = changes.audioTracks.findIndex((t) => t === savedAudioTrack);
          const currentActive =
            changes.activeAudioTrack !== undefined
              ? changes.activeAudioTrack
              : this.state.activeAudioTrack;
          if (matchIdx !== -1 && matchIdx !== currentActive) {
            changes.activeAudioTrack = matchIdx;
            this.sourceManager.setAudioTrack(matchIdx);
          }
        }
      } catch (e) {
        // Ignore
      }
    }

    // Enforce strict upper bound on markers list to prevent memory growth under 24/7 playback
    if (changes.markers) {
      const MAX_MARKERS = 1000;
      if (changes.markers.length > MAX_MARKERS) {
        changes.markers = changes.markers.slice(-MAX_MARKERS);
      }
    }

    // Garbage collect markers during live playback to prevent memory leaks
    if ((this.state.isLive || changes.isLive) && changes.seekableRange) {
      const minTime = changes.seekableRange.start; // Prune markers that fall behind the DVR window
      const prevMarkers = changes.markers || this.state.markers;
      if (prevMarkers && prevMarkers.length > 0) {
        const filteredMarkers = prevMarkers.filter(
          (m) => !TimelineMath.shouldPruneMarker(m.time, minTime)
        );
        if (filteredMarkers.length !== prevMarkers.length) {
          changes.markers = filteredMarkers;
        }
      }
    }

    const nextState = { ...this.state, ...changes };
    if (changes.error !== undefined && changes.error !== null) {
      nextState.status = 'error';
    }
    this.state = nextState;

    // Dispatch custom audio event notifications
    if (
      changes.audioTracks !== undefined &&
      JSON.stringify(prevAudioTracks) !== JSON.stringify(changes.audioTracks)
    ) {
      this.dispatchEvent('audioTracksChanged', { audioTracks: changes.audioTracks });
    }
    if (
      changes.activeAudioTrack !== undefined &&
      prevActiveAudioTrack !== changes.activeAudioTrack
    ) {
      this.dispatchEvent('audioTrackChanged', { activeAudioTrack: changes.activeAudioTrack });
    }

    this.stateCallbacks.forEach((cb) => cb({ ...this.state }));
  }

  public getState(): PlayerState {
    return this.state;
  }

  public updateStatePublic(changes: Partial<PlayerState>) {
    this.updateState(changes);
  }

  public getThumbnailProvider(): ThumbnailProvider | undefined {
    return this.thumbnailProvider;
  }

  public setThumbnailProvider(provider: ThumbnailProvider) {
    this.thumbnailProvider = provider;
    this.updateState({ thumbnailProvider: provider });
  }

  public setDisplayMode(mode: 'standard' | 'vertical' | 'audio-only' | 'custom' | 'mini' | 'floating') {
    const validModes = ['standard', 'vertical', 'audio-only', 'custom', 'mini', 'floating'];
    if (validModes.includes(mode)) {
      this.updateState({ displayMode: mode });
      this.video.loop = mode === 'vertical' ? false : this.state.loop;
      if (!this.config.layout) {
        this.config.layout = {};
      }
      const displayModeChanged = this.config.displayMode !== mode;
      const layoutModeChanged = this.config.layout.mode !== mode;
      this.config.displayMode = mode;
      this.config.layout.mode = mode;
      if (displayModeChanged || layoutModeChanged) {
        this.dispatchEvent('config-change', this.config);
      }
    }
  }

  public setLiveMode(mode: 'live-only' | 'live-dvr') {
    if (this.state.liveMode === mode) return;
    this.updateState({ liveMode: mode });
    if (this.state.isLive) {
      this.updateLiveState();
    }
  }

  // --- Playlist APIs (delegated to PlaylistManager) ---

  public loadPlaylist(sources: PlayerSource[], startIndex: number = 0): void {
    this.playlistManager.loadPlaylist(sources, startIndex);
  }

  public setPlaylist(sources: PlayerSource[], startIndex = 0): void {
    this.playlistManager.setPlaylist(sources, startIndex);
  }

  public setNearEndThreshold(threshold: number): void {
    this.playlistManager.setNearEndThreshold(threshold);
  }

  public getNearEndThreshold(): number {
    return this.playlistManager.getNearEndThreshold();
  }

  public getPlaylist(): PlayerSource[] {
    return this.playlistManager.getPlaylist();
  }

  public getCurrentPlaylistIndex(): number {
    return this.playlistManager.getCurrentPlaylistIndex();
  }

  public getHistoryStack(): number[] {
    return this.playlistManager.getHistoryStack();
  }

  public getCurrentPlaylistItem(): PlayerSource | null {
    return this.playlistManager.getCurrentPlaylistItem();
  }

  public getPlaylistLength(): number {
    return this.playlistManager.getPlaylistLength();
  }

  public hasPlaylist(): boolean {
    return this.playlistManager.hasPlaylist();
  }

  public isFirstPlaylistItem(): boolean {
    return this.playlistManager.isFirstPlaylistItem();
  }

  public isLastPlaylistItem(): boolean {
    return this.playlistManager.isLastPlaylistItem();
  }

  public next(): void {
    this.playlistManager.next();
  }

  public previous(): void {
    this.playlistManager.previous();
  }

  public appendPlaylistItem(source: PlayerSource): void {
    this.playlistManager.appendPlaylistItem(source);
  }

  public insertPlaylistItem(index: number, source: PlayerSource): void {
    this.playlistManager.insertPlaylistItem(index, source);
  }

  public removePlaylistItem(index: number): void {
    this.playlistManager.removePlaylistItem(index);
  }

  public clearPlaylist(): void {
    this.playlistManager.clearPlaylist();
  }

  public replacePlaylistItem(index: number, source: PlayerSource): void {
    this.playlistManager.replacePlaylistItem(index, source);
  }

  public movePlaylistItem(fromIndex: number, toIndex: number): void {
    this.playlistManager.movePlaylistItem(fromIndex, toIndex);
  }

  public setPlaylistRepeatMode(mode: 'off' | 'repeat-all') {
    this.playlistManager.setPlaylistRepeatMode(mode);
  }

  public getPlaylistRepeatMode(): 'off' | 'repeat-all' {
    return this.playlistManager.getPlaylistRepeatMode();
  }

  public getAutoAdvanceIndexOnEnded(): number | null {
    return this.playlistManager.getAutoAdvanceIndexOnEnded();
  }

  // --- Lifecycle & Event Binding ---
  private setupEventListeners() {
    this.video.addEventListener('play', this.handlePlay);
    this.video.addEventListener('pause', this.handlePause);
    this.video.addEventListener('timeupdate', this.handleTimeUpdate);
    this.video.addEventListener('durationchange', this.handleDurationChange);
    this.video.addEventListener('volumechange', this.handleVolumeChange);
    this.video.addEventListener('progress', this.handleProgress);
    this.video.addEventListener('waiting', this.handleWaiting);
    this.video.addEventListener('playing', this.handlePlaying);
    this.video.addEventListener('seeking', this.handleSeeking);
    this.video.addEventListener('seeked', this.handleSeeked);
    this.video.addEventListener('canplay', this.handleCanPlay);
    this.video.addEventListener('canplaythrough', this.handleCanPlay);
    this.video.addEventListener('error', this.handleNativeError);
    this.video.addEventListener('loadedmetadata', this.handleLoadedMetadata);
    this.video.addEventListener('ended', this.handleEnded);

    // Watch text tracks change to update captions availability + sync initial appearance
    this.subtitleManager.attach();

    // Monitor fullscreen change events
    if (typeof document !== 'undefined') {
      document.addEventListener('fullscreenchange', this.handleFullscreenChange);
      document.addEventListener('webkitfullscreenchange', this.handleFullscreenChange);
      document.addEventListener('visibilitychange', this.handleVisibilityChange);
    }

    // iOS Safari native fullscreen events on the video element itself
    this.video.addEventListener('webkitbeginfullscreen', this.handleWebkitBeginFullscreen);
    this.video.addEventListener('webkitendfullscreen', this.handleWebkitEndFullscreen);

    // Monitor Picture-in-Picture change events
    this.pictureInPictureManager.attach();
  }

  public destroy() {
    if (this.isDestroyed) return;
    this.isDestroyed = true;
    this.playlistManager.destroy();
    this.stopStallCheck();
    this.clearSleepTimer();
    this.clearBufferingTimeout();

    // Clear keyboard manager bindings, actions, and hooks
    this.shortcuts.destroy();

    // Release plugin platform storage structures
    this.analyticsHandlers.clear();
    this.playbackInterceptors.clear();
    this.pendingOverlays.clear();

    if (this.thumbnailProvider && typeof this.thumbnailProvider.destroy === 'function') {
      try {
        this.thumbnailProvider.destroy();
      } catch (err) {
        console.error('[PlayerController] Error destroying thumbnail provider:', err);
      }
    }
    this.sourceManager.destroy();

    try {
      this.ads.destroy();
    } catch (err) {
      console.error('[PlayerController] Error destroying ads controller:', err);
    }

    // Revoke any created blob URLs
    this.subtitleManager.revokeBlobUrls();

    // Clean up plugins
    this.plugins.forEach((plugin) => {
      try {
        plugin.destroy?.();
      } catch (err) {
        console.error(`[PlayerController] Error destroying plugin "${plugin.name}":`, err);
      }
    });
    this.plugins.clear();

    // Clear event listeners
    this.eventListeners.clear();

    this.video.removeEventListener('play', this.handlePlay);
    this.video.removeEventListener('pause', this.handlePause);
    this.video.removeEventListener('timeupdate', this.handleTimeUpdate);
    this.video.removeEventListener('durationchange', this.handleDurationChange);
    this.video.removeEventListener('volumechange', this.handleVolumeChange);
    this.video.removeEventListener('progress', this.handleProgress);
    this.video.removeEventListener('waiting', this.handleWaiting);
    this.video.removeEventListener('playing', this.handlePlaying);
    this.video.removeEventListener('seeking', this.handleSeeking);
    this.video.removeEventListener('seeked', this.handleSeeked);
    this.video.removeEventListener('canplay', this.handleCanPlay);
    this.video.removeEventListener('canplaythrough', this.handleCanPlay);
    this.video.removeEventListener('error', this.handleNativeError);
    this.video.removeEventListener('loadedmetadata', this.handleLoadedMetadata);
    this.video.removeEventListener('ended', this.handleEnded);

    this.subtitleManager.detach();

    if (typeof document !== 'undefined') {
      document.removeEventListener('fullscreenchange', this.handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', this.handleFullscreenChange);
      document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    }

    this.video.removeEventListener('webkitbeginfullscreen', this.handleWebkitBeginFullscreen);
    this.video.removeEventListener('webkitendfullscreen', this.handleWebkitEndFullscreen);
    this.pictureInPictureManager.detach();

    this.stateCallbacks.clear();
  }

  // --- Handlers for HTML5 Video Events ---
  private handlePlay = () => {
    const status = this.state.status;
    const nextStatus = status === 'loading' || status === 'buffering' ? status : 'playing';
    this.updateState({ isPlaying: true, status: nextStatus });
    this.startStallCheck();
    this.dispatchEvent('play');
    this.updateMediaSessionPlaybackState(true);
    this.updateMediaSessionPosition();
  };

  private handlePause = () => {
    const currentStatus = this.state.status;
    const nextStatus =
      currentStatus === 'playing' || currentStatus === 'buffering' || currentStatus === 'ready'
        ? 'paused'
        : currentStatus;
    this.updateState({ isPlaying: false, status: nextStatus });
    this.stopStallCheck();
    this.dispatchEvent('pause');
    this.updateMediaSessionPlaybackState(false);
    this.updateMediaSessionPosition();
  };

  private clearBufferingTimeout() {
    if (this.bufferingTimeout) {
      clearTimeout(this.bufferingTimeout);
      this.bufferingTimeout = undefined;
    }
  }

  private getSeekableStateBatch() {
    const seekable = this.video.seekable;
    let isLiveStream = this.state.isLive;
    const isAdaptive = this.state.sourceType === 'hls' || this.state.sourceType === 'dash';

    if (isAdaptive) {
      // For adaptive engines, they are the authoritative source of truth.
      // Do NOT infer or modify isLiveStream from native duration.
    } else {
      if (this.video.duration === Infinity) {
        isLiveStream = true;
      } else if (isLiveStream === null && this.video.duration > 0) {
        isLiveStream = false;
      }
    }

    let start = 0;
    let end = this.video.duration || 0;

    if (seekable && seekable.length > 0) {
      start = seekable.start(0);
      if (isLiveStream === true) {
        start += 2.0; // Minimal safety margin for live DVR boundary
      }
      end = seekable.end(seekable.length - 1);
      if (start > end) start = end;
    } else if (isLiveStream === true) {
      // For live streams, if seekable is empty, end should be 0, not Infinity
      end = 0;
    }

    const seekableRange = { start, end };
    const dvrWindow = isLiveStream === true ? end - start : 0;
    const hasDvr = this.state.hasDvr || (isLiveStream === true && dvrWindow > 30);
    const canSeekInDvr = hasDvr && this.state.liveMode === 'live-dvr';

    return {
      isLive: isLiveStream,
      seekableRange,
      dvrWindow,
      hasDvr,
      canSeekInDvr,
    };
  }

  private handleWaiting = () => {
    this.clearBufferingTimeout();
    const currentStatus = this.state.status;
    const nextStatus =
      currentStatus === 'playing' || currentStatus === 'ready' || currentStatus === 'paused'
        ? 'buffering'
        : currentStatus;

    this.bufferingTimeout = window.setTimeout(() => {
      this.bufferingTimeout = undefined;
      this.updateState({ isBuffering: true, status: nextStatus });
    }, 250);
    this.dispatchEvent('waiting');
  };

  private handlePlaying = () => {
    this.clearBufferingTimeout();
    this.updateState({ isBuffering: false, isPlaying: true, error: null, status: 'playing' });
    this.dispatchEvent('playing');
  };

  private handleSeeking = () => {
    this.clearBufferingTimeout();
    let currentStatus = this.state.status;
    if (currentStatus === 'ended') {
      currentStatus = this.video.paused ? 'paused' : 'playing';
    }
    const nextStatus =
      currentStatus === 'playing' || currentStatus === 'ready' || currentStatus === 'paused'
        ? 'buffering'
        : currentStatus;

    this.updateState({ isSeeking: true, status: nextStatus });
    this.dispatchEvent('seekstart');

    this.bufferingTimeout = window.setTimeout(() => {
      this.bufferingTimeout = undefined;
      this.updateState({ isBuffering: true });
    }, 250);
  };

  private handleSeeked = () => {
    this.clearBufferingTimeout();
    let currentStatus = this.state.status;
    if (currentStatus === 'ended') {
      currentStatus = this.video.paused ? 'paused' : 'playing';
    }
    let nextStatus = currentStatus;
    if (currentStatus === 'buffering') {
      nextStatus = this.video.paused ? 'paused' : 'playing';
    }
    this.updateState({ isBuffering: false, status: nextStatus, isSeeking: false });
    this.handleTimeUpdate();
    this.dispatchEvent('seekend');
  };

  private handleCanPlay = () => {
    this.clearBufferingTimeout();
    if (this.state.isBuffering) {
      const currentStatus = this.state.status;
      let nextStatus = currentStatus;
      if (currentStatus === 'buffering') {
        nextStatus = this.video.paused ? 'paused' : 'playing';
      }
      this.updateState({ isBuffering: false, status: nextStatus });
    }
  };

  private handleNativeError = (e?: Event) => {
    if (e && e.target && e.target !== this.video) {
      return;
    }
    this.clearBufferingTimeout();
    const errCode = this.video.error ? this.video.error.code : 0;
    let errMsg = 'An unknown video error occurred.';
    switch (errCode) {
      case 1:
        errMsg = 'Video loading aborted by user.';
        break;
      case 2:
        errMsg = 'Network error occurred while fetching video content.';
        break;
      case 3:
        errMsg = 'Video decoding failed. File may be corrupted.';
        break;
      case 4:
        errMsg = 'Video format or codec is not supported by your browser.';
        break;
    }
    this.updateState({ error: errMsg, isBuffering: false, status: 'error' });
    this.dispatchEvent('error', { message: errMsg });
  };

  private handleTimeUpdate = () => {
    if (this.state.isSeeking) return;
    const currentTime = this.video.currentTime;

    // Clear buffering indicator if playhead is progressing
    if (
      currentTime !== this.state.currentTime &&
      (this.state.isBuffering || this.bufferingTimeout)
    ) {
      this.clearBufferingTimeout();
      const currentStatus = this.state.status;
      let nextStatus = currentStatus;
      if (currentStatus === 'buffering') {
        nextStatus = this.video.paused ? 'paused' : 'playing';
      }
      this.updateState({ isBuffering: false, status: nextStatus });
    }

    const seekableState = this.getSeekableStateBatch();

    // Inline active chapter update
    const activeChapterIndex = TimelineMath.findNearestChapter(
      currentTime,
      this.state.chapters || [],
      this.video.duration || Infinity
    );

    const chapterChanged = activeChapterIndex !== this.state.activeChapterIndex;

    this.updateState({
      currentTime,
      activeChapterIndex,
    });

    this.dispatchEvent('timeupdate', {
      currentTime,
      duration: this.state.duration || this.video.duration || 0,
    });

    if (this.state.isLive) {
      this.updateLiveState();
    } else {
      this.updateState({
        isLive: seekableState.isLive,
        hasDvr: seekableState.hasDvr,
        seekableRange: seekableState.seekableRange,
        dvrWindow: seekableState.dvrWindow,
        canSeekInDvr: seekableState.canSeekInDvr,
      });
    }

    if (chapterChanged) {
      this.dispatchEvent('chapterchange', {
        activeChapterIndex,
        chapter: activeChapterIndex !== -1 ? this.state.chapters[activeChapterIndex] : null,
      });
    }
    this.updateMediaSessionPosition();
  };

  private updateActiveChapter() {
    if (!this.state.chapters || this.state.chapters.length === 0) {
      if (this.state.activeChapterIndex !== -1) {
        this.updateState({ activeChapterIndex: -1 });
      }
      return;
    }

    const time = this.video.currentTime;
    const chapters = this.state.chapters;
    const index = chapters.findIndex((c, idx) => {
      const start = c.startTime;
      const end =
        c.endTime !== undefined
          ? c.endTime
          : chapters[idx + 1]
            ? chapters[idx + 1].startTime
            : this.video.duration || Infinity;
      return time >= start && time < end;
    });
    if (index !== this.state.activeChapterIndex) {
      this.updateState({ activeChapterIndex: index });
      this.dispatchEvent('chapterchange', {
        activeChapterIndex: index,
        chapter: index !== -1 ? this.state.chapters[index] : null,
      });
    }
  }

  private handleDurationChange = () => {
    if (this.state.isLive) {
      this.updateLiveState();
    } else {
      const seekableState = this.getSeekableStateBatch();
      this.updateState({
        duration: this.video.duration,
        isLive: seekableState.isLive,
        hasDvr: seekableState.hasDvr,
        seekableRange: seekableState.seekableRange,
        dvrWindow: seekableState.dvrWindow,
        canSeekInDvr: seekableState.canSeekInDvr,
      });
    }
    this.updateMediaSessionPosition();
  };

  private handleVolumeChange = () => {
    if (this.preSeekVolume !== null) {
      if (this.video.volume === this.preSeekVolume) {
        this.preSeekVolume = null;
      }
      return;
    }

    if (this.video.volume > 0) {
      this.lastNonZeroVolume = this.video.volume;
    }
    this.updateState({
      volume: this.video.volume,
      isMuted: this.video.muted,
    });

    try {
      safeStorage.setItem('player_volume', this.video.volume.toString());
      safeStorage.setItem('player_muted', this.video.muted.toString());
    } catch (e) {
      // Ignore
    }

    this.dispatchEvent('volumechange', { volume: this.video.volume });
    this.dispatchEvent('mutechange', { isMuted: this.video.muted });
  };

  private handleProgress = () => {
    const buffered = this.video.buffered;
    const ranges = [];
    for (let i = 0; i < buffered.length; i++) {
      ranges.push({
        start: buffered.start(i),
        end: buffered.end(i),
      });
    }
    this.updateState({
      bufferedRanges: ranges,
    });
    if (this.state.isLive) {
      this.updateLiveState();
    } else {
      const seekableState = this.getSeekableStateBatch();
      this.updateState({
        isLive: seekableState.isLive,
        hasDvr: seekableState.hasDvr,
        seekableRange: seekableState.seekableRange,
        dvrWindow: seekableState.dvrWindow,
        canSeekInDvr: seekableState.canSeekInDvr,
      });
    }
  };

  private handleLoadedMetadata = () => {
    this.video.playbackRate = this.state.playbackRate;

    const currentStatus = this.state.status;
    const nextStatus =
      currentStatus === 'loading' || currentStatus === 'idle' ? 'ready' : currentStatus;

    this.updateState({
      status: nextStatus,
    });

    if (this.state.isLive) {
      this.updateLiveState();
      // Ensure we seek to the live edge on startup if we are paused at time 0 (e.g. autoplay is false)
      if (this.video.paused && this.video.currentTime === 0) {
        const syncStartupSeek = () => {
          if (this.video.seekable.length > 0) {
            this.seekToLiveEdge();
            this.video.removeEventListener('canplay', syncStartupSeek);
            this.video.removeEventListener('timeupdate', syncStartupSeek);
          }
        };

        if (this.video.seekable.length > 0) {
          this.seekToLiveEdge();
        } else {
          this.video.addEventListener('canplay', syncStartupSeek);
          this.video.addEventListener('timeupdate', syncStartupSeek);
        }
      }
    } else {
      const seekableState = this.getSeekableStateBatch();
      this.updateState({
        isLive: seekableState.isLive,
        hasDvr: seekableState.hasDvr,
        seekableRange: seekableState.seekableRange,
        dvrWindow: seekableState.dvrWindow,
        canSeekInDvr: seekableState.canSeekInDvr,
      });
    }
  };

  private handleEnded = () => {
    if (this.state.loop && this.state.displayMode !== 'vertical') {
      this.seek(0);
      this.play();
    } else {
      this.updateState({ isPlaying: false, status: 'ended' });
      this.stopStallCheck();
      if (this.state.sleepTimerSetting === 'end') {
        this.clearSleepTimer();
        this.triggerSleepTimerExpiration();
      }
      this.dispatchEvent('ended');
    }
  };

  public setManagedSubtitleTracks(
    source: 'hls' | 'dash',
    tracks: Array<{
      label: string;
      language: string;
      default?: boolean;
      forced?: boolean;
      kind?: string;
    }>,
    activeIndex: number
  ) {
    this.subtitleManager.setManagedSubtitleTracks(source, tracks, activeIndex);
  }

  private handleFullscreenChange = () => {
    const vendorDoc = document as VendorPrefixedFullscreenDocument;
    const isFs = !!(
      document.fullscreenElement ||
      vendorDoc.webkitFullscreenElement ||
      vendorDoc.mozFullScreenElement ||
      vendorDoc.msFullscreenElement
    );
    this.updateState({ isFullscreen: isFs });
    this.dispatchEvent('fullscreenchange', { isFullscreen: isFs });
  };

  private handleWebkitBeginFullscreen = () => {
    this.updateState({ isFullscreen: true });
    this.dispatchEvent('fullscreenchange', { isFullscreen: true });
  };

  private handleWebkitEndFullscreen = () => {
    this.updateState({ isFullscreen: false });
    this.dispatchEvent('fullscreenchange', { isFullscreen: false });
  };

  // --- Media API Operations ---
  public play() {
    const plugins = this.getPlugins();
    for (const p of plugins) {
      try {
        p.onBeforePlay?.();
      } catch (err) {
        console.error(`[PlayerController] Error running onBeforePlay for plugin ${p.name}:`, err);
      }
    }

    for (const interceptor of this.playbackInterceptors) {
      if (interceptor.play) {
        try {
          const res = interceptor.play();
          if (res) {
            for (const p of plugins) {
              p.onAfterPlay?.();
            }
            return;
          }
        } catch (err) {
          console.error(`[PlayerController] Playback interceptor error:`, err);
        }
      }
    }

    this.video
      .play()
      .then(() => {
        for (const p of plugins) {
          try {
            p.onAfterPlay?.();
          } catch (err) {
            console.error(
              `[PlayerController] Error running onAfterPlay for plugin ${p.name}:`,
              err
            );
          }
        }
      })
      .catch((err) => {
        console.warn('Playback failed or was prevented by browser autoplay restrictions:', err);
      });
  }

  public pause() {
    for (const interceptor of this.playbackInterceptors) {
      if (interceptor.pause) {
        try {
          const res = interceptor.pause();
          if (res) return;
        } catch (err) {
          console.error(`[PlayerController] Pause interceptor error:`, err);
        }
      }
    }
    this.video.pause();
  }

  public togglePlay() {
    if (this.state.isPlaying) {
      this.pause();
    } else {
      this.play();
    }
  }

  public seek(time: number) {
    if (this.state.isLive && !this.state.canSeekInDvr) {
      return;
    }

    let targetTime = time;
    if (this.state.isLive) {
      const start = this.state.seekableRange?.start ?? 0;
      const end = this.state.seekableRange?.end ?? 0;
      targetTime = Math.max(start, Math.min(time, end));
    } else {
      targetTime = Math.max(0, Math.min(time, this.state.duration || 0));
    }

    for (const interceptor of this.playbackInterceptors) {
      if (interceptor.seek) {
        try {
          const res = interceptor.seek(targetTime);
          if (res) return;
        } catch (err) {
          console.error(`[PlayerController] Seek interceptor error:`, err);
        }
      }
    }

    const handler = this.sourceManager.getActiveHandler() as SeekCapableSourceHandler | null;
    let handled = false;
    if (handler && typeof handler.seek === 'function') {
      handled = handler.seek(targetTime);
    }

    if (!handled) {
      const preciseSeek = this.config?.preciseSeek;
      const preciseSeekObj = typeof preciseSeek === 'object' ? preciseSeek : undefined;
      const shouldSmooth =
        preciseSeek !== false &&
        preciseSeekObj?.enabled !== false &&
        preciseSeekObj?.seekSmoothing !== false;
      const originalVolume = this.video.volume;
      const originalMuted = this.video.muted;

      if (shouldSmooth && !originalMuted && originalVolume > 0) {
        if (this.preSeekVolume === null) {
          this.preSeekVolume = originalVolume;
        }
        this.video.volume = this.preSeekVolume * 0.1;
        const restoreVolume = () => {
          if (this.preSeekVolume !== null) {
            this.video.volume = this.preSeekVolume;
            this.preSeekVolume = null;
          }
          this.video.removeEventListener('seeked', restoreVolume);
        };
        this.video.addEventListener('seeked', restoreVolume);
        setTimeout(() => {
          this.video.removeEventListener('seeked', restoreVolume);
          if (this.preSeekVolume !== null) {
            this.video.volume = this.preSeekVolume;
            this.preSeekVolume = null;
          }
        }, 250);
      }
      this.video.currentTime = targetTime;
    }

    const changes: Partial<PlayerState> = { currentTime: targetTime, isSeeking: true };
    if (this.state.isLive) {
      const target = this.getLiveEdgeTarget();
      const latency = Math.max(0, target - targetTime);
      const edgeThreshold = this.state.isLowLatency ? 6.0 : 18.0;
      changes.liveLatency = latency;
      changes.isAtLiveEdge = latency <= edgeThreshold;
    }
    this.updateState(changes);
  }

  public seekBy(seconds: number) {
    this.seek(this.state.currentTime + seconds);
  }

  public setVolume(vol: number) {
    const targetVol = Math.max(0, Math.min(vol, 1));
    for (const interceptor of this.playbackInterceptors) {
      if (interceptor.setVolume) {
        try {
          const res = interceptor.setVolume(targetVol);
          if (res) return;
        } catch (err) {
          console.error(`[PlayerController] setVolume interceptor error:`, err);
        }
      }
    }
    this.video.volume = targetVol;
    if (targetVol > 0) {
      this.lastNonZeroVolume = targetVol;
      if (this.video.muted) {
        this.setMuted(false);
      }
    }
  }

  public setMuted(muted: boolean) {
    for (const interceptor of this.playbackInterceptors) {
      if (interceptor.setMuted) {
        try {
          const res = interceptor.setMuted(muted);
          if (res) return;
        } catch (err) {
          console.error(`[PlayerController] setMuted interceptor error:`, err);
        }
      }
    }
    this.video.muted = muted;
  }

  public toggleMute() {
    const isCurrentlyMuted = this.video.muted || this.video.volume === 0;
    const newMutedState = !isCurrentlyMuted;
    this.setMuted(newMutedState);
    if (!newMutedState) {
      if (this.video.volume === 0) {
        this.setVolume(this.lastNonZeroVolume > 0 ? this.lastNonZeroVolume : 0.5);
      }
    }
  }

  public setPlaybackRate(rate: number) {
    if (!this.isPlaybackSpeedEnabled()) {
      rate = 1.0;
    }
    this.video.playbackRate = rate;
    this.updateState({ playbackRate: rate });
    try {
      safeStorage.setItem('player_playback_rate', rate.toString());
    } catch (e) {
      // Ignore
    }
  }

  public toggleFullscreen(container?: HTMLElement) {
    const target = container || this.video;

    const vendorTarget = target as VendorPrefixedFullscreenElement;
    const vendorVideo = this.video as WebkitVideoElement;
    const vendorDoc = document as VendorPrefixedFullscreenDocument;
    if (!this.state.isFullscreen) {
      if (target.requestFullscreen) {
        target.requestFullscreen();
      } else if (vendorTarget.webkitRequestFullscreen) {
        vendorTarget.webkitRequestFullscreen();
      } else if (this.video && vendorVideo.webkitEnterFullscreen) {
        // Native iOS Safari video fallback
        vendorVideo.webkitEnterFullscreen();
      }
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
      } else if (vendorDoc.webkitExitFullscreen) {
        vendorDoc.webkitExitFullscreen();
      } else if (this.video && vendorVideo.webkitExitFullscreen) {
        vendorVideo.webkitExitFullscreen();
      }
    }
  }

  public isPictureInPictureSupported(): boolean {
    return this.pictureInPictureManager.isPictureInPictureSupported();
  }

  public async enterPictureInPicture(): Promise<PictureInPictureWindow | undefined> {
    return this.pictureInPictureManager.enterPictureInPicture();
  }

  public async exitPictureInPicture(): Promise<void> {
    return this.pictureInPictureManager.exitPictureInPicture();
  }

  public async togglePictureInPicture(): Promise<void> {
    // Routed through this class's own public methods on purpose so consumers
    // wrapping enterPictureInPicture()/exitPictureInPicture() still observe it.
    if (this.pictureInPictureManager.isInPictureInPicture()) {
      await this.exitPictureInPicture();
    } else {
      await this.enterPictureInPicture();
    }
  }

  // --- Subtitle & Caption Management ---
  public loadCaptions(track: TextTrackSource) {
    this.subtitleManager.loadCaptions(track);
  }

  public toggleCaptions(enable?: boolean) {
    this.subtitleManager.toggleCaptions(enable);
  }

  public replay() {
    this.seek(0);
    this.play();
    this.dispatchEvent('replay');
  }

  private validateSource(source: PlayerSource): boolean {
    if (!source) return false;
    if (!source.src) return false;
    const trimmed = source.src.trim();
    if (trimmed.length === 0) return false;
    return (
      trimmed.startsWith('http://') ||
      trimmed.startsWith('https://') ||
      trimmed.startsWith('/') ||
      trimmed.startsWith('blob:') ||
      trimmed.startsWith('data:')
    );
  }

  private parseAndSanitizeEmbedSource(source: PlayerSource): boolean {
    if (!source || !source.src) return false;
    const embedUrl = sanitizeAndConvertEmbedUrl(source.src);
    if (embedUrl) {
      source.src = embedUrl;
      return true;
    }
    return false;
  }

  public loadSource(source: PlayerSource, clearPlaylist: boolean = true) {
    if (source.live?.mode) {
      this.setLiveMode(source.live.mode);
    }

    if (clearPlaylist && this.state.playlist.length > 0) {
      this.playlistManager.clearForExternalSourceLoad();
    }
    this.setSleepTimer('off');
    // Revoke any created blob URLs
    this.subtitleManager.revokeBlobUrls();

    if (this.state.pictureInPicture) {
      this.exitPictureInPicture().catch(() => {
        /* ignore */
      });
    }

    if (
      !source ||
      (!source.src && !source.srcObject) ||
      (typeof source.src === 'string' && source.src.trim() === '')
    ) {
      this.sourceManager.destroy();
      this.stopStallCheck();

      this.video.src = '';
      this.video.srcObject = null;
      this.video.removeAttribute('src');
      try {
        this.video.load();
      } catch (e) {
        // Ignore any errors from video.load()
      }

      const existingTracks = this.video.querySelectorAll('track');
      existingTracks.forEach((t) => t.remove());
      this.subtitleManager.resetManagedTracks();

      this.updateState({
        status: 'idle',
        currentSource: null,
        sourceType: 'unknown',
        error: null,
        isPlaying: false,
        isBuffering: false,
        isSeeking: false,
        currentTime: 0,
        duration: 0,
        bufferedRanges: [],
        qualities: [],
        activeQuality: 'Auto',
        audioTracks: [],
        activeAudioTrack: -1,
        subtitleTracks: [],
        activeSubtitleTrack: -1,
        activeSubtitleTrackId: null,
        chapters: [],
        activeChapterIndex: -1,
        markers: [],
      });
      this.dispatchEvent('sourcechange', { source: null });
      this.thumbnailProvider?.setSource?.('');
      return;
    }

    this.sourceManager.destroy();
    this.stopStallCheck();

    // 1. Detect type first
    let detectedType: SourceType = source.type || 'unknown';
    if (detectedType === 'unknown' && source.src) {
      const url = source.src.split('?')[0].toLowerCase();
      if (url.endsWith('.m3u8')) {
        detectedType = 'hls';
      } else if (url.endsWith('.mpd')) {
        detectedType = 'dash';
      } else if (url.endsWith('.webm')) {
        detectedType = 'webm';
      } else if (url.endsWith('.mov')) {
        detectedType = 'mov';
      } else if (
        url.includes('youtube.com') ||
        url.includes('youtu.be') ||
        url.includes('vimeo.com') ||
        source.src.trim().toLowerCase().startsWith('<iframe')
      ) {
        detectedType = 'embed';
      } else {
        detectedType = 'mp4';
      }
    }

    // 2. Sanitize and normalize embed source if type is embed
    if (detectedType === 'embed') {
      const ok = this.parseAndSanitizeEmbedSource(source);
      if (!ok) {
        this.updateState({
          status: 'error',
          currentSource: null,
          sourceType: 'unknown',
          error: 'Invalid embed source or host not approved.',
          isPlaying: false,
          currentTime: 0,
          duration: 0,
          bufferedRanges: [],
          isLive: false,
          seekableRange: { start: 0, end: 0 },
          chapters: [],
          activeChapterIndex: -1,
        });
        this.dispatchEvent('sourcechange', { source });
        this.thumbnailProvider?.setSource?.('');
        return;
      }
    }

    if (!this.validateSource(source)) {
      this.updateState({
        status: 'error',
        currentSource: null,
        sourceType: 'unknown',
        error: 'Invalid video source layout or stream. Please verify input.',
        isPlaying: false,
        currentTime: 0,
        duration: 0,
        bufferedRanges: [],
        isLive: false,
        seekableRange: { start: 0, end: 0 },
        chapters: [],
        activeChapterIndex: -1,
      });
      this.dispatchEvent('sourcechange', { source });
      this.thumbnailProvider?.setSource?.('');
      return;
    }

    // Revoke any created blob URLs
    this.subtitleManager.revokeBlobUrls();

    // Clear out previous tracks
    if (this.video.textTracks) {
      for (let i = 0; i < this.video.textTracks.length; i++) {
        (this.video.textTracks[i] as ZombieTextTrack)._zombie = true;
      }
    }
    const existingTracks = this.video.querySelectorAll('track');
    existingTracks.forEach((t) => t.remove());
    this.subtitleManager.resetManagedTracks();

    source.type = detectedType;

    const displaySource = source.src || '';

    this.video.loop = this.state.displayMode === 'vertical' ? false : this.state.loop;

    this.updateState({
      status: 'loading',
      currentSource: displaySource,
      sourceType: detectedType,
      isBuffering: false,
      isSeeking: false,
      isPlaying: false,
      currentTime: 0,
      duration: 0,
      bufferedRanges: [],
      error: null,
      qualities: [],
      activeQuality: 'Auto',
      audioTracks: [],
      activeAudioTrack: -1,
      subtitleTracks: [],
      activeSubtitleTrack: -1,
      activeSubtitleTrackId: null,
      isLive: null,
      isAtLiveEdge: true,
      liveLatency: null,
      dvrWindow: 0,
      canSeekInDvr: false,
      seekableRange: { start: 0, end: 0 },
      chapters: source.chapters || [],
      activeChapterIndex: -1,
      markers: [],
      visibleMarkerTypes: null,
    });

    // Load external subtitle tracks if present in source
    this.subtitleManager.attachSourceSubtitles(source.subtitles);

    this.subtitleManager.refreshSubtitleTracks();

    // Reset video source properties to prevent cross-handler state leaks
    this.video.srcObject = null;
    this.video.src = '';
    this.video.removeAttribute('src');

    this.sourceManager.load(source, this.video, this);
    this.thumbnailProvider?.setSource?.(displaySource, source);
    this.dispatchEvent('sourcechange', { source });
    this.updateMediaSession();

    const plugins = this.getPlugins();
    for (const p of plugins) {
      try {
        p.onSourceLoaded?.(source);
      } catch (err) {
        console.error(`[PlayerController] Error running onSourceLoaded for plugin ${p.name}:`, err);
      }
    }
  }

  public setQuality(qualityIndex: number) {
    if (!this.isQualityEnabled()) return;
    this.sourceManager.setQuality(qualityIndex);
    this.dispatchEvent('qualitychange', { qualityIndex });
  }

  public getAudioTracks(): string[] {
    return this.state.audioTracks;
  }

  public getCurrentAudioTrack(): number {
    return this.state.activeAudioTrack;
  }

  public setAudioTrack(trackIndex: number) {
    if (!this.isAudioTracksEnabled()) return;
    this.sourceManager.setAudioTrack(trackIndex);

    // Persistence logic
    try {
      const tracks = this.state.audioTracks;
      if (trackIndex >= 0 && trackIndex < tracks.length) {
        safeStorage.setItem('player_audio_language', tracks[trackIndex]);
      }
    } catch (e) {
      // Ignore
    }

    this.dispatchEvent('audiochange', { trackIndex });
  }
  public setSubtitleTrack(trackId: string | number) {
    this.subtitleManager.setSubtitleTrack(trackId);
  }

  public disableSubtitles() {
    this.subtitleManager.disableSubtitles();
  }

  public hasSubtitles(): boolean {
    return this.subtitleManager.hasSubtitles();
  }

  public getSubtitleTracks(): SubtitleTrack[] {
    return this.subtitleManager.getSubtitleTracks();
  }

  public getActiveSubtitleTrack(): SubtitleTrack | null {
    return this.subtitleManager.getActiveSubtitleTrack();
  }

  public getSubtitleAppearance(): SubtitleAppearance {
    return this.subtitleManager.getSubtitleAppearance();
  }

  public setSubtitleAppearance(appearance: Partial<SubtitleAppearance>) {
    this.subtitleManager.setSubtitleAppearance(appearance);
  }

  public resetSubtitleAppearance() {
    this.subtitleManager.resetSubtitleAppearance();
  }

  // --- Stall Recovery Mechanics ---
  private startStallCheck() {
    this.stopStallCheck();
    let lastTime = this.video.currentTime;
    let stuckCount = 0;

    this.stallTimer = window.setInterval(() => {
      if (this.state.isPlaying && !this.state.isBuffering) {
        if (this.video.currentTime === lastTime) {
          stuckCount++;
          if (stuckCount >= 5) {
            console.warn('Playback stall detected. Attempting stall recovery seek offset...');
            this.video.currentTime = Math.min(
              this.video.currentTime + 0.1,
              this.state.duration || 0
            );
            stuckCount = 0;
          }
        } else {
          stuckCount = 0;
          lastTime = this.video.currentTime;
        }
      }
    }, 1000);
  }

  private stopStallCheck() {
    if (this.stallTimer) {
      clearInterval(this.stallTimer);
      this.stallTimer = undefined;
    }
  }

  // --- Core Phase 2 Extension Methods ---

  public getVideoElement(): HTMLVideoElement {
    return this.video;
  }

  /** The currently-active source handler's DRM manager, if any - used by
   * DrmValidator's diagnostics report. Returns null when no source is
   * loaded, or the active handler doesn't use DRM. */
  public getDrmManager(): DrmManager | null {
    return this.sourceManager.getActiveHandler()?.getDrmManager?.() ?? null;
  }

  // --- Chapter System ---
  public setChapters(chapters: Chapter[]) {
    if (!this.isChaptersEnabled()) {
      this.updateState({ chapters: [], activeChapterIndex: -1 });
      return;
    }
    this.updateState({ chapters });
    this.updateActiveChapter();
  }

  public nextChapter() {
    const chapters = this.state.chapters;
    if (!chapters || chapters.length === 0) return;
    const time = this.video.currentTime;
    const next = chapters.find((c) => c.startTime > time + 0.5);
    if (next) {
      this.seek(next.startTime);
    }
  }

  public prevChapter() {
    const chapters = this.state.chapters;
    if (!chapters || chapters.length === 0) return;
    const time = this.video.currentTime;
    const activeIdx = this.state.activeChapterIndex;
    if (activeIdx > 0 && time - chapters[activeIdx].startTime < 2.0) {
      this.seek(chapters[activeIdx - 1].startTime);
    } else if (activeIdx >= 0) {
      this.seek(chapters[activeIdx].startTime);
    } else {
      const prev = [...chapters].reverse().find((c) => c.startTime < time - 0.5);
      if (prev) {
        this.seek(prev.startTime);
      }
    }
  }

  public getChapters(): Chapter[] {
    return this.state.chapters || [];
  }

  public getActiveChapter(): Chapter | null {
    const idx = this.state.activeChapterIndex;
    const chapters = this.state.chapters;
    if (idx >= 0 && chapters && chapters[idx]) {
      return chapters[idx];
    }
    return null;
  }

  public seekToChapter(idOrIndex: string | number) {
    const chapters = this.state.chapters;
    if (!chapters || chapters.length === 0) return;

    let chapter: Chapter | undefined;
    if (typeof idOrIndex === 'number') {
      chapter = chapters[idOrIndex];
    } else {
      chapter = chapters.find((c) => c.id === idOrIndex);
    }

    if (chapter) {
      this.seek(chapter.startTime);
    }
  }

  // --- Timeline Markers ---
  public setMarkers(markers: TimelineMarker[]) {
    if (!this.isMarkersEnabled()) {
      this.updateState({ markers: [] });
      return;
    }
    this.updateState({ markers });
  }

  public addMarker(marker: TimelineMarker) {
    if (!this.isMarkersEnabled()) {
      return;
    }
    const nextMarkers = [...this.state.markers, marker];
    this.updateState({ markers: nextMarkers });
  }

  public clearMarkers() {
    this.updateState({ markers: [] });
  }

  // --- Loop Mode ---
  public setLoop(enabled: boolean) {
    this.video.loop = this.state.displayMode === 'vertical' ? false : enabled;
    this.updateState({ loop: enabled });
    try {
      safeStorage.setItem('player_loop', enabled.toString());
    } catch (e) {
      // Ignore
    }
  }

  public toggleLoop() {
    this.setLoop(!this.state.loop);
  }

  // --- Auto Scroll Mode ---
  public setAutoScroll(enabled: boolean) {
    this.updateState({ autoScroll: enabled });
    try {
      safeStorage.setItem('player_auto_scroll', enabled.toString());
    } catch (e) {
      // Ignore
    }
    this.dispatchEvent('autoscroll-change', { autoScroll: enabled });
  }

  public toggleAutoScroll() {
    this.setAutoScroll(!this.state.autoScroll);
  }

  // --- Sleep Timer ---
  private tickSleepTimer() {
    if (!this.sleepTimerEndTimeMs || this.state.sleepTimerExpired) {
      return;
    }
    const remaining = Math.max(0, Math.ceil((this.sleepTimerEndTimeMs - Date.now()) / 1000));
    if (remaining <= 0) {
      this.clearSleepTimer();
      this.triggerSleepTimerExpiration();
    } else {
      this.updateState({
        sleepTimerSecondsRemaining: remaining,
      });
      this.dispatchEvent('sleeptimerupdate', {
        secondsRemaining: remaining,
        endTimeMs: this.sleepTimerEndTimeMs,
      });
    }
  }

  public setSleepTimer(setting: 'off' | 10 | 15 | 20 | 30 | 45 | 60 | 'end') {
    if (this.config?.controls?.sleepTimer === false) {
      return;
    }
    if (setting === 'end' && this.state.isLive) {
      console.warn('[PlayerController] Cannot set "end" sleep timer on a live stream');
      return;
    }
    this.clearSleepTimer();
    const wasExpired = this.state.sleepTimerExpired;

    this.updateState({
      sleepTimerSetting: setting,
      sleepTimerExpired: false,
    });

    if (setting === 'off') {
      this.sleepTimerEndTimeMs = undefined;
      this.updateState({
        sleepTimerSecondsRemaining: null,
      });
      this.dispatchEvent('sleeptimercancelled');
      return;
    }

    if (setting === 'end') {
      this.sleepTimerEndTimeMs = undefined;
      this.updateState({
        sleepTimerSecondsRemaining: null,
      });
      this.dispatchEvent('sleeptimerstart', {
        setting: 'end',
        secondsRemaining: null,
        endTimeMs: null,
      });
      if (wasExpired) {
        this.play();
      }
      return;
    }

    const seconds = setting * 60;
    this.sleepTimerEndTimeMs = Date.now() + seconds * 1000;
    this.updateState({
      sleepTimerSecondsRemaining: seconds,
    });

    this.dispatchEvent('sleeptimerstart', {
      setting,
      secondsRemaining: seconds,
      endTimeMs: this.sleepTimerEndTimeMs,
    });

    this.startSleepTimerCountdown();

    if (wasExpired) {
      this.play();
    }
  }

  private startSleepTimerCountdown() {
    if (this.sleepTimerId) {
      clearInterval(this.sleepTimerId);
    }
    this.sleepTimerId = window.setInterval(() => {
      this.tickSleepTimer();
    }, 1000);
  }

  private clearSleepTimer() {
    if (this.sleepTimerId) {
      clearInterval(this.sleepTimerId);
      this.sleepTimerId = undefined;
    }
    this.sleepTimerEndTimeMs = undefined;
  }

  public clearSleepTimerExpired() {
    this.updateState({
      sleepTimerExpired: false,
    });
  }

  private triggerSleepTimerExpiration() {
    this.pause();
    this.updateState({
      sleepTimerExpired: true,
      sleepTimerSetting: 'off',
      sleepTimerSecondsRemaining: null,
    });
    this.dispatchEvent('sleeptimerexpired');
  }

  public getSleepTimerState(): SleepTimerFullState {
    return {
      setting: this.state.sleepTimerSetting,
      secondsRemaining: this.state.sleepTimerSecondsRemaining,
      endTimeMs: this.sleepTimerEndTimeMs || null,
      isExpired: this.state.sleepTimerExpired,
      isRunning: this.isSleepTimerRunning(),
    };
  }

  public getSleepTimerRemaining(): number | null {
    if (!this.sleepTimerEndTimeMs || this.state.sleepTimerExpired) return null;
    return Math.max(0, Math.ceil((this.sleepTimerEndTimeMs - Date.now()) / 1000));
  }

  public getSleepTimerPreset(): 'off' | 10 | 15 | 20 | 30 | 45 | 60 | 'end' {
    return this.state.sleepTimerSetting;
  }

  public isSleepTimerRunning(): boolean {
    return Boolean(
      this.sleepTimerEndTimeMs &&
        !this.state.sleepTimerExpired &&
        (this.state.sleepTimerSecondsRemaining ?? 0) > 0
    );
  }
  public isPluginsEnabled(): boolean {
    // `config.plugins` is typed as `PlayerPlugin[] | undefined`, but plain-JS
    // consumers may also pass `false` or `{ enabled?: boolean; list?: [...] }`
    // - narrowed via `unknown` rather than trusted blindly.
    const pluginsConfig: unknown = this.config?.plugins;
    if (pluginsConfig === false) return false;
    if (pluginsConfig && typeof pluginsConfig === 'object' && 'enabled' in pluginsConfig) {
      return (pluginsConfig as { enabled?: boolean }).enabled !== false;
    }
    if (this.config?.controls && this.config.controls.plugins === false) {
      return false;
    }
    return true;
  }

  public isAnalyticsEnabled(): boolean {
    // Same rationale as `isPluginsEnabled()` above: `config.analytics` is
    // typed as `{ handlers?: [...] } | undefined`, but a bare `false` or an
    // `enabled` flag are also accepted at runtime.
    const analyticsConfig: unknown = this.config?.analytics;
    if (analyticsConfig === false) return false;
    if (
      analyticsConfig &&
      typeof analyticsConfig === 'object' &&
      (analyticsConfig as { enabled?: boolean }).enabled === false
    ) {
      return false;
    }
    // `controls.analytics` isn't part of the documented `controls` shape;
    // treated as an escape-hatch key the same way `settings`' index signature is.
    if (this.config?.controls && (this.config.controls as Record<string, unknown>).analytics === false) {
      return false;
    }
    return true;
  }

  public isSubtitlesEnabled(): boolean {
    if (this.config?.controls?.subtitles === false && this.config?.controls?.captions === false) return false;
    return true;
  }

  public isAudioTracksEnabled(): boolean {
    if (this.config?.controls?.audioTracks === false) return false;
    return true;
  }

  public isQualityEnabled(): boolean {
    if (this.config?.controls?.quality === false) return false;
    return true;
  }

  public isPlaybackSpeedEnabled(): boolean {
    if (this.config?.controls?.playbackSpeed === false) return false;
    return true;
  }

  public isSmartSeekEnabled(): boolean {
    const smartSeek = this.config?.smartSeek;
    if (smartSeek === false || (typeof smartSeek === 'object' && smartSeek.enabled === false)) {
      return false;
    }
    return true;
  }

  public isChaptersEnabled(): boolean {
    if (!this.isSmartSeekEnabled()) return false;
    const smartSeek = this.config?.smartSeek;
    if (smartSeek && typeof smartSeek === 'object' && smartSeek.chapters === false) return false;
    if (this.config?.controls?.chapters === false) return false;
    return true;
  }

  public isMarkersEnabled(): boolean {
    if (!this.isSmartSeekEnabled()) return false;
    const smartSeek = this.config?.smartSeek;
    if (smartSeek && typeof smartSeek === 'object' && smartSeek.markers === false) return false;
    if (this.config?.controls?.markers === false) return false;
    return true;
  }

  public isPreciseSeekEnabled(): boolean {
    const preciseSeek = this.config?.preciseSeek;
    if (preciseSeek === false || (typeof preciseSeek === 'object' && preciseSeek.enabled === false)) {
      return false;
    }
    return true;
  }

  public shouldSnapToChapters(): boolean {
    if (!this.isPreciseSeekEnabled()) return false;
    if (!this.isChaptersEnabled()) return false;
    const preciseSeek = this.config?.preciseSeek;
    const smartSeek = this.config?.smartSeek;
    if (preciseSeek && typeof preciseSeek === 'object' && preciseSeek.snapToChapters !== undefined) {
      return preciseSeek.snapToChapters;
    }
    if (smartSeek && typeof smartSeek === 'object' && smartSeek.snapToChapters !== undefined) {
      return smartSeek.snapToChapters;
    }
    return true;
  }

  public shouldSnapToMarkers(): boolean {
    if (!this.isPreciseSeekEnabled()) return false;
    if (!this.isMarkersEnabled()) return false;
    const preciseSeek = this.config?.preciseSeek;
    const smartSeek = this.config?.smartSeek;
    if (preciseSeek && typeof preciseSeek === 'object' && preciseSeek.snapToMarkers !== undefined) {
      return preciseSeek.snapToMarkers;
    }
    if (smartSeek && typeof smartSeek === 'object' && smartSeek.snapToMarkers !== undefined) {
      return smartSeek.snapToMarkers;
    }
    return true;
  }

  public isKeyboardPrecisionEnabled(): boolean {
    if (!this.isPreciseSeekEnabled()) return false;
    const preciseSeek = this.config?.preciseSeek;
    if (preciseSeek && typeof preciseSeek === 'object' && preciseSeek.keyboardPrecision === false) return false;
    return true;
  }

  public isFrameAccurateSeekingEnabled(): boolean {
    if (!this.isPreciseSeekEnabled()) return false;
    const preciseSeek = this.config?.preciseSeek;
    if (preciseSeek && typeof preciseSeek === 'object' && preciseSeek.frameAccurate === false) return false;
    return true;
  }

  public isLiveDraggingEnabled(): boolean {
    if (!this.isPreciseSeekEnabled()) return false;
    const preciseSeek = this.config?.preciseSeek;
    if (preciseSeek && typeof preciseSeek === 'object' && preciseSeek.liveDragging !== undefined) {
      return preciseSeek.liveDragging;
    }
    return true;
  }

  public isSmoothDraggingEnabled(): boolean {
    if (!this.isPreciseSeekEnabled()) return false;
    const preciseSeek = this.config?.preciseSeek;
    if (preciseSeek && typeof preciseSeek === 'object') {
      if (preciseSeek.smoothDragging === false || preciseSeek.dragInterpolation === false) {
        return false;
      }
    }
    return true;
  }

  public isContinuousUpdatesEnabled(): boolean {
    if (!this.isPreciseSeekEnabled()) return false;
    const preciseSeek = this.config?.preciseSeek;
    if (preciseSeek && typeof preciseSeek === 'object' && preciseSeek.continuousUpdates === false) {
      return false;
    }
    return true;
  }

  // --- Configuration System ---
  public exportConfig(): PlayerConfiguration {
    return JSON.parse(JSON.stringify(this.config));
  }

  public updateConfig(newConfig: Partial<PlayerConfiguration>) {
    this.validateConfig(newConfig);
    const mergedConfig: PlayerConfiguration = {
      ...this.config,
      ...newConfig,
      theme: {
        ...(this.config.theme || {}),
        ...(newConfig.theme || {}),
      },
      controls: {
        ...(this.config.controls || {}),
        ...(newConfig.controls || {}),
      },
      settings: {
        ...(this.config.settings || {}),
        ...(newConfig.settings || {}),
      },
      layout: {
        ...(this.config.layout || {}),
        ...(newConfig.layout || {}),
      },
      playback: {
        ...(this.config.playback || {}),
        ...(newConfig.playback || {}),
      },
      sleepTimer: {
        ...(this.config.sleepTimer || {}),
        ...(newConfig.sleepTimer || {}),
      },
      shortcuts: {
        ...(this.config.shortcuts || {}),
        ...(newConfig.shortcuts || {}),
      },
      preciseSeek: newConfig.preciseSeek !== undefined
        ? (typeof newConfig.preciseSeek === 'object'
          ? {
              ...(typeof this.config.preciseSeek === 'object' ? this.config.preciseSeek : {}),
              ...newConfig.preciseSeek,
            }
          : newConfig.preciseSeek)
        : this.config.preciseSeek,
      smartSeek: newConfig.smartSeek !== undefined
        ? (typeof newConfig.smartSeek === 'object'
          ? {
              ...(typeof this.config.smartSeek === 'object' ? this.config.smartSeek : {}),
              ...newConfig.smartSeek,
            }
          : newConfig.smartSeek)
        : this.config.smartSeek,
    };

    this.config = this.createUnifiedConfig(mergedConfig);

    const smartSeek = this.config.smartSeek;
    const isSmartSeekEnabled =
      smartSeek !== false && (typeof smartSeek !== 'object' || smartSeek.enabled !== false);
    if (!isSmartSeekEnabled) {
      if (this.thumbnailProvider && typeof this.thumbnailProvider.destroy === 'function') {
        try {
          this.thumbnailProvider.destroy();
        } catch (e) {
          console.error('[PlayerController] Error destroying thumbnail provider:', e);
        }
      }
      this.thumbnailProvider = undefined;
      this.updateState({ thumbnailProvider: undefined });
    } else if (!this.thumbnailProvider) {
      if (!this.config.thumbnailProvider) {
        this.thumbnailProvider = new AutoThumbnailProvider(this.config);
      } else {
        this.thumbnailProvider = this.config.thumbnailProvider;
      }
      this.updateState({ thumbnailProvider: this.thumbnailProvider });
    } else {
      const configurableProvider = this.thumbnailProvider as ConfigurableThumbnailProvider;
      if (typeof configurableProvider.updateConfig === 'function') {
        configurableProvider.updateConfig(this.config);
      } else {
        configurableProvider.config = this.config;
      }
    }

    if (!this.isAnalyticsEnabled()) {
      this.analyticsHandlers.clear();
    }

    if (!this.isPluginsEnabled() && this.plugins.size > 0) {
      this.plugins.forEach((plugin) => {
        try {
          plugin.destroy?.();
        } catch (e) {
          console.error(`[PlayerController] Error destroying plugin "${plugin.name}":`, e);
        }
      });
      this.plugins.clear();
    }

    if (this.config.controls?.sleepTimer === false) {
      this.clearSleepTimer();
      this.updateState({
        sleepTimerSetting: 'off',
        sleepTimerSecondsRemaining: null,
        sleepTimerExpired: false,
      });
    }

    if (!this.isChaptersEnabled() && this.state.chapters && this.state.chapters.length > 0) {
      this.updateState({ chapters: [], activeChapterIndex: -1 });
    }

    if (!this.isMarkersEnabled() && this.state.markers && this.state.markers.length > 0) {
      this.updateState({ markers: [] });
    }

    if (this.config.controls && this.config.controls.liveDVR !== undefined) {
      const liveDVR = this.config.controls.liveDVR;
      if (liveDVR === false) {
        this.updateState({ liveMode: 'live-only', canSeekInDvr: false });
      } else {
        this.updateState({
          liveMode: (this.config.live?.mode || 'live-dvr'),
          canSeekInDvr: this.state.hasDvr
        });
      }
    }

    if (!this.isSubtitlesEnabled() && this.state.subtitleTracks && this.state.subtitleTracks.length > 0) {
      this.updateState({
        subtitleTracks: [],
        activeSubtitleTrack: -1,
        activeSubtitleTrackId: null,
        captionsEnabled: false
      });
      this.disableSubtitles();
    }

    if (!this.isAudioTracksEnabled() && this.state.audioTracks && this.state.audioTracks.length > 0) {
      this.updateState({ audioTracks: [], activeAudioTrack: -1 });
    }

    if (!this.isQualityEnabled() && this.state.qualities && this.state.qualities.length > 0) {
      this.updateState({ qualities: [], activeQuality: 'Auto' });
    }

    if (!this.isPlaybackSpeedEnabled() && this.state.playbackRate !== 1.0) {
      this.setPlaybackRate(1.0);
    }
    if (newConfig.playback && newConfig.playback.autoplay !== undefined) {
      this.video.autoplay = newConfig.playback.autoplay;
    }
    if (newConfig.playback && newConfig.playback.loop !== undefined) {
      this.video.loop = newConfig.playback.loop;
      this.updateStatePublic({ loop: newConfig.playback.loop });
    }
    if (newConfig.playback && newConfig.playback.volume !== undefined) {
      this.setVolume(newConfig.playback.volume);
    }
    if (newConfig.playback && newConfig.playback.muted !== undefined) {
      if (newConfig.playback.muted !== this.video.muted) {
        this.toggleMute();
      }
    }
    if (newConfig.shortcuts && newConfig.shortcuts.enabled !== undefined) {
      if (newConfig.shortcuts.enabled) {
        this.shortcuts.enable();
      } else {
        this.shortcuts.disable();
      }
    }
    if (newConfig.displayMode !== undefined) {
      this.setDisplayMode(newConfig.displayMode);
    } else if (newConfig.layout?.mode !== undefined) {
      this.setDisplayMode(newConfig.layout.mode);
    }
    this.dispatchEvent('config-change', this.config);
  }

  // --- Plugin System ---
  public getPlugins(): PlayerPlugin[] {
    if (!this.isPluginsEnabled()) return [];
    return Array.from(this.plugins.values());
  }

  public use(plugin: PlayerPlugin) {
    if (!this.isPluginsEnabled()) return;
    if (this.plugins.has(plugin.name)) {
      console.warn(
        `[PlayerController] Plugin "${plugin.name}" is already registered. Reinstalling.`
      );
      try {
        this.plugins.get(plugin.name)?.destroy?.();
      } catch (e) {
        // Ignore
      }
    }
    this.plugins.set(plugin.name, plugin);
    plugin.install(this);
  }

  public getPlugin(name: string): PlayerPlugin | undefined {
    if (!this.isPluginsEnabled()) return undefined;
    return this.plugins.get(name);
  }

  // --- Core Event System ---
  public addEventListener<K extends keyof PlayerEvents>(
    event: K,
    callback: (detail: PlayerEvents[K]) => void
  ) {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set());
    }
    this.eventListeners.get(event)!.add(callback as (detail: unknown) => void);
  }

  public removeEventListener<K extends keyof PlayerEvents>(
    event: K,
    callback: (detail: PlayerEvents[K]) => void
  ) {
    if (this.eventListeners.has(event)) {
      this.eventListeners.get(event)!.delete(callback as (detail: unknown) => void);
    }
  }

  public dispatchEvent<K extends keyof PlayerEvents>(event: K, detail?: PlayerEvents[K]) {
    if (this.isAnalyticsEnabled()) {
      this.analyticsHandlers.forEach((h) => {
        try {
          h(event as string, detail);
        } catch (err) {
          console.error(`[PlayerController] Error running analytics handler for "${event}":`, err);
        }
      });
    }

    if (this.eventListeners.has(event)) {
      this.eventListeners.get(event)!.forEach((cb) => {
        try {
          cb(detail);
        } catch (err) {
          console.error(
            `[PlayerController] Error executing event listener callback for event "${event}":`,
            err
          );
        }
      });
    }
  }

  public on<K extends keyof PlayerEvents>(
    event: K,
    callback: (detail: PlayerEvents[K]) => void
  ): void {
    this.addEventListener(event, callback);
  }

  public off<K extends keyof PlayerEvents>(
    event: K,
    callback: (detail: PlayerEvents[K]) => void
  ): void {
    this.removeEventListener(event, callback);
  }

  public emit<K extends keyof PlayerEvents>(event: K, detail?: PlayerEvents[K]): void {
    this.dispatchEvent(event, detail);
  }

  public registerAnalyticsHandler(handler: (event: string, detail: unknown) => void) {
    if (!this.isAnalyticsEnabled()) return;
    this.analyticsHandlers.add(handler);
  }

  public unregisterAnalyticsHandler(handler: (event: string, detail: unknown) => void) {
    this.analyticsHandlers.delete(handler);
  }

  public registerPlaybackInterceptor(interceptor: PlaybackInterceptor) {
    this.playbackInterceptors.add(interceptor);
  }

  public unregisterPlaybackInterceptor(interceptor: PlaybackInterceptor) {
    this.playbackInterceptors.delete(interceptor);
  }

  // --- Public Ads Runtime APIs ---
  public getAdsState(): Partial<PlayerState> {
    return this.ads.state();
  }

  public getCurrentAd(): Advertisement | null {
    return this.ads.currentAd();
  }

  public getCurrentAdBreak(): AdBreak | null {
    return this.ads.currentBreak();
  }

  public isPlayingAd(): boolean {
    return !!this.ads.state().isAdPlaying;
  }

  public getAdProvider(): string | null {
    return this.ads.provider();
  }

  public setAdsEnabled(enabled: boolean) {
    if (!this.config) {
      this.config = {};
    }
    if (!this.config.ads) {
      this.config.ads = {};
    }
    this.config.ads.enabled = enabled;
    this.dispatchEvent('config-change', this.config);
  }

  public skipAd() {
    this.ads.skip();
  }

  public scheduleAd(request: ScheduledAdRequest): string {
    return this.ads.schedule(request);
  }

  public unscheduleAd(id: string): void {
    this.ads.unschedule(id);
  }

  public async playAd(tagUrl: string): Promise<void> {
    await this.ads.play(tagUrl);
  }

  public registerOverlay(id: string, options: OverlayOptions) {
    if (this.player && typeof this.player.registerOverlay === 'function') {
      this.player.registerOverlay(id, options);
    } else {
      this.pendingOverlays.set(id, options);
    }
  }

  public load(source: string | PlayerSource): void {
    const playerSource = typeof source === 'string' ? { src: source } : source;
    this.loadSource(playerSource);
  }

  public addPlaylistItem(source: PlayerSource): void {
    this.appendPlaylistItem(source);
  }

  public getCurrentItem(): PlayerSource | null {
    if (this.hasPlaylist()) {
      return this.getCurrentPlaylistItem();
    }
    return this.state.currentSource
      ? { src: this.state.currentSource, type: this.state.sourceType }
      : null;
  }

  public repeat(mode: 'off' | 'one' | 'all' | boolean): void {
    if (mode === true || mode === 'one') {
      this.setLoop(true);
      this.setPlaylistRepeatMode('off');
    } else if (mode === 'all') {
      this.setLoop(false);
      this.setPlaylistRepeatMode('repeat-all');
    } else {
      this.setLoop(false);
      this.setPlaylistRepeatMode('off');
    }
  }

  public getLiveEdgeTarget(): number {
    const raw = this.sourceManager.getRawLiveInfo();
    if (raw && raw.liveEdgeTarget !== null && raw.liveEdgeTarget > 0) {
      return raw.liveEdgeTarget;
    }

    const end = this.state.seekableRange?.end ?? 0;
    const start = this.state.seekableRange?.start ?? 0;
    if (end > 0) {
      const delay = this.state.isLowLatency ? 5 : 15;
      return Math.max(start, end - delay);
    }
    return this.state.duration || 0;
  }

  public buildLiveCapabilities(): import('./types').LiveCapabilities | null {
    const raw = this.sourceManager.getRawLiveInfo();
    if (!raw || !raw.isLive) return null;

    let start = 0;
    let end = this.video.duration || 0;
    if (this.video.seekable && this.video.seekable.length > 0) {
      start = this.video.seekable.start(0);
      end = this.video.seekable.end(this.video.seekable.length - 1);
      if (start > end) start = end;
    }
    const dvrWindow = raw.dvrWindow !== undefined ? raw.dvrWindow : end - start;
    if (dvrWindow > 0) {
      const computedStart = end - dvrWindow;
      if (computedStart > start) {
        start = computedStart;
      }
    }
    const seekableRange = { start, end };
    const hasDvr = raw.hasDvr !== undefined ? raw.hasDvr : dvrWindow > 10;

    const target = raw.liveEdgeTarget !== null ? raw.liveEdgeTarget : end;
    const liveLatency = Math.max(0, target - this.video.currentTime);
    const edgeThreshold = raw.isLowLatency ? 6.0 : 18.0;
    const isAtLiveEdge = liveLatency <= edgeThreshold;

    return {
      isLive: true,
      isLowLatency: raw.isLowLatency,
      hasDvr,
      dvrWindow,
      seekableRange,
      liveLatency,
      isAtLiveEdge,
    };
  }

  public updateLiveState(): void {
    if (!this.state.isLive) return;

    let caps = this.buildLiveCapabilities();
    if (!caps) {
      // Fallback for progressive live streams or simulations when raw info is not available
      const batch = this.getSeekableStateBatch();
      if (batch.isLive) {
        caps = {
          isLive: true,
          isLowLatency: false,
          hasDvr: batch.hasDvr,
          dvrWindow: batch.dvrWindow,
          seekableRange: batch.seekableRange,
          liveLatency: Math.max(0, batch.seekableRange.end - this.video.currentTime),
          isAtLiveEdge: true,
        };
      }
    }

    if (caps) {
      let canSeekInDvr = caps.hasDvr;
      if (this.state.liveMode === 'live-only') {
        canSeekInDvr = false;
      }

      this.updateState({
        isLive: caps.isLive,
        isLowLatency: caps.isLowLatency,
        hasDvr: caps.hasDvr,
        seekableRange: caps.seekableRange,
        dvrWindow: caps.dvrWindow,
        canSeekInDvr,
        liveLatency: caps.liveLatency,
        isAtLiveEdge: caps.isAtLiveEdge,
      });
    }
  }

  public seekToLiveEdge(): void {
    this.updateState({ isAtLiveEdge: true });
    if (this.state.seekableRange) {
      this.video.currentTime = this.state.seekableRange.end;
    } else if (!this.sourceManager.seekToLiveEdge()) {
      const target = this.getLiveEdgeTarget();
      this.video.currentTime = target;
    }
    this.play();
    this.dispatchEvent('live-edge-sync', { latency: this.state.liveLatency || 0 });
  }

  public getLiveLatency(): number | null {
    return this.state.liveLatency;
  }

  public isAtLiveEdge(): boolean {
    return this.state.isAtLiveEdge;
  }

  // --- Marker Groups & Visibility ---
  public showMarkerTypes(types: string[]) {
    if (!this.state.visibleMarkerTypes) {
      this.updateState({ visibleMarkerTypes: [...types] });
    } else {
      const newSet = new Set([...this.state.visibleMarkerTypes, ...types]);
      this.updateState({ visibleMarkerTypes: Array.from(newSet) });
    }
  }

  public hideMarkerTypes(types: string[]) {
    if (!this.state.visibleMarkerTypes) {
      const allTypes = Array.from(new Set(this.state.markers.map((m) => m.type)));
      const filtered = allTypes.filter((t) => !types.includes(t));
      this.updateState({ visibleMarkerTypes: filtered });
    } else {
      const filtered = this.state.visibleMarkerTypes.filter((t) => !types.includes(t));
      this.updateState({ visibleMarkerTypes: filtered });
    }
  }

  public setMarkerVisibility(types: string[] | null) {
    this.updateState({ visibleMarkerTypes: types });
  }

  public getStatistics(): PlayerStatistics {
    const video = this.video;

    // Calculate forward buffer length (bufferHealth)
    let bufferedLength = 0;
    const buffered = video.buffered;
    const time = video.currentTime;
    for (let i = 0; i < buffered.length; i++) {
      const start = buffered.start(i);
      const end = buffered.end(i);
      if (time >= start && time <= end) {
        bufferedLength = end - time;
        break;
      }
    }

    // Get decoded / dropped frames
    let decodedFrames: number | undefined;
    let droppedFrames: number | undefined;
    if (typeof video.getVideoPlaybackQuality === 'function') {
      const q = video.getVideoPlaybackQuality();
      decodedFrames = q.totalVideoFrames;
      droppedFrames = q.droppedVideoFrames;
    } else if ((video as WebkitVideoElement).webkitDecodedFrameCount !== undefined) {
      const webkitVideo = video as WebkitVideoElement;
      decodedFrames = webkitVideo.webkitDecodedFrameCount;
      droppedFrames = webkitVideo.webkitDroppedFrameCount;
    }

    // Dynamic FPS calculation
    let fps: number | undefined;
    const now = performance.now();
    if (decodedFrames !== undefined) {
      if (this.lastFpsTimestamp > 0) {
        const timeDiff = (now - this.lastFpsTimestamp) / 1000;
        if (timeDiff >= 0.25) {
          const framesDiff = decodedFrames - this.lastDecodedFrames;
          this.lastCalculatedFps = Math.max(0, Math.round(framesDiff / timeDiff));
          this.lastDecodedFrames = decodedFrames;
          this.lastFpsTimestamp = now;
        }
        fps = this.lastCalculatedFps;
      } else {
        this.lastDecodedFrames = decodedFrames;
        this.lastFpsTimestamp = now;
        fps = 0;
      }
    }

    const stats: PlayerStatistics = {
      currentTime: time,
      duration: video.duration || 0,
      playbackRate: video.playbackRate,
      paused: video.paused,
      ended: video.ended,
      muted: video.muted,
      volume: video.volume,
      width: video.videoWidth || undefined,
      height: video.videoHeight || undefined,
      fps,
      droppedFrames,
      decodedFrames,
      bufferedLength,
      bufferHealth: bufferedLength,
      isLive: this.state.isLive === true,
      liveLatency: this.state.liveLatency !== null ? this.state.liveLatency : undefined,
      isLowLatency: this.state.isLowLatency,
    };

    const handler = this.sourceManager.getActiveHandler();
    if (handler && typeof handler.getStats === 'function') {
      const protocolStats = handler.getStats();
      if (protocolStats.bitrate !== undefined) stats.bitrate = protocolStats.bitrate;
      if (protocolStats.bandwidthEstimate !== undefined)
        stats.bandwidthEstimate = protocolStats.bandwidthEstimate;
    }

    return stats;
  }

  private updateMediaSession() {
    if (typeof window === 'undefined' || !('mediaSession' in navigator)) {
      return;
    }

    const currentSource = this.state.currentSource;
    const playlist = this.state.playlist;
    const activeIndex = this.state.activePlaylistIndex;

    // Media Session metadata (title/artist/album/artwork/poster) isn't part of
    // the documented `PlayerSource` shape, but consumers commonly attach it to
    // their source objects anyway - read defensively via a local, permissive type.
    const sourceFromPlaylist = (playlist && playlist[activeIndex]) as
      | MediaSessionSourceMeta
      | undefined;
    const sourceMeta: MediaSessionSourceMeta = {
      ...sourceFromPlaylist,
      ...(currentSource ? { src: currentSource } : {}),
    };

    const title = sourceMeta.title || (typeof currentSource === 'string' ? currentSource.split('/').pop() : '') || 'Video Playback';
    const artist = sourceMeta.artist || 'Player SDK';
    const album = sourceMeta.album || '';
    const artwork = sourceMeta.artwork || (sourceMeta.poster ? [{ src: sourceMeta.poster }] : []);

    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title,
        artist,
        album,
        artwork,
      });

      navigator.mediaSession.setActionHandler('play', () => {
        this.play();
      });
      navigator.mediaSession.setActionHandler('pause', () => {
        this.pause();
      });
      navigator.mediaSession.setActionHandler('seekbackward', (details) => {
        const offset = details.seekOffset || 10;
        this.seekBy(-offset);
      });
      navigator.mediaSession.setActionHandler('seekforward', (details) => {
        const offset = details.seekOffset || 10;
        this.seekBy(offset);
      });
      navigator.mediaSession.setActionHandler('seekto', (details) => {
        if (details.seekTime !== undefined) {
          this.seek(details.seekTime);
        }
      });

      if (playlist && playlist.length > 1) {
        navigator.mediaSession.setActionHandler('previoustrack', () => {
          this.previous();
        });
        navigator.mediaSession.setActionHandler('nexttrack', () => {
          this.next();
        });
      } else {
        navigator.mediaSession.setActionHandler('previoustrack', null);
        navigator.mediaSession.setActionHandler('nexttrack', null);
      }
    } catch (e) {
      console.warn('[PlayerController] Failed to update Media Session metadata:', e);
    }
  }

  private updateMediaSessionPosition() {
    if (
      typeof window === 'undefined' ||
      !('mediaSession' in navigator) ||
      typeof navigator.mediaSession.setPositionState !== 'function'
    ) {
      return;
    }

    try {
      const duration = this.video.duration;
      const position = this.video.currentTime;
      const playbackRate = this.video.playbackRate;

      if (
        Number.isFinite(duration) &&
        Number.isFinite(position) &&
        Number.isFinite(playbackRate) &&
        duration >= 0 &&
        position >= 0 &&
        position <= duration
      ) {
        navigator.mediaSession.setPositionState({
          duration,
          playbackRate,
          position,
        });
      }
    } catch (e) {
      // Ignore
    }
  }

  private updateMediaSessionPlaybackState(isPlaying: boolean) {
    if (typeof window === 'undefined' || !('mediaSession' in navigator)) {
      return;
    }
    try {
      navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
    } catch (e) {
      // Ignore
    }
  }
}
