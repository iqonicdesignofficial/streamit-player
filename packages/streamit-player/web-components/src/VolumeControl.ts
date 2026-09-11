import { LitElement, html } from 'lit';
import { styles } from './VolumeControl.styles';
import { property } from 'lit/decorators.js';
import { renderIcon, IconRegistry, IconName } from './icons/IconRegistry';
import type { PlayerPlayer } from './Player';

export class PlayerVolumeControl extends LitElement {
  @property({ type: Number }) volume = 1.0;
  @property({ type: Boolean }) muted = false;
  @property({ attribute: false }) player?: PlayerPlayer;

  static styles = styles;

  private handleMuteToggle() {
    this.dispatchEvent(
      new CustomEvent('player-toggle-mute', {
        bubbles: true,
        composed: true,
      })
    );
  }

  private handleVolumeChange(e: Event) {
    const input = e.target as HTMLInputElement;
    const vol = parseFloat(input.value);
    this.dispatchEvent(
      new CustomEvent('player-volume-change', {
        detail: { volume: vol },
        bubbles: true,
        composed: true,
      })
    );
  }

  private getIcon(name: IconName) {
    if (this.player && typeof this.player.getIcon === 'function') {
      return this.player.getIcon(name);
    }
    return IconRegistry.getDefaultIcon(name);
  }

  private getVolumeIcon() {
    let name: IconName = 'volume';
    if (this.muted || this.volume === 0) {
      name = 'volume-mute';
    } else if (this.volume < 0.3) {
      name = 'volume-low';
    } else if (this.volume < 0.7) {
      name = 'volume-medium';
    }
    return renderIcon(this.getIcon(name)!);
  }

  render() {
    const activeVolume = this.muted ? 0 : this.volume;
    const muteLabel = this.player
      ? this.player.localize(this.muted ? 'unmute' : 'mute', this.muted ? 'Unmute' : 'Mute')
      : this.muted
        ? 'Unmute'
        : 'Mute';
    const sliderLabel = this.player
      ? this.player.localize('volumeSlider', 'Volume slider')
      : 'Volume slider';
    const tooltipLabel = this.player
      ? this.player.localize(
          this.muted || this.volume === 0 ? 'muted' : 'volume',
          this.muted || this.volume === 0 ? 'Muted' : 'Volume'
        )
      : this.muted || this.volume === 0
        ? 'Muted'
        : 'Volume';

    return html`
      <div
        part="volume-control"
        class="volume-control-wrapper"
        style="--volume-percent: ${activeVolume * 100};"
      >
        <button
          part="volume-button button"
          @click=${this.handleMuteToggle}
          aria-label=${muteLabel}
        >
          ${this.getVolumeIcon()}
        </button>
        <div part="slider-container" class="slider-container">
          <input
            part="slider-input"
            type="range"
            min="0"
            max="1"
            step="0.01"
            .value=${activeVolume.toString()}
            @input=${this.handleVolumeChange}
            aria-label=${sliderLabel}
            style="background: linear-gradient(to right, var(--player-volume-played-bg, var(--player-primary-color, #6366f1)) 0%, var(--player-volume-played-bg, var(--player-primary-color, #6366f1)) ${activeVolume *
            100}%, var(--player-volume-unplayed-bg, rgba(255, 255, 255, 0.2)) ${activeVolume *
            100}%, var(--player-volume-unplayed-bg, rgba(255, 255, 255, 0.2)) 100%);"
          />
        </div>
        <div part="tooltip" class="button-tooltip">
          ${tooltipLabel}
        </div>
      </div>
    `;
  }
}

if (typeof window !== 'undefined' && typeof customElements !== 'undefined') {
  if (!customElements.get('streamit-volume-control')) {
    customElements.define('streamit-volume-control', PlayerVolumeControl);
  }
  if (!customElements.get('player-volume-control')) {
    class PlayerVolumeControlLegacyAlias extends PlayerVolumeControl {}
    customElements.define('player-volume-control', PlayerVolumeControlLegacyAlias);
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'streamit-volume-control': PlayerVolumeControl;
    'player-volume-control': PlayerVolumeControl;
  }
}
