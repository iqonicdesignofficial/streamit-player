import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PlayerController } from './PlayerController';
import type { SourceHandler } from './SourceManager';

/**
 * Error reporting + stall watchdog.
 *
 * jsdom does not play media, so the video element is driven by hand: `play`/
 * `pause` dispatch the events a browser would, and `currentTime` / `paused`
 * are plain properties the tests move (or don't) to simulate a playhead that
 * advances or is stuck.
 */

function makeController(config: Record<string, unknown> = {}) {
  const video = document.createElement('video');
  // jsdom's textTracks is a bare array; PlayerController registers listeners on it.
  const tracks = video.textTracks as unknown as Record<string, unknown>;
  if (typeof tracks.addEventListener !== 'function') {
    const target = new EventTarget();
    tracks.addEventListener = target.addEventListener.bind(target);
    tracks.removeEventListener = target.removeEventListener.bind(target);
  }

  let currentTime = 0;
  let paused = true;
  Object.defineProperty(video, 'currentTime', {
    configurable: true,
    get: () => currentTime,
    set: (v: number) => {
      currentTime = v;
    },
  });
  Object.defineProperty(video, 'paused', { configurable: true, get: () => paused });

  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (
    this: HTMLVideoElement
  ) {
    paused = false;
    this.dispatchEvent(new Event('play'));
    return Promise.resolve();
  });
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function (
    this: HTMLVideoElement
  ) {
    paused = true;
    this.dispatchEvent(new Event('pause'));
  });
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});

  const controller = new PlayerController(video, {
    preciseSeek: { seekSmoothing: false },
    ...config,
  } as never);
  const recoverStall = vi.fn();
  const handler = { load: vi.fn(), destroy: vi.fn(), recoverStall } as unknown as SourceHandler;
  (
    controller as unknown as { sourceManager: { getActiveHandler: () => SourceHandler } }
  ).sourceManager.getActiveHandler = () => handler;

  const errors: string[] = [];
  controller.addEventListener('error', (detail) => errors.push((detail as { message: string }).message));

  return {
    video,
    controller,
    recoverStall,
    errors,
    setTime: (t: number) => {
      currentTime = t;
    },
    getTime: () => currentTime,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('PlayerController.reportFatalError', () => {
  it('sets the error state and dispatches the error event', () => {
    const { controller, errors } = makeController();

    controller.reportFatalError('boom');

    expect(controller.getState().error).toBe('boom');
    expect(controller.getState().status).toBe('error');
    expect(controller.getState().isBuffering).toBe(false);
    expect(errors).toEqual(['boom']);
    controller.destroy();
  });

  it('adds the HTTP code and detail to the event when a network error caused it', () => {
    const { controller } = makeController();
    const details: unknown[] = [];
    controller.addEventListener('error', (detail) => details.push(detail));

    controller.reportFatalError('expired', { httpCode: 403, details: 'fragLoadError' });
    controller.reportFatalError('plain');

    expect(details[0]).toEqual({ message: 'expired', httpCode: 403, details: 'fragLoadError' });
    // No cause given: the payload is exactly what it always was.
    expect(details[1]).toEqual({ message: 'plain' });
    expect(Object.keys(details[1] as object)).toEqual(['message']);
    controller.destroy();
  });

  it('is what a native <video> error now uses', () => {
    const { controller, video, errors } = makeController();

    video.dispatchEvent(new Event('error'));

    expect(errors).toHaveLength(1);
    expect(controller.getState().status).toBe('error');
    controller.destroy();
  });

  it('announces a rejected embed source with an error event', () => {
    const { controller, errors } = makeController();

    controller.loadSource({ src: 'https://not-approved.example/video', type: 'embed' } as never);

    expect(controller.getState().status).toBe('error');
    expect(errors).toEqual(['Invalid embed source or host not approved.']);
    controller.destroy();
  });
});

describe('PlayerController stall watchdog', () => {
  const tick = (seconds: number) => vi.advanceTimersByTimeAsync(seconds * 1000);

  it('escalates a stuck BUFFERING player: restart loading at 15s, fatal error at 60s', async () => {
    const { controller, video, recoverStall, errors } = makeController();
    await controller.play();
    video.dispatchEvent(new Event('waiting'));
    await tick(1);
    expect(controller.getState().isBuffering).toBe(true);

    await tick(13);
    expect(recoverStall).not.toHaveBeenCalled();
    await tick(2);
    expect(recoverStall).toHaveBeenCalledTimes(1);

    await tick(40);
    expect(errors).toEqual([]);
    expect(recoverStall).toHaveBeenCalledTimes(1);

    await tick(10);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/stalled/i);
    expect(controller.getState().status).toBe('error');
    controller.destroy();
  });

  it('keeps quiet while the playhead moves, even through buffering', async () => {
    const { controller, video, setTime, recoverStall, errors } = makeController();
    await controller.play();
    video.dispatchEvent(new Event('waiting'));

    for (let s = 1; s <= 120; s++) {
      setTime(s * 0.5);
      await tick(1);
    }

    expect(recoverStall).not.toHaveBeenCalled();
    expect(errors).toEqual([]);
    controller.destroy();
  });

  it('starts counting over when the playhead moves again', async () => {
    const { controller, video, setTime, recoverStall, errors } = makeController();
    await controller.play();
    video.dispatchEvent(new Event('waiting'));

    await tick(14);
    setTime(5); // a little data arrived
    await tick(1);
    await tick(14);

    expect(recoverStall).not.toHaveBeenCalled();
    expect(errors).toEqual([]);
    controller.destroy();
  });

  it('does not treat a paused player as stalled', async () => {
    const { controller, recoverStall, errors } = makeController();
    await controller.play();
    controller.pause();

    await tick(120);

    expect(recoverStall).not.toHaveBeenCalled();
    expect(errors).toEqual([]);
    controller.destroy();
  });

  it('still nudges a stuck, non-buffering playhead after 5s', async () => {
    const { controller, setTime, getTime } = makeController();
    await controller.play();
    setTime(10);
    await tick(1); // the watchdog sees the move and re-baselines

    await tick(5);

    expect(getTime()).toBeCloseTo(10.1, 5);
    controller.destroy();
  });

  it('is not fooled by a long timer gap (sleep / throttled background tab)', async () => {
    const { controller, recoverStall, errors } = makeController();
    await controller.play();

    // One tick arrives after the machine slept for an hour.
    vi.setSystemTime(Date.now() + 60 * 60 * 1000);
    await tick(1);

    expect(recoverStall).not.toHaveBeenCalled();
    expect(errors).toEqual([]);
    controller.destroy();
  });

  it('resumes watching after a fatal stall if playback recovers by itself', async () => {
    const { controller, video, errors } = makeController();
    await controller.play();
    await tick(61);
    expect(errors).toHaveLength(1);

    video.dispatchEvent(new Event('playing'));
    await tick(61);

    expect(errors).toHaveLength(2);
    controller.destroy();
  });
});

describe('PlayerController stall watchdog: config.recovery.stall', () => {
  const tick = (seconds: number) => vi.advanceTimersByTimeAsync(seconds * 1000);

  it('uses custom thresholds', async () => {
    const { controller, video, recoverStall, errors } = makeController({
      recovery: { stall: { nudgeAfterMs: 1000, restartAfterMs: 3000, failAfterMs: 6000 } },
    });
    await controller.play();
    video.dispatchEvent(new Event('waiting'));

    await tick(2);
    expect(recoverStall).not.toHaveBeenCalled();
    await tick(1);
    expect(recoverStall).toHaveBeenCalledTimes(1);

    await tick(2);
    expect(errors).toEqual([]);
    await tick(1);
    expect(errors).toHaveLength(1);
    controller.destroy();
  });

  it('can be made more patient than the default', async () => {
    const { controller, recoverStall, errors } = makeController({
      recovery: { stall: { failAfterMs: 120000 } },
    });
    await controller.play();

    await tick(100);
    expect(errors).toEqual([]);
    expect(recoverStall).toHaveBeenCalledTimes(1);

    await tick(21);
    expect(errors).toHaveLength(1);
    controller.destroy();
  });

  it('can be switched off', async () => {
    const { controller, recoverStall, errors } = makeController({
      recovery: { stall: { enabled: false } },
    });
    await controller.play();

    await tick(300);

    expect(recoverStall).not.toHaveBeenCalled();
    expect(errors).toEqual([]);
    expect(controller.getState().status).not.toBe('error');
    controller.destroy();
  });

  it('follows updateConfig() while playing', async () => {
    const { controller, recoverStall, errors } = makeController();
    await controller.play();
    await tick(10);

    controller.updateConfig({ recovery: { stall: { enabled: false } } });
    await tick(300);
    expect(recoverStall).not.toHaveBeenCalled();
    expect(errors).toEqual([]);

    controller.updateConfig({ recovery: { stall: { enabled: true, restartAfterMs: 2000, failAfterMs: 4000 } } });
    await tick(5);
    expect(errors).toHaveLength(1);
    controller.destroy();
  });

  it('warns about invalid values and falls back to the defaults', async () => {
    const warn = vi.spyOn(console, 'warn');
    const { controller, recoverStall, errors } = makeController({
      recovery: { stall: { failAfterMs: 'soon', restartAfterMs: -5 } },
    });
    const messages = warn.mock.calls.map((c) => String(c[0])).join('\n');
    expect(messages).toMatch(/recovery\.stall\.failAfterMs/);
    expect(messages).toMatch(/recovery\.stall\.restartAfterMs/);

    await controller.play();
    await tick(14);
    expect(recoverStall).not.toHaveBeenCalled();
    await tick(2);
    expect(recoverStall).toHaveBeenCalledTimes(1);
    await tick(43); // 59s in total: still below the default 60s
    expect(errors).toHaveLength(0);
    await tick(1);
    expect(errors).toHaveLength(1);
    controller.destroy();
  });
});
