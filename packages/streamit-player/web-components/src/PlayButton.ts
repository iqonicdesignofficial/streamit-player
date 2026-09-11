import { LitElement, html } from 'lit';
import { styles } from './PlayButton.styles';
import { property } from 'lit/decorators.js';
import { renderIcon, IconRegistry } from './icons/IconRegistry';
import type { PlayerPlayer } from './Player';

export class PlayerPlayButton extends LitElement {
  @property({ type: Boolean, reflect: true })
  playing = false;

  @property({ attribute: false }) player?: PlayerPlayer;

  static styles = styles;

  private handleClick() {
    this.dispatchEvent(
      new CustomEvent('player-toggle-play', {
        bubbles: true,
        composed: true,
      })
    );
  }

  render() {
    const defaultLabel = this.playing ? 'Pause' : 'Play';
    const labelKey = this.playing ? 'pause' : 'play';
    const label = this.player ? this.player.localize(labelKey, defaultLabel) : defaultLabel;

    return html`
      <button
        part="button"
        @click=${this.handleClick}
        aria-label=${label}
        title=${label}
      >
        ${this.playing
          ? renderIcon(
              this.player ? this.player.getIcon('pause') : IconRegistry.getDefaultIcon('pause')!
            )
          : renderIcon(
              this.player ? this.player.getIcon('play') : IconRegistry.getDefaultIcon('play')!
            )}
      </button>
    `;
  }
}

if (typeof window !== 'undefined' && typeof customElements !== 'undefined') {
  if (!customElements.get('streamit-play-button')) {
    customElements.define('streamit-play-button', PlayerPlayButton);
  }
  if (!customElements.get('player-play-button')) {
    class PlayerPlayButtonLegacyAlias extends PlayerPlayButton {}
    customElements.define('player-play-button', PlayerPlayButtonLegacyAlias);
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'streamit-play-button': PlayerPlayButton;
    'player-play-button': PlayerPlayButton;
  }
}
