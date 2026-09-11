import {
  PlayerEvents,
  PlayerState,
  SubtitleAppearance,
  SubtitleCharacterEdgeStyle,
  SubtitleFontFamily,
  SubtitleTrack,
  SubtitleTrackKind,
  TextTrackSource,
} from './types';
import type { SourceManager } from './SourceManager';
import { safeStorage } from './storage';

/**
 * `_zombie` is a marker `PlayerController` stamps onto native `TextTrack`
 * objects being torn down on source change (see `PlayerController.loadSource`),
 * so tracks still lingering in `video.textTracks` can be skipped here. Not a
 * standard `TextTrack` property.
 */
interface ZombieTextTrack extends TextTrack {
  _zombie?: boolean;
}

/**
 * Some browsers/engines expose a nonstandard `default` property directly on
 * live `TextTrack` objects (mirroring the `<track default>` attribute, which
 * standard `TextTrack` only exposes via the owning `HTMLTrackElement`).
 */
interface TextTrackWithDefault extends TextTrack {
  default?: boolean;
}

/**
 * The minimal surface of `PlayerController` that `SubtitleManager` depends on.
 */
export interface SubtitleManagerHost {
  getVideoElement(): HTMLVideoElement;
  getState(): PlayerState;
  updateStatePublic(changes: Partial<PlayerState>): void;
  dispatchEvent<K extends keyof PlayerEvents>(event: K, detail?: PlayerEvents[K]): void;
}

const DEFAULT_APPEARANCE: SubtitleAppearance = {
  fontFamily: 'default',
  fontSize: 75,
  fontColor: 'white',
  backgroundColor: 'black',
  backgroundOpacity: 75,
  windowColor: 'black',
  windowOpacity: 0,
  characterEdgeStyle: 'none',
  fontOpacity: 100,
};

/**
 * Owns subtitle/caption track discovery, selection, appearance and the blob
 * URLs created for externally fetched WebVTT files.
 */
export class SubtitleManager {
  private readonly host: SubtitleManagerHost;
  private readonly sourceManager: SourceManager;

  private readonly defaultAppearance: SubtitleAppearance = { ...DEFAULT_APPEARANCE };
  private managedTracks: SubtitleTrack[] = [];
  private managedActiveTrackId: string | null = null;
  private managedActiveTrackIndex: number = -1;
  private subtitleBlobUrls: string[] = [];

  constructor(host: SubtitleManagerHost, sourceManager: SourceManager) {
    this.host = host;
    this.sourceManager = sourceManager;
  }

  private get video(): HTMLVideoElement {
    return this.host.getVideoElement();
  }

  private get state(): PlayerState {
    return this.host.getState();
  }

  private updateState(changes: Partial<PlayerState>): void {
    this.host.updateStatePublic(changes);
  }

  private dispatchEvent<K extends keyof PlayerEvents>(event: K, detail?: PlayerEvents[K]): void {
    this.host.dispatchEvent(event, detail);
  }

  public getDefaultAppearance(): SubtitleAppearance {
    return this.defaultAppearance;
  }

  /**
   * Reads the persisted caption enablement + appearance. Used by
   * `PlayerController`'s constructor to seed initial state before any
   * subscriber exists (so it assigns directly rather than via updateState).
   */
  public readPersistedSettings(): { captionsEnabled: boolean; appearance: SubtitleAppearance } {
    let subtitlesEnabled = false;
    let appearance = { ...this.defaultAppearance };
    try {
      const savedEnabled = safeStorage.getItem('player_subtitles_enabled');
      if (savedEnabled !== null) {
        subtitlesEnabled = savedEnabled === 'true';
      }
      const savedAppearance = safeStorage.getItem('player_subtitle_appearance');
      if (savedAppearance !== null) {
        const parsed = JSON.parse(savedAppearance);
        appearance = { ...this.defaultAppearance, ...parsed };
      }
    } catch (e) {
      console.warn('Failed to load persisted subtitles settings:', e);
    }
    return { captionsEnabled: subtitlesEnabled, appearance };
  }

  private handleTrackChange = () => {
    this.refreshSubtitleTracks();
  };

  /**
   * Attaches the text-track listeners this manager needs and syncs the initial
   * cue appearance. Called from `PlayerController.setupEventListeners()`.
   */
  public attach(): void {
    const video = this.video;
    if (video.textTracks && typeof video.textTracks.addEventListener === 'function') {
      video.textTracks.addEventListener('addtrack', this.handleTrackChange);
      video.textTracks.addEventListener('removetrack', this.handleTrackChange);
      video.textTracks.addEventListener('change', this.handleTrackChange);
    }
    this.syncSubtitleAppearance();
  }

  /** Mirror of {@link attach}. Called from `PlayerController.destroy()`. */
  public detach(): void {
    const video = this.video;
    if (video.textTracks && typeof video.textTracks.removeEventListener === 'function') {
      video.textTracks.removeEventListener('addtrack', this.handleTrackChange);
      video.textTracks.removeEventListener('removetrack', this.handleTrackChange);
      video.textTracks.removeEventListener('change', this.handleTrackChange);
    }
  }

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
  ): void {
    this.managedTracks = tracks.map((t, idx) => ({
      id: `${source}-${t.language || 'unknown'}-${idx}`,
      language: t.language || '',
      label: t.label || t.language || `Track ${idx + 1}`,
      default: !!t.default,
      forced: !!t.forced,
      kind: (t.kind as SubtitleTrackKind) || 'subtitles',
      source,
      index: idx,
    }));

    this.managedActiveTrackIndex = activeIndex;
    if (activeIndex >= 0 && activeIndex < this.managedTracks.length) {
      this.managedActiveTrackId = this.managedTracks[activeIndex].id;
    } else {
      this.managedActiveTrackId = null;
    }

    this.refreshSubtitleTracks();

    // Auto-restore saved language track selection when HLS/DASH manifest is loaded
    if (this.state.captionsEnabled && this.state.activeSubtitleTrackId === null) {
      const savedLanguage = safeStorage.getItem('player_subtitle_language');
      let match = savedLanguage
        ? this.state.subtitleTracks.find(
            (t) => t.language === savedLanguage || t.id === savedLanguage
          )
        : null;
      if (!match) {
        match = this.state.subtitleTracks.find((t) => t.default) || this.state.subtitleTracks[0];
      }
      if (match) {
        this.setSubtitleTrack(match.id);
      }
    }
  }

  public refreshSubtitleTracks(): void {
    const handler = this.sourceManager.getActiveHandler();
    let tracks: SubtitleTrack[] = [];
    let activeTrackId: string | null = null;
    let activeTrackIndex = -1;
    let hasCaptions = false;

    if (handler && handler.managesSubtitles) {
      tracks = [...this.managedTracks];
      activeTrackId = this.managedActiveTrackId;
      activeTrackIndex = this.managedActiveTrackIndex;

      // Also scan for any non-managed native tracks (e.g. CEA-608 captions dynamically added)
      const textTracks = this.video.textTracks;
      if (textTracks && textTracks.length > 0) {
        let index = tracks.length;
        for (let i = 0; i < textTracks.length; i++) {
          const t = textTracks[i];
          if (t.kind === 'subtitles' || t.kind === 'captions') {
            if ((t as ZombieTextTrack)._zombie) continue;

            // Check if this track is already managed
            const isManaged = this.managedTracks.some(
              (mt) =>
                (mt.label === t.label && mt.language === t.language) ||
                (t.language && mt.language === t.language)
            );
            if (isManaged) {
              // If the managed track is showing natively, sync activeTrackId
              if (t.mode === 'showing') {
                const matched = this.managedTracks.find(
                  (mt) =>
                    (mt.label === t.label && mt.language === t.language) ||
                    (t.language && mt.language === t.language)
                );
                if (matched) {
                  activeTrackId = matched.id;
                  activeTrackIndex = matched.index ?? -1;
                }
              }
              continue;
            }

            const trackId = t.id || `native-embedded-${t.language || 'unknown'}-${index}`;
            const isDefault = (t as TextTrackWithDefault).default || false;
            tracks.push({
              id: trackId,
              language: t.language || '',
              label: t.label || t.language || `Embedded Track ${index + 1}`,
              default: isDefault,
              forced: false,
              kind: t.kind as SubtitleTrackKind,
              source: 'native',
              index: i,
            });
            if (t.mode === 'showing') {
              activeTrackId = trackId;
              activeTrackIndex = index;
            }
            index++;
          }
        }
      }
      hasCaptions = tracks.length > 0;
    } else {
      const textTracks = this.video.textTracks;
      if (textTracks && textTracks.length > 0) {
        let index = 0;
        for (let i = 0; i < textTracks.length; i++) {
          const t = textTracks[i];
          if (t.kind === 'subtitles' || t.kind === 'captions') {
            if ((t as ZombieTextTrack)._zombie) continue;
            const trackId = t.id || `native-${t.language || 'unknown'}-${index}`;
            const isDefault = (t as TextTrackWithDefault).default || false;
            tracks.push({
              id: trackId,
              language: t.language || '',
              label: t.label || t.language || `Track ${index + 1}`,
              default: isDefault,
              forced: false,
              kind: t.kind as SubtitleTrackKind,
              source: 'native',
              index: i,
            });
            if (t.mode === 'showing') {
              activeTrackId = trackId;
              activeTrackIndex = index;
            }
            index++;
          }
        }
      }
      hasCaptions = tracks.length > 0;
    }

    const captionsEnabled = activeTrackId !== null;

    if (!captionsEnabled) {
      const textTracks = this.video.textTracks;
      if (textTracks) {
        for (let i = 0; i < textTracks.length; i++) {
          if (textTracks[i].mode === 'showing') {
            textTracks[i].mode = 'disabled';
          }
        }
      }
    }
    const tracksChanged = JSON.stringify(this.state.subtitleTracks) !== JSON.stringify(tracks);
    const activeChanged =
      this.state.activeSubtitleTrackId !== activeTrackId ||
      this.state.activeSubtitleTrack !== activeTrackIndex ||
      this.state.captionsEnabled !== captionsEnabled;

    this.updateState({
      subtitleTracks: tracks,
      activeSubtitleTrack: activeTrackIndex,
      activeSubtitleTrackId: activeTrackId,
      captionsEnabled,
      hasCaptions,
    });

    if (tracksChanged) {
      this.dispatchEvent('subtitletrackschanged', { tracks });
    }

    if (activeChanged) {
      const activeTrack = tracks.find((t) => t.id === activeTrackId) || null;
      this.dispatchEvent('subtitletrackchange', { activeTrack });
      if (captionsEnabled) {
        this.dispatchEvent('subtitleenabled', { activeTrack });
      } else {
        this.dispatchEvent('subtitledisabled');
      }

      try {
        safeStorage.setItem('player_subtitles_enabled', captionsEnabled.toString());
        if (activeTrack) {
          safeStorage.setItem('player_subtitle_language', activeTrack.language || activeTrack.id);
        }
      } catch (e) {
        // Ignore
      }
    }

    this.dispatchEvent('subtitlechange', { activeSubtitleTrack: activeTrackIndex });
  }

  public loadCaptions(track: TextTrackSource): void {
    const existingTracks = this.video.querySelectorAll('track');
    existingTracks.forEach((t) => t.remove());

    const trackEl = document.createElement('track');
    trackEl.kind = 'subtitles';
    trackEl.label = track.label;
    trackEl.srclang = track.srclang;
    trackEl.src = track.src;
    if (track.default) {
      trackEl.default = true;
    }

    this.video.appendChild(trackEl);

    // Auto-restore enable state or default setting
    const savedEnabled = safeStorage.getItem('player_subtitles_enabled');
    const shouldEnable = savedEnabled !== null ? savedEnabled === 'true' : !!track.default;

    if (shouldEnable) {
      setTimeout(() => this.toggleCaptions(true), 100);
    }

    this.refreshSubtitleTracks();
  }

  public toggleCaptions(enable?: boolean): void {
    const isEnabled = enable !== undefined ? enable : !this.state.captionsEnabled;
    if (isEnabled) {
      const tracks = this.state.subtitleTracks;
      if (tracks.length > 0) {
        const savedLanguage = safeStorage.getItem('player_subtitle_language');
        const targetTrack =
          tracks.find((t) => t.language === savedLanguage || t.id === savedLanguage || t.default) ||
          tracks[0];
        this.setSubtitleTrack(targetTrack.id);
      } else {
        const textTracks = this.video.textTracks;
        if (textTracks && textTracks.length > 0) {
          textTracks[0].mode = 'showing';
          this.refreshSubtitleTracks();
        } else {
          this.updateState({ captionsEnabled: true });
        }
      }
    } else {
      this.disableSubtitles();
    }
  }

  public setSubtitleTrack(trackId: string | number): void {
    const tracks = this.state.subtitleTracks;
    let targetTrack: SubtitleTrack | undefined;

    if (typeof trackId === 'number') {
      targetTrack = tracks[trackId];
    } else {
      targetTrack = tracks.find((t) => t.id === trackId);
    }

    if (!targetTrack) {
      this.disableSubtitles();
      return;
    }

    const handler = this.sourceManager.getActiveHandler();
    if (handler && handler.managesSubtitles && targetTrack.source !== 'native') {
      if (handler.setSubtitleTrack && targetTrack.index !== undefined) {
        handler.setSubtitleTrack(targetTrack.index);
        this.managedActiveTrackId = targetTrack.id;
        this.managedActiveTrackIndex = targetTrack.index;
      }
    } else {
      const textTracks = this.video.textTracks;
      if (textTracks && targetTrack.index !== undefined) {
        for (let i = 0; i < textTracks.length; i++) {
          if (textTracks[i].kind === 'subtitles' || textTracks[i].kind === 'captions') {
            textTracks[i].mode = i === targetTrack.index ? 'showing' : 'disabled';
          }
        }
      }
    }

    this.refreshSubtitleTracks();
  }

  public disableSubtitles(): void {
    const handler = this.sourceManager.getActiveHandler();
    if (handler && handler.managesSubtitles) {
      if (handler.setSubtitleTrack) {
        handler.setSubtitleTrack(-1);
        this.managedActiveTrackId = null;
        this.managedActiveTrackIndex = -1;
      }
    } else {
      const textTracks = this.video.textTracks;
      if (textTracks) {
        for (let i = 0; i < textTracks.length; i++) {
          if (textTracks[i].kind === 'subtitles' || textTracks[i].kind === 'captions') {
            textTracks[i].mode = 'disabled';
          }
        }
      }
    }

    this.refreshSubtitleTracks();
  }

  public hasSubtitles(): boolean {
    return this.state.hasCaptions;
  }

  public getSubtitleTracks(): SubtitleTrack[] {
    return this.state.subtitleTracks;
  }

  public getActiveSubtitleTrack(): SubtitleTrack | null {
    const tracks = this.state.subtitleTracks;
    const activeId = this.state.activeSubtitleTrackId;
    return tracks.find((t) => t.id === activeId) || null;
  }

  public getSubtitleAppearance(): SubtitleAppearance {
    return this.state.subtitleAppearance;
  }

  public setSubtitleAppearance(appearance: Partial<SubtitleAppearance>): void {
    const nextAppearance = { ...this.state.subtitleAppearance, ...appearance };
    this.updateState({ subtitleAppearance: nextAppearance });

    try {
      safeStorage.setItem('player_subtitle_appearance', JSON.stringify(nextAppearance));
    } catch (e) {
      // Ignore
    }

    this.syncSubtitleAppearance();
    this.dispatchEvent('subtitleappearancechange', { appearance: nextAppearance });
  }

  public resetSubtitleAppearance(): void {
    this.setSubtitleAppearance(this.defaultAppearance);
  }

  public syncSubtitleAppearance(): void {
    const appearance = this.state.subtitleAppearance;
    const video = this.video;
    if (!video) return;

    const colorMap: Record<string, string> = {
      white: '255, 255, 255',
      black: '0, 0, 0',
      red: '255, 0, 0',
      green: '0, 255, 0',
      blue: '0, 0, 255',
      yellow: '255, 255, 0',
      magenta: '255, 0, 255',
      cyan: '0, 255, 255',
    };

    const fontMap: Record<SubtitleFontFamily, string> = {
      default: 'inherit',
      'proportional-sans-serif': "'Outfit', 'Inter', system-ui, -apple-system, sans-serif",
      'monospace-sans-serif': "'Courier New', 'Andale Mono', monospace",
      'proportional-serif': "'Georgia', 'Times New Roman', serif",
      'monospace-serif': "'Courier New', 'Courier', serif",
      casual: "'Comic Sans MS', 'Chalkboard SE', sans-serif",
      cursive: "'Comic Sans MS', 'Lucida Handwriting', cursive",
      'small-capitals': "'Outfit', 'Inter', system-ui, sans-serif",
    };

    const edgeMap: Record<SubtitleCharacterEdgeStyle, string> = {
      default: 'none',
      none: 'none',
      raised: '1px 1px 0px #000, 2px 2px 0px #000, -1px -1px 0px #fff',
      depressed: '1px 1px 0px #fff, -1px -1px 0px #000',
      uniform: '-1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000',
      'drop-shadow': '2px 2px 4px rgba(0, 0, 0, 0.8)',
    };

    const fontColorVal = colorMap[appearance.fontColor.toLowerCase()] || '255, 255, 255';
    const fontOpacityVal = (appearance.fontOpacity / 100).toFixed(2);
    const fontColor = `rgba(${fontColorVal}, ${fontOpacityVal})`;

    const bgColorVal = colorMap[appearance.backgroundColor.toLowerCase()] || '0, 0, 0';
    const bgOpacityVal = (appearance.backgroundOpacity / 100).toFixed(2);
    const bgColor = `rgba(${bgColorVal}, ${bgOpacityVal})`;

    const winColorVal = colorMap[appearance.windowColor.toLowerCase()] || '0, 0, 0';
    const winOpacityVal = (appearance.windowOpacity / 100).toFixed(2);
    const winColor = `rgba(${winColorVal}, ${winOpacityVal})`;

    const fontFamily = fontMap[appearance.fontFamily] || 'inherit';
    const fontSize = `${appearance.fontSize}%`;
    const textShadow = edgeMap[appearance.characterEdgeStyle] || 'none';
    const fontVariant = appearance.fontFamily === 'small-capitals' ? 'small-caps' : 'normal';

    video.style.setProperty('--player-cue-font-family', fontFamily);
    video.style.setProperty('--player-cue-font-size', fontSize);
    video.style.setProperty('--player-cue-font-color', fontColor);
    video.style.setProperty('--player-cue-background-color', bgColor);
    video.style.setProperty('--player-cue-text-shadow', textShadow);
    video.style.setProperty('--player-cue-window-color', winColor);
    video.style.setProperty('--player-cue-font-variant', fontVariant);
  }

  // --- Source lifecycle helpers used by PlayerController.loadSource()/destroy() ---

  /** Revokes and clears every blob URL created for external WebVTT files. */
  public revokeBlobUrls(): void {
    if (this.subtitleBlobUrls) {
      this.subtitleBlobUrls.forEach((url) => {
        try {
          if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
            URL.revokeObjectURL(url);
          }
        } catch (e) {
          /* ignore */
        }
      });
      this.subtitleBlobUrls = [];
    }
  }

  /** Drops the HLS/DASH-managed track list when the source changes. */
  public resetManagedTracks(): void {
    this.managedTracks = [];
    this.managedActiveTrackId = null;
    this.managedActiveTrackIndex = -1;
  }

  /**
   * Appends `<track>` elements for the external subtitle files declared on a
   * source, fetching remote VTT into blob URLs so cross-origin files render.
   */
  public attachSourceSubtitles(subtitles: TextTrackSource[] | undefined): void {
    if (!subtitles || subtitles.length === 0) return;

    subtitles.forEach((track) => {
      const trackEl = document.createElement('track');
      trackEl.kind = 'subtitles';
      trackEl.label = track.label;
      trackEl.srclang = track.srclang;
      if (track.default) {
        trackEl.default = true;
      }

      if (track.src && (track.src.startsWith('http') || track.src.startsWith('//'))) {
        fetch(track.src)
          .then((res) => {
            if (!res.ok) throw new Error(`HTTP error ${res.status}`);
            return res.text();
          })
          .then((text) => {
            const blob = new Blob([text], { type: 'text/vtt' });
            if (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
              const url = URL.createObjectURL(blob);
              trackEl.src = url;
              this.subtitleBlobUrls.push(url);
              this.refreshSubtitleTracks();
            } else {
              trackEl.src = track.src;
            }
          })
          .catch((err) => {
            console.error(`Failed to load external subtitle track from ${track.src}:`, err);
            trackEl.src = track.src;
          });
      } else {
        trackEl.src = track.src;
      }

      this.video.appendChild(trackEl);
    });

    const defaultTrack = subtitles.find((t) => t.default) || subtitles[0];
    const savedEnabled = safeStorage.getItem('player_subtitles_enabled');
    const shouldEnable = savedEnabled !== null ? savedEnabled === 'true' : !!defaultTrack.default;

    if (shouldEnable) {
      setTimeout(() => this.toggleCaptions(true), 100);
    }
  }
}
