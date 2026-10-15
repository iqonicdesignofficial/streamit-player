import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ThumbnailCache, type ThumbnailCacheHost } from './ThumbnailCache';

const requested: Array<{ url: string; time: number }> = [];

class FakeProvider {
  readonly type = 'fake';
  url = '';
  warmUp = vi.fn();
  setSource(url: string) {
    this.url = url;
  }
  getThumbnail(time: number) {
    requested.push({ url: this.url, time });
    return null;
  }
  destroy() {}
}

function makeHost(overrides: Record<string, unknown> = {}) {
  const main = new FakeProvider();
  main.url = 'https://example.test/current.mp4';
  const state = {
    status: 'playing',
    isLive: false,
    currentSource: 'https://example.test/current.mp4',
    activePlaylistIndex: 0,
    playlist: undefined as unknown,
    ...overrides,
  };
  const host = {
    playerState: state,
    controller: { getThumbnailProvider: () => main },
    isVisualTransitioning: false,
  } as unknown as ThumbnailCacheHost;
  return { host, main };
}

beforeEach(() => {
  requested.length = 0;
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  Object.defineProperty(navigator, 'connection', { configurable: true, value: undefined });
});

describe('ThumbnailCache warm-up', () => {
  it('warms the active provider once, a couple of seconds after playback starts', () => {
    const { host, main } = makeHost();
    const cache = new ThumbnailCache(host);

    cache.trigger();
    expect(main.warmUp).not.toHaveBeenCalled(); // not at startup: playback keeps the bandwidth
    vi.advanceTimersByTime(2500);
    expect(main.warmUp).toHaveBeenCalledTimes(1);

    cache.trigger(); // same provider + source: no second warm-up
    vi.advanceTimersByTime(2500);
    expect(main.warmUp).toHaveBeenCalledTimes(1);
    cache.destroy();
  });

  it('never warms live streams, and not when the user is saving data', () => {
    const live = makeHost({ isLive: true });
    new ThumbnailCache(live.host).trigger();
    vi.advanceTimersByTime(5000);
    expect(live.main.warmUp).not.toHaveBeenCalled();

    Object.defineProperty(navigator, 'connection', { configurable: true, value: { saveData: true } });
    const saver = makeHost();
    new ThumbnailCache(saver.host).trigger();
    vi.advanceTimersByTime(5000);
    expect(saver.main.warmUp).not.toHaveBeenCalled();
  });

  it('cancels a pending warm-up on destroy()', () => {
    const { host, main } = makeHost();
    const cache = new ThumbnailCache(host);
    cache.trigger();
    cache.destroy();
    vi.advanceTimersByTime(5000);
    expect(main.warmUp).not.toHaveBeenCalled();
  });
});

describe('ThumbnailCache playlist-neighbour preloading', () => {
  const playlist = [
    { src: 'https://example.test/prev.mp4' },
    { src: 'https://example.test/current.mp4' },
    {
      src: 'https://example.test/next.mp4',
      chapters: Array.from({ length: 8 }, (_, i) => ({ startTime: (i + 1) * 60, title: `c${i}` })),
    },
  ];

  it('preloads only the first frame plus at most 3 chapter frames per neighbour', async () => {
    const { host } = makeHost({ playlist, activePlaylistIndex: 1 });
    const cache = new ThumbnailCache(host);
    cache.trigger();
    await vi.advanceTimersByTimeAsync(500);

    const next = requested.filter((r) => r.url.endsWith('next.mp4'));
    const prev = requested.filter((r) => r.url.endsWith('prev.mp4'));
    expect(next.map((r) => r.time).sort((a, b) => a - b)).toEqual([0, 60, 120, 180]);
    expect(prev.map((r) => r.time)).toEqual([0]);
    cache.destroy();
  });

  it('skips neighbour preloading entirely when saving data', async () => {
    Object.defineProperty(navigator, 'connection', { configurable: true, value: { saveData: true } });
    const { host } = makeHost({ playlist, activePlaylistIndex: 1 });
    const cache = new ThumbnailCache(host);
    cache.trigger();
    await vi.advanceTimersByTimeAsync(500);
    expect(requested).toHaveLength(0);
    cache.destroy();
  });
});
