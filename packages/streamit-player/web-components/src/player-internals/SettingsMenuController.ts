/**
 * The narrow slice of the `<player-player>` element the settings menu needs.
 * `settingsMenuOpen` / `activeMenuScreen` stay on the element itself because
 * they are Lit `@state()` properties that both `render()` and `updated()`
 * (via `changedProperties`) depend on; this controller owns the transitions
 * between them, not their storage.
 */
export interface SettingsMenuHost {
  settingsMenuOpen: boolean;
  activeMenuScreen: string;
  readonly shadowRoot: ShadowRoot | null;
  handleActivity(): void;
  getDeepActiveElement(): Element | null;
  requestUpdate(): void;
}

/**
 * The multi-screen settings menu stack: which screen is showing, how the user
 * moves between screens, and the focus management that goes with it.
 *
 * Every handler that a Lit template binds directly (`@click=${...}`) is an
 * arrow-function property, because Lit invokes a bound listener with the host
 * *element* as `this` - a plain method would lose this controller.
 *
 * The screens themselves are still rendered by `Player.ts`: their templates are
 * built from `html` tagged literals that read player state, icons and
 * localization, so splitting them out would only move the coupling around.
 */
export class SettingsMenuController {
  private readonly host: SettingsMenuHost;
  private lastFocusedSettingsButton: HTMLElement | null = null;

  constructor(host: SettingsMenuHost) {
    this.host = host;
  }

  get isOpen(): boolean {
    return this.host.settingsMenuOpen;
  }

  get activeScreen(): string {
    return this.host.activeMenuScreen;
  }

  /** Opens the menu on a given screen without touching focus. */
  open = (screen: string = 'main'): void => {
    this.host.settingsMenuOpen = true;
    this.host.activeMenuScreen = screen;
  };

  close = (): void => {
    this.host.settingsMenuOpen = false;
  };

  /** Navigates to a sub-screen of the currently open menu. */
  goTo = (screen: string): void => {
    this.host.activeMenuScreen = screen;
  };

  backToMain = (): void => {
    this.host.activeMenuScreen = 'main';
  };

  /** Settings button click / `player-settings-toggle`: opens or closes the menu. */
  toggle = (): void => {
    this.host.settingsMenuOpen = !this.host.settingsMenuOpen;
    this.host.activeMenuScreen = 'main';
    this.host.handleActivity();

    if (this.host.settingsMenuOpen) {
      this.lastFocusedSettingsButton = this.host.getDeepActiveElement() as HTMLElement;
      setTimeout(() => {
        const firstItem = this.host.shadowRoot?.querySelector(
          '.settings-menu .settings-item'
        ) as HTMLElement;
        if (firstItem) {
          firstItem.focus();
        }
      }, 50);
    }
  };

  /** Enter/Space on a menu row behaves like a click. */
  handleItemKey = (e: KeyboardEvent): void => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      (e.currentTarget as HTMLElement).click();
    }
  };

  getAriaLabel(): string {
    switch (this.host.activeMenuScreen) {
      case 'speed':
        return 'Playback speed settings';
      case 'quality':
        return 'Video resolution settings';
      case 'audio':
        return 'Audio language settings';
      case 'subtitles':
        return 'Subtitles settings';
      default:
        return 'Settings options';
    }
  }

  /** The settings button, which lives in the standard bar or in the vertical rail. */
  getSettingsButton(): HTMLElement | null {
    let btn = this.host.shadowRoot?.querySelector('.settings-btn') as HTMLElement;
    if (!btn) {
      const vertControls = this.host.shadowRoot?.querySelector('player-vertical-controls');
      if (vertControls && vertControls.shadowRoot) {
        btn = vertControls.shadowRoot.querySelector('.settings-btn') as HTMLElement;
      }
    }
    return btn;
  }

  /**
   * Keyboard navigation while the menu is open. Returns true when the event was
   * consumed and the caller must stop processing it.
   */
  handleKeyDown(e: KeyboardEvent, deepActiveEl: Element | null): boolean {
    if (this.host.settingsMenuOpen) {
      if (e.key === 'Tab') {
        this.host.settingsMenuOpen = false;
        const btn = this.getSettingsButton();
        if (btn) btn.focus();
        return true;
      }
      const menuEl = this.host.shadowRoot?.querySelector('.settings-menu');
      if (menuEl) {
        const items = Array.from(
          menuEl.querySelectorAll('.settings-header, .settings-item')
        ) as HTMLElement[];
        if (items.length > 0) {
          const activeIndex = items.findIndex((item) => item === deepActiveEl);

          if (e.key === 'ArrowDown') {
            e.preventDefault();
            e.stopPropagation();
            const nextIndex = activeIndex === -1 ? 0 : (activeIndex + 1) % items.length;
            items[nextIndex].focus();
            this.host.handleActivity();
            return true;
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            e.stopPropagation();
            const prevIndex =
              activeIndex === -1
                ? items.length - 1
                : (activeIndex - 1 + items.length) % items.length;
            items[prevIndex].focus();
            this.host.handleActivity();
            return true;
          } else if (e.key === 'ArrowLeft') {
            if (this.host.activeMenuScreen !== 'main') {
              e.preventDefault();
              e.stopPropagation();

              const oldScreen = this.host.activeMenuScreen;
              this.backToMain();

              // Focus the parent menu item that opens this sub-menu
              setTimeout(() => {
                const root = this.host.shadowRoot;
                if (root) {
                  const mainItems = Array.from(
                    root.querySelectorAll('.settings-menu .settings-item')
                  ) as HTMLElement[];
                  const target = mainItems.find((item) => {
                    const text = item.querySelector('span')?.textContent?.toLowerCase() || '';
                    if (oldScreen === 'speed') return text.includes('speed');
                    if (oldScreen === 'quality') return text.includes('quality');
                    if (oldScreen === 'audio') return text.includes('audio');
                    if (oldScreen === 'subtitles') return text.includes('subtitles');
                    if (oldScreen === 'sleeptimer') return text.includes('sleep');
                    return false;
                  });
                  if (target) {
                    target.focus();
                  } else if (mainItems[0]) {
                    mainItems[0].focus();
                  }
                }
              }, 50);
              this.host.handleActivity();
              return true;
            }
          }
        }
      }
    }

    // Escape closes settings menu if open
    if (e.key === 'Escape' && this.host.settingsMenuOpen) {
      e.preventDefault();
      e.stopPropagation();
      this.host.settingsMenuOpen = false;
      return true;
    }

    return false;
  }

  /** Closes the menu when a click / focus lands outside of it. */
  closeIfOutside(e: Event): void {
    if (!this.host.settingsMenuOpen) return;
    const path = e.composedPath();
    const isInsideSettings = path.some(
      (el) =>
        el instanceof Element &&
        (el.classList.contains('settings-menu') || el.classList.contains('settings-btn'))
    );
    if (!isInsideSettings) {
      this.host.settingsMenuOpen = false;
    }
  }

  /** `updated()` hook: move focus to the first row of a newly shown screen. */
  onScreenChanged(): void {
    if (!this.host.settingsMenuOpen) return;
    setTimeout(() => {
      const menuEl = this.host.shadowRoot?.querySelector('.settings-menu');
      if (menuEl) {
        const firstFocusable = menuEl.querySelector(
          '.settings-header, .settings-item'
        ) as HTMLElement;
        if (firstFocusable) {
          firstFocusable.focus();
        }
      }
    }, 50);
  }

  /** `updated()` hook: restore focus to the settings button once the menu closes. */
  onOpenStateChanged(wasOpen: boolean | undefined): void {
    if (wasOpen === true && !this.host.settingsMenuOpen) {
      setTimeout(() => {
        if (
          this.lastFocusedSettingsButton &&
          typeof this.lastFocusedSettingsButton.focus === 'function'
        ) {
          this.lastFocusedSettingsButton.focus();
        } else {
          const btn = this.getSettingsButton();
          if (btn) btn.focus();
        }
        this.lastFocusedSettingsButton = null;
      }, 50);
    }
  }
}
