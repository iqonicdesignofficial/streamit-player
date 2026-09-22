import { LitElement, html, PropertyValues, TemplateResult, nothing } from 'lit';
import { styles } from './Player.styles';
import { property, state, query } from 'lit/decorators.js';
import {
  PlayerController,
  PlayerState,
  SubtitleAppearance,
  PlayerEvents,
  ThumbnailInfo,
  PlayerSource,
  SourceType,
  formatTime,
  PlayerStatistics,
  PlayerConfiguration,
  OverlayOptions,
  PlayerPlugin,
  ThumbnailProvider,
} from '../../core/src/index';
import './PlayButton';
import './SeekButton';
import './Seekbar';
import './VolumeControl';
import './ChaptersButton';
import './VerticalControls';
import { compileTheme } from './Themes';
import { ThumbnailCache } from './player-internals/ThumbnailCache';
import { PrefetchController } from './player-internals/PrefetchController';
import { SettingsMenuController } from './player-internals/SettingsMenuController';
import { GestureController } from './player-internals/GestureController';
import {
  PlayerIconRegistry,
  IconRegistry,
  IconName,
  IconValue,
  renderIcon,
} from './icons/IconRegistry';

const fontFamilies = [
  { value: 'default', label: 'Default' },
  { value: 'proportional-sans-serif', label: 'Proportional Sans-Serif' },
  { value: 'monospace-sans-serif', label: 'Monospace Sans-Serif' },
  { value: 'proportional-serif', label: 'Proportional Serif' },
  { value: 'monospace-serif', label: 'Monospace Serif' },
  { value: 'casual', label: 'Casual' },
  { value: 'cursive', label: 'Cursive' },
  { value: 'small-capitals', label: 'Small Capitals' },
];

const colors = [
  { value: 'white', label: 'White' },
  { value: 'black', label: 'Black' },
  { value: 'red', label: 'Red' },
  { value: 'green', label: 'Green' },
  { value: 'blue', label: 'Blue' },
  { value: 'yellow', label: 'Yellow' },
  { value: 'magenta', label: 'Magenta' },
  { value: 'cyan', label: 'Cyan' },
];

const fontSizes = [
  { value: 50, label: '50%' },
  { value: 75, label: '75%' },
  { value: 100, label: '100%' },
  { value: 125, label: '125%' },
  { value: 150, label: '150%' },
  { value: 175, label: '175%' },
  { value: 200, label: '200%' },
  { value: 300, label: '300%' },
  { value: 400, label: '400%' },
];

const opacities = [
  { value: 0, label: '0%' },
  { value: 25, label: '25%' },
  { value: 50, label: '50%' },
  { value: 75, label: '75%' },
  { value: 100, label: '100%' },
];

const edgeStyles = [
  { value: 'none', label: 'None' },
  { value: 'raised', label: 'Raised' },
  { value: 'depressed', label: 'Depressed' },
  { value: 'uniform', label: 'Uniform' },
  { value: 'drop-shadow', label: 'Drop Shadow' },
];

const STANDARD_SPEEDS = [0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0, 4.0];
const VERTICAL_SPEEDS = [0.5, 1.0, 2.0];

/**
 * `ThumbnailProvider` plus the `isPreciseSeeking` flag that `VideoFrameThumbnailProvider`
 * (and other concrete providers) happen to expose publicly, but which isn't part of the
 * `@player/core` public interface - precise-seek mode toggles it so a provider can defer
 * expensive frame captures while the user is scrubbing.
 */
interface PreciseSeekAwareThumbnailProvider extends ThumbnailProvider {
  isPreciseSeeking?: boolean;
}

/**
 * `PlayerPlugin.getSettingsItems()` return items, plus an optional `onKeyDown` handler
 * a plugin may attach for its settings row - accepted defensively since it isn't part
 * of the declared `PlayerPlugin` interface in `@player/core`.
 */
type PluginSettingsItem = {
  id: string;
  label: string;
  valueLabel?: string;
  onClick: () => void;
  onKeyDown?: (e: KeyboardEvent) => void;
};

/**
 * The shape of a statically-configured settings menu item, whether declared under
 * `config.settings.customItems` (the documented location) or the legacy top-level
 * `config.customItems` this code also honors for backward compatibility.
 */
type StaticCustomSettingsItem = {
  id?: string;
  label: string;
  valueLabel?: string;
  onClick?: (player: unknown) => void;
};

/**
 * Frameworks that hand values to a custom element as attributes rather than as
 * properties lowercase the name they were given: a React 18 `displayMode`
 * prop reaches the DOM as `displaymode`, which no kebab-cased observed
 * attribute matches. The value was then dropped in silence, so a player told to
 * be vertical stayed standard. Every hyphenated attribute therefore also
 * answers to its squashed and snake_cased spellings.
 */
function buildAttributeAliases(canonical: readonly string[]): Map<string, string> {
  const aliases = new Map<string, string>();
  for (const name of canonical) {
    if (!name.includes('-')) continue;
    for (const alias of [name.replace(/-/g, ''), name.replace(/-/g, '_')]) {
      if (alias !== name && !canonical.includes(alias)) {
        aliases.set(alias, name);
      }
    }
  }
  return aliases;
}

/**
 * `config` only survives as an attribute when it is a JSON string. A framework
 * that assigns an object to an attribute stringifies it to "[object Object]",
 * which would otherwise be swallowed and leave the whole configuration
 * silently missing.
 */
function parseConfigAttribute(value: string | null): PlayerConfiguration | undefined {
  if (value === null) return undefined;
  const trimmed = value.trim();
  if (trimmed === '') return undefined;
  if (trimmed.startsWith('[object ')) {
    console.warn(
      '[streamit-player] The "config" attribute received a stringified object ' +
        `("${trimmed}") and has been ignored. Pass config as a DOM property ` +
        '(element.config = {...}, or .config=${...} / :config="..." in a ' +
        'framework template) rather than as an attribute.'
    );
    return undefined;
  }
  try {
    return JSON.parse(trimmed) as PlayerConfiguration;
  } catch {
    console.warn(
      '[streamit-player] The "config" attribute is not valid JSON and has been ' +
        'ignored. Pass config as a DOM property instead.'
    );
    return undefined;
  }
}

export class PlayerPlayer extends LitElement {
  @property({ type: String, reflect: true }) src = '';
  @property({ type: String, reflect: true }) captions = '';
  @property({ type: Boolean, reflect: true }) autoplay = false;
  @property({ type: Boolean, reflect: true }) muted = false;
  @property({ type: Number, reflect: true }) volume = 1.0;
  @property({ type: String, attribute: 'display-mode', reflect: true }) displayMode:
    | 'standard'
    | 'vertical'
    | 'audio-only'
    | 'custom'
    | 'mini'
    | 'floating' = 'standard';
  @property({ type: Number }) nearEndThreshold = 1;
  @property({ type: Boolean, attribute: 'auto-scroll', reflect: true }) autoScroll = false;
  @property({ type: String, attribute: 'live-mode', reflect: true }) liveMode:
    | 'live-only'
    | 'live-dvr' = 'live-dvr';
  @property({
    type: Object,
    converter: { fromAttribute: parseConfigAttribute },
  })
  config?: PlayerConfiguration;
  @property({ type: Boolean, attribute: 'precise-seek', reflect: true }) preciseSeekEnabled?: boolean;
  @property({ type: Boolean, attribute: 'smart-seek', reflect: true }) smartSeekEnabled?: boolean;
  @property({ type: String, reflect: true }) preload: 'none' | 'metadata' | 'auto' = 'metadata';
  @property({ type: Boolean, reflect: true }) loop = false;
  @property({ type: Boolean, reflect: true }) playsinline = true;
  @property({ type: String, reflect: true }) poster = '';
  @property({ type: String, reflect: true }) crossorigin: 'anonymous' | 'use-credentials' | undefined;

  private get activePreload(): 'none' | 'metadata' | 'auto' {
    return this.config?.preload || this.preload || 'metadata';
  }

  private get activeLoop(): boolean {
    if (this.config?.playback?.loop !== undefined) return this.config.playback.loop;
    if (this.config?.loop !== undefined) return this.config.loop;
    return this.loop;
  }

  private get activePlaysinline(): boolean {
    if (this.config?.playsinline !== undefined) return this.config.playsinline;
    return this.playsinline;
  }

  private get activePoster(): string {
    return this.config?.poster || this.poster || '';
  }

  private get activeCrossorigin(): 'anonymous' | 'use-credentials' | undefined {
    const val = this.config?.crossorigin || this.crossorigin;
    if (val === 'anonymous' || val === 'use-credentials') return val;
    return undefined;
  }

  /**
   * True unless `config.controls` is the literal `false`, or carries an `enabled: false`
   * flag. Neither is part of the strict `controls` config object type - `false` isn't a
   * valid value for it and `enabled` isn't a declared key - but both are accepted here
   * defensively since consumers outside strict TypeScript can pass values outside the
   * declared shape.
   */
  private get controlsSectionEnabled(): boolean {
    const controls: unknown = this.config?.controls;
    if (controls === false) return false;
    if (controls && typeof controls === 'object' && (controls as { enabled?: boolean }).enabled === false) {
      return false;
    }
    return true;
  }

  /** Same defensive `false` / `enabled: false` handling as {@link controlsSectionEnabled}, for `config.emptyState`. */
  private get emptyStateSectionEnabled(): boolean {
    const emptyState: unknown = this.config?.emptyState;
    if (emptyState === false) return false;
    if (
      emptyState &&
      typeof emptyState === 'object' &&
      (emptyState as { enabled?: boolean }).enabled === false
    ) {
      return false;
    }
    return true;
  }

  public localize(key: string, defaultText: string): string {
    const localeConfig = this.config?.locale || {};
    const settingsLabels =
      (this.config?.settings?.labels as Record<string, string> | undefined) || {};
    return settingsLabels[key] || localeConfig[key] || defaultText;
  }

  private isFeedTransitioning = false;
  private iconRegistry = new PlayerIconRegistry();
  private customControls = new Map<
    string,
    (player: PlayerPlayer) => TemplateResult | string | Element | unknown
  >();
  private customOverlays = new Map<string, OverlayOptions>();

  /** @internal */ @state() isVisualTransitioning = false;
  /** @internal */ @state() transitionDirection: 'next' | 'prev' = 'next';
  /** @internal */ @state() transitionStage: 'idle' | 'start' | 'active' = 'idle';
  /** @internal */ shouldAutoplayAfterTransition = false;
  /** @internal */ suppressPlayPauseFeedback = false;

  @state() private contextMenuOpen = false;
  @state() private contextMenuX = 0;
  @state() private contextMenuY = 0;
  private isContextMenuDisabled = false;
  private customContextMenuItems: Array<{
    label: string;
    onClick: (player: PlayerPlayer) => void;
    disabled?: boolean;
  }> = [];

  private customSettingsItems: Array<{
    id: string;
    label: string;
    valueLabel?: string;
    onClick: (player: PlayerPlayer) => void;
  }> = [];
  private customSettingsScreens = new Map<
    string,
    (player: PlayerPlayer, onBack: () => void) => unknown
  >();

  /** @internal */
  @state({
    hasChanged(newVal: PlayerState, oldVal: PlayerState) {
      if (!oldVal) return true;
      const visualKeys: Array<keyof PlayerState> = [
        'status',
        'isPlaying',
        'currentTime',
        'duration',
        'volume',
        'isMuted',
        'isFullscreen',
        'bufferedRanges',
        'playbackRate',
        'captionsEnabled',
        'currentSource',
        'sourceType',
        'isBuffering',
        'isSeeking',
        'hasCaptions',
        'error',
        'qualities',
        'activeQuality',
        'audioTracks',
        'activeAudioTrack',
        'subtitleTracks',
        'activeSubtitleTrackId',
        'chapters',
        'activeChapterIndex',
        'isLive',
        'isLowLatency',
        'isAtLiveEdge',
        'hasDvr',
        'displayMode',
        'liveMode',
        'loop',
        'playlist',
        'activePlaylistIndex',
        'playlistRepeatMode',
        'autoScroll',
        'seekableRange',
        'isAdPlaying',
        'isAdLoading',
        'currentAd',
        'currentAdBreak',
        'adCurrentTime',
        'adRemainingTime',
        'adDuration',
        'canSkipAd',
        'skipAvailableAt',
        'adPosition',
        'adProvider',
        'adLinear',
        'adMuted',
      ];
      return visualKeys.some((k) => {
        const a = newVal[k];
        const b = oldVal[k];
        if (k === 'seekableRange') {
          const sa = a as { start: number; end: number } | undefined;
          const sb = b as { start: number; end: number } | undefined;
          return !sa || !sb || sa.start !== sb.start || sa.end !== sb.end;
        }
        if (k === 'bufferedRanges') {
          const ba = a as Array<{ start: number; end: number }> | undefined;
          const bb = b as Array<{ start: number; end: number }> | undefined;
          if (!ba || !bb || ba.length !== bb.length) return true;
          for (let i = 0; i < ba.length; i++) {
            if (ba[i].start !== bb[i].start || ba[i].end !== bb[i].end) return true;
          }
          return false;
        }
        return a !== b;
      });
    },
  })
  playerState: PlayerState = {
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
      fontSize: 75,
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
  @state() private controlsVisible = true;
  /** @internal */ @state() settingsMenuOpen = false;
  /** @internal */ @state() activeMenuScreen: string = 'main';
  @state() private toastMessage = '';
  @state() private toastType: 'success' | 'error' | 'info' = 'info';
  @state() private toastVisible = false;
  private toastTimer?: number;
  private lastFocusedElement: HTMLElement | null = null;
  @state() private tapFeedback: 'rewind' | 'fastforward' | null = null;
  @state() private feedbackTaps = 0;
  @state() private playPauseFeedback: 'play' | 'pause' | null = null;
  @state() private activeVolumeFeedback: { volume: number; isMuted: boolean } | null = null;
  @state() private isSeekingInteraction = false;
  /** @internal */ @state() activeSpeedFeedback: number | null = null;
  @state() private activeQualityFeedback: string | null = null;
  private shouldShowQualityFeedback = false;

  private seekInteractionTimer?: number;
  private shortcutsUnsubscribe?: () => void;
  /** @internal */ speedFeedbackTimer?: number;
  private qualityFeedbackTimer?: number;
  private throttledSeekTimer?: number;
  private pendingSeekTime: number | null = null;

  /** @internal */ @query('video') videoElement!: HTMLVideoElement;

  /** @internal */ controller!: PlayerController;
  private unsubscribe?: () => void;
  private hideControlsTimer?: number;
  private feedbackTimer?: number;
  private playPauseFeedbackTimer?: number;
  private volumeFeedbackTimer?: number;
  private lastTap = 0;
  private isDraggingSeekbar = false;
  private wasPlayingBeforeDrag = false;
  @state() private isPreciseSeeking = false;
  private filmstripCenterTime = -1;
  /** @internal */ @state() speedLockState: 'IDLE' | 'HOLDING' | 'READY_TO_LOCK' | 'LOCKED' | 'LOCKED_HOLDING' | 'READY_TO_UNLOCK' = 'IDLE';
  /** @internal */ @state() isSpeedOverlayFadingOut = false;
  @state() private isVolumeFeedbackFadingOut = false;
  private filmstripThumbs = new Map<number, ThumbnailInfo | null | undefined>();
  private preciseSeekContainerWidth = 1056;

  /** Thumbnail provider cache + neighbour preloading (see player-internals/ThumbnailCache). */
  /** @internal */ readonly thumbnailCache = new ThumbnailCache(this);

  /** Idle-scheduled prefetch of the neighbouring playlist source (see player-internals/PrefetchController). */
  /** @internal */ readonly prefetch = new PrefetchController(this);

  /** Multi-screen settings menu stack (see player-internals/SettingsMenuController). */
  /** @internal */ readonly settingsMenu = new SettingsMenuController(this);

  /** Pointer/touch gestures + the vertical-feed canvas transition (see player-internals/GestureController). */
  private gestures = new GestureController(this);

  private pendingListeners: Array<{
    action: 'on' | 'off';
    event: keyof PlayerEvents;
    callback: (detail: unknown) => void;
  }> = [];

  static styles = styles;

  /** The mode `config` last asked for - see adoptDisplayModeFromConfig. */
  private configRequestedMode?: PlayerPlayer['displayMode'];

  private static attributeAliases?: Map<string, string>;

  static get observedAttributes(): string[] {
    const canonical = super.observedAttributes;
    // Own-property, not inherited: a subclass (the player-player alias element,
    // or a consumer's) may observe attributes this class never declared.
    if (!Object.prototype.hasOwnProperty.call(this, 'attributeAliases')) {
      this.attributeAliases = buildAttributeAliases(canonical);
    }
    return [...canonical, ...(this.attributeAliases as Map<string, string>).keys()];
  }

  attributeChangedCallback(name: string, old: string | null, value: string | null) {
    const canonical = (this.constructor as typeof PlayerPlayer).attributeAliases?.get(name);
    if (canonical) {
      if (value === null) {
        this.removeAttribute(canonical);
      } else if (this.getAttribute(canonical) !== value) {
        this.setAttribute(canonical, value);
      }
      return;
    }
    super.attributeChangedCallback(name, old, value);
  }

  public get controllerInstance(): PlayerController {
    return this.controller;
  }

  public loadSource(source: PlayerSource) {
    this.prefetch.setDirection('next');
    if (this.controller) {
      this.controller.loadSource(source);
    } else {
      this.updateComplete.then(() => this.controller?.loadSource(source));
    }
  }

  public loadPlaylist(sources: PlayerSource[], startIndex: number = 0): void {
    this.prefetch.setDirection('next');
    if (this.controller) {
      this.controller.loadPlaylist(sources, startIndex);
    } else {
      this.updateComplete.then(() => this.controller?.loadPlaylist(sources, startIndex));
    }
  }

  public play(): void {
    if (this.controller) {
      this.controller.play();
    } else {
      this.updateComplete.then(() => this.controller?.play());
    }
  }

  public pause(): void {
    if (this.controller) {
      this.controller.pause();
    } else {
      this.updateComplete.then(() => this.controller?.pause());
    }
  }

  public load(source: string | PlayerSource): void {
    const playerSource = typeof source === 'string' ? { src: source } : source;
    if (this.controller) {
      this.controller.load(playerSource);
    } else {
      this.updateComplete.then(() => this.controller?.load(playerSource));
    }
  }

  public destroy(): void {
    if (this.controller) {
      this.controller.destroy();
    }
    this.remove();
  }

  public addPlaylistItem(source: PlayerSource): void {
    if (this.controller) {
      this.controller.addPlaylistItem(source);
    } else {
      this.updateComplete.then(() => this.controller?.addPlaylistItem(source));
    }
  }

  public getCurrentItem(): PlayerSource | null {
    return this.controller ? this.controller.getCurrentItem() : null;
  }

  public repeat(mode: 'off' | 'one' | 'all' | boolean): void {
    if (this.controller) {
      this.controller.repeat(mode);
    } else {
      this.updateComplete.then(() => this.controller?.repeat(mode));
    }
  }

  public on<K extends keyof PlayerEvents>(
    event: K,
    callback: (detail: PlayerEvents[K]) => void
  ): void {
    if (this.controller) {
      this.controller.on(event, callback);
    } else {
      this.pendingListeners.push({
        action: 'on',
        event,
        callback: callback as (detail: unknown) => void,
      });
    }
  }

  public off<K extends keyof PlayerEvents>(
    event: K,
    callback: (detail: PlayerEvents[K]) => void
  ): void {
    if (this.controller) {
      this.controller.off(event, callback);
    } else {
      this.pendingListeners.push({
        action: 'off',
        event,
        callback: callback as (detail: unknown) => void,
      });
    }
  }

  public emit<K extends keyof PlayerEvents>(event: K, detail?: PlayerEvents[K]): void {
    if (this.controller) {
      this.controller.emit(event, detail);
    }
  }

  public setNearEndThreshold(threshold: number): void {
    this.nearEndThreshold = threshold;
    if (this.controller) {
      this.controller.setNearEndThreshold(threshold);
    }
  }

  public getNearEndThreshold(): number {
    return this.controller ? this.controller.getNearEndThreshold() : this.nearEndThreshold;
  }

  public getPlaylist(): PlayerSource[] {
    return this.controller ? this.controller.getPlaylist() : [];
  }

  public getCurrentPlaylistIndex(): number {
    return this.controller ? this.controller.getCurrentPlaylistIndex() : 0;
  }

  public getHistoryStack(): number[] {
    return this.controller ? this.controller.getHistoryStack() : [];
  }

  public getCurrentPlaylistItem(): PlayerSource | null {
    return this.controller ? this.controller.getCurrentPlaylistItem() : null;
  }

  public getPlaylistLength(): number {
    return this.controller ? this.controller.getPlaylistLength() : 0;
  }

  public hasPlaylist(): boolean {
    return this.controller ? this.controller.hasPlaylist() : false;
  }

  public isFirstPlaylistItem(): boolean {
    return this.controller ? this.controller.isFirstPlaylistItem() : false;
  }

  public isLastPlaylistItem(): boolean {
    return this.controller ? this.controller.isLastPlaylistItem() : false;
  }

  public setPlaylistRepeatMode(mode: 'off' | 'repeat-all'): void {
    if (this.controller) {
      this.controller.setPlaylistRepeatMode(mode);
    }
  }

  public getPlaylistRepeatMode(): 'off' | 'repeat-all' {
    return this.controller ? this.controller.getPlaylistRepeatMode() : 'off';
  }

  public next(): void {
    if (!this.controller) {
      this.updateComplete.then(() => this.next());
      return;
    }
    if (this.getPlaylistLength() <= 1) return;
    if (this.gestures.isTransitionLocked) return;

    this.prefetch.setDirection('next');
    this.gestures.initiateVisualTransition('next', () => {
      this.controller.next();
    });
  }

  public previous(): void {
    if (!this.controller) {
      this.updateComplete.then(() => this.previous());
      return;
    }
    if (this.getPlaylistLength() <= 1) return;
    if (this.gestures.isTransitionLocked) return;

    this.prefetch.setDirection('prev');
    this.gestures.initiateVisualTransition('prev', () => {
      this.controller.previous();
    });
  }

  public appendPlaylistItem(source: PlayerSource): void {
    if (this.controller) {
      this.controller.appendPlaylistItem(source);
    } else {
      this.updateComplete.then(() => this.controller?.appendPlaylistItem(source));
    }
  }

  public insertPlaylistItem(index: number, source: PlayerSource): void {
    if (this.controller) {
      this.controller.insertPlaylistItem(index, source);
    } else {
      this.updateComplete.then(() => this.controller?.insertPlaylistItem(index, source));
    }
  }

  public removePlaylistItem(index: number): void {
    if (!this.controller) {
      this.updateComplete.then(() => this.removePlaylistItem(index));
      return;
    }
    if (this.gestures.isTransitionLocked) return;
    const isRemovingCurrent = index === this.getCurrentPlaylistIndex();
    if (isRemovingCurrent && this.displayMode === 'vertical') {
      this.prefetch.setDirection('next');
      this.gestures.initiateVisualTransition('next', () => {
        this.controller.removePlaylistItem(index);
      });
    } else {
      this.controller.removePlaylistItem(index);
    }
  }

  public clearPlaylist(): void {
    if (this.controller) {
      this.controller.clearPlaylist();
    } else {
      this.updateComplete.then(() => this.controller?.clearPlaylist());
    }
  }

  public replacePlaylistItem(index: number, source: PlayerSource): void {
    if (this.controller) {
      this.controller.replacePlaylistItem(index, source);
    } else {
      this.updateComplete.then(() => this.controller?.replacePlaylistItem(index, source));
    }
  }

  public movePlaylistItem(fromIndex: number, toIndex: number): void {
    if (this.controller) {
      this.controller.movePlaylistItem(fromIndex, toIndex);
    } else {
      this.updateComplete.then(() => this.controller?.movePlaylistItem(fromIndex, toIndex));
    }
  }

  public goToNextPlaylistItem(): void {
    this.next();
  }

  public goToPreviousPlaylistItem(): void {
    this.previous();
  }

  private handleResize = () => {
    if (this.isPreciseSeeking) {
      const container = this.shadowRoot?.querySelector('.precise-seek-container');
      if (
        container &&
        container.clientWidth > 0 &&
        this.preciseSeekContainerWidth !== container.clientWidth
      ) {
        this.preciseSeekContainerWidth = container.clientWidth;
        this.requestUpdate();
      }
    }
  };

  public setIcon(name: IconName, value: IconValue) {
    this.iconRegistry.setIcon(name, value);
    this.requestUpdate();
  }

  public registerIconPack(packName: string, pack: Record<string, IconValue>) {
    IconRegistry.registerIconPack(packName, pack);
    this.requestUpdate();
  }

  public useIconPack(packName: string) {
    this.iconRegistry.useIconPack(packName);
    this.requestUpdate();
  }

  public registerControl(
    id: string,
    renderer: (player: PlayerPlayer) => TemplateResult | string | Element | unknown
  ) {
    this.customControls.set(id, renderer);
    this.requestUpdate();
  }

  public registerOverlay(id: string, options: OverlayOptions) {
    this.customOverlays.set(id, options);
    this.requestUpdate();
  }

  public disableOverlay(id: string) {
    const existing = this.customOverlays.get(id) || {};
    this.customOverlays.set(id, { ...existing, enabled: false });
    this.requestUpdate();
  }

  public enableOverlay(id: string) {
    const existing = this.customOverlays.get(id) || {};
    this.customOverlays.set(id, { ...existing, enabled: true });
    this.requestUpdate();
  }

  public setOverlayTemplate(
    id: string,
    templateFn: (
      player: PlayerPlayer,
      context?: unknown
    ) => TemplateResult | string | Element | unknown
  ) {
    const existing = this.customOverlays.get(id) || {};
    // `OverlayOptions.template` is deliberately `(player: unknown, ...) => unknown` in
    // @player/core (which has no knowledge of the web-components UI layer); this is the
    // documented call site that narrows it back to the concrete Player element.
    this.customOverlays.set(id, {
      ...existing,
      template: templateFn as (player: unknown, context?: unknown) => unknown,
    });
    this.requestUpdate();
  }

  public setOverlayTiming(id: string, durationMs: number) {
    const existing = this.customOverlays.get(id) || {};
    this.customOverlays.set(id, { ...existing, timing: durationMs });
    this.requestUpdate();
  }

  public getIcon(name: IconName, params?: Record<string, unknown>) {
    const configIcons = (this.config?.icons as Record<string, IconValue> | undefined) || {};
    const settingsIcons =
      (this.config?.settings?.icons as Record<string, IconValue> | undefined) || {};
    const customIcon = settingsIcons[name] || configIcons[name];
    if (customIcon) return customIcon;
    return this.iconRegistry.getIcon(name, params);
  }

  public setThumbnailProvider(provider: ThumbnailProvider) {
    this.thumbnailCache.setMainProvider(provider);
    if (this.controller) {
      this.controller.setThumbnailProvider(provider);
    }
    const currentSource = this.playerState?.currentSource;
    if (currentSource && provider) {
      this.thumbnailCache.setProviderForSource(currentSource, provider);
    }
    this.thumbnailCache.trigger();
  }

  public seekToChapter(indexOrId: string | number) {
    if (this.controller) {
      this.controller.seekToChapter(indexOrId);
    }
  }

  willUpdate(changedProperties: PropertyValues) {
    if (changedProperties.has('liveMode') && this.controller) {
      this.controller.setLiveMode(this.liveMode);
    }
    this.adoptDisplayModeFromConfig(changedProperties);
  }

  /**
   * `displayMode` is the single source of truth for the layout: the host
   * stylesheet keys off the attribute it reflects and render() picks the
   * control set from it. `config.displayMode` and `config.layout.mode` are
   * equivalent ways to ask for a mode, so they are folded into the property
   * here - before the first render - rather than being read separately further
   * down, which is how a 9:16 host could end up wearing the standard control
   * bar.
   *
   * Only a config that changes the mode it asks for wins, so an unrelated
   * config update never clobbers a display-mode set on the element itself.
   */
  private adoptDisplayModeFromConfig(changedProperties: PropertyValues) {
    if (!changedProperties.has('config')) return;
    const requested = this.config?.displayMode || this.config?.layout?.mode;
    if (!requested || requested === this.configRequestedMode) return;
    this.configRequestedMode = requested;
    if (this.displayMode !== requested) {
      this.displayMode = requested;
    }
  }

  firstUpdated() {
    // 1. Instantiate the headless PlayerController with merged config
    const activeDisplayMode = this.config?.displayMode || this.config?.layout?.mode || this.displayMode;
    const mergedConfig: PlayerConfiguration = {
      autoplay: this.autoplay,
      muted: this.muted,
      volume: this.volume,
      displayMode: activeDisplayMode,
      autoScroll: this.autoScroll,
      nearEndThreshold: this.nearEndThreshold,
      preload: this.activePreload,
      loop: this.activeLoop,
      playsinline: this.activePlaysinline,
      poster: this.activePoster,
      crossorigin: this.activeCrossorigin,
      ...(this.config || {}),
      playback: {
        autoplay: this.autoplay,
        muted: this.muted,
        volume: this.volume,
        ...(this.config?.playback || {}),
      },
      layout: {
        mode: activeDisplayMode,
        ...(this.config?.layout || {}),
      },
      sleepTimer: {
        ...(this.config?.sleepTimer || {}),
      },
      live: {
        mode: this.liveMode,
        ...(this.config?.live || {}),
      },
    };
    mergedConfig.displayMode = activeDisplayMode;
    if (!mergedConfig.layout) mergedConfig.layout = {};
    mergedConfig.layout.mode = activeDisplayMode;

    if (this.preciseSeekEnabled !== undefined) {
      mergedConfig.preciseSeek = {
        ...(typeof mergedConfig.preciseSeek === 'object' ? mergedConfig.preciseSeek : {}),
        enabled: this.preciseSeekEnabled,
      };
    }
    if (this.smartSeekEnabled !== undefined) {
      mergedConfig.smartSeek = {
        ...(typeof mergedConfig.smartSeek === 'object' ? mergedConfig.smartSeek : {}),
        enabled: this.smartSeekEnabled,
      };
    }

    if (mergedConfig.iconPack) {
      this.iconRegistry.useIconPack(mergedConfig.iconPack);
    }
    if (mergedConfig.icons) {
      for (const [key, value] of Object.entries(mergedConfig.icons)) {
        this.iconRegistry.setIcon(key as IconName, value as IconValue);
      }
    }

    this.controller = new PlayerController(this.videoElement, mergedConfig);
    if (mergedConfig.theme) {
      this.applyTheme(mergedConfig.theme);
    }

    const adsOverlayContainer = this.shadowRoot?.querySelector('.player-ads-overlay') as HTMLElement;
    if (adsOverlayContainer && this.controller.ads) {
      this.controller.ads.setAdContainer(adsOverlayContainer);
    }

    // Flush pending listeners
    for (const listener of this.pendingListeners) {
      if (listener.action === 'on') {
        this.controller.on(listener.event, listener.callback);
      } else if (listener.action === 'off') {
        this.controller.off(listener.event, listener.callback);
      }
    }
    this.pendingListeners = [];

    // 2. Subscribe to internal controller updates
    this.unsubscribe = this.controller.onStateChange((state) => {
      if (this.isVisualTransitioning) {
        this.gestures.checkTransitionCompletion();
      }
      if (
        this.videoElement &&
        (state.isPlaying || state.status === 'playing' || this.videoElement.readyState >= 2)
      ) {
        this.videoElement.removeAttribute('poster');
      }
      const isSourceChanged =
        this.playerState && this.playerState.currentSource !== state.currentSource;
      if (isSourceChanged) {
        this.isFeedTransitioning = true;
        if (state.currentSource) {
          const preloadedProvider = this.thumbnailCache.getProvider(state.currentSource);
          if (preloadedProvider && preloadedProvider !== this.thumbnailCache.getMainProvider()) {
            this.thumbnailCache.setMainProvider(preloadedProvider);
            if (this.controller) {
              // `thumbnailProvider` and `state` are private on PlayerController; this
              // swaps the active provider in place during a source-change transition
              // without going through `setThumbnailProvider()` (which would trigger a
              // synchronous, re-entrant `updateState()` from inside this very callback).
              const internals = this.controller as unknown as {
                thumbnailProvider?: ThumbnailProvider;
                state: { thumbnailProvider?: ThumbnailProvider };
              };
              internals.thumbnailProvider = preloadedProvider;
              internals.state.thumbnailProvider = preloadedProvider;
            }
            state.thumbnailProvider = preloadedProvider;
          }
        }
      }

      if (this.playerState && this.playerState.isAdPlaying !== state.isAdPlaying) {
        if (state.isAdPlaying) {
          this.cleanupControlsTimer();
          this.controlsVisible = false;
          this.classList.add('controls-hidden');
        } else {
          this.controlsVisible = true;
          this.classList.remove('controls-hidden');
        }
      }

      // Trigger central play/pause feedback overlay on isPlaying changes
      if (
        this.playerState &&
        this.playerState.isPlaying !== state.isPlaying &&
        state.status !== 'idle' &&
        state.status !== 'error' &&
        !(state.status === 'ended' && this.displayMode === 'vertical')
      ) {
        const isEndedTransition = this.displayMode === 'vertical' && this.videoElement?.ended;
        if (!this.isFeedTransitioning && !this.suppressPlayPauseFeedback && !isEndedTransition) {
          this.triggerPlayPauseFeedback(state.isPlaying ? 'play' : 'pause');
        }
      }

      // Clear the feed transitioning flag once the video reaches a stable playback state
      if (
        this.isFeedTransitioning &&
        (state.status === 'playing' ||
          state.status === 'paused' ||
          state.status === 'error' ||
          state.status === 'ended')
      ) {
        this.isFeedTransitioning = false;
      }

      // Reset suppression flag once playback starts
      if (state.isPlaying || state.status === 'playing') {
        this.suppressPlayPauseFeedback = false;
        this.shouldAutoplayAfterTransition = false;
      }

      // Trigger volume feedback overlay when volume or muted state changes
      if (
        this.playerState &&
        (this.playerState.volume !== state.volume || this.playerState.isMuted !== state.isMuted) &&
        state.status !== 'idle' &&
        state.status !== 'error'
      ) {
        this.triggerVolumeFeedback(state.volume, state.isMuted);
      }

      // Trigger speed feedback overlay when playbackRate changes
      if (
        this.playerState &&
        this.playerState.playbackRate !== state.playbackRate &&
        state.status !== 'idle' &&
        state.status !== 'error'
      ) {
        this.triggerSpeedFeedback(state.playbackRate);
      }

      // Show quality feedback only after explicit user quality selection.
      if (
        this.shouldShowQualityFeedback &&
        this.playerState &&
        this.playerState.activeQuality !== state.activeQuality &&
        state.activeQuality &&
        state.status !== 'idle' &&
        state.status !== 'loading' &&
        state.status !== 'error'
      ) {
        this.triggerQualityFeedback(state.activeQuality);
        this.shouldShowQualityFeedback = false;
      }

      const oldState = this.playerState;
      this.playerState = state;
      // Sync properties back to outer host attributes
      this.muted = state.isMuted;
      this.volume = state.volume;
      this.displayMode = state.displayMode;
      this.autoScroll = state.autoScroll;
      this.liveMode = state.liveMode;

      const statusChanged = !oldState || oldState.status !== state.status;
      const sourceChanged = !oldState || oldState.currentSource !== state.currentSource;
      if (statusChanged || sourceChanged) {
        this.thumbnailCache.trigger();
        this.prefetch.trigger();
      }

      if (oldState && oldState.currentSource !== state.currentSource) {
        this.filmstripThumbs.clear();
        this.filmstripCenterTime = -1;
        this.isPreciseSeeking = false;
        this.speedLockState = 'IDLE';
        this.isSpeedOverlayFadingOut = false;
      }

      if (!state.isSeeking && !this.isDraggingSeekbar) {
        this.pendingSeekTime = null;
      }

      // Throttle player-state-change dispatches to reduce overhead during normal playback
      const importantKeys: Array<keyof PlayerState> = [
        'status',
        'isPlaying',
        'volume',
        'isMuted',
        'isFullscreen',
        'playbackRate',
        'captionsEnabled',
        'currentSource',
        'sourceType',
        'isBuffering',
        'isSeeking',
        'hasCaptions',
        'error',
        'activeQuality',
        'activeAudioTrack',
        'activeSubtitleTrackId',
        'activeChapterIndex',
        'loop',
        'isLive',
        'isLowLatency',
        'isAtLiveEdge',
        'liveLatency',
        'dvrWindow',
        'canSeekInDvr',
      ];
      const hasImportantChange = !oldState || importantKeys.some((k) => oldState[k] !== state[k]);

      const timeDiff = oldState ? Math.abs(oldState.currentTime - state.currentTime) : 0;
      const hasTimeChange =
        timeDiff >= 0.2 || state.isSeeking || (oldState && oldState.isSeeking !== state.isSeeking);

      if (hasImportantChange || hasTimeChange) {
        // Dispatch state changes for telemetry / embeds
        this.dispatchEvent(
          new CustomEvent('player-state-change', {
            detail: state,
            bubbles: true,
            composed: true,
          })
        );
      }
    });

    // Re-emit core controller events as DOM CustomEvents on <player-player>
    const coreEvents = [
      'play',
      'ended',
      'pause',
      'seek',
      'seekstart',
      'seekend',
      'volumechange',
      'mutechange',
      'playbackratechange',
      'qualitychange',
      'subtitlechange',
      'audiochange',
      'fullscreenchange',
      'pipchange',
      'sourcechange',
      'chapterchange',
      'markerclick',
      'markerhover',
      'metadata',
      'error',
      'replay',
      'playlist-loaded',
      'playlist-cleared',
      'playlist-change',
      'playlist-index-change',
      'playlist-next',
      'playlist-previous',
      'playlist-item-added',
      'playlist-item-removed',
      'playlist-item-replaced',
      'playlist-item-moved',
      'playlist-near-end',
      'playlist-repeat-change',
      'autoscroll-change',
      'metadata',
      'timeupdate',
      'waiting',
      'playing',
      'config-change',
      'drmsessioncreated',
      'drmsessionclosed',
      'drmmessage',
      'drmkeychange',
      'drmerror',
      'drmlicenserequest',
      'drmlicenseresponse',
      'manifestloaded',
      // Ads/Companions/VMAP/HTML Overlay/SIMID lifecycle events - re-dispatched
      // as DOM CustomEvents on <player-player> following the 'player-*' naming
      // convention every other event here uses (e.g. addEventListener('player-adloaded', ...)).
      'adbreakstart',
      'adbreakend',
      'adclick',
      'adloadstart',
      'adloaded',
      'adstart',
      'adpause',
      'adresume',
      'adskip',
      'adcomplete',
      'adquartile',
      'admute',
      'adunmute',
      'adtimeupdate',
      'adproviderchange',
      'aderror',
      'adverificationready',
      'skipavailable',
      'admilestone',
      'companionshown',
      'companionerror',
      'vmapparseerror',
      'vmapbreakerror',
      'htmloverlayavailable',
      'htmloverlayloaded',
      'htmloverlayshown',
      'htmloverlayhidden',
      'htmloverlayclosed',
      'htmloverlayclick',
      'htmloverlaycompleted',
      'htmloverlayerror',
      'htmloverlayupdated',
      'simidavailable',
      'simidstart',
      'simidready',
      'simiderror',
      'simidcomplete',
      'simidinteraction',
      'simidsecurityerror',
      'simidclick',
      'simiddurationchange',
      'simidcreativeerror',
      'simidpause',
      'simidresume',
      'simidresize',
      'simidfullscreen',
      'simidexitfullscreen',
      'simidcollapse',
      'simidexpand',
      'simidskip',
      'simidstop',
    ];
    coreEvents.forEach((evt) => {
      this.controller.addEventListener(evt as keyof PlayerEvents, (detail: unknown) => {
        if (evt === 'config-change') {
          const config = detail as PlayerConfiguration;
          this.config = config;
          if (config.theme) {
            this.applyTheme(config.theme);
          }
          this.requestUpdate();
        }

        if (evt === 'ended') {
          const nextIndex = this.controller.getAutoAdvanceIndexOnEnded();
          if (nextIndex !== null) {
            const loopSingle =
              this.config?.vertical?.loopSingleVideo !== undefined
                ? this.config.vertical.loopSingleVideo
                : this.displayMode === 'vertical' && !this.playerState.autoScroll;
            const shouldAdvance =
              this.displayMode !== 'vertical' || (this.playerState.autoScroll && !loopSingle);
            if (shouldAdvance) {
              this.next();
              if (this.displayMode !== 'vertical') {
                this.controller.play();
              }
            } else if (this.displayMode === 'vertical') {
              // Vertical mode with loopSingleVideo ON: auto-restart the current video
              this.suppressPlayPauseFeedback = true;
              this.controller.seek(0);
              this.controller.play();
            }
          } else if (this.displayMode === 'vertical') {
            const loopSingle = this.config?.vertical?.loopSingleVideo !== false;
            if (loopSingle) {
              this.suppressPlayPauseFeedback = true;
              this.controller.seek(0);
              this.controller.play();
            }
          }
        }

        // Backward compatibility: map 'playlist-next' to also emit 'player-feed-next'
        if (evt === 'playlist-next') {
          const nav = detail as PlayerEvents['playlist-next'];
          this.dispatchEvent(
            new CustomEvent('player-feed-next', {
              detail: { index: nav.index, source: nav.source },
              bubbles: true,
              composed: true,
            })
          );
        }

        // Backward compatibility: map 'playlist-previous' to also emit 'player-feed-previous'
        if (evt === 'playlist-previous') {
          const nav = detail as PlayerEvents['playlist-previous'];
          this.dispatchEvent(
            new CustomEvent('player-feed-previous', {
              detail: { index: nav.index, source: nav.source },
              bubbles: true,
              composed: true,
            })
          );
        }

        this.dispatchEvent(
          new CustomEvent(`player-${evt}`, {
            detail,
            bubbles: true,
            composed: true,
          })
        );
      });
    });

    // 3. Load initial source
    if (this.src) {
      this.controller.loadSource({ src: this.src });
    }

    // 4. Load initial captions
    if (this.captions) {
      this.controller.loadCaptions({
        src: this.captions,
        label: 'English Subtitles',
        srclang: 'en',
        default: true,
      });
    }

    this.setupInteractionListeners();
    this.gestures.attach();

    // Context menu binding
    this.addEventListener('contextmenu', this.handleContextMenu);
    document.addEventListener('click', this.handleDocumentClick);
    document.addEventListener('focusin', this.handleFocusIn);

    // Dynamic bridges and lifecycle hooks
    if (this.controller) {
      this.controller.player = this;

      // Flush any overlays registered before mounting
      this.controller.pendingOverlays.forEach((options, id) => {
        this.registerOverlay(id, options);
      });
      this.controller.pendingOverlays.clear();

      const plugins = this.controller.getPlugins();
      for (const p of plugins) {
        try {
          p.onPlayerAttached?.(this);
        } catch (e) {
          console.error(`[Player] Error running onPlayerAttached for plugin ${p.name}:`, e);
        }
      }
    }

    // Subscribe to key actions hook for overlays triggering
    this.shortcutsUnsubscribe = this.controller.shortcuts.onAction((action, detail) => {
      if (action === 'seek' && detail?.seconds !== undefined) {
        const seconds = detail.seconds;
        this.showFeedbackOverlay(seconds < 0 ? 'rewind' : 'fastforward');
        this.triggerSeekInteraction();
      } else if (action === 'volume' && detail?.volume !== undefined && detail.isMuted !== undefined) {
        const { volume, isMuted } = detail;
        this.triggerVolumeFeedback(volume, isMuted);
      } else if (action === 'fullscreen') {
        this.handleFullscreenToggle();
      }
    });
  }

  updated(changedProperties: PropertyValues) {
    super.updated(changedProperties);

    if (changedProperties.has('config') && this.controller && this.config) {
      if (this.config !== this.controller.config) {
        this.controller.updateConfig(this.config);
      }
    }

    if (changedProperties.has('preciseSeekEnabled') && this.controller) {
      if (this.preciseSeekEnabled !== undefined) {
        this.controller.updateConfig({
          preciseSeek: {
            ...(typeof this.config?.preciseSeek === 'object' ? this.config.preciseSeek : {}),
            enabled: this.preciseSeekEnabled,
          },
        });
      }
    }

    if (changedProperties.has('smartSeekEnabled') && this.controller) {
      if (this.smartSeekEnabled !== undefined) {
        this.controller.updateConfig({
          smartSeek: {
            ...(typeof this.config?.smartSeek === 'object' ? this.config.smartSeek : {}),
            enabled: this.smartSeekEnabled,
          },
        });
      }
    }

    if (changedProperties.has('config')) {
      const animationTiming = this.config?.vertical?.animationTiming;
      if (animationTiming !== undefined) {
        this.style.setProperty('--player-vertical-transition-duration', `${animationTiming}ms`);
      } else {
        this.style.removeProperty('--player-vertical-transition-duration');
      }

      if (this.config?.vertical?.autoScroll !== undefined) {
        this.autoScroll = this.config.vertical.autoScroll;
        if (this.controller) {
          this.controller.setAutoScroll(this.autoScroll);
        }
      }
    }

    if (changedProperties.has('displayMode') && this.controller) {
      const oldMode = changedProperties.get('displayMode') as 'standard' | 'vertical' | 'audio-only' | 'custom' | 'mini' | 'floating' | undefined;
      if (oldMode !== undefined && oldMode !== this.displayMode) {
        this.controller.setDisplayMode(this.displayMode);
        const availableSpeeds = this.getAvailableSpeeds(this.displayMode);
        const currentRate = this.playerState.playbackRate;
        if (!availableSpeeds.includes(currentRate)) {
          const nearestSpeed = availableSpeeds.reduce((closest, candidate) =>
            Math.abs(candidate - currentRate) < Math.abs(closest - currentRate) ? candidate : closest
          );
          this.controller.setPlaybackRate(nearestSpeed);
        }
        if (this.displayMode === 'vertical') {
          this.isPreciseSeeking = false;
          const provider = this.playerState.thumbnailProvider;
          if (provider) {
            (provider as PreciseSeekAwareThumbnailProvider).isPreciseSeeking = false;
          }
        }
      }
    }

    if (changedProperties.has('nearEndThreshold') && this.controller) {
      const oldThreshold = changedProperties.get('nearEndThreshold') as number | undefined;
      if (oldThreshold !== undefined && oldThreshold !== this.nearEndThreshold) {
        this.controller.setNearEndThreshold(this.nearEndThreshold);
      }
    }

    if (changedProperties.has('autoScroll') && this.controller) {
      const oldVal = changedProperties.get('autoScroll') as boolean | undefined;
      if (oldVal !== undefined && oldVal !== this.autoScroll) {
        this.controller.setAutoScroll(this.autoScroll);
      }
    }

    if (changedProperties.has('src') && this.controller) {
      const oldSrc = changedProperties.get('src') as string | undefined;
      if (oldSrc !== undefined && oldSrc !== this.src) {
        this.settingsMenu.close();
        this.filmstripThumbs.clear();
        this.filmstripCenterTime = -1;
        this.isPreciseSeeking = false;
        this.speedLockState = 'IDLE';
        this.isSpeedOverlayFadingOut = false;
        this.controller.loadSource({ src: this.src });
      }
    }

    if (changedProperties.has('captions') && this.controller && this.captions) {
      const oldCaptions = changedProperties.get('captions') as string | undefined;
      if (oldCaptions !== undefined && oldCaptions !== this.captions) {
        this.controller.loadCaptions({
          src: this.captions,
          label: 'English Subtitles',
          srclang: 'en',
          default: true,
        });
      }
    }
    if (changedProperties.has('activeMenuScreen')) {
      this.settingsMenu.onScreenChanged();
    }
    if (changedProperties.has('settingsMenuOpen')) {
      this.settingsMenu.onOpenStateChanged(
        changedProperties.get('settingsMenuOpen') as boolean | undefined
      );
    }
    if (changedProperties.has('contextMenuOpen')) {
      const oldVal = changedProperties.get('contextMenuOpen') as boolean | undefined;
      if (this.contextMenuOpen && !oldVal) {
        setTimeout(() => {
          const menuEl = this.shadowRoot?.querySelector('.custom-context-menu') as HTMLElement;
          if (menuEl) {
            const firstItem = menuEl.querySelector('.context-menu-item:not(.disabled)') as HTMLElement;
            if (firstItem) {
              firstItem.focus();
            } else {
              menuEl.focus();
            }
          }
        }, 50);
      }
    }
    if (changedProperties.has('playerState')) {
      const oldState = changedProperties.get('playerState') as PlayerState | undefined;
      if (
        this.playerState.status === 'ended' &&
        !this.playerState.isLive &&
        this.displayMode !== 'vertical' &&
        (!oldState || oldState.status !== 'ended')
      ) {
        setTimeout(() => {
          const replayBtn = this.shadowRoot?.querySelector('.replay-icon-circle') as HTMLElement;
          if (replayBtn) {
            replayBtn.focus();
          }
        }, 50);
      }

      if (this.playerState.sleepTimerExpired && (!oldState || !oldState.sleepTimerExpired)) {
        this.lastFocusedElement = this.getDeepActiveElement() as HTMLElement;
        setTimeout(() => {
          const closeBtn = this.shadowRoot?.querySelector('.sleep-timer-btn-close') as HTMLElement;
          if (closeBtn) {
            closeBtn.focus();
          }
        }, 50);
      }

      if (oldState && oldState.sleepTimerExpired && !this.playerState.sleepTimerExpired) {
        setTimeout(() => {
          if (this.lastFocusedElement && typeof this.lastFocusedElement.focus === 'function') {
            this.lastFocusedElement.focus();
          } else {
            this.focus();
          }
          this.lastFocusedElement = null;
        }, 50);
      }
    }

    if (this.isPreciseSeeking) {
      const container = this.shadowRoot?.querySelector('.precise-seek-container');
      if (
        container &&
        container.clientWidth > 0 &&
        this.preciseSeekContainerWidth !== container.clientWidth
      ) {
        this.preciseSeekContainerWidth = container.clientWidth;
        this.requestUpdate();
      }
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.speedLockState = 'IDLE';
    this.isSpeedOverlayFadingOut = false;
    this.activeSpeedFeedback = null;
    this.gestures.detach();
    if (typeof window !== 'undefined') {
      window.removeEventListener('resize', this.handleResize);
    }
    this.removeEventListener('mousemove', this.handleActivity);
    this.removeEventListener('mouseleave', this.handleMouseLeave);
    this.removeEventListener('focusin', this.handleActivity);
    this.removeEventListener('keydown', this.handleKeyDown);
    this.removeEventListener('contextmenu', this.handleContextMenu);
    document.removeEventListener('click', this.handleDocumentClick);
    document.removeEventListener('focusin', this.handleFocusIn);
    this.settingsMenu.close();

    if (this.controller) {
      const plugins = this.controller.getPlugins();
      for (const p of plugins) {
        try {
          p.onPlayerDetached?.(this);
        } catch (e) {
          console.error(`[Player] Error running onPlayerDetached for plugin ${p.name}:`, e);
        }
      }
    }

    if (this.unsubscribe) this.unsubscribe();
    if (this.shortcutsUnsubscribe) this.shortcutsUnsubscribe();

    this.thumbnailCache.destroy();
    this.prefetch.cancel();

    if (this.controller) this.controller.destroy();
    this.cleanupControlsTimer();
    if (this.feedbackTimer) {
      clearTimeout(this.feedbackTimer);
      this.feedbackTimer = undefined;
    }
    this.tapFeedback = null;
    this.feedbackTaps = 0;
    if (this.playPauseFeedbackTimer) clearTimeout(this.playPauseFeedbackTimer);
    if (this.seekInteractionTimer) clearTimeout(this.seekInteractionTimer);
    if (this.speedFeedbackTimer) clearTimeout(this.speedFeedbackTimer);
    if (this.qualityFeedbackTimer) clearTimeout(this.qualityFeedbackTimer);
    if (this.volumeFeedbackTimer) clearTimeout(this.volumeFeedbackTimer);
    if (this.throttledSeekTimer) clearTimeout(this.throttledSeekTimer);
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.isDraggingSeekbar = false;
    this.filmstripThumbs.clear();
    this.gestures.endVisualTransition();
  }

  // --- Controls visibility & Autohide logic ---
  /** @internal */ getDeepActiveElement(): Element | null {
    let activeEl = document.activeElement;
    while (activeEl && activeEl.shadowRoot && activeEl.shadowRoot.activeElement) {
      activeEl = activeEl.shadowRoot.activeElement;
    }
    return activeEl;
  }

  private handleKeyDown = (e: KeyboardEvent) => {
    const deepActiveEl = this.getDeepActiveElement();

    // Intercept ArrowUp/ArrowDown for feed navigation
    if (
      this.displayMode === 'vertical' &&
      this.playerState.playlist &&
      this.playerState.playlist.length > 1
    ) {
      const hasFocus =
        deepActiveEl &&
        (this === deepActiveEl ||
          this.shadowRoot?.contains(deepActiveEl) ||
          this.contains(deepActiveEl));
      if (hasFocus) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          e.stopPropagation();
          this.gestures.throttleTransition(() => this.next());
          return;
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          e.stopPropagation();
          this.gestures.throttleTransition(() => this.previous());
          return;
        }
      }
    }

    // Handle Sleep Timer Expiration dialog navigation if open
    if (this.playerState.sleepTimerExpired) {
      const dialogEl = this.shadowRoot?.querySelector('.sleep-timer-dialog-overlay');
      if (dialogEl) {
        const buttons = Array.from(dialogEl.querySelectorAll('.sleep-timer-btn')) as HTMLElement[];
        if (buttons.length > 0) {
          const activeIndex = buttons.findIndex((btn) => btn === deepActiveEl);
          const isNext = e.key === 'ArrowRight' || e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey);
          const isPrev = e.key === 'ArrowLeft' || e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey);
          if (isNext) {
            e.preventDefault();
            e.stopPropagation();
            const nextIndex = activeIndex === -1 ? 0 : (activeIndex + 1) % buttons.length;
            buttons[nextIndex].focus();
            return;
          } else if (isPrev) {
            e.preventDefault();
            e.stopPropagation();
            const prevIndex =
              activeIndex === -1
                ? buttons.length - 1
                : (activeIndex - 1 + buttons.length) % buttons.length;
            buttons[prevIndex].focus();
            return;
          }
        }
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.handleSleepTimerClose();
      }
      // Block other hotkeys while dialog is open
      return;
    }

    // Ignore if typing in text inputs or textareas
    if (
      deepActiveEl &&
      (deepActiveEl.tagName === 'INPUT' ||
        deepActiveEl.tagName === 'TEXTAREA' ||
        deepActiveEl.tagName === 'SELECT' ||
        deepActiveEl.hasAttribute('contenteditable'))
    ) {
      return;
    }

    // Settings menu navigation (arrow keys / Tab / Escape) while it is open
    if (this.settingsMenu.handleKeyDown(e, deepActiveEl)) {
      return;
    }

    // Space on a focused button inside controls should click it, not pause/play
    if (
      e.key === ' ' &&
      deepActiveEl &&
      (deepActiveEl.tagName === 'BUTTON' || deepActiveEl.getAttribute('role') === 'button')
    ) {
      return; // Let native click occur
    }

    // Delegate keyboard event to central KeyboardManager
    this.controller.shortcuts.handleKeyDown(e);
    this.handleActivity();
  };

  private setupInteractionListeners() {
    this.addEventListener('mousemove', this.handleActivity);
    this.addEventListener('mouseleave', this.handleMouseLeave);
    this.addEventListener('focusin', this.handleActivity);
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', this.handleResize);
    }

    // Support keyboard shortcuts on focus of the player
    this.setAttribute('tabindex', '0');
    this.addEventListener('keydown', this.handleKeyDown);
  }


  /** @internal */ handleActivity = () => {
    if (this.playerState?.isAdPlaying) {
      this.cleanupControlsTimer();
      this.controlsVisible = false;
      this.classList.add('controls-hidden');
      return;
    }

    const showControlsBar =
      this.config?.controls?.controlsBar !== false && this.controlsSectionEnabled;
    if (!showControlsBar) {
      if (this.controlsVisible) {
        this.controlsVisible = false;
        this.classList.add('controls-hidden');
      }
      this.cleanupControlsTimer();
      return;
    }

    if (!this.controlsVisible) {
      this.controlsVisible = true;
      this.classList.remove('controls-hidden');
    }
    this.cleanupControlsTimer();

    // Only set autohide timer if video is playing, settings menu is closed, and user is not dragging seekbar
    if (
      this.playerState &&
      this.playerState.isPlaying &&
      !this.settingsMenuOpen &&
      !this.isDraggingSeekbar
    ) {
      this.hideControlsTimer = window.setTimeout(() => {
        this.controlsVisible = false;
        this.classList.add('controls-hidden');
      }, 2500);
    }
  };

  private handleMouseLeave = () => {
    if (this.playerState?.isAdPlaying) {
      this.cleanupControlsTimer();
      this.controlsVisible = false;
      this.classList.add('controls-hidden');
      return;
    }
    // Instantly hide if playing, settings menu is closed, and user is not dragging seekbar
    if (
      this.playerState &&
      this.playerState.isPlaying &&
      !this.settingsMenuOpen &&
      !this.isDraggingSeekbar
    ) {
      this.controlsVisible = false;
      this.classList.add('controls-hidden');
    }
  };

  private cleanupControlsTimer() {
    if (this.hideControlsTimer) {
      clearTimeout(this.hideControlsTimer);
      this.hideControlsTimer = undefined;
    }
  }

  /** @internal */ showFeedbackOverlay(type: 'rewind' | 'fastforward') {
    // If the overlay was already active in a different direction, reset the counter
    if (this.tapFeedback && this.tapFeedback !== type) {
      this.feedbackTaps = 0;
    }

    this.tapFeedback = null;
    this.requestUpdate();

    this.feedbackTaps++;

    if (this.feedbackTimer) {
      clearTimeout(this.feedbackTimer);
      this.feedbackTimer = undefined;
    }

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        this.tapFeedback = type;
        this.feedbackTimer = window.setTimeout(
          () => {
            this.tapFeedback = null;
            this.feedbackTaps = 0;
            this.feedbackTimer = undefined;
          },
          this.getOverlayTiming('seek', 800)
        );
      });
    });
  }

  private triggerPlayPauseFeedback(type: 'play' | 'pause') {
    this.playPauseFeedback = null;
    this.requestUpdate();

    if (this.playPauseFeedbackTimer) clearTimeout(this.playPauseFeedbackTimer);

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        this.playPauseFeedback = type;
        this.playPauseFeedbackTimer = window.setTimeout(
          () => {
            this.playPauseFeedback = null;
          },
          this.getOverlayTiming('play-pause', 800)
        );
      });
    });
  }

  // --- Click gestures on Video element ---
  private handleVideoClick() {
    if (this.gestures.isLongPressSpeedActive) {
      return;
    }
    // Close settings first if it was open
    if (this.settingsMenuOpen) {
      this.settingsMenu.close();
      return;
    }
    // Check if play/playButton is disabled
    if (this.config?.controls?.play === false || this.config?.controls?.playButton === false) {
      return;
    }
    // If the video has ended (standard mode only), clicking it should not just toggle play/pause,
    // it should replay the video naturally. Vertical mode auto-loops, so this isn't needed.
    if (
      this.playerState.status === 'ended' &&
      !this.playerState.isLive &&
      this.displayMode !== 'vertical'
    ) {
      this.handleReplay();
      return;
    }
    this.controller.togglePlay();
    this.handleActivity();
  }

  /** @internal */ handleReplay() {
    if (this.controller) {
      this.controller.replay();
      this.handleActivity();
    }
  }

  private handleReplayKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      this.handleReplay();
    }
  }

  private handleVideoDoubleClick(e: MouseEvent) {
    if (this.config?.controls?.seekbar === false) return;
    if (this.playerState.isLive && !this.playerState.canSeekInDvr) return;
    const isVertical = this.displayMode === 'vertical';
    const isDoubleTapEnabled = isVertical
      ? this.config?.vertical?.gestures?.doubleTapToSeek !== false
      : true;
    if (!isDoubleTapEnabled) return;
    const rect = this.videoElement.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const pct = clickX / rect.width;

    if (pct < 0.4) {
      this.controller.seekBy(-10);
      this.showFeedbackOverlay('rewind');
    } else if (pct > 0.6) {
      this.controller.seekBy(10);
      this.showFeedbackOverlay('fastforward');
    } else {
      this.controller.toggleFullscreen(this);
    }
  }

  private handleSeekBy(e: CustomEvent<{ seconds: number }>) {
    if (this.playerState.isLive && !this.playerState.canSeekInDvr) return;
    const seconds = e.detail.seconds;
    this.controller.seekBy(seconds);
    this.showFeedbackOverlay(seconds < 0 ? 'rewind' : 'fastforward');
    this.triggerSeekInteraction();
  }

  private handleSelectSpeed(speed: number) {
    this.controller.setPlaybackRate(speed);
    this.settingsMenu.close();
  }

  private getAvailableSpeeds(mode: string): number[] {
    return (
      this.config?.playback?.playbackRates ||
      (mode === 'vertical' ? VERTICAL_SPEEDS : STANDARD_SPEEDS)
    );
  }

  private handleSelectQuality(idx: number) {
    this.shouldShowQualityFeedback = true;
    this.controller.setQuality(idx);
    this.settingsMenu.close();
  }

  private handleSelectAudio(idx: number) {
    this.controller.setAudioTrack(idx);
    this.settingsMenu.close();
  }

  private handleSelectSubtitle(trackId: string | number) {
    if (trackId === -1) {
      this.controller.disableSubtitles();
    } else {
      this.controller.setSubtitleTrack(trackId);
    }
    this.settingsMenu.close();
  }

  private handleSelectSleepTimer(setting: 'off' | 10 | 15 | 20 | 30 | 45 | 60 | 'end') {
    this.controller.setSleepTimer(setting);
    this.settingsMenu.close();
  }

  private getSleepTimerLabel(): string {
    const setting = this.playerState.sleepTimerSetting;
    if (setting === 'off') return 'Off';
    if (setting === 'end') return 'End of video';
    const remaining = this.playerState.sleepTimerSecondsRemaining;
    if (remaining !== null && remaining !== undefined) {
      return `${Math.ceil(remaining / 60)} min`;
    }
    return `${setting} min`;
  }

  private getRemainingVideoTimeText(): string {
    const duration = this.playerState.duration;
    const currentTime = this.playerState.currentTime;
    const remaining = Math.max(0, duration - currentTime);
    if (isNaN(remaining) || remaining === Infinity || remaining === 0) {
      return '';
    }
    const minutes = Math.ceil(remaining / 60);
    return `${minutes} min`;
  }

  private handleSleepTimerAddTime() {
    this.controller.clearSleepTimerExpired();
    this.controlsVisible = true;
    this.classList.remove('controls-hidden');
    this.settingsMenu.open('sleeptimer');
    this.requestUpdate();
  }

  private handleSleepTimerClose() {
    this.controller.clearSleepTimerExpired();
    this.settingsMenu.close();
    this.controlsVisible = true;
    this.classList.remove('controls-hidden');
    this.requestUpdate();
  }

  private handleIconSlotChange(name: IconName, e: Event) {
    const slot = e.target as HTMLSlotElement;
    const elements = slot.assignedElements();
    if (elements.length > 0) {
      this.iconRegistry.setIcon(name, elements[0]);
      this.requestUpdate();
    }
  }

  private renderHiddenSlots() {
    const slotNames: IconName[] = [
      'play',
      'pause',
      'replay',
      'loading',
      'volume',
      'volume-mute',
      'volume-low',
      'volume-medium',
      'settings',
      'settings-vertical',
      'fullscreen',
      'fullscreen-exit',
      'pip',
      'captions',
      'seek-backward',
      'seek-forward',
      'live',
      'playlist-prev',
      'playlist-next',
      'chapters',
      'markers',
      'arrow-back',
      'arrow-forward',
      'check',
      'audio-only',
      'speed-feedback',
    ];
    return html`
      <div class="hidden-slots" style="display: none;" aria-hidden="true">
        ${slotNames.map(
      (name) => html`
            <slot
              name="icon-${name}"
              @slotchange=${(e: Event) => this.handleIconSlotChange(name, e)}
            ></slot>
          `
    )}
      </div>
    `;
  }

  private handleSelectAppearanceOption(key: keyof SubtitleAppearance, value: string | number) {
    this.controller.setSubtitleAppearance({ [key]: value } as Partial<SubtitleAppearance>);
    this.settingsMenu.goTo('subtitle-options');
  }

  private handleResetSubtitleAppearance() {
    this.controller.resetSubtitleAppearance();
    this.settingsMenu.goTo('subtitle-options');
  }

  private renderAppearanceSelectionScreen(
    title: string,
    options: Array<{ value: string | number; label: string }>,
    key: keyof SubtitleAppearance
  ) {
    const backSvg = html`<slot name="icon-arrow-back"
      >${renderIcon(this.getIcon('arrow-back'))}</slot
    >`;
    const checkSvg = html`<slot name="icon-check">${renderIcon(this.getIcon('check'))}</slot>`;
    const currentValue = this.playerState.subtitleAppearance[key];

    return html`
      <div
        class="settings-header"
        @click=${() => this.settingsMenu.goTo('subtitle-options')}
        role="button"
        aria-label=${`Back to options`}
        tabindex="0"
        @keydown=${this.settingsMenu.handleItemKey}
      >
        ${backSvg} ${title}
      </div>
      <div class="settings-list-scroll" role="menu">
        ${options.map(
      (opt) => html`
            <div
              class="settings-item"
              @click=${() => this.handleSelectAppearanceOption(key, opt.value)}
              role="menuitemradio"
              aria-checked=${currentValue === opt.value}
              tabindex="0"
              @keydown=${this.settingsMenu.handleItemKey}
            >
              <span>${opt.label}</span>
              ${currentValue === opt.value ? checkSvg : ''}
            </div>
          `
    )}
      </div>
    `;
  }

  private handleSelectChapter(idx: number) {
    this.controller.seekToChapter(idx);
  }

  private handleToggleLoop() {
    this.controller.toggleLoop();
  }

  private handleToggleAutoScroll() {
    if (this.controller) {
      this.controller.toggleAutoScroll();
    }
  }

  private showToast(message: string, type: 'success' | 'error' | 'info' = 'info') {
    this.toastMessage = message;
    this.toastType = type;
    this.toastVisible = true;

    if (this.toastTimer) {
      window.clearTimeout(this.toastTimer);
    }
    this.toastTimer = window.setTimeout(() => {
      this.toastVisible = false;
    }, 3000);
  }

  private handleRetryLoad() {
    if (this.src) {
      this.controller.loadSource({ src: this.src });
    }
  }

  private triggerVolumeFeedback(volume: number, isMuted: boolean) {
    if (this.volumeFeedbackTimer) {
      window.clearTimeout(this.volumeFeedbackTimer);
      this.volumeFeedbackTimer = undefined;
    }

    this.activeVolumeFeedback = { volume, isMuted };
    this.isVolumeFeedbackFadingOut = false;
    this.requestUpdate();

    this.volumeFeedbackTimer = window.setTimeout(() => {
      this.isVolumeFeedbackFadingOut = true;
      this.requestUpdate();

      this.volumeFeedbackTimer = window.setTimeout(() => {
        this.activeVolumeFeedback = null;
        this.isVolumeFeedbackFadingOut = false;
        this.volumeFeedbackTimer = undefined;
        this.requestUpdate();
      }, 200);
    }, 1000);
  }

  private triggerSpeedFeedback(speed: number) {
    if (this.gestures.isLongPressSpeedActive) {
      this.activeSpeedFeedback = speed;
      this.requestUpdate();
      return;
    }

    if (this.speedFeedbackTimer) {
      window.clearTimeout(this.speedFeedbackTimer);
      this.speedFeedbackTimer = undefined;
    }

    this.activeSpeedFeedback = speed;
    this.requestUpdate();

    this.speedFeedbackTimer = window.setTimeout(
      () => {
        this.activeSpeedFeedback = null;
        this.requestUpdate();
      },
      this.getOverlayTiming('speed', 800)
    );
  }

  private triggerQualityFeedback(quality: string) {
    this.activeQualityFeedback = null;
    this.requestUpdate();

    if (this.qualityFeedbackTimer) {
      window.clearTimeout(this.qualityFeedbackTimer);
      this.qualityFeedbackTimer = undefined;
    }

    requestAnimationFrame(() => {
      this.activeQualityFeedback = quality;
      this.qualityFeedbackTimer = window.setTimeout(() => {
        this.activeQualityFeedback = null;
      }, 800);
    });
  }

  private triggerSeekInteraction() {
    this.isSeekingInteraction = true;
    if (this.seekInteractionTimer) {
      window.clearTimeout(this.seekInteractionTimer);
    }
    this.seekInteractionTimer = window.setTimeout(() => {
      this.isSeekingInteraction = false;
    }, 1000);
  }

  private getVolumeFeedbackIcon(volume: number, isMuted: boolean) {
    if (isMuted || volume === 0) {
      return html`
        <svg viewBox="0 0 24 24">
          <path
            d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.21.05-.42.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"
          />
        </svg>
      `;
    }
    if (volume < 0.3) {
      return html`
        <svg viewBox="0 0 24 24">
          <path
            d="M7 9v6h4l5 5V4l-5 5H7zm11.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"
          />
        </svg>
      `;
    }
    if (volume < 0.7) {
      return html`
        <svg viewBox="0 0 24 24">
          <path
            d="M5 9v6h4l5 5V4L9 9H5zm11.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.74 2.5-2.26 2.5-4.02z"
          />
        </svg>
      `;
    }
    return html`
      <svg viewBox="0 0 24 24">
        <path
          d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"
        />
      </svg>
    `;
  }

  // --- Captions & Controls Bubbling Handlers ---
  private handleTogglePlay() {
    this.controller.togglePlay();
  }

  private handleLiveBadgeClick(e: Event) {
    e.stopPropagation();
    if (this.config?.controls?.liveEdgeButton === false || this.config?.controls?.liveBadge === false) {
      return;
    }
    if (this.playerState.isAtLiveEdge) return;
    this.controller.seekToLiveEdge();
  }

  private handleSeek(e: CustomEvent<{ time: number; isFinal: boolean }>) {
    const { time, isFinal } = e.detail;

    if (isFinal) {
      const wasDragging = this.isDraggingSeekbar;
      this.isDraggingSeekbar = false;
      this.pendingSeekTime = time;
      if (this.throttledSeekTimer) {
        window.clearTimeout(this.throttledSeekTimer);
        this.throttledSeekTimer = undefined;
      }
      this.controller.seek(time);
      if (wasDragging && this.wasPlayingBeforeDrag) {
        this.controller.play();
      }
      this.handleActivity();
    } else {
      if (!this.isDraggingSeekbar) {
        this.isDraggingSeekbar = true;
        this.wasPlayingBeforeDrag = this.playerState.isPlaying;
        if (this.playerState.isPlaying) {
          this.controller.pause();
        }
        this.settingsMenu.close();
      }
      this.controlsVisible = true;
      this.classList.remove('controls-hidden');
      this.cleanupControlsTimer();

      this.pendingSeekTime = time;
      const isContinuous = this.controller?.isContinuousUpdatesEnabled() !== false;

      if (this.isPreciseSeeking) {
        if (this.throttledSeekTimer) {
          window.clearTimeout(this.throttledSeekTimer);
          this.throttledSeekTimer = undefined;
        }
        const configPrecise = this.config?.preciseSeek;
        if (configPrecise && typeof configPrecise === 'object' && configPrecise.continuousUpdates === true) {
          this.controller.seek(time);
        }
        const container = this.shadowRoot?.querySelector('.precise-seek-container');
        if (container) {
          this.preciseSeekContainerWidth = container.clientWidth;
        }
        this.requestUpdate();
      } else {
        if (isContinuous) {
          this.controller.seek(time);
        } else if (!this.playerState.isLive && !this.throttledSeekTimer) {
          this.throttledSeekTimer = window.setTimeout(() => {
            if (this.pendingSeekTime !== null) {
              this.controller.seek(this.pendingSeekTime);
              if (!this.isDraggingSeekbar) {
                this.pendingSeekTime = null;
              }
            }
            this.throttledSeekTimer = undefined;
          }, 100); // 100ms throttle
        }
      }
    }
    this.triggerSeekInteraction();
  }

  private handlePreciseSeekChange(e: CustomEvent<{ isPreciseSeeking: boolean }>) {
    if (this.displayMode === 'vertical') {
      this.isPreciseSeeking = false;
      return;
    }
    this.isPreciseSeeking = e.detail.isPreciseSeeking;

    // Sync with thumbnail provider
    const provider = this.playerState.thumbnailProvider;
    if (provider) {
      (provider as PreciseSeekAwareThumbnailProvider).isPreciseSeeking = this.isPreciseSeeking;
    }

    if (this.isPreciseSeeking) {
      this.controlsVisible = true;
      this.classList.remove('controls-hidden');
      this.cleanupControlsTimer();

      if (this.throttledSeekTimer) {
        window.clearTimeout(this.throttledSeekTimer);
        this.throttledSeekTimer = undefined;
      }
    } else {
      this.filmstripCenterTime = -1;
    }
  }

  private renderFilmstripThumbnails() {
    if (this.displayMode === 'vertical') return html``;
    if (this.playerState.isLive && !this.playerState.canSeekInDvr) return html``;
    const provider = this.playerState.thumbnailProvider;
    if (!provider || this.playerState.duration <= 0) return html``;
    const isUnavailable = typeof provider.isUnavailable === 'function' && provider.isUnavailable();
    if (isUnavailable) return html``;

    const { start, end } = this.playerState.seekableRange || {
      start: 0,
      end: this.playerState.duration,
    };
    const spacing = 1;

    const activeTime =
      this.pendingSeekTime !== null ? this.pendingSeekTime : this.playerState.currentTime;

    if (this.filmstripCenterTime === -1) {
      this.filmstripCenterTime = Math.max(start, Math.min(Math.round(activeTime), end));
    } else {
      const diff = Math.abs(activeTime - this.filmstripCenterTime);
      if (diff >= spacing) {
        this.filmstripCenterTime = Math.max(start, Math.min(Math.round(activeTime), end));
      }
    }

    const center = this.filmstripCenterTime;
    const times: number[] = [];
    for (let i = 0; i < 11; i++) {
      const t = center + (i - 5) * spacing;
      const clampedT = Math.max(start, Math.min(t, end));
      times.push(clampedT);
    }

    const requestSource = this.playerState.currentSource;
    times.forEach((t) => {
      const bucket = Math.round(t);
      if (!this.filmstripThumbs.has(bucket)) {
        this.filmstripThumbs.set(bucket, undefined);
        const res = provider.getThumbnail(t, 'low');
        if (res instanceof Promise) {
          res
            .then((thumb) => {
              if (this.playerState.currentSource === requestSource) {
                this.filmstripThumbs.set(bucket, thumb);
                this.requestUpdate();
              }
            })
            .catch((err) => {
              console.debug('[Player] Filmstrip thumb loading error:', err);
              if (this.playerState.currentSource === requestSource) {
                this.filmstripThumbs.set(bucket, null);
                this.requestUpdate();
              }
            });
        } else {
          this.filmstripThumbs.set(bucket, res);
        }
      }
    });

    let closestIndex = 0;
    let minDiff = Infinity;
    times.forEach((t, idx) => {
      const diff = Math.abs(t - activeTime);
      if (diff < minDiff) {
        minDiff = diff;
        closestIndex = idx;
      }
    });

    const w = this.preciseSeekContainerWidth;
    const cellWidth = w >= 1056 ? (w - 48) / 7 : 144;
    const stepWidth = cellWidth + 6;
    const translateX = -(activeTime - center) * (stepWidth / spacing);

    return html`
      <div class="precise-seek-container">
        <div
          class="precise-seek-filmstrip"
          style="--cell-width: ${cellWidth}px; transform: translateX(${translateX}px);"
        >
          ${times.map((clampedT, idx) => {
            const t = clampedT;
            const bucket = Math.round(t);
            let thumb = this.filmstripThumbs.get(bucket) || null;
            if (!thumb && typeof provider.getNearestCachedThumbnail === 'function') {
              const nearest = provider.getNearestCachedThumbnail(bucket);
              if (nearest && nearest.time !== undefined && Math.abs(nearest.time - bucket) <= 5) {
                thumb = nearest;
              }
            }
            const isActive = idx === closestIndex;
            const isLoading = !thumb;

            const wVal = thumb ? (thumb.width || 200) : 200;
            const hVal = thumb ? (thumb.height || 112) : 112;
            const scale = cellWidth / wVal;
            const thumbStyle = thumb
              ? (thumb.x !== undefined
                ? `background-image: url('${thumb.url}'); background-position: -${thumb.x || 0}px -${thumb.y || 0}px; width: ${wVal}px; height: ${hVal}px; background-size: auto; transform: translate(-50%, -50%) scale(${scale}); position: absolute; left: 50%; top: 50%; transform-origin: center;`
                : `background-image: url('${thumb.url}'); width: 100%; height: 100%; background-size: cover;`)
              : '';

            return html`
              <div
                class="filmstrip-thumbnail-cell ${isActive ? 'active' : ''} ${isLoading
                  ? 'loading'
                  : ''}"
                @click=${() => this.handleFilmstripClick(t)}
              >
                ${thumb
                  ? html`
                      <div
                        class="filmstrip-thumbnail-preview"
                        style="${thumbStyle}"
                      ></div>
                    `
                  : ''}
                ${isLoading ? html`<div class="thumbnail-placeholder-shimmer"></div>` : ''}
                <div class="filmstrip-time-badge">${formatTime(t)}</div>
              </div>
            `;
          })}
        </div>
      </div>
    `;
  }

  private handleFilmstripClick(time: number) {
    if (this.isDraggingSeekbar) {
      this.pendingSeekTime = time;
      this.controller.seek(time);
      this.requestUpdate();
    } else {
      this.controller.seek(time);
      this.handleActivity();
    }
  }

  private handleToggleMute() {
    this.controller.toggleMute();
  }

  private handleVolumeChange(e: CustomEvent<{ volume: number }>) {
    this.controller.setVolume(e.detail.volume);
  }

  private handleFullscreenToggle() {
    this.controller.toggleFullscreen(this);
  }

  private handlePictureInPictureToggle() {
    this.controller.togglePictureInPicture();
  }

  private handleCaptionsToggle() {
    this.controller.toggleCaptions();
  }

  // --- Sub-menu renders ---
  private renderSettingsMenuContent() {
    const backSvg = html`<slot name="icon-arrow-back"
      >${renderIcon(this.getIcon('arrow-back'))}</slot
    >`;
    const checkSvg = html`<slot name="icon-check">${renderIcon(this.getIcon('check'))}</slot>`;
    const forwardSvg = html`<slot name="icon-arrow-forward"
      >${renderIcon(this.getIcon('arrow-forward'))}</slot
    >`;

    switch (this.activeMenuScreen) {
      case 'speed': {
        const speeds = this.getAvailableSpeeds(this.displayMode);
        return html`
          <div
            class="settings-header"
            @click=${this.settingsMenu.backToMain}
            role="button"
            aria-label="Back to main settings"
            tabindex="0"
            @keydown=${this.settingsMenu.handleItemKey}
          >
            ${backSvg} Speed
          </div>
          <div class="settings-list-scroll" role="menu">
            ${speeds.map(
          (rate: number) => html`
                <div
                  class="settings-item"
                  @click=${() => this.handleSelectSpeed(rate)}
                  role="menuitemradio"
                  aria-checked=${this.playerState.playbackRate === rate}
                  tabindex="0"
                  @keydown=${this.settingsMenu.handleItemKey}
                >
                  <span>${rate === 1.0 ? this.localize('normal', 'Normal') : `${rate}x`}</span>
                  ${this.playerState.playbackRate === rate ? checkSvg : ''}
                </div>
              `
        )}
          </div>
        `;
      }
      case 'quality':
        return html`
          <div
            class="settings-header"
            @click=${this.settingsMenu.backToMain}
            role="button"
            aria-label=${this.localize('backToSettings', 'Back to main settings')}
            tabindex="0"
            @keydown=${this.settingsMenu.handleItemKey}
          >
            ${backSvg} ${this.localize('quality', 'Quality')}
          </div>
          <div class="settings-list-scroll" role="menu">
            ${this.playerState.qualities.map((q, idx) => {
          const isSelected =
            (q === 'Auto' && this.playerState.activeQuality.startsWith('Auto')) ||
            this.playerState.activeQuality === q;
          const isHd = (() => {
            const match = q.match(/^(\d+)p$/);
            if (match) {
              const res = parseInt(match[1], 10);
              return res >= 720;
            }
            return false;
          })();

          return html`
                <div
                  class="settings-item"
                  @click=${() => this.handleSelectQuality(idx)}
                  role="menuitemradio"
                  aria-checked=${isSelected ? 'true' : 'false'}
                  tabindex="0"
                  @keydown=${this.settingsMenu.handleItemKey}
                >
                  <span style="display: flex; align-items: center; gap: 6px;">
                    ${q} ${isHd ? html`<span class="hd-badge">HD</span>` : ''}
                  </span>
                  ${isSelected ? checkSvg : ''}
                </div>
              `;
        })}
          </div>
        `;
      case 'audio':
        return html`
          <div
            class="settings-header"
            @click=${this.settingsMenu.backToMain}
            role="button"
            aria-label=${this.localize('backToSettings', 'Back to main settings')}
            tabindex="0"
            @keydown=${this.settingsMenu.handleItemKey}
          >
            ${backSvg} ${this.localize('audioDubs', 'Audio Dubs')}
          </div>
          <div class="settings-list-scroll" role="menu">
            ${this.playerState.audioTracks.map(
          (track, idx) => html`
                <div
                  class="settings-item"
                  @click=${() => this.handleSelectAudio(idx)}
                  role="menuitemradio"
                  aria-checked=${this.playerState.activeAudioTrack === idx}
                  tabindex="0"
                  @keydown=${this.settingsMenu.handleItemKey}
                >
                  <span>${track}</span>
                  ${this.playerState.activeAudioTrack === idx ? checkSvg : ''}
                </div>
              `
        )}
          </div>
        `;
      case 'subtitles': {
        const isOffSelected =
          this.playerState.activeSubtitleTrackId === null || !this.playerState.captionsEnabled;
        return html`
          <div
            class="settings-header"
            role="button"
            aria-label=${this.localize('subtitlesMenu', 'Subtitles Menu')}
            tabindex="0"
            @keydown=${this.settingsMenu.handleItemKey}
            style="display: flex; justify-content: space-between; align-items: center;"
          >
            <span
              @click=${this.settingsMenu.backToMain}
              style="display: flex; align-items: center; gap: 8px;"
              >${backSvg} ${this.localize('subtitles', 'Subtitles')}</span
            >
            <span
              @click=${(e: Event) => {
            e.stopPropagation();
            this.settingsMenu.goTo('subtitle-options');
          }}
              style="font-size: 11px; text-decoration: underline; color: var(--player-primary-color, #6366f1); cursor: pointer;"
              role="button"
              >${this.localize('options', 'Options')}</span
            >
          </div>
          <div class="settings-list-scroll" role="menu">
            <div
              class="settings-item"
              @click=${() => this.handleSelectSubtitle(-1)}
              role="menuitemradio"
              aria-checked=${isOffSelected ? 'true' : 'false'}
              tabindex="0"
              @keydown=${this.settingsMenu.handleItemKey}
            >
              <span>${this.localize('off', 'Off')}</span>
              ${isOffSelected ? checkSvg : ''}
            </div>
            ${this.playerState.subtitleTracks.map((track) => {
            const isSelected =
              !isOffSelected && this.playerState.activeSubtitleTrackId === track.id;
            return html`
                <div
                  class="settings-item"
                  @click=${() => this.handleSelectSubtitle(track.id)}
                  role="menuitemradio"
                  aria-checked=${isSelected ? 'true' : 'false'}
                  tabindex="0"
                  @keydown=${this.settingsMenu.handleItemKey}
                >
                  <span>${track.label || track.language || 'Unknown'}</span>
                  ${isSelected ? checkSvg : ''}
                </div>
              `;
          })}
          </div>
        `;
      }

      case 'subtitle-options': {
        const app = this.playerState.subtitleAppearance;
        const fontFamLabel =
          fontFamilies.find((f) => f.value === app.fontFamily)?.label || 'Default';
        const fontColorLabel = colors.find((c) => c.value === app.fontColor)?.label || 'White';
        const fontSizeLabel = fontSizes.find((s) => s.value === app.fontSize)?.label || '100%';
        const bgColorLabel = colors.find((c) => c.value === app.backgroundColor)?.label || 'Black';
        const bgOpacityLabel =
          opacities.find((o) => o.value === app.backgroundOpacity)?.label || '75%';
        const winColorLabel = colors.find((c) => c.value === app.windowColor)?.label || 'Black';
        const winOpacityLabel = opacities.find((o) => o.value === app.windowOpacity)?.label || '0%';
        const edgeLabel =
          edgeStyles.find((e) => e.value === app.characterEdgeStyle)?.label || 'None';
        const fontOpacityLabel =
          opacities.find((o) => o.value === app.fontOpacity)?.label || '100%';

        return html`
          <div
            class="settings-header"
            @click=${() => this.settingsMenu.goTo('subtitles')}
            role="button"
            aria-label=${this.localize('backToSubtitles', 'Back to subtitles')}
            tabindex="0"
            @keydown=${this.settingsMenu.handleItemKey}
          >
            ${backSvg} ${this.localize('options', 'Options')}
          </div>
          <div class="settings-list-scroll" role="menu">
            <div
              class="settings-item"
              @click=${() => this.settingsMenu.goTo('opt-font-family')}
              role="menuitem"
              tabindex="0"
              @keydown=${this.settingsMenu.handleItemKey}
            >
              <span>${this.localize('fontFamily', 'Font family')}</span>
              <span style="color: #9ca3af; display: flex; align-items: center; gap: 4px;"
                >${fontFamLabel} ${forwardSvg}</span
              >
            </div>
            <div
              class="settings-item"
              @click=${() => this.settingsMenu.goTo('opt-font-color')}
              role="menuitem"
              tabindex="0"
              @keydown=${this.settingsMenu.handleItemKey}
            >
              <span>${this.localize('fontColour', 'Font colour')}</span>
              <span style="color: #9ca3af; display: flex; align-items: center; gap: 4px;"
                >${fontColorLabel} ${forwardSvg}</span
              >
            </div>
            <div
              class="settings-item"
              @click=${() => this.settingsMenu.goTo('opt-font-size')}
              role="menuitem"
              tabindex="0"
              @keydown=${this.settingsMenu.handleItemKey}
            >
              <span>${this.localize('fontSize', 'Font size')}</span>
              <span style="color: #9ca3af; display: flex; align-items: center; gap: 4px;"
                >${fontSizeLabel} ${forwardSvg}</span
              >
            </div>
            <div
              class="settings-item"
              @click=${() => this.settingsMenu.goTo('opt-background-color')}
              role="menuitem"
              tabindex="0"
              @keydown=${this.settingsMenu.handleItemKey}
            >
              <span>${this.localize('backgroundColour', 'Background colour')}</span>
              <span style="color: #9ca3af; display: flex; align-items: center; gap: 4px;"
                >${bgColorLabel} ${forwardSvg}</span
              >
            </div>
            <div
              class="settings-item"
              @click=${() => this.settingsMenu.goTo('opt-background-opacity')}
              role="menuitem"
              tabindex="0"
              @keydown=${this.settingsMenu.handleItemKey}
            >
              <span>${this.localize('backgroundOpacity', 'Background opacity')}</span>
              <span style="color: #9ca3af; display: flex; align-items: center; gap: 4px;"
                >${bgOpacityLabel} ${forwardSvg}</span
              >
            </div>
            <div
              class="settings-item"
              @click=${() => this.settingsMenu.goTo('opt-window-color')}
              role="menuitem"
              tabindex="0"
              @keydown=${this.settingsMenu.handleItemKey}
            >
              <span>${this.localize('windowColour', 'Window colour')}</span>
              <span style="color: #9ca3af; display: flex; align-items: center; gap: 4px;"
                >${winColorLabel} ${forwardSvg}</span
              >
            </div>
            <div
              class="settings-item"
              @click=${() => this.settingsMenu.goTo('opt-window-opacity')}
              role="menuitem"
              tabindex="0"
              @keydown=${this.settingsMenu.handleItemKey}
            >
              <span>${this.localize('windowOpacity', 'Window opacity')}</span>
              <span style="color: #9ca3af; display: flex; align-items: center; gap: 4px;"
                >${winOpacityLabel} ${forwardSvg}</span
              >
            </div>
            <div
              class="settings-item"
              @click=${() => this.settingsMenu.goTo('opt-character-edge')}
              role="menuitem"
              tabindex="0"
              @keydown=${this.settingsMenu.handleItemKey}
            >
              <span>${this.localize('characterEdgeStyle', 'Character edge style')}</span>
              <span style="color: #9ca3af; display: flex; align-items: center; gap: 4px;"
                >${edgeLabel} ${forwardSvg}</span
              >
            </div>
            <div
              class="settings-item"
              @click=${() => this.settingsMenu.goTo('opt-font-opacity')}
              role="menuitem"
              tabindex="0"
              @keydown=${this.settingsMenu.handleItemKey}
            >
              <span>${this.localize('fontOpacity', 'Font opacity')}</span>
              <span style="color: #9ca3af; display: flex; align-items: center; gap: 4px;"
                >${fontOpacityLabel} ${forwardSvg}</span
              >
            </div>
            <div
              class="settings-item"
              @click=${this.handleResetSubtitleAppearance}
              role="menuitem"
              tabindex="0"
              @keydown=${this.settingsMenu.handleItemKey}
              style="color: #f87171; font-weight: 500;"
            >
              <span>${this.localize('reset', 'Reset')}</span>
            </div>
          </div>
        `;
      }

      case 'opt-font-family':
        return this.renderAppearanceSelectionScreen('Font family', fontFamilies, 'fontFamily');
      case 'opt-font-color':
        return this.renderAppearanceSelectionScreen('Font colour', colors, 'fontColor');
      case 'opt-font-size':
        return this.renderAppearanceSelectionScreen('Font size', fontSizes, 'fontSize');
      case 'opt-background-color':
        return this.renderAppearanceSelectionScreen('Background colour', colors, 'backgroundColor');
      case 'opt-background-opacity':
        return this.renderAppearanceSelectionScreen(
          'Background opacity',
          opacities,
          'backgroundOpacity'
        );
      case 'opt-window-color':
        return this.renderAppearanceSelectionScreen('Window colour', colors, 'windowColor');
      case 'opt-window-opacity':
        return this.renderAppearanceSelectionScreen('Window opacity', opacities, 'windowOpacity');
      case 'opt-character-edge':
        return this.renderAppearanceSelectionScreen(
          'Character edge style',
          edgeStyles,
          'characterEdgeStyle'
        );
      case 'opt-font-opacity':
        return this.renderAppearanceSelectionScreen('Font opacity', opacities, 'fontOpacity');

      case 'sleeptimer': {
        const isLive = Boolean(this.playerState?.isLive);
        const sleepPresets = this.config?.sleepTimer?.presets || [10, 15, 20, 30, 45, 60];
        const sleepOptions = [
          { value: 'off', label: this.localize('off', 'Off') },
          ...sleepPresets.map((p: number) => ({ value: p, label: `${p} ${this.localize('minutes', 'minutes')}` })),
          ...(!isLive ? [{ value: 'end', label: this.localize('endOfVideo', 'End of video') }] : []),
        ];
        return html`
          <div
            class="settings-header"
            @click=${this.settingsMenu.backToMain}
            role="button"
            aria-label=${this.localize('backToSettings', 'Back to main settings')}
            tabindex="0"
            @keydown=${this.settingsMenu.handleItemKey}
          >
            ${backSvg} ${this.localize('sleepTimer', 'Sleep Timer')}
          </div>
          <div class="settings-list-scroll" role="menu">
            ${sleepOptions.map((opt) => {
          const isSelected = this.playerState.sleepTimerSetting === opt.value;
          return html`
                <div
                  class="settings-item"
                  @click=${() =>
                    this.handleSelectSleepTimer(
                      opt.value as 'off' | 10 | 15 | 20 | 30 | 45 | 60 | 'end'
                    )}
                  role="menuitemradio"
                  aria-checked=${isSelected ? 'true' : 'false'}
                  tabindex="0"
                  @keydown=${this.settingsMenu.handleItemKey}
                >
                  ${opt.value === 'end'
              ? html`
                        <span
                          style="display: flex; flex-direction: column; align-items: flex-start;"
                        >
                          <span>${opt.label}</span>
                          ${this.getRemainingVideoTimeText()
                  ? html`<span style="font-size: 11px; color: #9ca3af; margin-top: 2px;">
                                ${this.getRemainingVideoTimeText()}
                              </span>`
                  : ''}
                        </span>
                      `
              : html`<span>${opt.label}</span>`}
                  ${isSelected ? checkSvg : ''}
                </div>
              `;
        })}
          </div>
        `;
      }
      case 'chapters': {
        return html`
          <div
            class="settings-header"
            @click=${this.settingsMenu.backToMain}
            role="button"
            aria-label=${this.localize('backToSettings', 'Back to main settings')}
            tabindex="0"
            @keydown=${this.settingsMenu.handleItemKey}
          >
            ${backSvg} ${this.localize('chapters', 'Chapters')}
          </div>
          <div class="settings-list-scroll" role="menu">
            ${this.playerState.chapters.map(
              (chapter, idx) => html`
                <div
                  class="settings-item"
                  @click=${() => {
                    this.handleSelectChapter(idx);
                    this.settingsMenu.close();
                  }}
                  role="menuitemradio"
                  aria-checked=${this.playerState.activeChapterIndex === idx}
                  tabindex="0"
                  @keydown=${this.settingsMenu.handleItemKey}
                >
                  <span style="display: flex; flex-direction: column; align-items: flex-start;">
                    <span>${chapter.title}</span>
                    <span style="font-size: 11px; color: #9ca3af; margin-top: 2px;">
                      ${formatTime(chapter.startTime)}
                    </span>
                  </span>
                  ${this.playerState.activeChapterIndex === idx ? checkSvg : ''}
                </div>
              `
            )}
          </div>
        `;
      }

      default: {
        if (this.customSettingsScreens.has(this.activeMenuScreen)) {
          try {
            const renderer = this.customSettingsScreens.get(this.activeMenuScreen);
            if (renderer) {
              const res = renderer(this, () => this.settingsMenu.backToMain());
              if (res) return res;
            }
          } catch (e) {
            console.error(
              `[Player] Error rendering custom settings screen ${this.activeMenuScreen}:`,
              e
            );
          }
        }

        if (this.controller) {
          const activePlugins = this.controller.getPlugins();
          for (const p of activePlugins) {
            if (p.renderSettingsScreen) {
              const customScreen = p.renderSettingsScreen(
                this.activeMenuScreen,
                this.controller,
                () => this.settingsMenu.backToMain()
              );
              if (customScreen) return customScreen;
            }
          }
        }

        const currentSpeedText =
          this.playerState.playbackRate === 1 ? this.localize('normal', 'Normal') : `${this.playerState.playbackRate}x`;

        const configControls = this.config?.controls || {};
        const isVertical = this.displayMode === 'vertical';
        const verticalMenus = this.config?.vertical?.menus;

        const isSpeedEnabled =
          isVertical && verticalMenus?.playbackSpeed !== undefined
            ? verticalMenus.playbackSpeed
            : configControls.playbackSpeed !== false;

        const isQualityEnabled =
          isVertical && verticalMenus?.quality !== undefined
            ? verticalMenus.quality
            : configControls.quality !== false;

        const isAudioEnabled =
          isVertical && verticalMenus?.audioTracks !== undefined
            ? verticalMenus.audioTracks
            : configControls.audioTracks !== false;

        const isSubtitlesEnabled =
          isVertical && verticalMenus?.subtitles !== undefined
            ? verticalMenus.subtitles
            : configControls.subtitles !== false;

        const isSleepTimerEnabled =
          isVertical && verticalMenus?.sleepTimer !== undefined
            ? verticalMenus.sleepTimer
            : configControls.sleepTimer !== false;

        const isLoopEnabled =
          configControls.loop !== false &&
          this.config?.playback?.loop !== false;

        const isAutoScrollEnabled =
          isVertical && verticalMenus?.autoScroll !== undefined
            ? verticalMenus.autoScroll
            : configControls.autoScroll !== false;

        const isChaptersEnabled =
          isVertical && verticalMenus?.chapters !== undefined
            ? verticalMenus.chapters
            : configControls.chapters === true;

        const pluginItems: PluginSettingsItem[] = [];
        if (this.controller) {
          const activePlugins = this.controller.getPlugins();
          for (const p of activePlugins) {
            if (p.getSettingsItems) {
              const items = p.getSettingsItems(this.controller);
              if (items) pluginItems.push(...items);
            }
          }
        }

        const normalizedOrder = (this.config?.settings?.order || [
          'speed',
          'quality',
          'audioTracks',
          'subtitles',
          'autoScroll',
          'sleepTimer',
          'loop'
        ]).map((key: string) => {
          if (key === 'captions') return 'subtitles';
          if (key === 'playbackSpeed') return 'speed';
          if (key === 'audio') return 'audioTracks';
          return key;
        });

        const itemsMap = new Map<string, TemplateResult>();

        if (isSpeedEnabled) {
          itemsMap.set('speed', html`
            <div
              class="settings-item"
              @click=${() => this.settingsMenu.goTo('speed')}
              role="menuitem"
              tabindex="0"
              @keydown=${this.settingsMenu.handleItemKey}
            >
              <span>${this.localize('playbackSpeed', 'Playback Speed')}</span>
              <span style="color: #9ca3af; display: flex; align-items: center; gap: 4px;">
                ${currentSpeedText} ${forwardSvg}
              </span>
            </div>
          `);
        }

        if (isQualityEnabled && this.playerState.qualities.length > 0) {
          itemsMap.set('quality', html`
            <div
              class="settings-item"
              @click=${() => this.settingsMenu.goTo('quality')}
              role="menuitem"
              tabindex="0"
              @keydown=${this.settingsMenu.handleItemKey}
            >
              <span>${this.localize('quality', 'Quality')}</span>
              <span style="color: #9ca3af; display: flex; align-items: center; gap: 4px;">
                ${this.playerState.activeQuality} ${forwardSvg}
              </span>
            </div>
          `);
        }

        if (isAudioEnabled && this.playerState.audioTracks.length > 1) {
          itemsMap.set('audioTracks', html`
            <div
              class="settings-item"
              @click=${() => this.settingsMenu.goTo('audio')}
              role="menuitem"
              tabindex="0"
              @keydown=${this.settingsMenu.handleItemKey}
            >
              <span>${this.localize('audioDubs', 'Audio Dubs')}</span>
              <span style="color: #9ca3af; display: flex; align-items: center; gap: 4px;">
                ${this.playerState.audioTracks[this.playerState.activeAudioTrack] ||
            'Default'}
                ${forwardSvg}
              </span>
            </div>
          `);
        }

        if (isSubtitlesEnabled && this.playerState.subtitleTracks.length > 0) {
          itemsMap.set('subtitles', html`
            <div
              class="settings-item"
              @click=${() => this.settingsMenu.goTo('subtitles')}
              role="menuitem"
              tabindex="0"
              @keydown=${this.settingsMenu.handleItemKey}
            >
              <span>${this.localize('subtitles', 'Subtitles')}</span>
              <span class="settings-item-value">
                <span>
                  ${this.playerState.activeSubtitleTrackId === null ||
                !this.playerState.captionsEnabled
                ? this.localize('off', 'Off')
                : this.playerState.subtitleTracks.find(
                  (t) => t.id === this.playerState.activeSubtitleTrackId
                )?.label || this.localize('on', 'On')}
                </span>
                ${forwardSvg}
              </span>
            </div>
          `);
        }

        if (isChaptersEnabled && this.playerState.chapters.length > 0) {
          const currentChapter = this.playerState.chapters[this.playerState.activeChapterIndex];
          const currentChapterTitle = currentChapter ? currentChapter.title : 'None';
          itemsMap.set('chapters', html`
            <div
              class="settings-item"
              @click=${() => this.settingsMenu.goTo('chapters')}
              role="menuitem"
              tabindex="0"
              @keydown=${this.settingsMenu.handleItemKey}
            >
              <span>${this.localize('chapters', 'Chapters')}</span>
              <span style="color: #9ca3af; display: flex; align-items: center; gap: 4px;">
                ${currentChapterTitle} ${forwardSvg}
              </span>
            </div>
          `);
        }

        const isPipMenuEnabled =
          this.config?.settings?.pictureInPicture === true || this.config?.settings?.pip === true;
        if (isPipMenuEnabled) {
          itemsMap.set('pictureInPicture', html`
            <div
              class="settings-item"
              @click=${() => {
                this.handlePictureInPictureToggle();
                this.settingsMenu.close();
              }}
              role="menuitemcheckbox"
              aria-checked=${this.playerState.pictureInPicture}
              tabindex="0"
              @keydown=${this.settingsMenu.handleItemKey}
            >
              <span>${this.localize('pictureInPicture', 'Picture in Picture')}</span>
              <span class="settings-toggle ${this.playerState.pictureInPicture ? 'active' : ''}"></span>
            </div>
          `);
        }

        const isFullscreenMenuEnabled =
          this.config?.settings?.fullscreen === true;
        if (isFullscreenMenuEnabled) {
          itemsMap.set('fullscreen', html`
            <div
              class="settings-item"
              @click=${() => {
                this.handleFullscreenToggle();
                this.settingsMenu.close();
              }}
              role="menuitemcheckbox"
              aria-checked=${this.playerState.isFullscreen}
              tabindex="0"
              @keydown=${this.settingsMenu.handleItemKey}
            >
              <span>${this.localize('fullscreen', 'Fullscreen')}</span>
              <span class="settings-toggle ${this.playerState.isFullscreen ? 'active' : ''}"></span>
            </div>
          `);
        }

        if (this.displayMode === 'vertical') {
          if (isAutoScrollEnabled) {
            itemsMap.set('autoScroll', html`
              <div
                class="settings-item"
                @click=${this.handleToggleAutoScroll}
                role="menuitemcheckbox"
                aria-checked=${this.autoScroll}
                tabindex="0"
                @keydown=${this.settingsMenu.handleItemKey}
              >
                <span>${this.localize('autoScroll', 'Auto Scroll')}</span>
                <span class="settings-toggle ${this.autoScroll ? 'active' : ''}"></span>
              </div>
            `);
          }
        } else {
          if (isSleepTimerEnabled) {
            itemsMap.set('sleepTimer', html`
              <div
                class="settings-item"
                @click=${() => this.settingsMenu.goTo('sleeptimer')}
                role="menuitem"
                tabindex="0"
                @keydown=${this.settingsMenu.handleItemKey}
              >
                <span>${this.localize('sleepTimer', 'Sleep Timer')}</span>
                <span
                  style="color: #9ca3af; display: flex; align-items: center; gap: 4px;"
                >
                  ${this.getSleepTimerLabel()} ${forwardSvg}
                </span>
              </div>
            `);
          }

          if (isLoopEnabled) {
            itemsMap.set('loop', html`
              <div
                class="settings-item"
                @click=${this.handleToggleLoop}
                role="menuitemcheckbox"
                aria-checked=${this.playerState.loop}
                tabindex="0"
                @keydown=${this.settingsMenu.handleItemKey}
              >
                <span>${this.localize('loopVideo', 'Loop Video')}</span>
                <span
                  class="settings-toggle ${this.playerState.loop ? 'active' : ''}"
                ></span>
              </div>
            `);
          }
        }

        pluginItems.forEach((item) => {
          const itemHtml = html`
            <div
              class="settings-item"
              @click=${item.onClick}
              role="menuitem"
              tabindex="0"
              @keydown=${item.onKeyDown || this.settingsMenu.handleItemKey}
            >
              <span>${item.label}</span>
              <span style="color: #9ca3af; display: flex; align-items: center; gap: 4px;">
                ${item.valueLabel || ''} ${forwardSvg}
              </span>
            </div>
          `;
          itemsMap.set(item.id, itemHtml);
        });

        this.customSettingsItems.forEach((item, index) => {
          const itemHtml = html`
            <div
              class="settings-item"
              @click=${() => item.onClick(this)}
              role="menuitem"
              tabindex="0"
              @keydown=${this.settingsMenu.handleItemKey}
            >
              <span>${item.label}</span>
              <span style="color: #9ca3af; display: flex; align-items: center; gap: 4px;">
                ${item.valueLabel || ''} ${forwardSvg}
              </span>
            </div>
          `;
          itemsMap.set(item.id || `custom-${index}`, itemHtml);
        });

        const legacyCustomItems = (
          this.config as unknown as { customItems?: StaticCustomSettingsItem[] } | undefined
        )?.customItems;
        const staticCustomItems: StaticCustomSettingsItem[] =
          this.config?.settings?.customItems || legacyCustomItems || [];
        if (Array.isArray(staticCustomItems)) {
          staticCustomItems.forEach((item: StaticCustomSettingsItem, index: number) => {
            const itemHtml = html`
              <div
                class="settings-item"
                @click=${() => {
                  if (typeof item.onClick === 'function') {
                    item.onClick(this);
                  }
                }}
                role="menuitem"
                tabindex="0"
                @keydown=${this.settingsMenu.handleItemKey}
              >
                <span>${item.label}</span>
                <span style="color: #9ca3af; display: flex; align-items: center; gap: 4px;">
                  ${item.valueLabel || ''} ${forwardSvg}
                </span>
              </div>
            `;
            itemsMap.set(item.id || `static-custom-${index}`, itemHtml);
          });
        }

        const renderedItems: TemplateResult[] = [];
        const settingsGroups = this.config?.settings?.groups;

        if (settingsGroups && typeof settingsGroups === 'object') {
          Object.entries(settingsGroups).forEach(([groupName, itemKeys]) => {
            if (!Array.isArray(itemKeys)) return;
            const groupItems: TemplateResult[] = [];
            itemKeys.forEach((key) => {
              const item = itemsMap.get(key);
              if (item) {
                groupItems.push(item);
                itemsMap.delete(key);
              }
            });

            if (groupItems.length > 0) {
              const groupHeading = html`
                <div class="settings-group-header" part="settings-group-header">
                  ${this.localize(groupName, groupName)}
                </div>
              `;
              renderedItems.push(groupHeading, ...groupItems);
            }
          });

          for (const item of itemsMap.values()) {
            renderedItems.push(item);
          }
        } else {
          normalizedOrder.forEach((key: string) => {
            const item = itemsMap.get(key);
            if (item) {
              renderedItems.push(item);
              itemsMap.delete(key);
            }
          });

          for (const item of itemsMap.values()) {
            renderedItems.push(item);
          }
        }

        return html`
          <div class="settings-list-scroll" role="menu">
            ${renderedItems}
          </div>
        `;
      }
    }
  }

  public setTheme(theme: NonNullable<PlayerConfiguration['theme']>) {
    if (this.controller) {
      this.controller.updateConfig({ theme });
    } else {
      this.config = {
        ...(this.config || {}),
        theme,
      };
    }
  }

  public registerPlugin(plugin: PlayerPlugin) {
    if (this.controller) {
      this.controller.use(plugin);
    } else {
      const config = this.config || {};
      const plugins = config.plugins || [];
      plugins.push(plugin);
      this.config = { ...config, plugins };
    }
  }

  private applyTheme(themeConfig?: PlayerConfiguration['theme']) {
    const allKeys = [
      '--player-primary-color',
      '--player-accent-color',
      '--player-bg-color',
      '--player-text-color',
      '--player-glass-bg',
      '--player-glass-border',
      '--player-glass-shadow',
      '--player-menu-bg',
      '--player-seekbar-bg',
      '--player-seekbar-buffer',
      '--tooltip-bg',
      '--player-tooltip-color',
      '--marker-color-default',
      '--player-border-radius',
      '--player-font-family',
      '--player-cue-font-size',
      '--player-glass-blur',
      '--player-glass-blur-webkit',
      '--player-shadow',
      '--player-spacing',
      '--player-transition-duration',
      '--player-primary-glow',
      '--player-glass-panel',
      '--player-button-color',
      '--player-button-hover-color',
      '--player-button-hover-bg',
      '--player-button-icon-size',
      '--player-volume-played-bg',
      '--player-volume-unplayed-bg',
      '--player-vertical-max-width',
      '--player-overlay-bg',
      '--player-live-badge-live-bg',
      '--player-live-badge-live-border',
      '--player-live-badge-live-color',
      '--player-live-badge-behind-bg',
      '--player-live-badge-behind-border',
      '--player-live-badge-behind-color',
      '--player-seekbar-played',
      '--player-preview-border-color',
      '--player-preview-border-width',
      '--player-preview-border-radius',
      '--player-preview-shadow',
      '--player-preview-bg',
      '--player-preview-time-bg',
      '--player-preview-time-color',
      '--player-preview-time-font',
      '--player-preview-time-size',
      '--player-preview-width',
      '--player-preview-height',
      '--player-preview-offset',
      '--player-preview-animation',
      '--player-preview-opacity',
      '--player-preview-blur',
      '--player-preview-arrow-color',
      '--player-preview-arrow-size',
      '--player-preview-arrow-visible',
      '--player-preview-transition',
      '--player-preview-z-index',
      '--player-preview-padding',
      '--player-preview-spacing',
      '--player-preview-backdrop-filter',
      '--player-preview-vertical-width',
      '--player-preview-vertical-height',
    ];

    if (!themeConfig || Object.keys(themeConfig).length === 0) {
      for (const key of allKeys) {
        this.style.removeProperty(key);
      }
      return;
    }

    const compiled = compileTheme(themeConfig);
    for (const [key, value] of Object.entries(compiled)) {
      this.style.setProperty(key, value);
    }
  }

  private getControlsLayout(): { groups: Record<string, string[]>; layout: string[] } {
    const defaultGroups: Record<string, string[]> = {
      left: ['play-button', 'seek-backward', 'seek-forward', 'volume-control', 'live-badge'],
      center: [],
      right: ['chapters-btn', 'caption-btn', 'settings-btn', 'pip-btn', 'fullscreen-btn'],
    };
    const defaultLayout = ['left', 'center', 'right'];

    // Collect all plugin buttons and their positions
    const pluginButtonsByPosition: Record<string, string[]> = { left: [], center: [], right: [] };
    if (this.controller) {
      const plugins = this.controller.getPlugins();
      for (const p of plugins) {
        if (p.getControlButtons) {
          try {
            const buttons = p.getControlButtons(this.controller);
            if (buttons) {
              for (const b of buttons) {
                const pos = b.position || 'center';
                if (!pluginButtonsByPosition[pos]) {
                  pluginButtonsByPosition[pos] = [];
                }
                pluginButtonsByPosition[pos].push(b.id);
              }
            }
          } catch (e) {
            console.error('[Player] Error getting plugin buttons:', e);
          }
        }
      }
    }

    // Get config overrides
    const configControls = this.config?.controls || {};
    const configGroups = configControls.groups;
    const configLayout = configControls.layout;

    if (configGroups || configLayout) {
      const groups: Record<string, string[]> = {};

      // Initialize groups with configGroups
      if (configGroups) {
        for (const [gName, gControls] of Object.entries(configGroups)) {
          groups[gName] = [...(gControls || [])];
        }
      }

      // Fill in default groups if not specified in configGroups
      for (const [gName, defControls] of Object.entries(defaultGroups)) {
        if (!groups[gName]) {
          groups[gName] = [...defControls];
        }
      }

      // Auto-append any plugin buttons that aren't placed anywhere
      const allAssigned = new Set<string>();
      for (const gControls of Object.values(groups)) {
        for (const cId of gControls) {
          allAssigned.add(cId);
        }
      }

      for (const [pos, pButtons] of Object.entries(pluginButtonsByPosition)) {
        for (const bId of pButtons) {
          if (!allAssigned.has(bId)) {
            const targetPos = groups[pos] ? pos : 'center';
            if (!groups[targetPos]) groups[targetPos] = [];
            groups[targetPos].push(bId);
            allAssigned.add(bId);
          }
        }
      }

      const layout = configLayout || Object.keys(groups);
      return { groups, layout };
    }

    // Fallback/backward compatibility for config.controls.order
    if (configControls.order) {
      const order = configControls.order;
      const left: string[] = [];
      const center: string[] = [];
      const right: string[] = [];

      const defaultLeft = defaultGroups.left;
      const defaultRight = defaultGroups.right;

      for (const id of order) {
        if (this.isPluginControlForPosition(id, 'left')) {
          left.push(id);
        } else if (this.isPluginControlForPosition(id, 'right')) {
          right.push(id);
        } else if (this.isPluginControlForPosition(id, 'center')) {
          center.push(id);
        } else if (defaultLeft.includes(id)) {
          left.push(id);
        } else if (defaultRight.includes(id)) {
          right.push(id);
        } else {
          center.push(id);
        }
      }

      // Auto-append plugin buttons not in order
      const allInOrder = new Set(order);
      for (const [pos, pButtons] of Object.entries(pluginButtonsByPosition)) {
        for (const bId of pButtons) {
          if (!allInOrder.has(bId)) {
            if (pos === 'left') left.push(bId);
            else if (pos === 'right') right.push(bId);
            else center.push(bId);
          }
        }
      }

      return {
        groups: { left, center, right },
        layout: defaultLayout,
      };
    }

    // Default structure: defaultGroups + all registered plugin buttons
    const groups: Record<string, string[]> = {};
    for (const [gName, defControls] of Object.entries(defaultGroups)) {
      groups[gName] = [...defControls];
      const pButtons = pluginButtonsByPosition[gName] || [];
      for (const bId of pButtons) {
        if (!groups[gName].includes(bId)) {
          groups[gName].push(bId);
        }
      }
    }

    return { groups, layout: defaultLayout };
  }

  private renderControlsGroup(groupName: string, controlIds: string[]) {
    const classes = ['controls-group', `${groupName}-controls`].join(' ');
    return html`
      <div class="${classes}" part="controls-group controls-group-${groupName}">
        <slot name="${groupName}-controls-before"></slot>
        ${groupName === 'center' ? html`<slot name="center-controls"></slot>` : ''}
        ${controlIds.map((id) => this.renderControlOrPlugin(id))}
        <slot name="${groupName}-controls-after"></slot>
      </div>
    `;
  }

  private renderLeftControls() {
    const { groups } = this.getControlsLayout();
    return html`
      <slot name="left-controls-before"></slot>
      ${(groups.left || []).map((k: string) => this.renderControlOrPlugin(k))}
      <slot name="left-controls-after"></slot>
    `;
  }

  private renderRightControls() {
    const { groups } = this.getControlsLayout();
    return html`
      <slot name="right-controls-before"></slot>
      ${(groups.right || []).map((k: string) => this.renderControlOrPlugin(k))}
      <slot name="right-controls-after"></slot>
    `;
  }

  private renderCenterControls() {
    const { groups } = this.getControlsLayout();
    return html`
      <slot name="center-controls-before"></slot>
      <slot name="center-controls"></slot>
      ${(groups.center || []).map((k: string) => this.renderControlOrPlugin(k))}
      <slot name="center-controls-after"></slot>
    `;
  }

  private isPluginControlForPosition(key: string, position: 'left' | 'center' | 'right'): boolean {
    if (!this.controller) return false;
    const plugins = this.controller.getPlugins();
    for (const p of plugins) {
      if (p.getControlButtons) {
        const buttons = p.getControlButtons(this.controller);
        if (buttons && buttons.some((b) => b.id === key && b.position === position)) {
          return true;
        }
      }
    }
    return false;
  }

  public exportConfig(): PlayerConfiguration {
    if (this.controller) {
      return this.controller.exportConfig();
    }
    return {};
  }

  public updateConfig(newConfig: Partial<PlayerConfiguration>) {
    if (this.controller) {
      this.controller.updateConfig(newConfig);
    }
  }

  public registerSettingsItem(item: {
    id: string;
    label: string;
    valueLabel?: string;
    onClick: (player: PlayerPlayer) => void;
  }) {
    if (!this.customSettingsItems.some((i) => i.id === item.id)) {
      this.customSettingsItems.push(item);
      this.requestUpdate();
    }
  }

  public registerSettingsScreen(
    screenId: string,
    renderer: (player: PlayerPlayer, onBack: () => void) => unknown
  ) {
    this.customSettingsScreens.set(screenId, renderer);
    this.requestUpdate();
  }

  public registerContextMenuItem(item: {
    label: string;
    onClick: (player: PlayerPlayer) => void;
    disabled?: boolean;
  }) {
    this.customContextMenuItems.push(item);
  }

  public disableContextMenu() {
    this.isContextMenuDisabled = true;
  }

  // --- Context Menu Handlers ---

  private handleContextMenu = (e: MouseEvent) => {
    if (this.isContextMenuDisabled || this.config?.controls?.contextMenu === false) {
      e.preventDefault();
      return;
    }
    const rect = this.getBoundingClientRect();
    this.contextMenuX = e.clientX - rect.left;
    this.contextMenuY = e.clientY - rect.top;
    this.contextMenuOpen = true;
  };

  private handleDocumentClick = (e: MouseEvent) => {
    if (this.contextMenuOpen) {
      this.contextMenuOpen = false;
    }

    this.settingsMenu.closeIfOutside(e);
  };

  private handleFocusIn = (e: FocusEvent) => {
    this.settingsMenu.closeIfOutside(e);
  };

  private handleContextMenuItemClick(item: {
    label: string;
    onClick: (player: PlayerPlayer) => void;
    disabled?: boolean;
  }) {
    if (item.disabled) return;
    try {
      item.onClick(this);
    } catch (e) {
      console.error(`[Player] Error executing context menu item "${item.label}":`, e);
    }
    this.contextMenuOpen = false;
  }

  private handleContextMenuKeyDown(e: KeyboardEvent) {
    if (!this.contextMenuOpen) return;

    if (e.key === 'Escape' || e.key === 'Tab') {
      e.preventDefault();
      e.stopPropagation();
      this.contextMenuOpen = false;
      this.focus();
      return;
    }

    const items = Array.from(
      this.shadowRoot?.querySelectorAll('.custom-context-menu .context-menu-item') || []
    ) as HTMLElement[];
    if (items.length === 0) return;

    const activeEl = this.shadowRoot?.activeElement as HTMLElement;
    const activeIndex = items.indexOf(activeEl);

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      e.stopPropagation();
      const nextIndex = activeIndex === -1 ? 0 : (activeIndex + 1) % items.length;
      items[nextIndex].focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      const prevIndex =
        activeIndex === -1 ? items.length - 1 : (activeIndex - 1 + items.length) % items.length;
      items[prevIndex].focus();
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      if (activeIndex !== -1) {
        items[activeIndex].click();
      }
    }
  }

  private getContextMenuItems() {
    return [
      {
        label: `Player SDK v1.1.0`,
        onClick: () => { },
        disabled: true,
      },
      ...this.customContextMenuItems,
    ];
  }

  public renderControlOrPlugin(key: string) {
    if (this.customControls.has(key)) {
      try {
        const renderFn = this.customControls.get(key);
        if (renderFn) {
          return renderFn(this);
        }
      } catch (e) {
        console.error('[Player] Error rendering custom control:', key, e);
      }
    }

    const std = this.renderControl(key);
    if (std !== '') return std;

    if (!this.controller) return '';
    const plugins = this.controller.getPlugins();
    for (const p of plugins) {
      if (p.getControlButtons) {
        const buttons = p.getControlButtons(this.controller);
        const match = buttons?.find((b) => b.id === key);
        if (match) {
          try {
            return match.render();
          } catch (e) {
            console.error('[Player] Error rendering plugin button:', key, e);
          }
        }
      }
    }
    return '';
  }
  private getOverlayTiming(id: string, defaultTiming: number): number {
    const registered = this.customOverlays.get(id);
    const configVal = this.config?.overlays?.[id];

    if (configVal && typeof configVal === 'object' && configVal.timing !== undefined) {
      return configVal.timing;
    }
    if (registered && registered.timing !== undefined) {
      return registered.timing;
    }
    return defaultTiming;
  }

  /** @internal */ isOverlayEnabled(id: string): boolean {
    const registered = this.customOverlays.get(id);
    const configVal = this.config?.overlays?.[id];
    const configControls = this.config?.controls || {};

    if (configVal === false) return false;
    if (registered && registered.enabled === false) return false;
    if (configVal && typeof configVal === 'object' && configVal.enabled === false) return false;

    // Connect top-level controls configurations
    if (id === 'replay' && configControls.replayButton === false) return false;
    if ((id === 'loading' || id === 'buffering') && configControls.loadingSpinner === false) return false;
    if (id === 'live' && (configControls.liveBadge === false || configControls.liveEdgeButton === false)) return false;
    if (id === 'center-play' && (configControls.play === false || configControls.playButton === false)) return false;

    if (
      (id === 'play-pause' || id === 'seek' || id === 'speed') &&
      configControls.feedbackOverlay === false
    ) {
      return false;
    }
    if (id === 'play-pause') {
      if (this.playPauseFeedback === 'play' && (configControls.play === false || configControls.playButton === false)) return false;
      if (this.playPauseFeedback === 'pause' && configControls.pause === false) return false;
    }
    if (id === 'seek' && configControls.seekbar === false) return false;
    if (id === 'speed' && configControls.playbackSpeed === false) return false;
    if (id === 'volume' && (configControls.volumeOverlay === false || configControls.volume === false || configControls.mute === false)) return false;

    return true;
  }

  private renderOverlay(
    id: string,
    defaultRenderer: (
      player: PlayerPlayer,
      context?: unknown
    ) => TemplateResult | string | Element | unknown,
    context?: unknown
  ): TemplateResult | string | Element | unknown {
    if (!this.isOverlayEnabled(id)) return '';

    const registered = this.customOverlays.get(id);
    const configVal = this.config?.overlays?.[id];
    const configObj = configVal && typeof configVal === 'object' ? configVal : {};

    let renderer = defaultRenderer;
    if (configObj.template) {
      renderer = configObj.template as (
        player: PlayerPlayer,
        context?: unknown
      ) => TemplateResult | string | Element | unknown;
    } else if (registered && registered.template) {
      renderer = registered.template as (
        player: PlayerPlayer,
        context?: unknown
      ) => TemplateResult | string | Element | unknown;
    }

    const positionClass = configObj.position || registered?.position || '';
    const animationClass = configObj.animation || registered?.animation || '';
    const customStyle = configObj.style || registered?.style || {};

    const styleStr =
      typeof customStyle === 'string'
        ? customStyle
        : Object.entries(customStyle)
          .map(([k, v]) => `${k}:${v}`)
          .join(';');

    try {
      const rendered = renderer(this, context);
      if (!rendered) return '';

      if (positionClass || animationClass || styleStr) {
        return html`
          <div
            class="custom-overlay-wrap ${positionClass} ${animationClass}"
            style="${styleStr || undefined}"
          >
            ${rendered}
          </div>
        `;
      }
      return rendered;
    } catch (e) {
      console.error(`[Player] Error rendering overlay ${id}:`, e);
      return '';
    }
  }

  private renderCustomOverlays() {
    const defaultOverlays = [
      'loading',
      'buffering',
      'replay',
      'play-pause',
      'seek',
      'volume',
      'speed',
      'error',
      'poster',
      'live',
      'ads',
      'center-play',
    ];
    const customList = [];
    for (const [id, options] of this.customOverlays.entries()) {
      if (!defaultOverlays.includes(id)) {
        customList.push(this.renderOverlay(id, options.template || (() => '')));
      }
    }
    return customList;
  }

  private renderDefaultBufferingOverlay(player: PlayerPlayer) {
    const { isBuffering, error } = player.playerState;
    if (!isBuffering || error) return '';
    return html`
      <div class="buffering-overlay" aria-label="Buffering video" role="status">
        <slot name="icon-loading">
          ${player.getIcon('loading')
        ? renderIcon(player.getIcon('loading')!)
        : html`<div class="premium-spinner"></div>`}
        </slot>
      </div>
    `;
  }

  private renderDefaultReplayOverlay(player: PlayerPlayer) {
    const { status, isLive, loop } = player.playerState;
    if (status !== 'ended' || isLive || player.displayMode === 'vertical' || loop) return '';
    return html`
      <div class="replay-overlay" @click=${player.handleReplay}>
        <div
          class="replay-icon-circle"
          role="button"
          aria-label="Replay video"
          tabindex="0"
          @keydown=${player.handleReplayKeyDown}
        >
          <slot name="icon-replay"> ${renderIcon(player.getIcon('replay')!)} </slot>
        </div>
      </div>
    `;
  }

  private renderDefaultPlayPauseOverlay(player: PlayerPlayer) {
    if (!player.playPauseFeedback) return '';
    return html`
      <div class="feedback-overlay center-feedback" aria-hidden="true">
        <div class="feedback-ripple-center">
          ${player.playPauseFeedback === 'play'
        ? html`<slot name="icon-play-feedback">${renderIcon(player.getIcon('play')!)}</slot>`
        : html`<slot name="icon-pause-feedback">${renderIcon(player.getIcon('pause')!)}</slot>`}
        </div>
      </div>
    `;
  }

  private renderDefaultSeekOverlay(player: PlayerPlayer, direction: 'rewind' | 'fastforward') {
    return html`
      <div class="feedback-overlay ${direction}" aria-hidden="true">
        <div class="feedback-ripple-wrapper">
          ${direction === 'rewind'
        ? html`
                <div class="feedback-seek-circle">
                  <span class="seek-icon-wrap">
                    <slot name="icon-arrow-back">${renderIcon(player.getIcon('arrow-back')!)}</slot>
                  </span>
                  <span class="feedback-text"
                    >${player.feedbackTaps *
          (player.config?.playback?.doubleTapInterval || 10)}s</span
                  >
                </div>
              `
        : html`
                <div class="feedback-seek-circle">
                  <span class="feedback-text"
                    >+${player.feedbackTaps *
          (player.config?.playback?.doubleTapInterval || 10)}s</span
                  >
                  <span class="seek-icon-wrap">
                    <slot name="icon-arrow-forward"
                      >${renderIcon(player.getIcon('arrow-forward')!)}</slot
                    >
                  </span>
                </div>
              `}
        </div>
      </div>
    `;
  }

  private renderDefaultVolumeOverlay(player: PlayerPlayer) {
    if (!player.activeVolumeFeedback) return '';
    const { volume, isMuted } = player.activeVolumeFeedback;
    return html`
      <div class="volume-feedback-overlay ${player.isVolumeFeedbackFadingOut ? 'fade-out' : ''}" aria-hidden="true">
        <div class="volume-feedback-pill">
          ${isMuted || volume === 0
        ? html`
                <slot name="icon-volume-mute"> ${renderIcon(player.getIcon('volume-mute')!)} </slot>
              `
        : html` <slot name="icon-volume"> ${renderIcon(player.getIcon('volume')!)} </slot> `}
          <span> ${isMuted ? 'Muted' : `${Math.round(volume * 100)}%`} </span>
        </div>
      </div>
    `;
  }

  private renderDefaultSpeedOverlay(player: PlayerPlayer) {
    if (!player.activeSpeedFeedback) return '';
    const speed = player.activeSpeedFeedback;
    const isLockMode = this.speedLockState !== 'IDLE';

    let overlayText = '';
    if (this.speedLockState === 'HOLDING') {
      overlayText = 'Slide down to lock 2× speed';
    } else if (this.speedLockState === 'READY_TO_LOCK') {
      overlayText = 'Release to lock 2× speed';
    } else if (this.speedLockState === 'LOCKED' || this.speedLockState === 'LOCKED_HOLDING') {
      overlayText = 'Slide down for normal speed';
    } else if (this.speedLockState === 'READY_TO_UNLOCK') {
      overlayText = 'Release for normal speed';
    } else {
      overlayText = `${speed}×`;
    }

    const fadeClass = this.isSpeedOverlayFadingOut ? 'fade-out' : '';
    const lockClass = isLockMode ? 'lock-mode' : '';

    return html`
      <div class="speed-feedback-overlay ${lockClass} ${fadeClass}" aria-hidden="true">
        <div class="speed-feedback-pill">
          <slot name="icon-speed-feedback"> ${renderIcon(player.getIcon('speed-feedback')!)} </slot>
          <span>${overlayText}</span>
        </div>
      </div>
    `;
  }

  private renderDefaultErrorOverlay(player: PlayerPlayer) {
    const { error } = player.playerState;
    if (!error) return '';
    return html`
      <div class="error-overlay" role="alert">
        <svg viewBox="0 0 24 24">
          <path
            d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"
          />
        </svg>
        <div class="error-message">${error}</div>
        <button class="retry-btn" @click=${player.handleRetryLoad}>${player.localize('retryPlayback', 'Retry Playback')}</button>
      </div>
    `;
  }

  private renderDefaultLiveOverlay(player: PlayerPlayer) {
    const layoutMode = player.displayMode;
    if (layoutMode !== 'vertical' || !player.playerState.isLive) return '';
    return html`
      <div
        class="vertical-persistent-live-badge ${player.playerState.isAtLiveEdge
        ? 'live'
        : 'behind'}"
        @click=${player.handleLiveBadgeClick}
        @keydown=${(e: KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          player.handleLiveBadgeClick(e);
        }
      }}
        role="button"
        tabindex="0"
        aria-label="${player.playerState.isAtLiveEdge
        ? 'Playing at live edge'
        : 'Seek to live edge'}"
      >
        <slot name="icon-live">
          ${player.getIcon('live')
        ? renderIcon(player.getIcon('live')!)
        : html`<span class="live-dot"></span>`}
        </slot>
        <span class="live-text">LIVE</span>
      </div>
    `;
  }

  private renderDefaultCenterPlayOverlay(player: PlayerPlayer) {
    const { isPlaying, status } = player.playerState;
    const show = player.config?.vertical?.showCenterPlayButton;
    if (!show || isPlaying || status === 'ended') return '';

    return html`
      <div
        class="vertical-center-play-overlay"
        @click=${player.handleTogglePlay}
        role="button"
        aria-label="Play video"
      >
        <div class="vertical-center-play-btn">${renderIcon(player.getIcon('play')!)}</div>
      </div>
    `;
  }

  private handleEmptyStateButtonClick() {
    this.dispatchEvent(
      new CustomEvent('player-empty-state-click', { bubbles: true, composed: true })
    );
  }

  private renderEmptyState() {
    const emptyConfig = this.config?.emptyState;
    if (!emptyConfig) return '';

    if (typeof emptyConfig.render === 'function') {
      try {
        const customHtml = emptyConfig.render(this);
        if (customHtml) return customHtml;
      } catch (e) {
        console.error('[Player] Error rendering custom emptyState:', e);
      }
    }

    const icon = emptyConfig.icon || '';
    const title = emptyConfig.title || '';
    const subtitle = emptyConfig.subtitle || '';
    const buttonText = emptyConfig.buttonText || '';

    return html`
      <div part="empty-state" class="player-empty-state">
        <div part="empty-state-content" class="player-empty-state-content">
          ${icon ? html`<div part="empty-state-icon" class="player-empty-state-icon">${icon}</div>` : ''}
          ${title ? html`<h2 part="empty-state-title" class="player-empty-state-title">${title}</h2>` : ''}
          ${subtitle ? html`<p part="empty-state-subtitle" class="player-empty-state-subtitle">${subtitle}</p>` : ''}
          ${buttonText
        ? html`
                <button
                  part="empty-state-btn"
                  class="player-empty-state-btn"
                  @click=${this.handleEmptyStateButtonClick}
                >
                  ${buttonText}
                </button>
              `
        : ''}
        </div>
      </div>
    `;
  }

  private renderControl(controlId: string) {
    const configControls = this.config?.controls || {};
    const controlIdToConfigKeys: Record<string, string[]> = {
      'play-button': ['play', 'playButton'],
      'seek-backward': ['seekButtons'],
      'seek-forward': ['seekButtons'],
      'volume-control': ['volume'],
      'live-badge': ['liveBadge'],
      'chapters-btn': ['chapters'],
      'caption-btn': ['captions', 'subtitles'],
      'settings-btn': ['settings'],
      'pip-btn': ['pip', 'pictureInPicture'],
      'fullscreen-btn': ['fullscreen'],
    };
    const configKeys = controlIdToConfigKeys[controlId] || [];
    const isExplicitlyDisabled =
      configKeys.some(
        (key) => configControls[key as keyof typeof configControls] === false
      ) || configControls[controlId as keyof typeof configControls] === false;

    if (isExplicitlyDisabled) {
      return '';
    }

    const {
      isPlaying,
      isMuted,
      volume,
      captionsEnabled,
      hasCaptions,
      pictureInPictureSupported,
      pictureInPicture,
      isFullscreen,
    } = this.playerState;

    switch (controlId) {
      case 'play-button':
        return html`
          <player-play-button
            part="play-button"
            exportparts="button: play-button-inner"
            ?playing=${isPlaying}
            .player=${this}
            @player-toggle-play=${this.handleTogglePlay}
          >
            <slot name="icon-play" slot="icon-play"></slot>
            <slot name="icon-pause" slot="icon-pause"></slot>
          </player-play-button>
        `;
      case 'seek-backward':
        if (this.playerState.isLive && !this.playerState.canSeekInDvr) return '';
        return html`
          <player-seek-button
            part="seek-button seek-backward"
            exportparts="button: seek-backward-inner"
            direction="backward"
            .player=${this}
            @player-seek-by=${this.handleSeekBy}
          >
            <slot name="icon-seek-backward" slot="icon-seek-backward"></slot>
          </player-seek-button>
        `;
      case 'seek-forward':
        if (this.playerState.isLive && !this.playerState.canSeekInDvr) return '';
        return html`
          <player-seek-button
            part="seek-button seek-forward"
            exportparts="button: seek-forward-inner"
            direction="forward"
            .player=${this}
            @player-seek-by=${this.handleSeekBy}
          >
            <slot name="icon-seek-forward" slot="icon-seek-forward"></slot>
          </player-seek-button>
        `;
      case 'volume-control':
        return html`
          <player-volume-control
            part="volume-control"
            exportparts="volume-control: volume-control-wrapper, volume-button, slider-container, slider-input, tooltip: volume-tooltip"
            .volume=${volume}
            ?muted=${isMuted}
            .player=${this}
            @player-toggle-mute=${this.handleToggleMute}
            @player-volume-change=${this.handleVolumeChange}
          >
            <slot name="icon-volume" slot="icon-volume"></slot>
            <slot name="icon-volume-medium" slot="icon-volume-medium"></slot>
            <slot name="icon-volume-low" slot="icon-volume-low"></slot>
            <slot name="icon-volume-mute" slot="icon-volume-mute"></slot>
          </player-volume-control>
        `;
      case 'live-badge':
        if (!this.playerState.isLive) return '';
        return html`
          <div
            part="live-badge"
            class="live-badge-container ${this.playerState.isAtLiveEdge ? 'live' : 'behind'}"
            @click=${this.handleLiveBadgeClick}
            @keydown=${(e: KeyboardEvent) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              this.handleLiveBadgeClick(e);
            }
          }}
            role="button"
            tabindex="0"
            aria-label="${this.playerState.isAtLiveEdge
            ? 'Playing at live edge'
            : 'Seek to live edge'}"
            title="${this.playerState.isAtLiveEdge
            ? 'Playing at live edge'
            : 'Click to seek to live edge'}"
          >
            <slot name="icon-live">
              ${this.getIcon('live')
            ? renderIcon(this.getIcon('live')!)
            : html`<span class="live-dot"></span>`}
            </slot>
            <span class="live-text">LIVE</span>
          </div>
        `;
      case 'chapters-btn':
        if (!this.playerState.chapters || this.playerState.chapters.length === 0) return '';
        return html`
          <player-chapters-button
            part="chapters-btn"
            exportparts="button: chapters-button-inner, popup: chapters-popup, popup-header: chapters-popup-header, chapters-list, chapter-item"
            .chapters=${this.playerState.chapters}
            .activeChapterIndex=${this.playerState.activeChapterIndex}
            .player=${this}
            @player-select-chapter=${(e: CustomEvent<{ index: number }>) =>
            this.handleSelectChapter(e.detail.index)}
          >
            <slot name="icon-chapters" slot="icon-chapters"></slot>
          </player-chapters-button>
        `;
      case 'caption-btn':
        if (!hasCaptions) return '';
        return html`
          <button
            part="caption-btn"
            class="caption-btn ${captionsEnabled ? 'active' : ''}"
            @click=${this.handleCaptionsToggle}
            aria-label="Subtitles"
            aria-pressed=${captionsEnabled}
            title="Subtitles"
          >
            <slot name="icon-captions"> ${renderIcon(this.getIcon('captions')!)} </slot>
          </button>
        `;
      case 'settings-btn':
        return html`
          <button
            part="settings-btn"
            class="settings-btn"
            @click=${this.settingsMenu.toggle}
            aria-label="Open settings menu"
            aria-haspopup="true"
            aria-expanded=${this.settingsMenuOpen}
            title="Settings"
          >
            <slot name="icon-settings"> ${renderIcon(this.getIcon('settings')!)} </slot>
          </button>
        `;
      case 'pip-btn':
        if (!pictureInPictureSupported) return '';
        return html`
          <button
            part="pip-btn"
            class="pip-btn"
            @click=${this.handlePictureInPictureToggle}
            aria-label=${pictureInPicture ? 'Exit Picture-in-Picture' : 'Enter Picture-in-Picture'}
            title=${pictureInPicture ? 'Exit Picture-in-Picture' : 'Enter Picture-in-Picture'}
          >
            <slot name="icon-pip"> ${renderIcon(this.getIcon('pip')!)} </slot>
          </button>
        `;
      case 'fullscreen-btn':
        return html`
          <button
            part="fullscreen-btn"
            class="fullscreen-btn"
            @click=${this.handleFullscreenToggle}
            aria-label=${isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'}
            title=${isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'}
          >
            ${isFullscreen
            ? html`<slot name="icon-fullscreen-exit"
                  >${renderIcon(this.getIcon('fullscreen-exit')!)}</slot
                >`
            : html`<slot name="icon-fullscreen"
                  >${renderIcon(this.getIcon('fullscreen')!)}</slot
                >`}
          </button>
        `;
      default:
        return '';
    }
  }

  private handleSkipAd() {
    if (this.controller && this.controller.ads) {
      this.controller.ads.skip();
    }
  }

  private handleAdClickThrough() {
    const ad = this.playerState?.currentAd;
    if (ad?.clickThroughUrl) {
      try {
        window.open(ad.clickThroughUrl, '_blank');
        this.controller?.emit('adclick', { adId: ad.id, clickUrl: ad.clickThroughUrl });
      } catch (e) {
        console.error('Ad clickthrough failed:', e);
      }
    }
  }

  private renderAdUIOverlay() {
    if (!this.playerState?.isAdPlaying) return '';

    const ad = this.playerState.currentAd;
    // NonLinear / HTML Overlay ads do not render linear ad UI overlays (countdown badge, linear ad progress bar, skip button)
    if (ad && ad.linear === false) return '';
    if (this.playerState.adLinear === false) return '';
    const breakObj = this.playerState.currentAdBreak;
    const adPosition = this.playerState.adPosition;
    const totalAds = breakObj?.ads?.length || 1;
    const adTitle = ad?.title || '';
    const canSkip = !!this.playerState.canSkipAd;
    const skipAvailableAt = this.playerState.skipAvailableAt;
    const isSkippableAd = canSkip || (skipAvailableAt !== null && skipAvailableAt !== undefined);
    const adDuration = this.playerState.adDuration || ad?.duration || 0;
    const adCurrentTime = this.playerState.adCurrentTime ?? Math.max(0, adDuration - (this.playerState.adRemainingTime ?? adDuration));
    const remainingTime = Math.ceil(this.playerState.adRemainingTime ?? Math.max(0, adDuration - adCurrentTime));
    const progressPercent = adDuration > 0 ? Math.min(100, (adCurrentTime / adDuration) * 100) : 0;

    const showAdTitle = !!this.controller?.config?.ads?.showAdTitle;
    const showSkipButton = this.controller?.config?.ads?.ui?.showSkipButton ?? true;
    const showCountdown = this.controller?.config?.ads?.ui?.showCountdown ?? true;

    return html`
      <div class="player-ad-ui-overlay" part="ad-ui-overlay">
        <!-- Top Left Ad Info Badge (Compact by default) -->
        <div class="ad-badge-top" @click=${this.handleAdClickThrough}>
          <span class="ad-pill">${totalAds > 1 && adPosition !== null ? `Ad · ${adPosition + 1} of ${totalAds}` : 'Ad'}</span>
          ${showAdTitle && adTitle ? html`<span class="ad-title-text">${adTitle}</span>` : ''}
        </div>

        <!-- Bottom Right Action / Countdown Box -->
        <div class="ad-skip-container">
          ${isSkippableAd
            ? (canSkip || (skipAvailableAt !== null && skipAvailableAt <= 0))
              ? (showSkipButton ? html`
                  <button
                    class="ad-skip-btn active"
                    part="ad-skip-btn"
                    @click=${(e: Event) => {
                      e.stopPropagation();
                      this.handleSkipAd();
                    }}
                  >
                    Skip Ad
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                      <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/>
                    </svg>
                  </button>
                ` : '')
              : (showCountdown ? html`
                  <button class="ad-skip-btn disabled" part="ad-skip-btn" disabled>
                    Skip in ${Math.ceil(skipAvailableAt ?? 0)}s
                  </button>
                ` : '')
            : (showCountdown ? html`
                <div class="ad-countdown">
                  Ad ends in ${formatTime(remainingTime)}
                </div>
              ` : '')}
        </div>

        <!-- Thin Bottom Advertisement Progress Indicator -->
        <div class="ad-progress-bar-track" part="ad-progress-track">
          <div class="ad-progress-bar-fill" part="ad-progress-fill" style="width: ${progressPercent}%"></div>
        </div>
      </div>
    `;
  }

  render() {
    const {
      isPlaying,
      status,
      currentTime,
      duration,
      bufferedRanges,
      isBuffering,
      error,
      currentSource,
      loop,
    } = this.playerState;

    const isVisible = this.controlsVisible || !isPlaying;
    const layoutMode = this.displayMode;

    return html`
      <div
        part="player-container"
        class="player-container layout-${layoutMode} ${isVisible
        ? 'controls-visible'
        : ''} source-type-${this.playerState.sourceType} ${this.isVisualTransitioning
          ? 'feed-transitioning'
          : ''} transition-stage-${this.transitionStage} transition-direction-${this
            .transitionDirection}"
      >
        <div part="video-wrapper" class="video-wrapper">
          <video
            part="video"
            ?autoplay=${this.autoplay}
            ?muted=${this.muted}
            ?loop=${this.activeLoop}
            ?playsinline=${this.activePlaysinline}
            preload=${this.activePreload}
            poster=${this.activePoster || nothing}
            crossorigin=${this.activeCrossorigin || nothing}
            disableRemotePlayback
          ></video>
          <canvas part="transition-canvas" class="transition-canvas"></canvas>
        </div>

        ${!currentSource && this.emptyStateSectionEnabled && this.config?.controls?.emptyState !== false
        ? this.renderEmptyState()
        : html`
              <!-- Custom overlay slot -->
              <slot name="top-overlay"></slot>

              <!-- Center Play Button Overlay -->
              ${!this.playerState?.isAdPlaying ? this.renderOverlay('center-play', (p) => this.renderDefaultCenterPlayOverlay(p)) : ''}

              <!-- Audio only cover -->
              ${layoutMode === 'audio-only'
            ? html`
                    <div part="audio-only-cover" class="audio-only-cover">
                      <div part="audio-only-album-art" class="audio-only-album-art">
                        <slot name="icon-audio-only"> ${renderIcon(this.getIcon('audio-only')!)} </slot>
                      </div>
                      <div part="audio-only-title" class="audio-only-title">
                        ${currentSource ? 'Audio Playback' : 'No Audio Source'}
                      </div>
                    </div>
                  `
            : ''}

              <!-- Toast Notification Overlay -->
              <div
                part="toast-overlay"
                class="toast-overlay ${this.toastVisible ? 'visible' : ''} ${this.toastType}"
              >
                ${this.toastMessage}
              </div>

              <!-- Sleep Timer Expiration Dialog -->
              ${this.playerState.sleepTimerExpired
            ? html`
                    <div
                      part="sleep-timer-dialog-overlay"
                      class="sleep-timer-dialog-overlay"
                      role="dialog"
                      aria-modal="true"
                      aria-labelledby="sleep-title"
                      aria-describedby="sleep-desc"
                      @click=${(e: Event) => e.stopPropagation()}
                    >
                      <div part="sleep-timer-dialog-content" class="sleep-timer-dialog-card">
                        <div part="sleep-timer-title" class="sleep-timer-dialog-title" id="sleep-title">
                          ${this.localize('timesUp', "Time's up")}
                        </div>
                        <div part="sleep-timer-desc" class="sleep-timer-dialog-message" id="sleep-desc">
                          ${this.localize('sleepTimerDesc', "We hope you're fast asleep, but you can always add more time.")}
                        </div>
                        <div class="sleep-timer-dialog-buttons">
                          <button
                            part="sleep-timer-btn sleep-timer-btn-add"
                            class="sleep-timer-btn sleep-timer-btn-add secondary"
                            @click=${(e: Event) => {
                              e.stopPropagation();
                              this.handleSleepTimerAddTime();
                            }}
                          >
                            ${this.localize('addTime', 'Add time')}
                          </button>
                          <button
                            part="sleep-timer-btn sleep-timer-btn-close"
                            class="sleep-timer-btn sleep-timer-btn-close primary"
                            @click=${(e: Event) => {
                              e.stopPropagation();
                              this.handleSleepTimerClose();
                            }}
                          >
                            ${this.localize('close', 'Close')}
                          </button>
                        </div>
                      </div>
                    </div>
                  `
            : ''}

              <!-- Error State Overlay -->
              ${error ? this.renderOverlay('error', (p) => this.renderDefaultErrorOverlay(p)) : ''}

              <!-- Buffering Loading Spinner Overlay -->
              ${isBuffering && !error
            ? this.renderOverlay('buffering', (p) => this.renderDefaultBufferingOverlay(p))
            : ''}

              <!-- Centered Replay Overlay (not shown in vertical mode) -->
              ${status === 'ended' && !this.playerState.isLive && this.displayMode !== 'vertical' && !loop && !this.playerState?.isAdPlaying
            ? this.renderOverlay('replay', (p) => this.renderDefaultReplayOverlay(p))
            : ''}

              <!-- Ambient Tap Skip / Volume / Playback Speed gesture feedback ripples -->
              ${this.tapFeedback && !this.playerState?.isAdPlaying
            ? this.renderOverlay(
              'seek',
              (p, dir) => this.renderDefaultSeekOverlay(p, dir as 'rewind' | 'fastforward'),
              this.tapFeedback
            )
            : ''}
              ${this.playPauseFeedback && !this.playerState?.isAdPlaying
            ? this.renderOverlay('play-pause', (p) => this.renderDefaultPlayPauseOverlay(p))
            : ''}
              ${this.activeVolumeFeedback && !this.playerState?.isAdPlaying
            ? this.renderOverlay('volume', (p) => this.renderDefaultVolumeOverlay(p))
            : ''}
              ${this.activeSpeedFeedback && !this.playerState?.isAdPlaying
            ? this.renderOverlay('speed', (p) => this.renderDefaultSpeedOverlay(p))
            : ''}

              <!-- Persistent Live Badge for Vertical Player -->
              ${layoutMode === 'vertical' && this.playerState.isLive && !this.playerState?.isAdPlaying
            ? this.renderOverlay('live', (p) => this.renderDefaultLiveOverlay(p))
            : ''}

              ${!this.playerState?.isAdPlaying
            ? html`
                  <!-- Ambient top/bottom vignette scrim -->
                  <div part="scrim" class="scrim ${isVisible ? 'visible' : ''}"></div>

                  <!-- Popover Settings Menus Wrapper -->
                  <div part="settings-menu-wrapper" class="settings-menu-wrapper">
                    <div
                      part="settings-menu"
                      class="settings-menu ${this.settingsMenuOpen ? 'visible' : ''}"
                      role="menu"
                      aria-label="${this.settingsMenu.getAriaLabel()}"
                    >
                      <div part="settings-drag-handle" class="settings-drag-handle"></div>
                      ${this.settingsMenuOpen ? this.renderSettingsMenuContent() : ''}
                    </div>
                  </div>

                  <!-- Control overlays wrapper -->
                  <div part="controls-overlay" class="controls-overlay">
                    ${layoutMode === 'custom'
                ? html`<slot></slot>`
                : layoutMode === 'vertical'
                  ? (this.config?.controls?.verticalControls !== false && this.controlsSectionEnabled
                    ? html`
                            <player-vertical-controls
                              part="vertical-controls"
                              exportparts="vertical-controls-container, action-rail, rail-btn, seekbar, seekbar-container, hover-tooltip, tooltip-marker-label, thumbnail-container, thumbnail-preview, tooltip-time-text, track, buffer-bar, progress-bar, handle, marker, time-display"
                              ?hideCurrentTime=${this.config?.controls?.currentTime === false}
                              ?hideDuration=${this.config?.controls?.duration === false}
                              .currentTime=${currentTime}
                              .duration=${duration}
                              .bufferedRanges=${bufferedRanges}
                              .isPlaying=${isPlaying}
                              .playerState=${this.playerState}
                              .controlsVisible=${this.controlsVisible}
                              .settingsMenuOpen=${this.settingsMenuOpen}
                              .pendingSeekTime=${this.pendingSeekTime}
                              .showNavigation=${this.playerState.playlist &&
                      this.playerState.playlist.length > 1}
                              .player=${this}
                              @prev-feed=${() =>
                        this.gestures.throttleTransition(() => this.goToPreviousPlaylistItem())}
                              @next-feed=${() => this.gestures.throttleTransition(() => this.goToNextPlaylistItem())}
                              @player-toggle-play=${this.handleTogglePlay}
                              @player-toggle-mute=${this.handleToggleMute}
                              @player-volume-change=${this.handleVolumeChange}
                              @player-seek=${this.handleSeek}
                              @player-settings-toggle=${this.settingsMenu.toggle}
                              @player-fullscreen-toggle=${this.handleFullscreenToggle}
                              @player-captions-toggle=${this.handleCaptionsToggle}
                              @player-precise-seek-change=${this.handlePreciseSeekChange}
                              @player-seek-to-live-edge=${this.handleLiveBadgeClick}
                            >
                              <slot name="top-actions" slot="top-actions"></slot>
                              <slot name="social-actions" slot="social-actions"></slot>
                              <slot name="bottom-actions" slot="bottom-actions"></slot>
                            </player-vertical-controls>
                          `
                    : '')
                  : (this.config?.controls?.controlsBar !== false && this.controlsSectionEnabled
                    ? this.renderStandardControls()
                    : '')}
                  </div>
                `
            : ''}

              <!-- Extra Custom Overlay Slots -->
              <div class="player-ads-overlay" part="ads-overlay"></div>
              ${this.renderAdUIOverlay()}
              <slot name="bottom-overlay"></slot>
              <slot name="watermark"></slot>
              <slot name="logo"></slot>
              ${this.renderOverlay('ads', () => html`<slot name="ad-overlay"></slot>`)}
              ${this.renderCustomOverlays()} ${this.renderHiddenSlots()}

              <!-- Custom context menu -->
              ${this.contextMenuOpen
            ? html`
                    <div
                      class="custom-context-menu"
                      style="top: ${this.contextMenuY}px; left: ${this.contextMenuX}px;"
                      role="menu"
                      tabindex="-1"
                      aria-label="Context menu"
                      @keydown=${this.handleContextMenuKeyDown}
                    >
                      ${this.getContextMenuItems().map(
              (item) => html`
                          <div
                            class="context-menu-item ${item.disabled ? 'disabled' : ''}"
                            @click=${() => this.handleContextMenuItemClick(item)}
                            role="menuitem"
                            tabindex="${item.disabled ? '-1' : '0'}"
                          >
                            ${item.label}
                          </div>
                        `
            )}
                    </div>
                  `
            : ''}
          `}
      </div>
    `;
  }

  private renderStandardControls() {
    const { currentTime, duration, isPlaying, bufferedRanges } = this.playerState;

    const isVisible = !this.playerState?.isAdPlaying && (this.controlsVisible || !isPlaying);
    const showSeekbar =
      this.config?.controls?.seekbar !== false &&
      this.config?.controls?.timeline !== false;

    return html`
      <div
        part="controls-bar"
        class="controls-bar ${isVisible ? 'visible' : ''}"
        role="toolbar"
        aria-label="Video controls bar"
      >
        <!-- Seeker timeline slider -->
        <slot name="timeline-overlay-before"></slot>
        ${showSeekbar
        ? html`
              <player-seekbar
                part="seekbar"
                exportparts="seekbar-container, hover-tooltip, tooltip-marker-label, thumbnail-container, thumbnail-preview, tooltip-time-text, track, buffer-bar, progress-bar, handle, marker, time-display"
                ?hideCurrentTime=${this.config?.controls?.currentTime === false}
                ?hideDuration=${this.config?.controls?.duration === false}
                .currentTime=${this.pendingSeekTime !== null ? this.pendingSeekTime : currentTime}
                .duration=${duration}
                .bufferedRanges=${bufferedRanges}
                .isSeeking=${this.playerState.isSeeking || this.isSeekingInteraction}
                .isLive=${this.playerState.isLive}
                .canSeekInDvr=${this.playerState.canSeekInDvr || false}
                .seekableRange=${this.playerState.seekableRange}
                .isAtLiveEdge=${this.playerState.isAtLiveEdge || false}
                .paused=${!isPlaying}
                .markers=${this.playerState.markers}
                .visibleMarkerTypes=${this.playerState.visibleMarkerTypes}
                .chapters=${this.playerState.chapters}
                .thumbnailProvider=${this.playerState.thumbnailProvider}
                .currentSource=${this.playerState.currentSource || ''}
                .activeFilmstripThumbnail=${this.filmstripThumbs.get(Math.round(this.pendingSeekTime !== null ? this.pendingSeekTime : currentTime))}
                .variant=${'standard'}
                .player=${this}
                @player-seek=${this.handleSeek}
                @player-precise-seek-change=${this.handlePreciseSeekChange}
                aria-label="Seek timeline progress"
              ></player-seekbar>
            `
        : ''}
        <slot name="timeline-overlay-after"></slot>

        ${this.isPreciseSeeking ? this.renderFilmstripThumbnails() : ''}
        ${!this.isPreciseSeeking
        ? html`
              <div class="controls-row">
                ${(() => {
            const { groups, layout } = this.getControlsLayout();
            return layout.map((gName) =>
              this.renderControlsGroup(gName, groups[gName] || [])
            );
          })()}
              </div>
            `
        : ''}
      </div>
    `;
  }

  public getStatistics(): PlayerStatistics | null {
    if (this.controller) {
      return this.controller.getStatistics();
    }
    return null;
  }
}

if (typeof window !== 'undefined' && typeof customElements !== 'undefined') {
  if (!customElements.get('streamit-player')) {
    customElements.define('streamit-player', PlayerPlayer);
  }
  if (!customElements.get('player-player')) {
    class PlayerPlayerLegacyAlias extends PlayerPlayer {}
    customElements.define('player-player', PlayerPlayerLegacyAlias);
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'streamit-player': PlayerPlayer;
    'player-player': PlayerPlayer;
  }
}
