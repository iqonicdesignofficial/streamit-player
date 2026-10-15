import { describe, it, expect, vi, afterEach } from 'vitest';
import { PlayerController } from './PlayerController';

const controllers: PlayerController[] = [];
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function makeController(config: ConstructorParameters<typeof PlayerController>[1] = {}) {
  const video = document.createElement('video');
  // jsdom's textTracks is a plain array; PlayerController subscribes to it on construction.
  const tracks = video.textTracks as unknown as Record<string, unknown>;
  if (typeof tracks.addEventListener !== 'function') {
    const target = new EventTarget();
    tracks.addEventListener = target.addEventListener.bind(target);
    tracks.removeEventListener = target.removeEventListener.bind(target);
    tracks.dispatchEvent = target.dispatchEvent.bind(target);
  }
  const controller = new PlayerController(video, config);
  controllers.push(controller);
  return { video, controller };
}

function setFullscreenElement(el: Element | null) {
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => el });
  document.dispatchEvent(new Event('fullscreenchange'));
}

function stubTouchPhone(lock: () => Promise<void>, unlock: () => void) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: () => ({ matches: true }),
  });
  Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: 5 });
  Object.defineProperty(screen, 'orientation', { configurable: true, value: { lock, unlock } });
}

afterEach(() => {
  controllers.splice(0).forEach((c) => c.destroy());
  setFullscreenElement(null);
  Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: 0 });
  Object.defineProperty(screen, 'orientation', { configurable: true, value: undefined });
  vi.restoreAllMocks();
});

describe('PlayerController fullscreen orientation lock', () => {
  it('locks landscape on fullscreen enter and unlocks on exit', async () => {
    const lock = vi.fn().mockResolvedValue(undefined);
    const unlock = vi.fn();
    stubTouchPhone(lock, unlock);
    const { video } = makeController();

    setFullscreenElement(video);
    await flush();
    expect(lock).toHaveBeenCalledWith('landscape');
    expect(unlock).not.toHaveBeenCalled();

    setFullscreenElement(null);
    expect(unlock).toHaveBeenCalledTimes(1);
  });

  it('does not lock when layout.lockLandscapeOnFullscreen is false', async () => {
    const lock = vi.fn().mockResolvedValue(undefined);
    const unlock = vi.fn();
    stubTouchPhone(lock, unlock);
    const { video } = makeController({ layout: { lockLandscapeOnFullscreen: false } });

    setFullscreenElement(video);
    await flush();
    expect(lock).not.toHaveBeenCalled();

    setFullscreenElement(null);
    expect(unlock).not.toHaveBeenCalled();
  });

  it('does not lock in vertical layout', async () => {
    const lock = vi.fn().mockResolvedValue(undefined);
    stubTouchPhone(lock, vi.fn());
    const { video } = makeController({ layout: { mode: 'vertical' } });

    setFullscreenElement(video);
    await flush();
    expect(lock).not.toHaveBeenCalled();
  });

  it('releases a held lock if the player is destroyed while fullscreen', async () => {
    const lock = vi.fn().mockResolvedValue(undefined);
    const unlock = vi.fn();
    stubTouchPhone(lock, unlock);
    const { video, controller } = makeController();

    setFullscreenElement(video);
    await flush();
    expect(lock).toHaveBeenCalled();

    controller.destroy();
    expect(unlock).toHaveBeenCalledTimes(1);
  });
});
