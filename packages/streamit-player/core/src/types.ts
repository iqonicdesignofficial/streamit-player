import { SimidConfig } from './simid/types';
import type { HtmlOverlayDiagnostics } from './html-overlay/HtmlOverlayRenderer';

export interface ThumbnailInfo {
  url: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  time?: number;
}

export type ThumbnailProviderType = 'auto' | 'frame-capture' | 'vtt' | 'sprite' | 'cdn' | 'custom';

export interface SpriteInfo {
  tileWidth: number;
  tileHeight: number;
  totalColumns: number;
  totalRows?: number;
  interval: number;
}

export interface SmartSeekConfig {
  enabled?: boolean;
  type?: 'auto' | 'frame-capture' | 'vtt' | 'sprite' | 'none';
  vttUrl?: string;
  spriteUrl?: string;
  spriteInfo?: SpriteInfo;
  thumbnails?: boolean;
  storyboard?: boolean;
  hoverTime?: boolean;
  chapters?: boolean;
  markers?: boolean;
  snapToChapters?: boolean;
  snapToMarkers?: boolean;
  cache?: boolean;
}

export interface PreciseSeekConfig {
  enabled?: boolean;
  frameAccurate?: boolean;
  smoothDragging?: boolean;
  dragInterpolation?: boolean;
  liveDragging?: boolean;
  keyboardPrecision?: boolean;
  snapToMarkers?: boolean;
  snapToChapters?: boolean;
  continuousUpdates?: boolean;
  seekSmoothing?: boolean;
}

export interface ThumbnailProvider {
  readonly type: ThumbnailProviderType | string;
  getThumbnail(
    time: number,
    priority?: 'high' | 'low'
  ): Promise<ThumbnailInfo | null> | ThumbnailInfo | null;
  getNearestCachedThumbnail?(time: number): ThumbnailInfo | null;
  setSource?(src: string, sourceOptions?: PlayerSource): void;
  destroy?(): void;
  isUnavailable?(): boolean;
}

export interface OverlayOptions {
  enabled?: boolean;
  /**
   * Custom overlay renderer. The player instance and context are UI-layer
   * concerns that `@player/core` has no knowledge of (it has zero UI
   * dependencies), so both are intentionally `unknown` - the web-components
   * consumer narrows/casts these at the call site.
   */
  template?: (player: unknown, context?: unknown) => unknown;
  animation?: string;
  position?: string;
  style?: Record<string, string> | string;
  timing?: number;
}

export interface ShortcutBinding {
  key: string;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  action: string;
}

export interface HotkeysConfig {
  enabled?: boolean;
  bindings?: ShortcutBinding[];
  overrides?: ShortcutBinding[];
}

export interface EmptyStateConfig {
  /** Opaque UI icon value (string, template, Element, or render function) - see `IconRegistry` in `@player/web-components`. */
  icon?: unknown;
  title?: string;
  subtitle?: string;
  buttonText?: string;
  render?: (player: unknown) => unknown;
}

export interface PlayerConfig {
  /** Enables automatic media playback on source load. */
  autoplay?: boolean;
  /** Starts playback with audio muted. */
  muted?: boolean;
  /** Sets the initial volume level (number between 0 and 1). */
  volume?: number;
  /** Determines if the video should play inline on mobile browsers instead of entering native fullscreen. */
  playsinline?: boolean;
  /** Enables automatic looping of single videos or active playlists. */
  loop?: boolean;
  /** Custom provider for timeline seek hover preview thumbnails. */
  thumbnailProvider?: ThumbnailProvider;
  /** Enables Smart Seek (skipping silence, ads, or intro chunks). */
  smartSeek?: SmartSeekConfig | boolean;
  /** Enables Precise Seek frame-by-frame scrubbing. */
  preciseSeek?: PreciseSeekConfig | boolean;
  /** Custom icons registry to override standard default SVGs (opaque UI icon values). */
  icons?: Record<string, unknown>;
  /** The theme/icon pack ID to load. */
  iconPack?: string;
  /** Initial sleep timer setting (duration in minutes or 'end' of video). */
  sleepTimerSetting?: 'off' | 10 | 15 | 20 | 30 | 45 | 60 | 'end';
  /** The display/layout mode of the player. */
  displayMode?: 'standard' | 'vertical' | 'audio-only' | 'custom' | 'mini' | 'floating';
  /** Duration threshold (in seconds) near the end of video to trigger auto-advance. */
  nearEndThreshold?: number;
  /** Loop behavior when a playlist reaches the end. */
  playlistRepeatMode?: 'off' | 'repeat-all';

  /** Enables vertical page scroll controls on swipes. */
  autoScroll?: boolean;
  /** Configurations for live streams. */
  live?: {
    /** The live playback mode ('live-only' or 'live-dvr'). */
    mode?: 'live-only' | 'live-dvr';
  };
  settings?: {
    /** Defines the order of setting menu items. */
    order?: string[];
    /** Enables/disables the playback speed selector menu item. */
    playbackSpeed?: boolean;
    /** Enables/disables the resolution/quality selector menu item. */
    quality?: boolean;
    /** Enables/disables the audio track selection menu item. */
    audioTracks?: boolean;
    /** Enables/disables the subtitle track selector menu item. */
    subtitles?: boolean;
    /** Enables/disables the loop toggle menu item. */
    loop?: boolean;
    /** Enables/disables the sleep timer selector menu item. */
    sleepTimer?: boolean;
    /** Enables/disables the chapters navigation menu item. */
    chapters?: boolean;
    /** Enables/disables the timeline markers menu item. */
    markers?: boolean;
    /** Enables/disables the vertical auto scroll toggle menu item. */
    autoScroll?: boolean;
    /** Enables/disables the picture-in-picture toggle menu item. */
    pictureInPicture?: boolean;
    /** Alias for pictureInPicture option. */
    pip?: boolean;
    /** Enables/disables the fullscreen toggle menu item. */
    fullscreen?: boolean;
    /** Enables or disables the settings menu button in controls bar. */
    enabled?: boolean;
    /** Custom options/items to inject statically into the Settings menu. */
    customItems?: Array<{
      id: string;
      label: string;
      valueLabel?: string;
      onClick?: (player: unknown) => void;
    }>;
    /** Custom groupings for setting items. Map group names to arrays of item keys. */
    groups?: Record<string, string[]>;
    /** Escape hatch for consumer-defined settings menu extension flags. */
    [key: string]: unknown;
  };
  /** Preload policy of standard HTML video element. */
  preload?: 'none' | 'metadata' | 'auto';
  /** Cross-origin attribute parameter for credential resolution. */
  crossorigin?: 'anonymous' | 'use-credentials';
  /** @deprecated Use `crossorigin` instead for standard HTML element property alignment. */
  crossOrigin?: 'anonymous' | 'use-credentials';
  /** @deprecated Use `playsinline` instead for standard HTML element property alignment. */
  playsInline?: boolean;
  /** Poster image URL displayed before source playback start. */
  poster?: string;
  /** Configures standard hotkeys and shortcuts. */
  hotkeys?: boolean | HotkeysConfig;
  /** Exposes analytics tracking callback triggers. */
  analytics?: {
    handlers?: Array<(event: string, detail: unknown) => void>;
  };
  /** Custom UI empty state placeholders parameters. */
  emptyState?: EmptyStateConfig;
  /** Static locale mappings translations table. */
  locale?: Record<string, string>;
  /** Optional global DRM configuration defaults. */
  drm?: DrmConfig;
  /** Optional global advertisement configuration options. */
  ads?: AdsConfig;
}

export interface PlayerThemeConfig {
    preset?: 'light' | 'dark' | 'glass-dark' | 'glass-light' | string;
    primaryColor?: string;
    accentColor?: string;
    backgroundColor?: string;
    textColor?: string;
    menuColor?: string;
    seekbarBg?: string;
    seekbarPlayed?: string;
    seekbarBuffered?: string;
    borderRadius?: string;
    fontFamily?: string;
    fontSize?: string;
    blur?: string;
    shadows?: string;
    spacing?: string;
    transitions?: string;
    primaryGlow?: string;
    glassBg?: string;
    glassPanel?: string;
    glassBorder?: string;
    glassShadow?: string;
    menuBg?: string;
    tooltipBg?: string;
    tooltipColor?: string;
    buttonColor?: string;
    buttonHoverColor?: string;
    buttonHoverBg?: string;
    buttonIconSize?: string;
    volumePlayedBg?: string;
    volumeUnplayedBg?: string;
    verticalMaxWidth?: string;
    overlayBg?: string;
    liveBadgeLiveBg?: string;
    liveBadgeLiveBorder?: string;
    liveBadgeLiveColor?: string;
    liveBadgeBehindBg?: string;
    liveBadgeBehindBorder?: string;
    liveBadgeBehindColor?: string;
    previewBorderColor?: string;
    previewBorderWidth?: string;
    previewBorderRadius?: string;
    previewShadow?: string;
    previewBg?: string;
    previewTimeBg?: string;
    previewTimeColor?: string;
    previewTimeFont?: string;
    previewTimeSize?: string;
    previewWidth?: string;
    previewHeight?: string;
    previewOffset?: string;
    previewAnimation?: string;
    previewOpacity?: string;
    previewBlur?: string;
    previewArrowColor?: string;
    previewArrowSize?: string;
    previewArrowVisible?: string;
    previewTransition?: string;
    previewZIndex?: string;
    previewPadding?: string;
    previewSpacing?: string;
    previewBackdropFilter?: string;
    previewVerticalWidth?: string;
    previewVerticalHeight?: string;
    customVariables?: Record<string, string>;
}

export interface PlayerConfiguration extends PlayerConfig {
  theme?: PlayerThemeConfig;
  controls?: {
    /** Enables the play/pause interaction on video click. */
    play?: boolean;
    /** Renders the Play/Pause button in the controls bar. */
    playButton?: boolean;
    /** Renders the Pause icon. */
    pause?: boolean;
    /** Renders the Seekbar slider timeline. */
    seekbar?: boolean;
    /** Renders the full interactive seek track. */
    timeline?: boolean;
    /** Renders the current time counter text. */
    currentTime?: boolean;
    /** Renders the total media duration text. */
    duration?: boolean;
    /** Renders the Volume slider control. */
    volume?: boolean;
    /** Renders the mute/unmute button. */
    mute?: boolean;
    /** Renders the Settings gear button. */
    settings?: boolean;
    /** Renders the subtitles selection button. */
    subtitles?: boolean;
    /** Alias for subtitles button. */
    captions?: boolean;
    /** Renders the audio tracks selector button. */
    audioTracks?: boolean;
    /** Renders the quality resolution selector button. */
    quality?: boolean;
    /** Renders the playback speed selector button. */
    playbackSpeed?: boolean;
    /** Renders the sleep timer selection button. */
    sleepTimer?: boolean;
    /** Renders the Picture-in-Picture button. */
    pictureInPicture?: boolean;
    /** Alias for pictureInPicture button. */
    pip?: boolean;
    /** Renders the Fullscreen button. */
    fullscreen?: boolean;
    /** Renders the Live badge overlay. */
    liveBadge?: boolean;
    /** Renders timeline segment indicators. */
    markers?: boolean;
    /** Renders timeline chapter dividers. */
    chapters?: boolean;
    /** Enables hover thumbnail pre-scrubbing. */
    timelinePreview?: boolean;
    /** Legacy alias for the hover tooltip visibility toggle. */
    hoverTooltip?: boolean;
    /** Legacy alias for the hover tooltip visibility toggle. */
    tooltip?: boolean;
    /** Renders replay action trigger. */
    replayButton?: boolean;
    /** Renders buffer loading indicator. */
    loadingSpinner?: boolean;
    /** Renders user action feedback overlay (e.g. double tap indicator). */
    feedbackOverlay?: boolean;
    /** Renders center volume adjustment indicator. */
    volumeOverlay?: boolean;
    /** Enables standard player context menu options. */
    contextMenu?: boolean;
    /** Enables vertical page rail actions. */
    actionRail?: boolean;
    /** Enables seeking backwards inside live DVR windows. */
    liveDVR?: boolean;
    /** Renders a snap-to-live-edge overlay button on delay. */
    liveEdgeButton?: boolean;
    /** Renders default empty/error cards. */
    emptyState?: boolean;
    /** Renders the main landscape control bar. */
    controlsBar?: boolean;
    /** Renders the vertical mobile layout overlay bar. */
    verticalControls?: boolean;
    /** Enables external integrations/plugins extension hooks. */
    plugins?: boolean;
    /** Renders the loop video controls bar icon. */
    loop?: boolean;
    /** Renders the auto-scroll overlay toggle button. */
    autoScroll?: boolean;
    /** Custom order of control elements inside control group layout containers. */
    order?: string[];
    /** Custom groupings for control items. */
    groups?: Record<string, string[]>;
    /** Control layout templates mapping lists of items. */
    layout?: string[];
  };
  overlays?: Record<string, OverlayOptions | boolean>;
  vertical?: {
    swipeThreshold?: number;
    autoScroll?: boolean;
    loopSingleVideo?: boolean;
    loopPlaylist?: boolean;
    railPosition?: 'left' | 'right';
    railButtons?: string[];
    showCenterPlayButton?: boolean;
    showProgressBar?: boolean;
    snapBehavior?: 'snap' | 'none';
    animationTiming?: number;
    gestures?: {
      doubleTapToSeek?: boolean;
      swipeToNavigate?: boolean;
      longPressToSpeed?: boolean;
      longPressSpeed?: number;
    };
    menus?: {
      playbackSpeed?: boolean;
      quality?: boolean;
      audioTracks?: boolean;
      subtitles?: boolean;
      sleepTimer?: boolean;
      autoScroll?: boolean;
      chapters?: boolean;
    };
  };
  layout?: {
    /**
     * The layout mode of the player.
     * - 'standard': Standard VOD/Live landscape layout.
     * - 'vertical': Mobile vertical layout.
     * - 'audio-only': Audio-only layout with album art placeholder.
     * - 'custom': Empty layout rendering only child slots.
     * - 'mini' (Experimental/Internal): Mini overlay player.
     * - 'floating' (Experimental/Internal): Centered floating dialog player.
     */
    mode?: 'standard' | 'vertical' | 'audio-only' | 'custom' | 'mini' | 'floating';
  };
  playback?: {
    autoplay?: boolean;
    muted?: boolean;
    volume?: number;
    loop?: boolean;
    playbackRate?: number;
    playbackRates?: number[];
    doubleTapInterval?: number;
  };
  sleepTimer?: {
    presets?: number[];
  };
  shortcuts?: {
    enabled?: boolean;
  };
  plugins?: PlayerPlugin[];
}

export type SourceType =
  | 'mp4'
  | 'mov'
  | 'hls'
  | 'dash'
  | 'webm'
  | 'file'
  | 'blob'
  | 'embed'
  | 'unknown';

export interface Chapter {
  id: string;
  title: string;
  startTime: number;
  endTime?: number;
  description?: string;
}

export interface TimelineMarker {
  id: string;
  time: number;
  label: string;
  type: 'chapter' | 'ad' | 'bookmark' | 'analytics' | 'metadata' | string;
  color?: string;
  /** Caller-supplied opaque metadata attached to this marker - no fixed shape. */
  metadata?: unknown;
}

export interface PlayerPlugin {
  name: string;
  install(controller: PlayerController): void;
  destroy?(): void;
  getSettingsItems?(controller: PlayerController): Array<{
    id: string;
    label: string;
    valueLabel?: string;
    onClick: () => void;
  }>;
  renderSettingsScreen?(screenId: string, controller: PlayerController, onBack: () => void): unknown;
  getControlButtons?(controller: PlayerController): Array<{
    id: string;
    position: 'left' | 'center' | 'right' | 'rail';
    render(): unknown;
  }>;
  onPlayerAttached?(player: unknown): void;
  onPlayerDetached?(player: unknown): void;
  onSourceLoaded?(source: unknown): void;
  onBeforePlay?(): void;
  onAfterPlay?(): void;
}

export interface PlaybackInterceptor {
  play?: () => Promise<boolean> | boolean;
  pause?: () => boolean;
  seek?: (time: number) => boolean;
  setVolume?: (vol: number) => boolean;
  setMuted?: (muted: boolean) => boolean;
}

import { PlayerController } from './PlayerController';

export interface PlayerSourceVariant {
  src: string;
  label: string;
  type?: SourceType;
}

export interface PlayerSource {
  src?: string;
  srcObject?: MediaStream;
  type?: SourceType;
  variants?: PlayerSourceVariant[];
  chapters?: Chapter[];
  subtitles?: TextTrackSource[];
  live?: {
    mode?: 'live-only' | 'live-dvr';
  };
  smartSeek?: Omit<SmartSeekConfig, 'enabled'>;
  preciseSeek?: Omit<PreciseSeekConfig, 'enabled'> | boolean;
  /** Optional source-specific DRM configuration parameters. */
  drm?: DrmConfig;
  /** Optional source-specific advertisement tag URL override. */
  adsUrl?: string;
  /** Optional source-specific advertisement configuration overrides. */
  ads?: AdsConfig;
}

export interface TextTrackSource {
  src: string;
  label: string;
  srclang: string;
  default?: boolean;
}

export type SubtitleTrackKind = 'subtitles' | 'captions' | 'descriptions' | 'chapters' | 'metadata';

export interface SubtitleTrack {
  id: string;
  language: string;
  label: string;
  default: boolean;
  forced: boolean;
  kind: SubtitleTrackKind;
  source: 'native' | 'external' | 'hls' | 'dash';
  index?: number;
}

export type SubtitleFontFamily =
  | 'default'
  | 'proportional-sans-serif'
  | 'monospace-sans-serif'
  | 'proportional-serif'
  | 'monospace-serif'
  | 'casual'
  | 'cursive'
  | 'small-capitals';

export type SubtitleCharacterEdgeStyle =
  | 'default'
  | 'none'
  | 'raised'
  | 'depressed'
  | 'uniform'
  | 'drop-shadow';

export interface SubtitleAppearance {
  fontFamily: SubtitleFontFamily;
  fontSize: number; // percentage (e.g. 50 to 400)
  fontColor: string; // color name (e.g., 'white', 'red') or hex
  backgroundColor: string; // color name or hex
  backgroundOpacity: number; // percentage (0 to 100)
  windowColor: string; // color name or hex
  windowOpacity: number; // percentage (0 to 100)
  characterEdgeStyle: SubtitleCharacterEdgeStyle;
  fontOpacity: number; // percentage (0 to 100)
}

export interface RawLiveInfo {
  isLive: boolean;
  isLowLatency: boolean;
  hasDvr?: boolean;
  dvrWindow?: number;
  liveEdgeTarget: number | null;
}

export interface LiveCapabilities {
  isLive: boolean;
  isLowLatency: boolean;
  hasDvr: boolean;
  dvrWindow: number;
  seekableRange: { start: number; end: number };
  liveLatency: number;
  isAtLiveEdge: boolean;
}

export type PlayerStatus =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'playing'
  | 'paused'
  | 'buffering'
  | 'ended'
  | 'error';

export interface PlayerState {
  status: PlayerStatus;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  isMuted: boolean;
  isFullscreen: boolean;
  bufferedRanges: Array<{ start: number; end: number }>;
  playbackRate: number;
  captionsEnabled: boolean;
  currentSource: string | null;
  sourceType: SourceType;
  isBuffering: boolean;
  isSeeking: boolean;
  hasCaptions: boolean;
  error: string | null;
  qualities: string[];
  activeQuality: string;
  audioTracks: string[];
  activeAudioTrack: number;
  subtitleTracks: SubtitleTrack[];
  activeSubtitleTrack: number;
  activeSubtitleTrackId: string | null;
  subtitleAppearance: SubtitleAppearance;
  isLive: boolean | null;
  isLowLatency: boolean;
  isAtLiveEdge: boolean;
  liveLatency: number | null;
  hasDvr: boolean;
  dvrWindow: number;
  canSeekInDvr: boolean;
  seekableRange: { start: number; end: number };
  liveMode: 'live-only' | 'live-dvr';
  thumbnailProvider?: ThumbnailProvider;
  pictureInPicture: boolean;
  pictureInPictureSupported: boolean;
  loop: boolean;
  sleepTimerSetting: 'off' | 10 | 15 | 20 | 30 | 45 | 60 | 'end';
  sleepTimerSecondsRemaining: number | null;
  sleepTimerExpired: boolean;
  chapters: Chapter[];
  activeChapterIndex: number;
  markers: TimelineMarker[];
  visibleMarkerTypes: string[] | null;
  displayMode: 'standard' | 'vertical' | 'audio-only' | 'custom' | 'mini' | 'floating';
  playlist: PlayerSource[];
  activePlaylistIndex: number;
  playlistRepeatMode: 'off' | 'repeat-all';
  autoScroll: boolean;
  isAdPlaying: boolean;
  isAdLoading: boolean;
  currentAd: Advertisement | null;
  currentAdBreak: AdBreak | null;
  adCurrentTime: number | null;
  adRemainingTime: number | null;
  adDuration: number | null;
  canSkipAd: boolean;
  skipAvailableAt: number | null;
  adPosition: number | null;
  adProvider: string | null;
  adLinear: boolean | null;
  adMuted: boolean | null;
}

export interface SleepTimerFullState {
  setting: 'off' | 10 | 15 | 20 | 30 | 45 | 60 | 'end';
  secondsRemaining: number | null;
  endTimeMs: number | null;
  isExpired: boolean;
  isRunning: boolean;
}

export type PlayerStateCallback = (state: PlayerState) => void;

export interface PlayerMetadataEvent {
  timestamp: number;
  type: string;
  sourceProtocol: 'hls' | 'dash' | 'mp4' | 'unknown';
  /** Raw, protocol-specific metadata payload (e.g. hls.js/dash.js event data) - shape varies by protocol/muxer. */
  rawData: unknown;
  parsedData: Record<string, unknown>;
}

export interface PlayerEvents {
  /** Allows consumers/plugins to dispatch/listen to custom event names beyond the fixed set below. */
  [key: string]: unknown;
  play: undefined;
  ended: undefined;
  adbreakstart: { adId?: string; duration?: number } | undefined;
  adbreakend: undefined;
  adclick: { adId?: string; clickUrl?: string } | undefined;
  pause: undefined;
  seekstart: undefined;
  seekend: undefined;
  error: { message: string };
  chapterchange: { activeChapterIndex: number; chapter: Chapter | null };
  volumechange: { volume: number };
  mutechange: { isMuted: boolean };
  subtitletrackschanged: { tracks: SubtitleTrack[] };
  subtitletrackchange: { activeTrack: SubtitleTrack | null };
  subtitleenabled: { activeTrack: SubtitleTrack | null };
  subtitledisabled: undefined;
  subtitlechange: { activeSubtitleTrack: number };
  fullscreenchange: { isFullscreen: boolean };
  pipchange: { isPictureInPicture: boolean };
  sourcechange: { source: PlayerSource | null };
  qualitychange: { qualityIndex: number };
  audiochange: { trackIndex: number };
  subtitleappearancechange: { appearance: SubtitleAppearance };
  replay: undefined;
  audioTracksChanged: { audioTracks: string[] };
  audioTrackChanged: { activeAudioTrack: number };
  seek: { seconds: number } | undefined;
  metadata: PlayerMetadataEvent;
  playbackratechange: { playbackRate: number } | undefined;
  markerclick:
  | {
    marker: TimelineMarker;
    type: string;
    time: number;
    label: string;
    originalEvent: MouseEvent;
  }
  | undefined;
  markerhover: { marker: TimelineMarker; type: string; time: number; label: string } | undefined;
  'playlist-loaded': { playlist: PlayerSource[]; startIndex: number };
  'playlist-cleared': undefined;
  'playlist-change': { playlist: PlayerSource[] };
  'playlist-index-change': { index: number; source: PlayerSource | null };
  'playlist-next': { index: number; source: PlayerSource };
  'playlist-previous': { index: number; source: PlayerSource };
  'playlist-item-added': { index: number; source: PlayerSource };
  'playlist-item-removed': { index: number; source: PlayerSource };
  'playlist-item-replaced': { index: number; source: PlayerSource };
  'playlist-item-moved': { fromIndex: number; toIndex: number; source: PlayerSource };
  'playlist-near-end': { index: number; length: number; remainingItems: number; threshold: number };
  'playlist-repeat-change': { repeatMode: 'off' | 'repeat-all' };
  'autoscroll-change': { autoScroll: boolean };
  'live-status-change': { isLive: boolean; isLowLatency: boolean };
  'live-sync-update': { latency: number; isAtLiveEdge: boolean; playbackRate: number };
  'live-edge-sync': { latency: number };
  sleeptimerstart: {
    setting: 'off' | 10 | 15 | 20 | 30 | 45 | 60 | 'end';
    secondsRemaining: number | null;
    endTimeMs: number | null;
  };
  sleeptimerupdate: { secondsRemaining: number; endTimeMs: number };
  sleeptimerexpired: undefined;
  sleeptimercancelled: undefined;
  'config-change': PlayerConfiguration;
  timeupdate: { currentTime: number; duration: number };
  waiting: undefined;
  playing: undefined;
  drmsessioncreated: { session: MediaKeySession; system: string };
  drmsessionclosed: { session: MediaKeySession; system: string };
  drmmessage: { session: MediaKeySession; messageType: MediaKeyMessageType; message: ArrayBuffer };
  drmkeychange: { session: MediaKeySession; keyStatuses: Record<string, string> };
  drmerror: {
    message: string;
    system?: string;
    code?: number;
    errorType: 'key-system' | 'session' | 'license' | 'certificate';
    /** Native EME/DRM error object caught while handling the failure - shape varies by browser/CDM. */
    originalError?: unknown;
  };
  drmlicenserequest: {
    url: string;
    challengeSize: number;
    system: string;
  };
  drmlicenseresponse: {
    url: string;
    responseSize: number;
    system: string;
  };
  manifestloaded: {
    system: 'hls' | 'dash';
    levels?: number;
    /** Raw manifest-parsed event payload from hls.js/dash.js - shape varies by library/version. */
    data?: unknown;
  };
  adloadstart: { adTagUrl: string } | undefined;
  adloaded: { ad: Advertisement } | undefined;
  adstart: { ad: Advertisement } | undefined;
  adpause: { ad: Advertisement } | undefined;
  adresume: { ad: Advertisement } | undefined;
  adskip: { ad: Advertisement } | undefined;
  adcomplete: { ad: Advertisement } | undefined;
  adquartile: { ad: Advertisement; quartile: 1 | 2 | 3 | 4 } | undefined;
  admute: { ad: Advertisement } | undefined;
  adunmute: { ad: Advertisement } | undefined;
  adtimeupdate: { currentTime: number; duration: number; remainingTime?: number } | undefined;
  adproviderchange: { providerName: string } | undefined;
  aderror: { error: AdError } | undefined;
  adverificationready: { ad: Advertisement; verifications: AdVerification[] } | undefined;
  skipavailable: { ad: Advertisement } | undefined;
  admilestone: { milestone: 'start' | 'firstQuartile' | 'midpoint' | 'thirdQuartile' | 'complete' } | undefined;
  companionshown: { adId?: string; slotId: string } | undefined;
  companionerror: { adId?: string; slotId?: string; reason: string } | undefined;
  vmapparseerror: { message: string } | undefined;
  vmapbreakerror: { breakId: string; tagUrl: string; message: string } | undefined;
  htmloverlayavailable: { adId?: string } | undefined;
  htmloverlayloaded: { adId?: string } | undefined;
  htmloverlayshown: { adId?: string } | undefined;
  htmloverlayhidden: { adId?: string } | undefined;
  htmloverlayclosed: { adId?: string } | undefined;
  htmloverlayclick: { adId?: string } | undefined;
  htmloverlayerror: { message: string } | undefined;
  htmloverlaycompleted: { adId?: string } | undefined;
  htmloverlayupdated: { adId?: string } | undefined;
  adschedulerconflict: { source: 'scheduler' | 'vmap'; reason: string } | undefined;
  simidavailable: { sessionId: string } | undefined;
  simidstart: { sessionId: string } | undefined;
  simidready: { sessionId: string } | undefined;
  simiderror: { message: string; code?: number; fatal?: boolean } | undefined;
  simidcomplete: undefined;
  simidinteraction: Record<string, unknown> | undefined;
  simidsecurityerror: { reason: string; url?: string } | undefined;
  simidclick: { url?: string; trackingUrls?: string[]; playerHandled?: boolean } | undefined;
  simiddurationchange: { duration: number; extensionSec: number; maxAllowed: number } | undefined;
  simidcreativeerror: { code?: number; message: string; fatal?: boolean } | undefined;
  simidpause: undefined;
  simidresume: undefined;
  simidresize: { width: number; height: number } | undefined;
  simidfullscreen: undefined;
  simidexitfullscreen: undefined;
  simidcollapse: undefined;
  simidexpand: undefined;
  simidskip: undefined;
  simidstop: undefined;
}

export interface PlayerStatistics {
  // General Playback
  currentTime: number;
  duration: number;
  playbackRate: number;
  paused: boolean;
  ended: boolean;
  muted: boolean;
  volume: number;

  // Video
  width?: number;
  height?: number;
  fps?: number;
  droppedFrames?: number;
  decodedFrames?: number;

  // Buffer
  bufferedLength?: number;
  bufferHealth?: number;

  // Network
  bitrate?: number;
  bandwidthEstimate?: number;

  // Live
  isLive?: boolean;
  liveLatency?: number;
  isLowLatency?: boolean;
}

export interface DrmSystemConfig {
  /** The license acquisition server URL. */
  licenseUrl?: string;
  /** Optional custom HTTP headers sent with the licensing requests. */
  headers?: Record<string, string>;
  /** Set to true to include cookies or authentication credentials in requests. */
  withCredentials?: boolean;
  /** Optional server certificate URL (primarily Widevine/PlayReady). */
  serverCertificateUrl?: string;
  /** Server certificate payload raw binary data (can be passed synchronously). */
  serverCertificate?: Uint8Array;
  /** Number of retries for transient failures. Default: 3. */
  retryCount?: number;
  /** Timeout in milliseconds for requests. Default: 10000. */
  timeout?: number;
  /** Optional custom function to intercept/modify the raw license challenge before sending. */
  licenseRequestInterceptor?: (
    challenge: ArrayBuffer,
    system: string
  ) =>
    | ArrayBuffer
    | Promise<ArrayBuffer>
    | { body: ArrayBuffer | ArrayBufferView | string; headers?: Record<string, string> }
    | Promise<{ body: ArrayBuffer | ArrayBufferView | string; headers?: Record<string, string> }>;
  /** Optional custom function to intercept/modify the raw license response from the server. */
  licenseResponseInterceptor?: (
    response: ArrayBuffer,
    system: string
  ) => ArrayBuffer | Promise<ArrayBuffer>;
}

export interface FairPlayConfig extends DrmSystemConfig {
  /** The certificate URL of the FairPlay application. Required for FairPlay. */
  certificateUrl?: string;
  /**
   * Optional custom function to extract the FairPlay content/asset ID from
   * the raw initData. Defaults to parsing the `skd://` URI scheme out of it.
   */
  extractContentId?: (initData: Uint8Array) => string;
}

export interface DrmConfig {
  /** Widevine configurations. */
  widevine?: DrmSystemConfig;
  /** PlayReady configurations. */
  playready?: DrmSystemConfig;
  /** FairPlay configurations (Safari/iOS/macOS). */
  fairplay?: FairPlayConfig;
  /** ClearKey licensing parameters. */
  clearkey?: {
    /** ClearKey Key ID -> Key mapping. Hex is the primary format; base64url is also accepted for compatibility. */
    clearkeys?: Record<string, string>;
    /** Optional license server url fallback. */
    licenseUrl?: string;
    /** Custom headers for ClearKey licensing requests. */
    headers?: Record<string, string>;
  };
  /** Robustness preferences for EME capability resolution. */
  robustness?: {
    audio?: string;
    video?: string;
  };
  /** Distinctive identifier setting. */
  distinctiveIdentifier?: 'required' | 'optional' | 'not-allowed';
  /** Persistent state setting. */
  persistentState?: 'required' | 'optional' | 'not-allowed';
  /** Global number of retries for transient failures. Default: 3. */
  retryCount?: number;
  /** Global timeout in milliseconds for requests. Default: 10000. */
  timeout?: number;
}

// --- Ads API Contracts ---

export enum AdState {
  IDLE = 'idle',
  REQUESTING = 'ad-requesting',
  LOADED = 'ad-loaded',
  PLAYING = 'ad-playing',
  PAUSED = 'ad-paused',
  BUFFERING = 'ad-buffering',
  SKIPPING = 'ad-skipping',
  ENDED = 'ad-ended',
  ERROR = 'ad-error',
  CONTENT_RESUMING = 'content-resuming',
}

export enum AdBreakType {
  PREROLL = 'preroll',
  MIDROLL = 'midroll',
  POSTROLL = 'postroll',
}

export enum AdProviderType {
  IMA = 'IMA',
  VAST = 'VAST',
  VMAP = 'VMAP',
  CUSTOM = 'CUSTOM',
}

export enum AdSkipMode {
  AUTO = 'auto',
  USER = 'user',
  DISABLED = 'disabled',
}

export enum AdPlacementType {
  LINEAR = 'linear',
  NON_LINEAR = 'non-linear',
  COMPANION = 'companion',
  OVERLAY = 'overlay',
}

export enum TrackingEventName {
  IMPRESSION = 'impression',
  CREATIVE_VIEW = 'creativeView',
  START = 'start',
  FIRST_QUARTILE = 'firstQuartile',
  MIDPOINT = 'midpoint',
  THIRD_QUARTILE = 'thirdQuartile',
  COMPLETE = 'complete',
  PAUSE = 'pause',
  RESUME = 'resume',
  MUTE = 'mute',
  UNMUTE = 'unmute',
  CLICK = 'click',
  SKIP = 'skip',
  CLOSE = 'close',
  ERROR = 'error',
}

export interface AdsRequestConfig {
  timeout?: number;
  retryCount?: number;
  withCredentials?: boolean;
  headers?: Record<string, string>;
  /** Caller-supplied opaque metadata forwarded to the ad request - no fixed shape. */
  customMetadata?: Record<string, unknown>;
}

export interface AdsPlaybackConfig {
  autoplay?: boolean;
  preload?: 'none' | 'metadata' | 'auto';
  skipMode?: AdSkipMode;
  skipOffset?: number;
}

export interface AdsTrackingConfig {
  trackImpression?: boolean;
  trackQuartiles?: boolean;
  customTracker?: (event: string, url: string) => void;
}

export interface AdsUiConfig {
  enabled?: boolean;
  showCountdown?: boolean;
  showSkipButton?: boolean;
  adOverlaySlot?: string;
  companionSlots?: CompanionSlot[];
  /**
   * Default HTML sanitizer applied to HTML-string overlay/companion creatives
   * (htmlContent) that don't set their own per-ad `sanitizeHtml`. Ad-server
   * supplied HTML is rendered via innerHTML - without a sanitizer (here or
   * per-ad), that HTML is trusted as-is, which is an XSS risk for untrusted
   * ad sources. Strongly recommended in production.
   */
  sanitizeHtml?: (html: string) => string;
}

export interface AdsConfig {
  enabled?: boolean;
  provider?: AdProviderType | string;
  tagUrl?: string;
  inlineXml?: string;
  request?: AdsRequestConfig;
  playback?: AdsPlaybackConfig;
  tracking?: AdsTrackingConfig;
  ui?: AdsUiConfig;
  /** Caller-supplied opaque per-provider options (e.g. IMA SDK settings) - no fixed shape across providers. */
  providerOptions?: Record<string, unknown>;
  /** Caller-supplied opaque metadata forwarded to the ad request - no fixed shape. */
  customMetadata?: Record<string, unknown>;
  /** Configuration for SIMID interactive-creative sessions (handshake timeouts, allowed origins, etc). */
  simid?: SimidConfig;
  /** Escape hatch for consumer/provider-defined ads configuration extensions. */
  [key: string]: unknown;
}

export interface Advertisement {
  readonly id: string;
  readonly title: string;
  readonly duration: number;
  readonly width?: number;
  readonly height?: number;
  readonly linear: boolean;
  readonly skippable: boolean;
  readonly skipOffset?: number; // seconds
  readonly clickThroughUrl?: string;
  readonly trackingUrls?: TrackingUrl[];
  readonly contentType?: string;
  readonly creativeId?: string;
  readonly adSystem?: string;
  readonly htmlContent?: string;
  readonly htmlUrl?: string;
  readonly htmlTemplateId?: string;
  readonly useIframe?: boolean;
  readonly imageUrl?: string;
  readonly errorUrls?: string[];
  readonly creativeParameters?: Record<string, unknown> | string;
  readonly position?: 'top' | 'bottom' | 'left' | 'right' | 'center' | string;
  readonly overlayStyle?: Record<string, string | number>;
  readonly margin?: string;
  readonly padding?: string;
  readonly opacity?: number;
  readonly pointerEvents?: string;
  readonly zIndex?: number;
  readonly closeDelay?: number;
  readonly iframeSandbox?: string;
  readonly trustedOrigins?: string[];
  readonly sanitizeHtml?: (html: string) => string;
  readonly externalSlot?: HTMLElement | string;
  readonly responsive?: boolean;
  readonly maxWidth?: number;
  readonly maxHeight?: number;
  readonly closeButton?: boolean | {
    enabled?: boolean;
    delaySeconds?: number;
    label?: string;
    styleOverrides?: Record<string, string>;
    className?: string;
  };
  /** Companion creatives associated with this ad (e.g. VAST Companion Ads) -
   * rendered separately from the ad itself via AdsManager.showCompanions(). */
  readonly companions?: Advertisement[];
}

export interface HtmlOverlayConfig {
  id?: string;
  title?: string;
  position?: 'top' | 'bottom' | 'left' | 'right' | 'center' | string;
  overlayStyle?: Record<string, string | number>;
  width?: number;
  height?: number;
  maxWidth?: number;
  maxHeight?: number;
  responsive?: boolean;
  duration?: number;
  closeButton?: boolean | {
    enabled?: boolean;
    delaySeconds?: number;
    label?: string;
    styleOverrides?: Record<string, string>;
    className?: string;
  };
  closeDelay?: number;
  clickThroughUrl?: string;
  trackingUrls?: TrackingUrl[];
  externalSlot?: HTMLElement | string;
  zIndex?: number;
  trustedOrigins?: string[];
  iframeSandbox?: string;
  sanitizeHtml?: (html: string) => string;
  htmlContent?: string;
  htmlUrl?: string;
  htmlTemplateId?: string;
  imageUrl?: string;
  useIframe?: boolean;
  opacity?: number;
  pointerEvents?: string;
  margin?: string;
  padding?: string;
}

export interface AdCreative {
  readonly id: string;
  readonly adId: string;
  readonly contentType: string;
  readonly width?: number;
  readonly height?: number;
  readonly mediaFiles: AdMedia[];
  readonly clickThrough?: ClickThrough;
  readonly trackingEvents: TrackingEvent[];
}

export interface AdMedia {
  readonly url: string;
  readonly bitrate?: number;
  readonly width?: number;
  readonly height?: number;
  readonly contentType: string;
  readonly delivery?: 'progressive' | 'streaming';
}

export interface CompanionAd {
  readonly id: string;
  readonly width: number;
  readonly height: number;
  readonly resourceType: 'static' | 'html' | 'iframe';
  readonly resourceUrl: string;
  readonly clickThroughUrl?: string;
  readonly trackingUrls?: TrackingUrl[];
}

export interface OverlayAd {
  readonly id: string;
  readonly width?: number;
  readonly height?: number;
  readonly resourceUrl: string;
  readonly clickThroughUrl?: string;
  readonly trackingUrls?: TrackingUrl[];
}

export interface NonLinearAd {
  readonly id: string;
  readonly width: number;
  readonly height: number;
  readonly resourceType: 'static' | 'html' | 'iframe';
  readonly resourceUrl: string;
  readonly clickThroughUrl?: string;
  readonly trackingUrls?: TrackingUrl[];
}

export interface AdBreak {
  readonly id: string;
  readonly timeOffset: number; // seconds, 0 = preroll, -1 = postroll
  readonly type: 'preroll' | 'midroll' | 'postroll';
  readonly ads: Advertisement[];
  readonly duration?: number;
}

export interface AdSchedule {
  readonly adBreaks: AdBreak[];
}

export type TrackingEventType =
  | 'impression'
  | 'creativeView'
  | 'start'
  | 'firstQuartile'
  | 'midpoint'
  | 'thirdQuartile'
  | 'complete'
  | 'pause'
  | 'resume'
  | 'mute'
  | 'unmute'
  | 'click'
  | 'skip'
  | 'close'
  | 'error';

export interface TrackingEvent {
  readonly type: TrackingEventType;
  readonly url: string;
}

export interface TrackingUrl {
  readonly url: string;
  readonly event?: string;
}

/** A VAST `<Verification>` (Open Measurement / OM SDK) entry: an ad-verification vendor + its JS resource. */
export interface AdVerification {
  readonly vendor: string;
  readonly script: string;
}

export interface ClickThrough {
  readonly url: string;
  readonly trackingUrls?: string[];
}

export interface CompanionSlot {
  readonly id: string;
  readonly width: number;
  readonly height: number;
  readonly elementId: string;
}

export interface ProviderInfo {
  readonly name: string;
  readonly version: string;
}

export interface CapabilityInfo {
  readonly supportsLinear: boolean;
  readonly supportsNonLinear: boolean;
  readonly supportsCompanion: boolean;
  readonly supportsSkippable: boolean;
  readonly supportsVMAP: boolean;
  readonly supportsVAST: boolean;
  readonly supportsSSAI: boolean;
  readonly supportsIMA: boolean;
}

export interface ProviderCapabilities {
  readonly capabilities: CapabilityInfo;
}

export interface ProviderContext {
  readonly videoElement: HTMLVideoElement;
  readonly adContainer: HTMLElement;
  readonly controller: PlayerController;
  readonly config: AdsConfig;
}

export interface ProviderResult {
  readonly success: boolean;
  readonly error?: AdError;
}

export enum AdErrorType {
  CONFIGURATION = 'configuration',
  PROVIDER = 'provider',
  NETWORK = 'network',
  TIMEOUT = 'timeout',
  PARSING = 'parsing',
  PLAYBACK = 'playback',
  TRACKING = 'tracking',
  /**
   * The ad request/resource most likely failed because a browser-level or
   * extension ad blocker intercepted it (e.g. Opera's built-in blocker,
   * uBlock Origin, AdGuard) - distinct from NETWORK so consumers can show a
   * more accurate diagnostic instead of treating it as a generic outage.
   */
  BLOCKED = 'blocked',
  UNKNOWN = 'unknown',
}

export interface AdError {
  readonly type: AdErrorType | string;
  readonly code: number;
  readonly message: string;
  /** Native/underlying error caught while handling the ad failure - shape varies by provider/browser. */
  readonly originalError?: unknown;
}

export interface AdProvider {
  readonly name: string;
  readonly capabilities: CapabilityInfo;
  init(context: ProviderContext): Promise<ProviderResult> | ProviderResult;
  requestAds(adTagUrl: string, config?: Record<string, unknown>): Promise<ProviderResult> | ProviderResult;
  playAdBreak(breakType?: 'preroll' | 'midroll' | 'postroll'): Promise<void>;
  pauseAd(): void;
  resumeAd(): void;
  setVolume(volume: number): void;
  setMuted(muted: boolean): void;
  skipAd?(): void;
  onSourceLoaded?(source?: PlayerSource): void;
  destroy(): void;
}

export interface AdsDiagnostics {
  readonly providerName: string | null;
  readonly state: AdState | string;
  readonly configuration: AdsConfig | null;
  readonly lastError: AdError | null;
  readonly statistics: {
    readonly totalAdsRequested: number;
    readonly totalAdsPlayed: number;
    readonly totalAdsCompleted: number;
    readonly totalAdsSkipped: number;
    readonly totalAdErrors: number;
  };
  readonly htmlOverlay?: HtmlOverlayDiagnostics | null;
}

export interface AdsValidationReport {
  passed: boolean;
  providerConfigured: boolean;
  tagUrlValid: boolean;
  errors: string[];
}

export class AdsValidator {
  public static validate(controller: PlayerController): AdsValidationReport {
    const report: AdsValidationReport = {
      passed: false,
      providerConfigured: false,
      tagUrlValid: false,
      errors: [],
    };
    const adsConfig = controller.config?.ads;
    if (!adsConfig) {
      report.errors.push('No advertisement configuration provided.');
      return report;
    }
    if (adsConfig.enabled === false) {
      report.errors.push('Ads subsystem is disabled in configuration.');
      return report;
    }
    if (adsConfig.provider) {
      report.providerConfigured = true;
    } else {
      report.errors.push('No ad provider specified in config.');
    }
    if (adsConfig.tagUrl) {
      try {
        new URL(adsConfig.tagUrl);
        report.tagUrlValid = true;
      } catch (_) {
        report.errors.push(`Invalid ad tag URL: "${adsConfig.tagUrl}"`);
      }
    } else if (!adsConfig.inlineXml) {
      report.errors.push('Neither tagUrl nor inlineXml is configured.');
    }
    report.passed = report.errors.length === 0;
    return report;
  }
}
