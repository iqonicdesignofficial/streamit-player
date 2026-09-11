import { LitElement, html } from 'lit';
import { property, state } from 'lit/decorators.js';
import { PlayerState } from '../../core/src/index';
import { styles } from './VerticalControls.styles';
import { renderIcon, IconRegistry, IconName } from './icons/IconRegistry';
import type { PlayerPlayer } from './Player';
import './Seekbar';

export class PlayerVerticalControls extends LitElement {
  @property({ type: Object }) playerState!: PlayerState;
  @property({ type: Boolean }) controlsVisible = true;
  @property({ type: Boolean }) settingsMenuOpen = false;
  @property({ type: String }) activeMenuScreen = 'main';
  @property({ type: Number }) pendingSeekTime: number | null = null;
  @property({ type: Boolean }) showNavigation = false;
  @property({ attribute: false }) player?: PlayerPlayer;
  @property({ type: Boolean }) hideCurrentTime = false;
  @property({ type: Boolean }) hideDuration = false;

  static styles = styles;

  @state() private isVolumeSliderActive = false;
  private volumeSliderTimer?: number;
  private volumeTouchStartTimer?: number;
  private volumeIsTouch = false;

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener('pointerdown', this.handleDocumentPointerDown);
    document.addEventListener('focusin', this.handleDocumentFocusIn);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this.volumeSliderTimer) clearTimeout(this.volumeSliderTimer);
    if (this.volumeTouchStartTimer) clearTimeout(this.volumeTouchStartTimer);
    document.removeEventListener('pointerdown', this.handleDocumentPointerDown);
    document.removeEventListener('focusin', this.handleDocumentFocusIn);
  }

  updated(changedProperties: Map<string | number | symbol, unknown>) {
    super.updated(changedProperties);
    if (changedProperties.has('settingsMenuOpen') && this.settingsMenuOpen) {
      this.isVolumeSliderActive = false;
    }
    if (changedProperties.has('controlsVisible') && !this.controlsVisible) {
      this.isVolumeSliderActive = false;
    }
    if (changedProperties.has('playerState')) {
      const oldState = changedProperties.get('playerState') as PlayerState | undefined;
      if (oldState && oldState.currentSource !== this.playerState.currentSource) {
        this.isVolumeSliderActive = false;
      }
    }
  }

  private handleDocumentPointerDown = (e: PointerEvent) => {
    if (this.isVolumeSliderActive) {
      const path = e.composedPath();
      const isInsideVolume = path.some(
        (el: EventTarget) => el instanceof Element && el.classList.contains('vertical-volume-control')
      );
      if (!isInsideVolume) {
        this.isVolumeSliderActive = false;
      }
    }
  };

  private handleDocumentFocusIn = (e: FocusEvent) => {
    if (this.isVolumeSliderActive) {
      const path = e.composedPath();
      const isInsideVolume = path.some(
        (el: EventTarget) => el instanceof Element && el.classList.contains('vertical-volume-control')
      );
      if (!isInsideVolume) {
        this.isVolumeSliderActive = false;
      }
    }
  };

  private handleVolumeMouseEnter() {
    if (this.volumeIsTouch) return;
    if (this.volumeSliderTimer) {
      clearTimeout(this.volumeSliderTimer);
      this.volumeSliderTimer = undefined;
    }
    this.isVolumeSliderActive = true;
  }

  private handleVolumeMouseLeave() {
    if (this.volumeIsTouch) return;
    this.resetVolumeSliderTimer(200);
  }

  private handleVolumeTouchStart = (e: TouchEvent) => {
    this.volumeIsTouch = true;
    if (this.volumeTouchStartTimer) clearTimeout(this.volumeTouchStartTimer);
    
    this.volumeTouchStartTimer = window.setTimeout(() => {
      this.isVolumeSliderActive = !this.isVolumeSliderActive;
      if (this.isVolumeSliderActive) {
        this.resetVolumeSliderTimer();
      }
      this.volumeTouchStartTimer = undefined;
    }, 350);
  };

  private handleVolumeTouchEnd = (e: TouchEvent) => {
    if (this.volumeTouchStartTimer) {
      clearTimeout(this.volumeTouchStartTimer);
      this.volumeTouchStartTimer = undefined;
    }
  };

  private handleVolumeSliderInput(e: Event) {
    const input = e.target as HTMLInputElement;
    const vol = parseFloat(input.value);
    this.dispatchEvent(
      new CustomEvent('player-volume-change', {
        detail: { volume: vol },
        bubbles: true,
        composed: true,
      })
    );
    this.resetVolumeSliderTimer();
  }

  private resetVolumeSliderTimer(delay = 3000) {
    if (this.volumeSliderTimer) {
      clearTimeout(this.volumeSliderTimer);
    }
    this.volumeSliderTimer = window.setTimeout(() => {
      this.isVolumeSliderActive = false;
      this.volumeSliderTimer = undefined;
    }, delay);
  }

  private getIcon(name: IconName) {
    if (this.player && typeof this.player.getIcon === 'function') {
      return this.player.getIcon(name);
    }
    return IconRegistry.getDefaultIcon(name);
  }

  private handlePrevClick(e: Event) {
    e.stopPropagation();
    this.dispatchEvent(new CustomEvent('prev-feed', { bubbles: true, composed: true }));
  }

  private handleNextClick(e: Event) {
    e.stopPropagation();
    this.dispatchEvent(new CustomEvent('next-feed', { bubbles: true, composed: true }));
  }

  private handleMuteClick(e: Event) {
    e.stopPropagation();
    this.dispatchEvent(new CustomEvent('player-toggle-mute', { bubbles: true, composed: true }));
    if (this.volumeIsTouch) {
      this.isVolumeSliderActive = !this.isVolumeSliderActive;
      if (this.isVolumeSliderActive) {
        this.resetVolumeSliderTimer();
      }
    }
  }

  private handleCaptionsClick(e: Event) {
    e.stopPropagation();
    this.dispatchEvent(
      new CustomEvent('player-captions-toggle', { bubbles: true, composed: true })
    );
  }

  private handleSettingsClick(e: Event) {
    e.stopPropagation();
    this.dispatchEvent(
      new CustomEvent('player-settings-toggle', { bubbles: true, composed: true })
    );
  }

  private handleFullscreenClick(e: Event) {
    e.stopPropagation();
    this.dispatchEvent(
      new CustomEvent('player-fullscreen-toggle', { bubbles: true, composed: true })
    );
  }

  private handleSeek(e: CustomEvent) {
    e.stopPropagation();
    this.dispatchEvent(
      new CustomEvent('player-seek', {
        detail: e.detail,
        bubbles: true,
        composed: true,
      })
    );
  }

  private handlePlayClick() {
    this.dispatchEvent(
      new CustomEvent('player-toggle-play', { bubbles: true, composed: true })
    );
  }

  private renderRailButton(btnId: string) {
    const { isMuted, volume, isFullscreen, captionsEnabled, hasCaptions, isPlaying } = this.playerState;

    const configControls = this.player?.config?.controls || {};

    if (btnId === 'play-btn' && configControls.playButton === false) return '';
    if (btnId === 'volume-btn' && configControls.volume === false) return '';
    if (btnId === 'caption-btn' && (configControls.captions === false || configControls.subtitles === false)) return '';
    if (btnId === 'fullscreen-btn' && configControls.fullscreen === false) return '';
    if (btnId === 'settings-btn' && configControls.settings === false) return '';

    switch (btnId) {
      case 'play-btn':
        return html`
          <button
            part="rail-btn rail-btn-play"
            class="rail-btn play-btn"
            @click=${this.handlePlayClick}
            aria-label=${isPlaying ? 'Pause' : 'Play'}
            title=${isPlaying ? 'Pause' : 'Play'}
          >
            ${isPlaying
              ? renderIcon(this.getIcon('pause')!)
              : renderIcon(this.getIcon('play')!)}
          </button>
        `;
      case 'prev-btn':
        return this.showNavigation
          ? html`
              <button
                part="rail-btn rail-btn-prev"
                class="rail-btn prev-btn"
                @click=${this.handlePrevClick}
                aria-label="Previous Video"
                title="Previous Video"
              >
                ${renderIcon(this.getIcon('playlist-prev')!)}
              </button>
            `
          : '';
      case 'next-btn':
        return this.showNavigation
          ? html`
              <button
                part="rail-btn rail-btn-next"
                class="rail-btn next-btn"
                @click=${this.handleNextClick}
                aria-label="Next Video"
                title="Next Video"
              >
                ${renderIcon(this.getIcon('playlist-next')!)}
              </button>
            `
          : '';
      case 'volume-btn':
        return html`
          <div
            class="vertical-volume-control ${this.isVolumeSliderActive ? 'slider-active' : ''}"
            @mouseenter=${this.handleVolumeMouseEnter}
            @mouseleave=${this.handleVolumeMouseLeave}
            @touchstart=${this.handleVolumeTouchStart}
            @touchend=${this.handleVolumeTouchEnd}
          >
            <div
              class="vertical-volume-popover"
              @pointerdown=${(e: Event) => e.stopPropagation()}
              @pointermove=${(e: Event) => e.stopPropagation()}
              @touchstart=${(e: Event) => e.stopPropagation()}
              @touchmove=${(e: Event) => e.stopPropagation()}
              @touchend=${(e: Event) => e.stopPropagation()}
            >
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                .value=${(isMuted ? 0 : volume).toString()}
                @input=${this.handleVolumeSliderInput}
                @pointerdown=${(e: Event) => e.stopPropagation()}
                @pointermove=${(e: Event) => e.stopPropagation()}
                aria-label="Volume slider"
                style="background: linear-gradient(to right, var(--player-volume-played-bg, var(--player-primary-color, #6366f1)) 0%, var(--player-volume-played-bg, var(--player-primary-color, #6366f1)) ${(isMuted ? 0 : volume) * 100}%, var(--player-volume-unplayed-bg, rgba(255, 255, 255, 0.2)) ${(isMuted ? 0 : volume) * 100}%, var(--player-volume-unplayed-bg, rgba(255, 255, 255, 0.2)) 100%);"
              />
            </div>
            <button
              part="rail-btn rail-btn-volume"
              class="rail-btn volume-btn"
              @click=${this.handleMuteClick}
              aria-label=${isMuted ? 'Unmute' : 'Mute'}
              title=${isMuted ? 'Unmute' : 'Mute'}
            >
              ${isMuted || volume === 0
                ? renderIcon(this.getIcon('volume-mute')!)
                : renderIcon(this.getIcon('volume')!)}
            </button>
          </div>
        `;
      case 'caption-btn':
        return hasCaptions
          ? html`
              <button
                part="rail-btn rail-btn-caption ${captionsEnabled ? 'rail-btn-active' : ''}"
                class="rail-btn caption-btn ${captionsEnabled ? 'active' : ''}"
                @click=${this.handleCaptionsClick}
                aria-label="Subtitles"
                aria-pressed=${captionsEnabled}
                title="Subtitles"
              >
                ${renderIcon(this.getIcon('captions')!)}
              </button>
            `
          : '';
      case 'fullscreen-btn':
        return html`
          <button
            part="rail-btn rail-btn-fullscreen"
            class="rail-btn fullscreen-btn"
            @click=${this.handleFullscreenClick}
            aria-label=${isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'}
            title=${isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'}
          >
            ${isFullscreen
              ? renderIcon(this.getIcon('fullscreen-exit')!)
              : renderIcon(this.getIcon('fullscreen')!)}
          </button>
        `;
      case 'settings-btn':
        return html`
          <button
            part="rail-btn rail-btn-settings"
            class="rail-btn settings-btn"
            @click=${this.handleSettingsClick}
            aria-label="Open settings menu"
            aria-haspopup="true"
            aria-expanded=${this.settingsMenuOpen}
            title="Settings"
          >
            ${renderIcon(this.getIcon('settings-vertical')!)}
          </button>
        `;
      default:
        if (this.player && typeof this.player.renderControlOrPlugin === 'function') {
          const custom = this.player.renderControlOrPlugin(btnId);
          if (custom !== '') {
            return html`<div part="rail-btn rail-btn-custom" class="rail-btn custom-rail-btn">
              ${custom}
            </div>`;
          }
        }
        return '';
    }
  }

  render() {
    const { currentTime, duration, isPlaying, bufferedRanges } = this.playerState;

    const railPos = this.player?.config?.vertical?.railPosition || 'right';
    const configRailButtons =
      this.player?.config?.controls?.groups?.rail ||
      this.player?.config?.controls?.groups?.actionRail;
    const rawRailButtons = configRailButtons || this.player?.config?.vertical?.railButtons || [
      'prev-btn',
      'next-btn',
      'volume-btn',
      'caption-btn',
      'fullscreen-btn',
      'settings-btn',
    ];
    const railButtons = rawRailButtons.map((btnId: string) => {
      if (btnId === 'play-button' || btnId === 'play') return 'play-btn';
      if (btnId === 'playlist-prev' || btnId === 'playlist-previous') return 'prev-btn';
      if (btnId === 'playlist-next') return 'next-btn';
      if (btnId === 'volume-control' || btnId === 'volume') return 'volume-btn';
      if (btnId === 'caption-btn' || btnId === 'captions' || btnId === 'subtitles') return 'caption-btn';
      if (btnId === 'fullscreen-btn' || btnId === 'fullscreen') return 'fullscreen-btn';
      if (btnId === 'settings-btn' || btnId === 'settings') return 'settings-btn';
      return btnId;
    });

    const showProgress =
      this.player?.config?.vertical?.showProgressBar !== false &&
      this.player?.config?.controls?.timeline !== false &&
      this.player?.config?.controls?.seekbar !== false;

    const showActionRail = this.player?.config?.controls?.actionRail !== false;
    const isVisible = this.controlsVisible && !this.playerState?.isAdPlaying;

    return html`
      <div
        part="vertical-controls-container"
        class="vertical-controls-container ${isVisible ? 'visible' : ''}"
        role="toolbar"
        aria-label="Vertical video controls"
      >
        <!-- Right-side Action Rail -->
        ${showActionRail
          ? html`
              <div part="action-rail" class="vertical-action-rail rail-position-${railPos}">
                <!-- Top Section Slot -->
                <slot name="top-actions"></slot>

                ${railButtons.map((btnId) => this.renderRailButton(btnId))}

                <!-- Social Actions Slot -->
                <slot name="social-actions"></slot>

                <!-- Bottom Section Slot -->
                <slot name="bottom-actions"></slot>
              </div>
            `
          : ''}

        <!-- Bottom Seekbar Wrapper -->
        ${showProgress
          ? html`
              <div class="vertical-seekbar-wrapper">
                <player-seekbar
                  part="seekbar"
                  exportparts="seekbar-container, hover-tooltip, tooltip-marker-label, thumbnail-container, thumbnail-preview, tooltip-time-text, track, buffer-bar, progress-bar, handle, marker, time-display"
                  ?hideCurrentTime=${this.hideCurrentTime}
                  ?hideDuration=${this.hideDuration}
                  .currentTime=${this.pendingSeekTime !== null ? this.pendingSeekTime : currentTime}
                  .duration=${duration}
                  .bufferedRanges=${bufferedRanges}
                  .isSeeking=${this.playerState.isSeeking}
                  .isLive=${this.playerState.isLive}
                  .canSeekInDvr=${this.playerState.canSeekInDvr || false}
                  .seekableRange=${this.playerState.seekableRange}
                  .isAtLiveEdge=${this.playerState.isAtLiveEdge || false}
                  .paused=${!isPlaying}
                  .thumbnailProvider=${this.playerState.thumbnailProvider}
                  .currentSource=${this.playerState.currentSource || ''}
                  .markers=${this.playerState.markers}
                  .visibleMarkerTypes=${this.playerState.visibleMarkerTypes}
                  .chapters=${this.playerState.chapters}
                  .variant=${'vertical'}
                  @player-seek=${this.handleSeek}
                  aria-label="Seek timeline progress"
                ></player-seekbar>
              </div>
            `
          : ''}
      </div>
    `;
  }
}

if (typeof window !== 'undefined' && typeof customElements !== 'undefined') {
  if (!customElements.get('streamit-vertical-controls')) {
    customElements.define('streamit-vertical-controls', PlayerVerticalControls);
  }
  if (!customElements.get('player-vertical-controls')) {
    class PlayerVerticalControlsLegacyAlias extends PlayerVerticalControls {}
    customElements.define('player-vertical-controls', PlayerVerticalControlsLegacyAlias);
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'streamit-vertical-controls': PlayerVerticalControls;
    'player-vertical-controls': PlayerVerticalControls;
  }
}
