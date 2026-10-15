import { describe, it, expect, vi, afterEach } from 'vitest';
import { lockLandscapeForFullscreen, unlockOrientation } from './OrientationLock';

function stubTouchDevice(coarse: boolean, maxTouchPoints = 5) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockReturnValue({ matches: coarse })
  );
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (globalThis as unknown as { matchMedia: unknown }).matchMedia,
  });
  Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: maxTouchPoints });
}

function stubOrientation(orientation: unknown) {
  Object.defineProperty(screen, 'orientation', { configurable: true, value: orientation });
}

afterEach(() => {
  vi.unstubAllGlobals();
  stubOrientation(undefined);
  Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: 0 });
});

describe('lockLandscapeForFullscreen', () => {
  it('locks to landscape on a touch device for a landscape video', async () => {
    stubTouchDevice(true);
    const lock = vi.fn().mockResolvedValue(undefined);
    stubOrientation({ lock, unlock: vi.fn() });

    await expect(
      lockLandscapeForFullscreen({ videoWidth: 1920, videoHeight: 1080 })
    ).resolves.toBe(true);
    expect(lock).toHaveBeenCalledWith('landscape');
  });

  it('locks when the video size is not known yet', async () => {
    stubTouchDevice(true);
    const lock = vi.fn().mockResolvedValue(undefined);
    stubOrientation({ lock, unlock: vi.fn() });

    await expect(lockLandscapeForFullscreen({})).resolves.toBe(true);
    expect(lock).toHaveBeenCalled();
  });

  it('does nothing on desktop (non-touch) devices', async () => {
    stubTouchDevice(false, 0);
    const lock = vi.fn().mockResolvedValue(undefined);
    stubOrientation({ lock, unlock: vi.fn() });

    await expect(lockLandscapeForFullscreen({ videoWidth: 1920, videoHeight: 1080 })).resolves.toBe(
      false
    );
    expect(lock).not.toHaveBeenCalled();
  });

  it('keeps portrait video and vertical layouts in portrait', async () => {
    stubTouchDevice(true);
    const lock = vi.fn().mockResolvedValue(undefined);
    stubOrientation({ lock, unlock: vi.fn() });

    expect(await lockLandscapeForFullscreen({ videoWidth: 720, videoHeight: 1280 })).toBe(false);
    expect(await lockLandscapeForFullscreen({ isVerticalLayout: true })).toBe(false);
    expect(lock).not.toHaveBeenCalled();
  });

  it('respects enabled: false', async () => {
    stubTouchDevice(true);
    const lock = vi.fn().mockResolvedValue(undefined);
    stubOrientation({ lock, unlock: vi.fn() });

    expect(await lockLandscapeForFullscreen({ enabled: false })).toBe(false);
    expect(lock).not.toHaveBeenCalled();
  });

  it('returns false instead of throwing when the API is missing or rejects', async () => {
    stubTouchDevice(true);
    stubOrientation(undefined);
    expect(await lockLandscapeForFullscreen({})).toBe(false);

    stubOrientation({ lock: vi.fn().mockRejectedValue(new Error('NotSupportedError')) });
    expect(await lockLandscapeForFullscreen({})).toBe(false);
  });
});

describe('unlockOrientation', () => {
  it('calls screen.orientation.unlock and never throws', () => {
    const unlock = vi.fn();
    stubOrientation({ unlock });
    unlockOrientation();
    expect(unlock).toHaveBeenCalledTimes(1);

    stubOrientation({
      unlock: () => {
        throw new Error('boom');
      },
    });
    expect(() => unlockOrientation()).not.toThrow();

    stubOrientation(undefined);
    expect(() => unlockOrientation()).not.toThrow();
  });
});
