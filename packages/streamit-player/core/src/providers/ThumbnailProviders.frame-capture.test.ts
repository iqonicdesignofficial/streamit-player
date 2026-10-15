import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  VideoFrameThumbnailProvider,
  getThumbnailGridStep,
  snapToThumbnailGrid,
  isConstrainedNetwork,
} from './ThumbnailProviders';
import type { ThumbnailInfo } from '../types';

describe('thumbnail time grid', () => {
  it('uses 1s steps for short videos, unknown duration and precise seeking', () => {
    expect(getThumbnailGridStep(180, false)).toBe(1);
    expect(getThumbnailGridStep(NaN, false)).toBe(1);
    expect(getThumbnailGridStep(Infinity, false)).toBe(1);
    expect(getThumbnailGridStep(7200, true)).toBe(1);
  });

  it('widens the step with duration but never beyond 10s', () => {
    expect(getThumbnailGridStep(1800, false)).toBe(5);
    expect(getThumbnailGridStep(7200, false)).toBe(10);
    expect(getThumbnailGridStep(20000, false)).toBe(10);
  });

  it('snaps to the nearest grid point', () => {
    expect(snapToThumbnailGrid(10.4, 1)).toBe(10);
    expect(snapToThumbnailGrid(10.6, 1)).toBe(11);
    expect(snapToThumbnailGrid(47, 10)).toBe(50);
    expect(snapToThumbnailGrid(44, 10)).toBe(40);
  });
});

describe('isConstrainedNetwork', () => {
  afterEach(() => {
    Object.defineProperty(navigator, 'connection', { configurable: true, value: undefined });
  });

  it('is true for Save-Data and 2G, false otherwise', () => {
    expect(isConstrainedNetwork()).toBe(false);
    Object.defineProperty(navigator, 'connection', {
      configurable: true,
      value: { saveData: true },
    });
    expect(isConstrainedNetwork()).toBe(true);
    Object.defineProperty(navigator, 'connection', {
      configurable: true,
      value: { effectiveType: '2g' },
    });
    expect(isConstrainedNetwork()).toBe(true);
    Object.defineProperty(navigator, 'connection', {
      configurable: true,
      value: { effectiveType: '4g' },
    });
    expect(isConstrainedNetwork()).toBe(false);
  });
});

describe('VideoFrameThumbnailProvider (frame capture)', () => {
  let seeks: number[];
  let loadSpy: ReturnType<typeof vi.spyOn>;

  /** Builds a provider whose hidden <video> behaves like a fast, healthy MP4. */
  function makeProvider(): { provider: VideoFrameThumbnailProvider; video: HTMLVideoElement } {
    const provider = new VideoFrameThumbnailProvider();
    provider.setSource('https://example.test/movie.mp4');
    const video = (provider as unknown as { video: HTMLVideoElement }).video;

    let current = 0;
    Object.defineProperties(video, {
      duration: { configurable: true, value: 600 },
      readyState: { configurable: true, value: 4 },
      videoWidth: { configurable: true, value: 1280 },
      videoHeight: { configurable: true, value: 720 },
      seekable: {
        configurable: true,
        value: { length: 1, start: () => 0, end: () => 600 },
      },
      currentTime: {
        configurable: true,
        get: () => current,
        set: (t: number) => {
          current = t;
          seeks.push(t);
          queueMicrotask(() => video.dispatchEvent(new Event('seeked')));
        },
      },
    });
    return { provider, video };
  }

  /** Asks for a frame and marks the hidden video's metadata as loaded. */
  function request(
    provider: VideoFrameThumbnailProvider,
    video: HTMLVideoElement,
    time: number,
    priority: 'high' | 'low'
  ) {
    const result = provider.getThumbnail(time, priority);
    video.dispatchEvent(new Event('loadedmetadata'));
    return result;
  }

  beforeEach(() => {
    seeks = [];
    loadSpy = vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
    const fakeCtx = {
      drawImage: () => {},
      getImageData: () => ({ data: new Uint8ClampedArray(16 * 9 * 4).fill(200) }),
    };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
      () => fakeCtx as unknown as CanvasRenderingContext2D
    );
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/jpeg;base64,AAAA');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.querySelectorAll('video').forEach((v) => v.remove());
  });

  it('keeps the hidden video from buffering ahead (preload=metadata)', () => {
    const { video, provider } = makeProvider();
    expect(video.preload).toBe('metadata');
    provider.destroy();
  });

  it('resolves a whole 11-cell filmstrip window without dropping any request', async () => {
    const { provider, video } = makeProvider();
    provider.isPreciseSeeking = true;

    const results = await Promise.all(
      Array.from({ length: 11 }, (_, i) => request(provider, video, 100 + i, 'low')) as Array<
        Promise<ThumbnailInfo | null>
      >
    );

    expect(results.every((r) => r !== null)).toBe(true);
    expect(seeks).toHaveLength(11);
    provider.destroy();
  });

  it('serves hover requests inside the same grid cell from one capture', async () => {
    const { provider, video } = makeProvider();

    const first = request(provider, video, 10.2, 'high');
    const second = provider.getThumbnail(10.4, 'high');
    expect(second).toBe(first); // deduplicated onto the in-flight request

    const thumb = (await first) as ThumbnailInfo;
    expect(thumb).not.toBeNull();
    expect(seeks).toEqual([10]);

    // Now cached: any time in that cell returns synchronously with no new seek.
    const cached = provider.getThumbnail(10.3, 'high');
    expect(cached).not.toBeInstanceOf(Promise);
    expect((cached as ThumbnailInfo).url).toBe(thumb.url);
    expect(seeks).toEqual([10]);
    provider.destroy();
  });

  it('evicts the least recently used frame once the cache is full', () => {
    const provider = new VideoFrameThumbnailProvider();
    const internals = provider as unknown as {
      cache: Map<number, ThumbnailInfo>;
      MAX_CACHE_SIZE: number;
      storeInCache(bucket: number, thumb: ThumbnailInfo): void;
      getCached(bucket: number): ThumbnailInfo | undefined;
    };
    const frame = (time: number): ThumbnailInfo => ({ url: 'x', width: 1, height: 1, time });

    for (let i = 1; i <= internals.MAX_CACHE_SIZE; i++) internals.storeInCache(i, frame(i));
    expect(internals.cache.size).toBe(internals.MAX_CACHE_SIZE);

    internals.getCached(1); // touch: frame 1 is now the most recently used
    internals.storeInCache(internals.MAX_CACHE_SIZE + 1, frame(0));

    expect(internals.cache.size).toBe(internals.MAX_CACHE_SIZE);
    expect(internals.cache.has(1)).toBe(true); // survived because it was touched
    expect(internals.cache.has(2)).toBe(false); // least recently used, evicted
    provider.destroy();
  });

  it('warmUp() loads the source once and is harmless afterwards or when destroyed', () => {
    const provider = new VideoFrameThumbnailProvider();
    provider.setSource('https://example.test/movie.mp4');
    loadSpy.mockClear();

    provider.warmUp();
    provider.warmUp();
    expect(loadSpy).toHaveBeenCalledTimes(1);

    provider.destroy();
    expect(() => provider.warmUp()).not.toThrow();
  });
});
