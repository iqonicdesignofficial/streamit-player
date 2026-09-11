import { LitElement, html, PropertyValues } from 'lit';
import { styles } from './ChaptersButton.styles';
import { property, state } from 'lit/decorators.js';
import { Chapter, formatTime } from '../../core/src/index';
import { renderIcon, IconRegistry } from './icons/IconRegistry';
import type { PlayerPlayer } from './Player';

export class PlayerChaptersButton extends LitElement {
  @property({ type: Array }) chapters: Chapter[] = [];
  @property({ type: Number }) activeChapterIndex = -1;
  @property({ attribute: false }) player?: PlayerPlayer;
  @state() private open = false;
  @state() private lastFocusedButton: HTMLElement | null = null;

  static styles = styles;

  private handleDocumentClick = (e: MouseEvent) => {
    const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
    if (!path.includes(this)) {
      this.open = false;
    }
  };

  connectedCallback() {
    super.connectedCallback();
    if (typeof document !== 'undefined') {
      document.addEventListener('click', this.handleDocumentClick);
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (typeof document !== 'undefined') {
      document.removeEventListener('click', this.handleDocumentClick);
    }
  }

  private togglePopup() {
    this.open = !this.open;
  }

  private handleSelect(index: number) {
    this.dispatchEvent(
      new CustomEvent('player-select-chapter', {
        detail: { index },
        bubbles: true,
        composed: true,
      })
    );
    this.open = false;
  }

  protected updated(changedProperties: PropertyValues) {
    super.updated(changedProperties);
    if (changedProperties.has('open')) {
      if (this.open) {
        this.lastFocusedButton = (this.shadowRoot?.activeElement || document.activeElement) as HTMLElement;
        setTimeout(() => {
          const firstItem = this.shadowRoot?.querySelector('.chapter-item') as HTMLElement;
          if (firstItem) {
            firstItem.focus();
          }
        }, 50);
      } else {
        setTimeout(() => {
          if (this.lastFocusedButton && typeof this.lastFocusedButton.focus === 'function') {
            this.lastFocusedButton.focus();
          }
          this.lastFocusedButton = null;
        }, 50);
      }
    }
  }

  private handlePopupKeyDown(e: KeyboardEvent) {
    if (!this.open) return;

    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      this.open = false;
      return;
    }

    if (e.key === 'Tab') {
      e.preventDefault();
      e.stopPropagation();
      this.open = false;
      return;
    }

    const items = Array.from(
      this.shadowRoot?.querySelectorAll('.chapter-item') || []
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
    }
  }

  render() {
    if (!this.chapters || this.chapters.length === 0) return html``;

    const viewChaptersLabel = this.player ? this.player.localize('viewChapters', 'View Chapters') : 'View Chapters';
    const chaptersLabel = this.player ? this.player.localize('chapters', 'Chapters') : 'Chapters';

    return html`
      <button
        part="button"
        @click=${this.togglePopup}
        aria-label=${viewChaptersLabel}
        aria-haspopup="true"
        aria-expanded=${this.open}
        title=${chaptersLabel}
      >
        ${renderIcon(
          this.player ? this.player.getIcon('chapters') : IconRegistry.getDefaultIcon('chapters')!
        )}
      </button>

      <div
        part="popup"
        class="chapters-popup ${this.open ? 'visible' : ''}"
        @keydown=${this.handlePopupKeyDown}
      >
        <div part="popup-header" class="popup-header">${chaptersLabel}</div>
        <div part="chapters-list" class="chapters-list" role="menu">
          ${this.chapters.map(
            (chapter, idx) => html`
              <div
                part="chapter-item ${this.activeChapterIndex === idx ? 'chapter-item-active' : ''}"
                class="chapter-item ${this.activeChapterIndex === idx ? 'active' : ''}"
                @click=${() => this.handleSelect(idx)}
                role="menuitem"
                tabindex="0"
                @keydown=${(e: KeyboardEvent) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    this.handleSelect(idx);
                  }
                }}
              >
                <span class="chapter-title">${chapter.title}</span>
                <span class="chapter-time">
                  ${formatTime(chapter.startTime)} - ${formatTime(chapter.endTime || 0)}
                </span>
              </div>
            `
          )}
        </div>
      </div>
    `;
  }
}

if (typeof window !== 'undefined' && typeof customElements !== 'undefined') {
  if (!customElements.get('streamit-chapters-button')) {
    customElements.define('streamit-chapters-button', PlayerChaptersButton);
  }
  if (!customElements.get('player-chapters-button')) {
    class PlayerChaptersButtonLegacyAlias extends PlayerChaptersButton {}
    customElements.define('player-chapters-button', PlayerChaptersButtonLegacyAlias);
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'streamit-chapters-button': PlayerChaptersButton;
    'player-chapters-button': PlayerChaptersButton;
  }
}
