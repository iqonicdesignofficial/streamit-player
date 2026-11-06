import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Hls from 'hls.js';
import { PlayerController } from './PlayerController';

/**
 * An expired signed URL, against the REAL hls.js (only the network and
 * MediaSource are faked): the CDN answers every segment with HTTP 403.
 *
 * The playlist has the shape a typical token-protected backend serves: a
 * `manifest.m3u8?token=` URL with no explicit type, absolute variant URLs and
 * a subtitle group (`DEFAULT=NO,AUTOSELECT=YES`).
 *
 * What is pinned here:
 *  - the `error` event fires exactly once, carrying the HTTP code, so an app can
 *    tell "expired, ask for a new link" from "network down";
 *  - the player does not walk its own retry ladder for a refusal;
 *  - the player's state ends as `error`, not "buffering forever".
 *
 * hls.js itself retries a refused segment for ~30s by default (fragLoadPolicy)
 * before it reports a fatal error, so the fast tests lower that policy through
 * `config.hls`. The default-policy timing is measured by the slow test, which
 * only runs with STREAMIT_SLOW_TESTS=1.
 */

const MANIFEST_URL =
  'https://api.test/api/v1/playback/sessions/6f1d2c4e-0c1b-4d0e-9a53-1c2b3a4d5e6f/manifest.m3u8?token=raw-token';

const MASTER = `#EXTM3U
#EXT-X-VERSION:4
#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",LANGUAGE="en",NAME="English",DEFAULT=NO,AUTOSELECT=YES,FORCED=NO,URI="https://api.test/api/v1/subtitles/m1/en.m3u8?exp=1999999999&sig=abc"
#EXT-X-STREAM-INF:BANDWIDTH=900520,CODECS="avc1.64001e,mp4a.40.2",RESOLUTION=360x640,CLOSED-CAPTIONS=NONE,SUBTITLES="subs"
https://cdn.test/guid/360p/video.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2002576,CODECS="avc1.64001f,mp4a.40.2",RESOLUTION=720x1280,CLOSED-CAPTIONS=NONE,SUBTITLES="subs"
https://cdn.test/guid/720p/video.m3u8
`;

const MEDIA = `#EXTM3U
#EXT-X-TARGETDURATION:4
#EXT-X-VERSION:3
#EXT-X-MEDIA-SEQUENCE:0
#EXTINF:4,
seg0.ts
#EXT-X-ENDLIST
`;

let segmentStatus = 403;
let segmentRequests = 0;

class TestLoader {
  context: unknown = null;
  stats = {
    aborted: false,
    loaded: 0,
    retry: 0,
    total: 0,
    chunkCount: 0,
    bwEstimate: 0,
    loading: { start: 0, first: 0, end: 0 },
    parsing: { start: 0, end: 0 },
    buffering: { start: 0, first: 0, end: 0 },
  };
  destroy() {}
  abort() {}
  getCacheAge() {
    return null;
  }
  getResponseHeader() {
    return null;
  }
  load(
    context: { url: string },
    _config: unknown,
    callbacks: {
      onSuccess: (r: unknown, s: unknown, c: unknown, n: unknown) => void;
      onError: (e: { code: number; text: string }, c: unknown, n: unknown, s: unknown) => void;
    }
  ) {
    this.context = context;
    if (/\.vtt$/.test(context.url)) return;
    if (/\.ts$/.test(context.url)) {
      segmentRequests++;
      setTimeout(
        () =>
          callbacks.onError({ code: segmentStatus, text: String(segmentStatus) }, context, null, this.stats),
        0
      );
      return;
    }
    const data = context.url.includes('/manifest.m3u8') ? MASTER : MEDIA;
    setTimeout(() => callbacks.onSuccess({ url: context.url, data }, this.stats, context, null), 0);
  }
}

class FakeMediaSource extends EventTarget {
  static isTypeSupported = () => true;
  readyState = 'closed';
  duration = NaN;
  addSourceBuffer() {
    return Object.assign(new EventTarget(), {
      appendBuffer() {},
      remove() {},
      abort() {},
      buffered: { length: 0 },
    });
  }
  removeSourceBuffer() {}
  endOfStream() {}
}

function makeVideo(): HTMLVideoElement {
  const video = document.createElement('video');
  const tracks = video.textTracks as unknown as Record<string, unknown>;
  if (typeof tracks.addEventListener !== 'function') {
    const target = new EventTarget();
    tracks.addEventListener = target.addEventListener.bind(target);
    tracks.removeEventListener = target.removeEventListener.bind(target);
  }
  return video;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor(check: () => boolean, ms: number) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out waiting for condition');
    await sleep(5);
  }
}

beforeEach(() => {
  segmentStatus = 403;
  segmentRequests = 0;
  (globalThis as { MediaSource?: unknown }).MediaSource = FakeMediaSource;
  (window as { MediaSource?: unknown }).MediaSource = FakeMediaSource;
  Object.defineProperty(HTMLTrackElement.prototype, 'track', {
    configurable: true,
    get(this: HTMLTrackElement & { __t?: unknown }) {
      return (this.__t ??= {
        mode: 'disabled',
        kind: this.kind,
        label: this.label,
        language: this.srclang,
        cues: null,
        addCue() {},
        removeCue() {},
        addEventListener() {},
        removeEventListener() {},
      });
    },
  });
  (URL as { createObjectURL?: unknown }).createObjectURL = (ms: FakeMediaSource) => {
    setTimeout(() => {
      ms.readyState = 'open';
      ms.dispatchEvent(new Event('sourceopen'));
    }, 0);
    return 'blob:test';
  };
  (URL as { revokeObjectURL?: unknown }).revokeObjectURL = () => {};
  (globalThis as { Hls?: unknown }).Hls = Hls;
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  delete (globalThis as { Hls?: unknown }).Hls;
  vi.restoreAllMocks();
});

/** hls.js' own retry policy for a refused segment, lowered from its ~30s default. */
const quickRetry = { maxNumRetry: 1, retryDelayMs: 50, maxRetryDelayMs: 100 };
const FAST_HLS = {
  loader: TestLoader,
  enableWorker: false,
  fragLoadPolicy: {
    default: {
      maxTimeToFirstByteMs: 10000,
      maxLoadTimeMs: 20000,
      timeoutRetry: quickRetry,
      errorRetry: quickRetry,
    },
  },
};

function start(config: Record<string, unknown>) {
  const controller = new PlayerController(makeVideo(), {
    preciseSeek: { seekSmoothing: false },
    ...config,
  } as never);
  const errors: Array<Record<string, unknown>> = [];
  controller.addEventListener('error', (detail) => errors.push(detail as Record<string, unknown>));
  controller.loadSource({ src: MANIFEST_URL } as never); // no explicit type
  return { controller, errors };
}

describe('expired signed URL (HTTP 403 on every segment)', () => {
  it('raises one error that carries the HTTP code, and the state ends as error', async () => {
    const { controller, errors } = start({ hls: FAST_HLS });

    await waitFor(() => errors.length > 0, 5000);
    await sleep(300);

    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ httpCode: 403, details: 'fragLoadError' });
    expect(String(errors[0].message)).toMatch(/refused \(HTTP 403\).*expired/i);
    expect(controller.getState().status).toBe('error');
    expect(controller.getState().isBuffering).toBe(false);
    controller.destroy();
  });

  it('does not walk its own retry ladder for a refusal', async () => {
    const { controller, errors } = start({ hls: FAST_HLS });
    await waitFor(() => errors.length > 0, 5000);
    await sleep(300);
    const afterError = segmentRequests;

    // Nothing keeps requesting once the error is out (the ladder would reload at 2s, 4s, 8s).
    await sleep(500);
    expect(segmentRequests).toBe(afterError);
    controller.destroy();
  });

  it('with noRetryStatuses: [] it still ends in an error, but only after the ladder', async () => {
    const { controller, errors } = start({
      hls: FAST_HLS,
      recovery: { network: { noRetryStatuses: [], retryDelayMs: 20 } },
    });

    await waitFor(() => errors.length > 0, 8000);
    // hls.js's own retries, then three more rounds from the player's ladder.
    expect(errors[0]).toMatchObject({ httpCode: 403 });
    expect(segmentRequests).toBeGreaterThan(4);
    controller.destroy();
  });

  // Measures the out-of-the-box wait: hls.js retries for ~30s on its own first.
  it.skipIf(!process.env.STREAMIT_SLOW_TESTS)(
    'default settings: reports the refusal after hls.js has used its own retries (~30s)',
    async () => {
      const started = Date.now();
      const { controller, errors } = start({ hls: { loader: TestLoader, enableWorker: false } });

      await waitFor(() => errors.length > 0, 100000);
      const seconds = (Date.now() - started) / 1000;
      // eslint-disable-next-line no-console
      console.info(`[slow] default settings reported the error after ${seconds.toFixed(1)}s`);

      expect(errors[0]).toMatchObject({ httpCode: 403 });
      expect(seconds).toBeLessThan(60);
      controller.destroy();
    },
    120000
  );
});
