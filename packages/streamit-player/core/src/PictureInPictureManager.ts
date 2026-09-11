import { PlayerEvents, PlayerState } from './types';

/** Legacy Safari WebKit presentation-mode Picture-in-Picture API, not part of the standard DOM lib types. */
interface WebkitPresentationModeVideoElement extends HTMLVideoElement {
  webkitSupportsPresentationMode?(mode: string): boolean;
  webkitSetPresentationMode?(mode: string): void;
  webkitPresentationMode?: string;
}

/**
 * The minimal surface of `PlayerController` that `PictureInPictureManager`
 * depends on.
 */
export interface PictureInPictureManagerHost {
  getVideoElement(): HTMLVideoElement;
  getState(): PlayerState;
  updateStatePublic(changes: Partial<PlayerState>): void;
  dispatchEvent<K extends keyof PlayerEvents>(event: K, detail?: PlayerEvents[K]): void;
}

/**
 * Owns Picture-in-Picture support detection, entering/exiting PiP (standard and
 * legacy WebKit presentation-mode APIs) and the associated video events.
 */
export class PictureInPictureManager {
  private readonly host: PictureInPictureManagerHost;

  constructor(host: PictureInPictureManagerHost) {
    this.host = host;
  }

  private get video(): HTMLVideoElement {
    return this.host.getVideoElement();
  }

  private get state(): PlayerState {
    return this.host.getState();
  }

  /**
   * Detects Picture-in-Picture browser support, including Safari's WebKit
   * presentation-mode API. Called once from `PlayerController`'s constructor.
   */
  public detectSupport(): boolean {
    const video = this.video as WebkitPresentationModeVideoElement;
    const standardPiPSupport = !!(
      typeof document !== 'undefined' &&
      document.pictureInPictureEnabled &&
      typeof video.requestPictureInPicture === 'function'
    );
    const webkitPiPSupport = !!(
      typeof video.webkitSupportsPresentationMode === 'function' &&
      video.webkitSupportsPresentationMode('picture-in-picture')
    );
    return standardPiPSupport || webkitPiPSupport;
  }

  private handleEnterPiP = () => {
    this.host.updateStatePublic({ pictureInPicture: true });
    this.host.dispatchEvent('pipchange', { isPictureInPicture: true });
  };

  private handleLeavePiP = () => {
    this.host.updateStatePublic({ pictureInPicture: false });
    this.host.dispatchEvent('pipchange', { isPictureInPicture: false });
  };

  private handleWebkitPresentationModeChanged = () => {
    const isPiP =
      (this.video as WebkitPresentationModeVideoElement).webkitPresentationMode ===
      'picture-in-picture';
    this.host.updateStatePublic({ pictureInPicture: isPiP });
    this.host.dispatchEvent('pipchange', { isPictureInPicture: isPiP });
  };

  /** Called from `PlayerController.setupEventListeners()`. */
  public attach(): void {
    const video = this.video;
    video.addEventListener('enterpictureinpicture', this.handleEnterPiP);
    video.addEventListener('leavepictureinpicture', this.handleLeavePiP);
    video.addEventListener(
      'webkitpresentationmodechanged',
      this.handleWebkitPresentationModeChanged
    );
  }

  /** Mirror of {@link attach}. Called from `PlayerController.destroy()`. */
  public detach(): void {
    const video = this.video;
    video.removeEventListener('enterpictureinpicture', this.handleEnterPiP);
    video.removeEventListener('leavepictureinpicture', this.handleLeavePiP);
    video.removeEventListener(
      'webkitpresentationmodechanged',
      this.handleWebkitPresentationModeChanged
    );
  }

  public isPictureInPictureSupported(): boolean {
    return this.state.pictureInPictureSupported;
  }

  public async enterPictureInPicture(): Promise<PictureInPictureWindow | undefined> {
    if (!this.state.pictureInPictureSupported) {
      console.warn('[PlayerController] Picture-in-Picture is not supported in this environment.');
      return;
    }
    try {
      if (typeof this.video.requestPictureInPicture === 'function') {
        const pipWindow = await this.video.requestPictureInPicture();
        return pipWindow;
      } else {
        const webkitVideo = this.video as WebkitPresentationModeVideoElement;
        if (typeof webkitVideo.webkitSetPresentationMode === 'function') {
          webkitVideo.webkitSetPresentationMode('picture-in-picture');
        }
      }
    } catch (err) {
      console.warn('[PlayerController] Failed to enter Picture-in-Picture mode:', err);
    }
  }

  public async exitPictureInPicture(): Promise<void> {
    if (!this.state.pictureInPictureSupported) {
      console.warn('[PlayerController] Picture-in-Picture is not supported in this environment.');
      return;
    }
    try {
      if (typeof document.exitPictureInPicture === 'function') {
        const activePip = document.pictureInPictureElement;
        const shadowPip = (this.video.getRootNode() as Document | ShadowRoot).pictureInPictureElement;
        if (!activePip || activePip === this.video || shadowPip === this.video) {
          await document.exitPictureInPicture();
        }
      } else {
        const webkitVideo = this.video as WebkitPresentationModeVideoElement;
        if (typeof webkitVideo.webkitSetPresentationMode === 'function') {
          webkitVideo.webkitSetPresentationMode('inline');
        }
      }
    } catch (err) {
      console.warn('[PlayerController] Failed to exit Picture-in-Picture mode:', err);
    }
  }

  /**
   * Whether the video is currently presented in Picture-in-Picture.
   *
   * NOTE: the toggle itself deliberately stays on `PlayerController`, because it
   * must dispatch through the controller's own public `enterPictureInPicture()`
   * / `exitPictureInPicture()` methods - consumers (and tests) rely on being
   * able to observe or wrap those calls.
   */
  public isInPictureInPicture(): boolean {
    return this.state.pictureInPicture;
  }
}
