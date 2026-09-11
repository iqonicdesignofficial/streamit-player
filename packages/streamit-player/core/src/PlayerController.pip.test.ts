import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PlayerController } from './PlayerController';

/**
 * See PlayerController.test.ts for the rationale behind these stubs. jsdom's
 * `HTMLMediaElement.prototype.play`/`.pause()` are no-ops that never dispatch
 * events, so PlayerController (which learns about play/pause exclusively via
 * those events) needs them stubbed to dispatch synchronously. `.load()` is
 * stubbed to a no-op since jsdom doesn't implement real media loading.
 */
function stubMediaMethods() {
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (
    this: HTMLVideoElement
  ) {
    this.dispatchEvent(new Event('play'));
    return Promise.resolve();
  });
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function (
    this: HTMLVideoElement
  ) {
    this.dispatchEvent(new Event('pause'));
  });
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
}

function patchTextTracksEventTarget(video: HTMLVideoElement) {
  // See PlayerController.test.ts - jsdom's `video.textTracks` is a plain
  // array, not a real EventTarget-based TextTrackList; PlayerController's
  // constructor unconditionally calls addEventListener/removeEventListener
  // on it, so this patches jsdom's gap.
  const tracks = video.textTracks as unknown as EventTarget;
  if (typeof (tracks as any).addEventListener !== 'function') {
    const target = new EventTarget();
    (tracks as any).addEventListener = target.addEventListener.bind(target);
    (tracks as any).removeEventListener = target.removeEventListener.bind(target);
    (tracks as any).dispatchEvent = target.dispatchEvent.bind(target);
  }
}

/**
 * jsdom does not implement the Picture-in-Picture API at all: there is no
 * `document.pictureInPictureEnabled`, no `HTMLVideoElement.prototype.requestPictureInPicture`,
 * and no `document.exitPictureInPicture`. PlayerController's constructor
 * computes `state.pictureInPictureSupported` ONCE, synchronously, from
 * `document.pictureInPictureEnabled && typeof video.requestPictureInPicture === 'function'`
 * (or the webkit presentation-mode equivalent for Safari). To test the
 * "supported" branches, the stand-ins below must be installed on the video
 * element / `document` BEFORE constructing PlayerController.
 */
function makeController(): { video: HTMLVideoElement; controller: PlayerController } {
  const video = document.createElement('video');
  patchTextTracksEventTarget(video);
  const controller = new PlayerController(video, {
    preciseSeek: { seekSmoothing: false },
  });
  return { video, controller };
}

function makeStandardPipSupportedController(
  requestPipImpl: () => Promise<PictureInPictureWindow | undefined>
): { video: HTMLVideoElement; controller: PlayerController } {
  const video = document.createElement('video');
  patchTextTracksEventTarget(video);
  Object.defineProperty(document, 'pictureInPictureEnabled', {
    value: true,
    configurable: true,
  });
  (video as any).requestPictureInPicture = vi.fn(requestPipImpl);
  const controller = new PlayerController(video, {
    preciseSeek: { seekSmoothing: false },
  });
  return { video, controller };
}

describe('PlayerController Picture-in-Picture', () => {
  beforeEach(() => {
    stubMediaMethods();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (document as any).pictureInPictureEnabled;
    delete (document as any).exitPictureInPicture;
    delete (document as any).pictureInPictureElement;
  });

  describe('unsupported environment (jsdom default - no PiP APIs present)', () => {
    it('isPictureInPictureSupported() is false', () => {
      const { controller } = makeController();
      expect(controller.isPictureInPictureSupported()).toBe(false);
    });

    it('enterPictureInPicture() warns and resolves without calling any browser API', async () => {
      const { controller } = makeController();
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const result = await controller.enterPictureInPicture();

      expect(result).toBeUndefined();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Picture-in-Picture is not supported')
      );
      expect(controller.getState().pictureInPicture).toBe(false);
    });

    it('exitPictureInPicture() warns and resolves without calling any browser API', async () => {
      const { controller } = makeController();
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await controller.exitPictureInPicture();

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Picture-in-Picture is not supported')
      );
    });

    it('togglePictureInPicture() falls through to the unsupported enter path when not currently in PiP', async () => {
      const { controller } = makeController();
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await controller.togglePictureInPicture();

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Picture-in-Picture is not supported')
      );
    });
  });

  describe('supported environment (standard requestPictureInPicture)', () => {
    it('isPictureInPictureSupported() is true once document.pictureInPictureEnabled and video.requestPictureInPicture exist', () => {
      const fakePipWindow = {} as PictureInPictureWindow;
      const { controller } = makeStandardPipSupportedController(() =>
        Promise.resolve(fakePipWindow)
      );
      expect(controller.isPictureInPictureSupported()).toBe(true);
    });

    it('enterPictureInPicture() calls video.requestPictureInPicture() and returns its resolved value', async () => {
      const fakePipWindow = {} as PictureInPictureWindow;
      const { video, controller } = makeStandardPipSupportedController(() =>
        Promise.resolve(fakePipWindow)
      );

      const result = await controller.enterPictureInPicture();

      expect(video.requestPictureInPicture).toHaveBeenCalledTimes(1);
      expect(result).toBe(fakePipWindow);
      // state.pictureInPicture only flips once the browser actually fires
      // 'enterpictureinpicture' - calling requestPictureInPicture() alone
      // does not (mirrors real browser timing).
      expect(controller.getState().pictureInPicture).toBe(false);
    });

    it('dispatching a real "enterpictureinpicture" event updates state and fires a pipchange event', async () => {
      const fakePipWindow = {} as PictureInPictureWindow;
      const { video, controller } = makeStandardPipSupportedController(() =>
        Promise.resolve(fakePipWindow)
      );
      const pipChangeSpy = vi.fn();
      controller.addEventListener('pipchange', pipChangeSpy);

      await controller.enterPictureInPicture();
      video.dispatchEvent(new Event('enterpictureinpicture'));

      expect(controller.getState().pictureInPicture).toBe(true);
      expect(pipChangeSpy).toHaveBeenCalledWith({ isPictureInPicture: true });
    });

    it('dispatching a real "leavepictureinpicture" event updates state and fires a pipchange event', async () => {
      const fakePipWindow = {} as PictureInPictureWindow;
      const { video, controller } = makeStandardPipSupportedController(() =>
        Promise.resolve(fakePipWindow)
      );
      const pipChangeSpy = vi.fn();
      controller.addEventListener('pipchange', pipChangeSpy);
      await controller.enterPictureInPicture();
      video.dispatchEvent(new Event('enterpictureinpicture'));
      expect(controller.getState().pictureInPicture).toBe(true);

      video.dispatchEvent(new Event('leavepictureinpicture'));

      expect(controller.getState().pictureInPicture).toBe(false);
      expect(pipChangeSpy).toHaveBeenCalledWith({ isPictureInPicture: false });
    });

    it('enterPictureInPicture() catches a rejected requestPictureInPicture() and warns instead of throwing', async () => {
      const { controller } = makeStandardPipSupportedController(() =>
        Promise.reject(new Error('NotAllowedError: requires a user gesture'))
      );
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await expect(controller.enterPictureInPicture()).resolves.toBeUndefined();

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to enter Picture-in-Picture mode'),
        expect.any(Error)
      );
      expect(controller.getState().pictureInPicture).toBe(false);
    });

    it('exitPictureInPicture() calls document.exitPictureInPicture() when this video is the active PiP element', async () => {
      const fakePipWindow = {} as PictureInPictureWindow;
      const { video, controller } = makeStandardPipSupportedController(() =>
        Promise.resolve(fakePipWindow)
      );
      await controller.enterPictureInPicture();
      video.dispatchEvent(new Event('enterpictureinpicture'));

      const exitPipMock = vi.fn(() => Promise.resolve());
      (document as any).exitPictureInPicture = exitPipMock;
      Object.defineProperty(document, 'pictureInPictureElement', {
        value: video,
        configurable: true,
      });

      await controller.exitPictureInPicture();

      expect(exitPipMock).toHaveBeenCalledTimes(1);
    });

    it('exitPictureInPicture() does NOT call document.exitPictureInPicture() when a different element is the active PiP element', async () => {
      const fakePipWindow = {} as PictureInPictureWindow;
      const { controller } = makeStandardPipSupportedController(() =>
        Promise.resolve(fakePipWindow)
      );
      const otherVideo = document.createElement('video');
      const exitPipMock = vi.fn(() => Promise.resolve());
      (document as any).exitPictureInPicture = exitPipMock;
      Object.defineProperty(document, 'pictureInPictureElement', {
        value: otherVideo,
        configurable: true,
      });

      await controller.exitPictureInPicture();

      expect(exitPipMock).not.toHaveBeenCalled();
    });

    it('exitPictureInPicture() catches a rejected document.exitPictureInPicture() and warns instead of throwing', async () => {
      const fakePipWindow = {} as PictureInPictureWindow;
      const { video, controller } = makeStandardPipSupportedController(() =>
        Promise.resolve(fakePipWindow)
      );
      await controller.enterPictureInPicture();
      video.dispatchEvent(new Event('enterpictureinpicture'));

      (document as any).exitPictureInPicture = vi.fn(() =>
        Promise.reject(new Error('exit failed'))
      );
      Object.defineProperty(document, 'pictureInPictureElement', {
        value: video,
        configurable: true,
      });
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await expect(controller.exitPictureInPicture()).resolves.toBeUndefined();

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to exit Picture-in-Picture mode'),
        expect.any(Error)
      );
    });

    it('togglePictureInPicture() calls enterPictureInPicture() when not currently in PiP', async () => {
      const fakePipWindow = {} as PictureInPictureWindow;
      const { controller } = makeStandardPipSupportedController(() =>
        Promise.resolve(fakePipWindow)
      );
      const enterSpy = vi.spyOn(controller, 'enterPictureInPicture');
      const exitSpy = vi.spyOn(controller, 'exitPictureInPicture');
      expect(controller.getState().pictureInPicture).toBe(false);

      await controller.togglePictureInPicture();

      expect(enterSpy).toHaveBeenCalledTimes(1);
      expect(exitSpy).not.toHaveBeenCalled();
    });

    it('togglePictureInPicture() calls exitPictureInPicture() when currently in PiP', async () => {
      const fakePipWindow = {} as PictureInPictureWindow;
      const { video, controller } = makeStandardPipSupportedController(() =>
        Promise.resolve(fakePipWindow)
      );
      await controller.enterPictureInPicture();
      video.dispatchEvent(new Event('enterpictureinpicture'));
      expect(controller.getState().pictureInPicture).toBe(true);

      const enterSpy = vi.spyOn(controller, 'enterPictureInPicture');
      const exitSpy = vi.spyOn(controller, 'exitPictureInPicture').mockResolvedValue(undefined);

      await controller.togglePictureInPicture();

      expect(exitSpy).toHaveBeenCalledTimes(1);
      expect(enterSpy).not.toHaveBeenCalled();
    });
  });

  describe('supported environment (Safari webkit presentation-mode fallback)', () => {
    function makeWebkitPipSupportedController(): {
      video: HTMLVideoElement;
      controller: PlayerController;
      setPresentationModeMock: ReturnType<typeof vi.fn>;
    } {
      const video = document.createElement('video');
      patchTextTracksEventTarget(video);
      (video as any).webkitSupportsPresentationMode = vi.fn(
        (mode: string) => mode === 'picture-in-picture'
      );
      const setPresentationModeMock = vi.fn();
      (video as any).webkitSetPresentationMode = setPresentationModeMock;
      const controller = new PlayerController(video, {
        preciseSeek: { seekSmoothing: false },
      });
      return { video, controller, setPresentationModeMock };
    }

    it('isPictureInPictureSupported() is true via webkitSupportsPresentationMode even without standard PiP APIs', () => {
      const { controller } = makeWebkitPipSupportedController();
      expect(controller.isPictureInPictureSupported()).toBe(true);
    });

    it('enterPictureInPicture() calls webkitSetPresentationMode("picture-in-picture") when standard requestPictureInPicture is absent', async () => {
      const { controller, setPresentationModeMock } = makeWebkitPipSupportedController();

      await controller.enterPictureInPicture();

      expect(setPresentationModeMock).toHaveBeenCalledWith('picture-in-picture');
    });

    it('exitPictureInPicture() calls webkitSetPresentationMode("inline") when document.exitPictureInPicture is absent', async () => {
      const { controller, setPresentationModeMock } = makeWebkitPipSupportedController();

      await controller.exitPictureInPicture();

      expect(setPresentationModeMock).toHaveBeenCalledWith('inline');
    });
  });
});
