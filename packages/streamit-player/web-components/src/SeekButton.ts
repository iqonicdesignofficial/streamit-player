import { LitElement, html } from 'lit';
import { styles } from './SeekButton.styles';
import { property } from 'lit/decorators.js';
import { renderIcon, IconRegistry } from './icons/IconRegistry';
import type { PlayerPlayer } from './Player';

export class PlayerSeekButton extends LitElement {
  @property({ type: String }) direction: 'backward' | 'forward' = 'forward';
  @property({ type: Number }) amount = 10;
  @property({ attribute: false }) player?: PlayerPlayer;

  static styles = styles;

  private handleClick() {
    const seconds = this.direction === 'backward' ? -this.amount : this.amount;
    this.dispatchEvent(
      new CustomEvent('player-seek-by', {
        detail: { seconds },
        bubbles: true,
        composed: true,
      })
    );
  }

  render() {
    const isBackward = this.direction === 'backward';
    const defaultLabel = isBackward
      ? `Seek backward ${this.amount} seconds`
      : `Seek forward ${this.amount} seconds`;
    const labelKey = isBackward ? 'seekBackward' : 'seekForward';
    const label = this.player
      ? this.player.localize(labelKey, defaultLabel).replace('{amount}', String(this.amount))
      : defaultLabel;

    const fallbackBackward = IconRegistry.getDefaultIcon('seek-backward');
    const fallbackForward = IconRegistry.getDefaultIcon('seek-forward');

    return html`
      <button part="button" @click=${this.handleClick} aria-label=${label} title=${label}>
        ${isBackward
          ? renderIcon(
              this.player
                ? this.player.getIcon('seek-backward', { amount: this.amount })
                : typeof fallbackBackward === 'function'
                  ? fallbackBackward({ amount: this.amount })
                  : fallbackBackward!
            )
          : renderIcon(
              this.player
                ? this.player.getIcon('seek-forward', { amount: this.amount })
                : typeof fallbackForward === 'function'
                  ? fallbackForward({ amount: this.amount })
                  : fallbackForward!
            )}
      </button>
    `;
  }
}

if (typeof window !== 'undefined' && typeof customElements !== 'undefined') {
  if (!customElements.get('streamit-seek-button')) {
    customElements.define('streamit-seek-button', PlayerSeekButton);
  }
  if (!customElements.get('player-seek-button')) {
    class PlayerSeekButtonLegacyAlias extends PlayerSeekButton {}
    customElements.define('player-seek-button', PlayerSeekButtonLegacyAlias);
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'streamit-seek-button': PlayerSeekButton;
    'player-seek-button': PlayerSeekButton;
  }
}
