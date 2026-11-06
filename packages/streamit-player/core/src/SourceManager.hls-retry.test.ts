import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HlsHandler } from './SourceManager';

/**
 * HlsHandler network-error recovery.
 *
 * Regression for "playback stays buffering forever when an HLS segment keeps
 * failing": the retry counter used to be reset by playlist events (which fire
 * again on every recovery) and nothing noticed a retry that went quiet, so the
 * "retries exhausted" fatal error was never reached.
 *
 * hls.js is replaced by a tiny fake that exposes `trigger()` so each test can
 * script exactly which events the library emits.
 */

type Listener = (event: string, data: unknown) => void;

class FakeHls {
  static instances: FakeHls[] = [];
  static isSupported = () => true;
  static Events = {
    MEDIA_ATTACHED: 'hlsMediaAttached',
    LEVEL_LOADED: 'hlsLevelLoaded',
    MANIFEST_PARSED: 'hlsManifestParsed',
    SUBTITLE_TRACK_SWITCH: 'hlsSubtitleTrackSwitch',
    SUBTITLE_TRACKS_UPDATED: 'hlsSubtitleTracksUpdated',
    LEVEL_SWITCHED: 'hlsLevelSwitched',
    AUDIO_TRACKS_UPDATED: 'hlsAudioTracksUpdated',
    AUDIO_TRACK_SWITCHED: 'hlsAudioTrackSwitched',
    FRAG_PARSING_METADATA: 'hlsFragParsingMetadata',
    FRAG_BUFFERED: 'hlsFragBuffered',
    ERROR: 'hlsError',
  };
  static ErrorTypes = {
    NETWORK_ERROR: 'networkError',
    MEDIA_ERROR: 'mediaError',
    KEY_SYSTEM_ERROR: 'keySystemError',
  };

  listeners = new Map<string, Listener[]>();
  levels: unknown[] = [];
  subtitleTracks: unknown[] = [];
  audioTracks: unknown[] = [];
  subtitleTrack = -1;
  startLoad = vi.fn();
  loadSource = vi.fn();
  attachMedia = vi.fn();
  detachMedia = vi.fn();
  recoverMediaError = vi.fn();
  swapAudioCodec = vi.fn();
  destroy = vi.fn();

  constructor() {
    FakeHls.instances.push(this);
  }

  on(event: string, fn: Listener) {
    const list = this.listeners.get(event) ?? [];
    list.push(fn);
    this.listeners.set(event, list);
  }

  trigger(event: string, data: unknown = {}) {
    (this.listeners.get(event) ?? []).forEach((fn) => fn(event, data));
  }
}

const SEGMENT_500 = {
  fatal: true,
  type: 'networkError',
  details: 'fragLoadError',
  response: { code: 500 },
};

/** The server refused the credentials (an expired signed URL): retrying cannot help. */
const SEGMENT_403 = {
  fatal: true,
  type: 'networkError',
  details: 'fragLoadError',
  response: { code: 403 },
};

function makeController(config: Record<string, unknown> = {}) {
  const state: Record<string, unknown> = {
    liveMode: 'vod',
    isLive: false,
    isLowLatency: false,
    error: null,
  };
  return {
    config,
    getState: () => state,
    updateStatePublic: vi.fn((changes: Record<string, unknown>) => Object.assign(state, changes)),
    reportFatalError: vi.fn((message: string) => {
      state.error = message;
    }),
    dispatchEvent: vi.fn(),
    emit: vi.fn(),
    setManagedSubtitleTracks: vi.fn(),
    updateLiveState: vi.fn(),
    state,
  };
}

/** A video element that is starving (nothing buffered, nothing to play). */
function makeVideo(overrides: Record<string, unknown> = {}) {
  return {
    readyState: 0,
    currentTime: 0,
    ended: false,
    paused: false,
    buffered: { length: 0, start: () => 0, end: () => 0 },
    ...overrides,
  };
}

async function setup(
  videoOverrides: Record<string, unknown> = {},
  config: Record<string, unknown> = {}
) {
  const handler = new HlsHandler();
  const controller = makeController(config);
  const video = makeVideo(videoOverrides);
  handler.load(
    { src: 'https://example.test/vod.m3u8', type: 'hls' } as never,
    video as never,
    controller as never
  );
  // loadHls() and loadDrmSetup() resolve through promise chains.
  await vi.advanceTimersByTimeAsync(0);
  const hls = FakeHls.instances[FakeHls.instances.length - 1];
  expect(hls).toBeDefined();
  return { handler, controller, video, hls };
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeHls.instances = [];
  (globalThis as { Hls?: unknown }).Hls = FakeHls;
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  delete (globalThis as { Hls?: unknown }).Hls;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('HlsHandler network error recovery', () => {
  it('retries with backoff and finally raises an error when every attempt fails fast', async () => {
    const { controller, hls } = await setup();

    for (let attempt = 1; attempt <= 3; attempt++) {
      hls.trigger(FakeHls.Events.ERROR, SEGMENT_500);
      await vi.advanceTimersByTimeAsync(Math.pow(2, attempt) * 1000);
      expect(hls.startLoad).toHaveBeenCalledTimes(attempt);
      expect(controller.state.error).toBeNull();
    }

    hls.trigger(FakeHls.Events.ERROR, SEGMENT_500);
    expect(controller.state.error).toMatch(/Fatal streaming connection failure/);
    expect(hls.destroy).toHaveBeenCalled();
  });

  it('does not reset the retry budget when playlists reload during recovery', async () => {
    // Recovery makes hls.js re-emit LEVEL_LOADED (always for live, and after
    // any level/manifest error). That must not count as progress.
    const { controller, hls } = await setup();

    for (let attempt = 1; attempt <= 3; attempt++) {
      hls.trigger(FakeHls.Events.ERROR, SEGMENT_500);
      await vi.advanceTimersByTimeAsync(Math.pow(2, attempt) * 1000);
      hls.trigger(FakeHls.Events.LEVEL_LOADED, { details: undefined });
      hls.trigger(FakeHls.Events.MANIFEST_PARSED);
    }

    hls.trigger(FakeHls.Events.ERROR, SEGMENT_500);
    expect(controller.state.error).not.toBeNull();
  });

  it('gives up with an error when a retry goes silent (hls.js never reports again)', async () => {
    // The reported bug: after retry 1/3 nothing else happens and the player
    // sits in "buffering" indefinitely.
    const { controller, hls } = await setup();

    hls.trigger(FakeHls.Events.ERROR, SEGMENT_500);
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);

    expect(hls.startLoad.mock.calls.length).toBe(3);
    expect(controller.state.error).toEqual(expect.any(String));
    expect(controller.state.error).not.toBeNull();
    expect(hls.destroy).toHaveBeenCalled();
  });

  it('resets the retry budget once a main-stream fragment is buffered', async () => {
    const { controller, hls } = await setup();

    // Burn two retries...
    for (let attempt = 1; attempt <= 2; attempt++) {
      hls.trigger(FakeHls.Events.ERROR, SEGMENT_500);
      await vi.advanceTimersByTimeAsync(Math.pow(2, attempt) * 1000);
    }
    // ...then the stream genuinely recovers.
    hls.trigger(FakeHls.Events.FRAG_BUFFERED, { frag: { type: 'main' } });

    // A fresh failure starts again from retry 1, so three more are tolerated.
    for (let attempt = 1; attempt <= 3; attempt++) {
      hls.trigger(FakeHls.Events.ERROR, SEGMENT_500);
      expect(controller.state.error).toBeNull();
      await vi.advanceTimersByTimeAsync(Math.pow(2, attempt) * 1000);
    }
    hls.trigger(FakeHls.Events.ERROR, SEGMENT_500);
    expect(controller.state.error).not.toBeNull();
  });

  it('ignores buffered audio/subtitle fragments as progress', async () => {
    const { controller, hls } = await setup();

    for (let attempt = 1; attempt <= 3; attempt++) {
      hls.trigger(FakeHls.Events.ERROR, SEGMENT_500);
      await vi.advanceTimersByTimeAsync(Math.pow(2, attempt) * 1000);
      hls.trigger(FakeHls.Events.FRAG_BUFFERED, { frag: { type: 'audio' } });
    }
    hls.trigger(FakeHls.Events.ERROR, SEGMENT_500);
    expect(controller.state.error).not.toBeNull();
  });

  it('stops watching once the stream recovers, so a healthy stream is never failed', async () => {
    const { controller, hls } = await setup();

    hls.trigger(FakeHls.Events.ERROR, SEGMENT_500);
    await vi.advanceTimersByTimeAsync(2000);
    expect(hls.startLoad).toHaveBeenCalledTimes(1);
    hls.trigger(FakeHls.Events.FRAG_BUFFERED, { frag: { type: 'main' } });

    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    expect(hls.startLoad).toHaveBeenCalledTimes(1);
    expect(controller.state.error).toBeNull();
  });

  it('does not count a retry as failed while the viewer still has plenty buffered', async () => {
    // Paused / far-ahead failures must not burn the retry budget: playback has
    // not actually stalled yet.
    const { controller, hls } = await setup({
      readyState: 4,
      currentTime: 10,
      buffered: { length: 1, start: () => 0, end: () => 60 },
    });

    hls.trigger(FakeHls.Events.ERROR, SEGMENT_500);
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

    expect(hls.startLoad).toHaveBeenCalledTimes(1);
    expect(controller.state.error).toBeNull();
  });

  it('starts counting once the buffered data runs out', async () => {
    const video = makeVideo({
      readyState: 4,
      currentTime: 10,
      buffered: { length: 1, start: () => 0, end: () => 60 },
    });
    const handler = new HlsHandler();
    const controller = makeController();
    handler.load({ src: 'https://example.test/vod.m3u8', type: 'hls' } as never, video as never, controller as never);
    await vi.advanceTimersByTimeAsync(0);
    const hls = FakeHls.instances[0];

    hls.trigger(FakeHls.Events.ERROR, SEGMENT_500);
    await vi.advanceTimersByTimeAsync(60 * 1000);
    expect(controller.state.error).toBeNull();

    // Playhead reaches the end of the buffer and playback starves.
    video.readyState = 1;
    video.currentTime = 60;
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);

    expect(controller.state.error).not.toBeNull();
  });

  it('retries manifest errors through loadSource and still finishes with an error', async () => {
    const { controller, hls } = await setup();
    const manifest404 = {
      fatal: true,
      type: 'networkError',
      details: 'manifestLoadError',
      response: { code: 404 },
    };

    hls.trigger(FakeHls.Events.ERROR, manifest404);
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);

    // MEDIA_ATTACHED never fired in the fake, so every loadSource is a retry.
    expect(hls.loadSource).toHaveBeenCalledTimes(3);
    expect(hls.startLoad).not.toHaveBeenCalled();
    expect(controller.state.error).toMatch(/Stream not found \(404\)/);
  });

  it('cancels pending retries when the handler is destroyed', async () => {
    const { handler, hls } = await setup();

    hls.trigger(FakeHls.Events.ERROR, SEGMENT_500);
    handler.destroy();
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);

    expect(hls.startLoad).not.toHaveBeenCalled();
  });
});

/**
 * Every fatal HLS failure must go through `controller.reportFatalError`, which
 * sets the error state AND dispatches the `error` event (what the web
 * component re-emits as `player-error`). Writing only `error` into state left
 * apps that listen for `player-error` unaware that playback had died.
 */
describe('HlsHandler fatal error reporting', () => {
  it('reports exhausted network retries', async () => {
    const { controller, hls } = await setup();

    for (let attempt = 1; attempt <= 3; attempt++) {
      hls.trigger(FakeHls.Events.ERROR, SEGMENT_500);
      await vi.advanceTimersByTimeAsync(Math.pow(2, attempt) * 1000);
    }
    hls.trigger(FakeHls.Events.ERROR, SEGMENT_500);

    expect(controller.reportFatalError).toHaveBeenCalledTimes(1);
    expect(controller.reportFatalError).toHaveBeenCalledWith(expect.stringMatching(/\S/), {
      httpCode: 500,
      details: 'fragLoadError',
    });
  });

  it('reports a manifest 404 with its specific message once retries run out', async () => {
    const { controller, hls } = await setup();
    const manifest404 = {
      fatal: true,
      type: 'networkError',
      details: 'manifestLoadError',
      response: { code: 404 },
    };

    for (let attempt = 1; attempt <= 3; attempt++) {
      hls.trigger(FakeHls.Events.ERROR, manifest404);
      await vi.advanceTimersByTimeAsync(Math.pow(2, attempt) * 1000);
    }
    hls.trigger(FakeHls.Events.ERROR, manifest404);

    expect(controller.reportFatalError).toHaveBeenCalledWith(
      'Stream not found (404). The URL may be expired, moved, or invalid.',
      { httpCode: 404, details: 'manifestLoadError' }
    );
  });

  it('reports media decoding failure after the three recovery stages', async () => {
    const { controller, hls } = await setup();
    const mediaError = { fatal: true, type: 'mediaError', details: 'bufferAppendError' };

    for (let i = 0; i < 3; i++) hls.trigger(FakeHls.Events.ERROR, mediaError);
    expect(controller.reportFatalError).not.toHaveBeenCalled();

    hls.trigger(FakeHls.Events.ERROR, mediaError);
    expect(controller.reportFatalError).toHaveBeenCalledWith('Fatal media decoding failure.');
    expect(hls.destroy).toHaveBeenCalled();
  });

  it('reports any other fatal hls.js error', async () => {
    const { controller, hls } = await setup();

    hls.trigger(FakeHls.Events.ERROR, {
      fatal: true,
      type: 'otherError',
      details: 'internalException',
    });

    expect(controller.reportFatalError).toHaveBeenCalledWith(
      'Fatal video stream initialization crash.'
    );
  });

  it('does not report non-fatal errors', async () => {
    const { controller, hls } = await setup();

    hls.trigger(FakeHls.Events.ERROR, { ...SEGMENT_500, fatal: false });

    expect(controller.reportFatalError).not.toHaveBeenCalled();
  });

  it('reports when hls.js is unsupported and there is no native HLS', async () => {
    FakeHls.isSupported = () => false;
    try {
      const handler = new HlsHandler();
      const controller = makeController();
      const video = { ...makeVideo(), canPlayType: () => '' };
      handler.load(
        { src: 'https://example.test/a.m3u8', type: 'hls' } as never,
        video as never,
        controller as never
      );
      await vi.advanceTimersByTimeAsync(0);

      expect(controller.reportFatalError).toHaveBeenCalledWith(
        'HLS streaming is not supported by your browser.'
      );
    } finally {
      FakeHls.isSupported = () => true;
    }
  });
});

/**
 * Media (decode) error recovery has its own budget: recoverMediaError, then
 * swapAudioCodec, then detach/attach, then give up. Like the network budget it
 * used to be restored by playlist events - which hls.js repeats constantly on
 * a live stream - so a persistent decode error could cycle forever.
 */
describe('HlsHandler media error recovery budget', () => {
  const MEDIA_ERROR = { fatal: true, type: 'mediaError', details: 'bufferAppendError' };

  it('is not restored by playlist reloads', async () => {
    const { controller, hls } = await setup();

    for (let i = 0; i < 3; i++) {
      hls.trigger(FakeHls.Events.ERROR, MEDIA_ERROR);
      hls.trigger(FakeHls.Events.LEVEL_LOADED, { details: undefined });
      hls.trigger(FakeHls.Events.MANIFEST_PARSED);
    }
    expect(controller.reportFatalError).not.toHaveBeenCalled();

    hls.trigger(FakeHls.Events.ERROR, MEDIA_ERROR);
    expect(controller.reportFatalError).toHaveBeenCalledWith('Fatal media decoding failure.');
  });

  it('is not restored by a fragment buffering without the playhead getting anywhere', async () => {
    const { controller, video, hls } = await setup();
    video.currentTime = 50;

    for (let i = 0; i < 3; i++) {
      hls.trigger(FakeHls.Events.ERROR, MEDIA_ERROR);
      video.currentTime += 2; // only creeps forward
      hls.trigger(FakeHls.Events.FRAG_BUFFERED, { frag: { type: 'main' } });
    }

    hls.trigger(FakeHls.Events.ERROR, MEDIA_ERROR);
    expect(controller.reportFatalError).toHaveBeenCalledWith('Fatal media decoding failure.');
  });

  it('is restored once playback has moved well past the failure', async () => {
    const { controller, video, hls } = await setup();
    video.currentTime = 50;

    // Two recoveries used up...
    hls.trigger(FakeHls.Events.ERROR, MEDIA_ERROR);
    hls.trigger(FakeHls.Events.ERROR, MEDIA_ERROR);
    // ...then 10+ seconds of real playback.
    video.currentTime = 65;
    hls.trigger(FakeHls.Events.FRAG_BUFFERED, { frag: { type: 'main' } });

    // A new, unrelated decode error gets the full three recovery stages again.
    for (let i = 0; i < 3; i++) hls.trigger(FakeHls.Events.ERROR, MEDIA_ERROR);
    expect(controller.reportFatalError).not.toHaveBeenCalled();
    expect(hls.recoverMediaError).toHaveBeenCalledTimes(2 + 2);

    hls.trigger(FakeHls.Events.ERROR, MEDIA_ERROR);
    expect(controller.reportFatalError).toHaveBeenCalledWith('Fatal media decoding failure.');
  });

  it('keeps the three-stage recovery order', async () => {
    const { hls, video } = await setup();

    hls.trigger(FakeHls.Events.ERROR, MEDIA_ERROR);
    expect(hls.recoverMediaError).toHaveBeenCalledTimes(1);
    expect(hls.swapAudioCodec).not.toHaveBeenCalled();

    hls.trigger(FakeHls.Events.ERROR, MEDIA_ERROR);
    expect(hls.swapAudioCodec).toHaveBeenCalledTimes(1);
    expect(hls.recoverMediaError).toHaveBeenCalledTimes(2);

    hls.trigger(FakeHls.Events.ERROR, MEDIA_ERROR);
    expect(hls.detachMedia).toHaveBeenCalledTimes(1);
    expect(hls.attachMedia).toHaveBeenLastCalledWith(video);
  });
});

/**
 * `config.recovery` replaces the hard-coded retry numbers. Defaults are pinned
 * by the tests above; these cover overriding them.
 */
describe('HlsHandler honours config.recovery', () => {
  const MEDIA_ERROR = { fatal: true, type: 'mediaError', details: 'bufferAppendError' };

  it('network.maxRetries: one retry, then the error', async () => {
    const { controller, hls } = await setup({}, { recovery: { network: { maxRetries: 1 } } });

    hls.trigger(FakeHls.Events.ERROR, SEGMENT_500);
    await vi.advanceTimersByTimeAsync(2000);
    expect(hls.startLoad).toHaveBeenCalledTimes(1);
    expect(controller.reportFatalError).not.toHaveBeenCalled();

    hls.trigger(FakeHls.Events.ERROR, SEGMENT_500);
    expect(controller.reportFatalError).toHaveBeenCalledTimes(1);
    expect(hls.startLoad).toHaveBeenCalledTimes(1);
  });

  it('network.maxRetries: 0 fails on the first error without reloading', async () => {
    const { controller, hls } = await setup({}, { recovery: { network: { maxRetries: 0 } } });

    hls.trigger(FakeHls.Events.ERROR, SEGMENT_500);
    await vi.advanceTimersByTimeAsync(60000);

    expect(controller.reportFatalError).toHaveBeenCalledTimes(1);
    expect(hls.startLoad).not.toHaveBeenCalled();
  });

  it('network.maxRetries: a larger budget is used in full', async () => {
    const { controller, hls } = await setup({}, { recovery: { network: { maxRetries: 5, retryDelayMs: 100 } } });

    for (let attempt = 1; attempt <= 5; attempt++) {
      hls.trigger(FakeHls.Events.ERROR, SEGMENT_500);
      await vi.advanceTimersByTimeAsync(100 * Math.pow(2, attempt - 1));
      expect(controller.reportFatalError).not.toHaveBeenCalled();
    }
    expect(hls.startLoad).toHaveBeenCalledTimes(5);
    hls.trigger(FakeHls.Events.ERROR, SEGMENT_500);
    expect(controller.reportFatalError).toHaveBeenCalledTimes(1);
  });

  it('network.retryDelayMs: sets the first delay and doubles it', async () => {
    const { hls } = await setup({}, { recovery: { network: { retryDelayMs: 500 } } });

    hls.trigger(FakeHls.Events.ERROR, SEGMENT_500);
    await vi.advanceTimersByTimeAsync(499);
    expect(hls.startLoad).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(hls.startLoad).toHaveBeenCalledTimes(1);

    hls.trigger(FakeHls.Events.ERROR, SEGMENT_500);
    await vi.advanceTimersByTimeAsync(999);
    expect(hls.startLoad).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(hls.startLoad).toHaveBeenCalledTimes(2);
  });

  it('network.attemptTimeoutMs: a silent attempt is failed after the configured time', async () => {
    const { controller, hls } = await setup(
      {},
      { recovery: { network: { maxRetries: 1, retryDelayMs: 100, attemptTimeoutMs: 3000 } } }
    );

    hls.trigger(FakeHls.Events.ERROR, SEGMENT_500);
    await vi.advanceTimersByTimeAsync(100); // reload happens
    expect(hls.startLoad).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(2999);
    expect(controller.reportFatalError).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(controller.reportFatalError).toHaveBeenCalledTimes(1);
  });

  it('media.resetAfterSeconds: needs that much playback before the budget is restored', async () => {
    const { controller, video, hls } = await setup({}, { recovery: { media: { resetAfterSeconds: 30 } } });
    video.currentTime = 100;
    hls.trigger(FakeHls.Events.ERROR, MEDIA_ERROR);
    hls.trigger(FakeHls.Events.ERROR, MEDIA_ERROR);

    video.currentTime = 125; // past the default 10s, short of 30s
    hls.trigger(FakeHls.Events.FRAG_BUFFERED, { frag: { type: 'main' } });
    hls.trigger(FakeHls.Events.ERROR, MEDIA_ERROR); // third stage
    hls.trigger(FakeHls.Events.ERROR, MEDIA_ERROR);
    expect(controller.reportFatalError).toHaveBeenCalledWith('Fatal media decoding failure.');
  });

  it('invalid values fall back to the defaults', async () => {
    const { controller, hls } = await setup(
      {},
      { recovery: { network: { maxRetries: 'lots', retryDelayMs: -1, attemptTimeoutMs: 'x' } } }
    );

    for (let attempt = 1; attempt <= 3; attempt++) {
      hls.trigger(FakeHls.Events.ERROR, SEGMENT_500);
      await vi.advanceTimersByTimeAsync(Math.pow(2, attempt) * 1000);
    }
    expect(hls.startLoad).toHaveBeenCalledTimes(3);
    hls.trigger(FakeHls.Events.ERROR, SEGMENT_500);
    expect(controller.reportFatalError).toHaveBeenCalledTimes(1);
  });
});

describe('HlsHandler does not retry what a retry cannot fix', () => {
  for (const code of [401, 403, 410]) {
    it(`reports HTTP ${code} on a segment at once, without reloading`, async () => {
      const { controller, hls } = await setup();

      hls.trigger(FakeHls.Events.ERROR, { ...SEGMENT_403, response: { code } });
      await vi.advanceTimersByTimeAsync(60000);

      expect(hls.startLoad).not.toHaveBeenCalled();
      expect(controller.reportFatalError).toHaveBeenCalledTimes(1);
      expect(controller.reportFatalError).toHaveBeenCalledWith(
        expect.stringContaining(`HTTP ${code}`),
        { httpCode: code, details: 'fragLoadError' }
      );
      expect(hls.destroy).toHaveBeenCalled();
    });
  }

  it('says the link may have expired, so an app knows to ask for a new one', async () => {
    const { controller, hls } = await setup();
    hls.trigger(FakeHls.Events.ERROR, SEGMENT_403);
    expect(controller.state.error).toMatch(/expired/i);
  });

  it('keeps the manifest wording for a refused manifest, and does not reload it', async () => {
    const { controller, hls } = await setup();

    hls.trigger(FakeHls.Events.ERROR, {
      fatal: true,
      type: 'networkError',
      details: 'manifestLoadError',
      response: { code: 403 },
    });
    await vi.advanceTimersByTimeAsync(60000);

    expect(hls.loadSource).not.toHaveBeenCalled();
    expect(controller.reportFatalError).toHaveBeenCalledTimes(1);
    expect(controller.reportFatalError).toHaveBeenCalledWith(
      expect.stringMatching(/Access denied \(403\)/),
      { httpCode: 403, details: 'manifestLoadError' }
    );
  });

  it('still retries a missing segment (404), a server error and an error with no code', async () => {
    for (const response of [{ code: 404 }, { code: 500 }, undefined]) {
      const { controller, hls } = await setup();
      hls.trigger(FakeHls.Events.ERROR, { ...SEGMENT_500, response });
      await vi.advanceTimersByTimeAsync(2000);

      expect(hls.startLoad).toHaveBeenCalledTimes(1);
      expect(controller.reportFatalError).not.toHaveBeenCalled();
    }
  });

  it('stops retrying as soon as a retry meets a refusal', async () => {
    const { controller, hls } = await setup();

    hls.trigger(FakeHls.Events.ERROR, SEGMENT_500);
    await vi.advanceTimersByTimeAsync(2000);
    expect(hls.startLoad).toHaveBeenCalledTimes(1);

    hls.trigger(FakeHls.Events.ERROR, SEGMENT_403);
    await vi.advanceTimersByTimeAsync(60000);

    expect(hls.startLoad).toHaveBeenCalledTimes(1);
    expect(controller.reportFatalError).toHaveBeenCalledTimes(1);
    expect(controller.reportFatalError).toHaveBeenCalledWith(expect.any(String), {
      httpCode: 403,
      details: 'fragLoadError',
    });
  });

  it('carries the HTTP code and detail on an error raised after the retries ran out', async () => {
    const { controller, hls } = await setup();
    for (let attempt = 1; attempt <= 3; attempt++) {
      hls.trigger(FakeHls.Events.ERROR, SEGMENT_500);
      await vi.advanceTimersByTimeAsync(Math.pow(2, attempt) * 1000);
    }
    hls.trigger(FakeHls.Events.ERROR, SEGMENT_500);

    expect(controller.reportFatalError).toHaveBeenCalledWith(expect.any(String), {
      httpCode: 500,
      details: 'fragLoadError',
    });
  });

  it('recovery.network.noRetryStatuses: [] restores "always retry"', async () => {
    const { controller, hls } = await setup({}, { recovery: { network: { noRetryStatuses: [] } } });

    hls.trigger(FakeHls.Events.ERROR, SEGMENT_403);
    await vi.advanceTimersByTimeAsync(2000);

    expect(hls.startLoad).toHaveBeenCalledTimes(1);
    expect(controller.reportFatalError).not.toHaveBeenCalled();
  });

  it('recovery.network.noRetryStatuses: a custom list replaces the default one', async () => {
    const { controller, hls } = await setup({}, { recovery: { network: { noRetryStatuses: [404] } } });

    hls.trigger(FakeHls.Events.ERROR, { ...SEGMENT_500, response: { code: 404 } });
    expect(controller.reportFatalError).toHaveBeenCalledTimes(1);

    const second = await setup({}, { recovery: { network: { noRetryStatuses: [404] } } });
    second.hls.trigger(FakeHls.Events.ERROR, SEGMENT_403); // no longer in the list
    await vi.advanceTimersByTimeAsync(2000);
    expect(second.hls.startLoad).toHaveBeenCalledTimes(1);
    expect(second.controller.reportFatalError).not.toHaveBeenCalled();
  });
});
