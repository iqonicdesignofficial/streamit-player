import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HlsHandler } from './SourceManager';

/**
 * `config.hls` is handed to the hls.js constructor so integrators can tune
 * options such as `capLevelToPlayerSize`, buffer lengths or `fragLoadPolicy`
 * (and turn off `lowLatencyMode`, which is on by default).
 */

class FakeHls {
  static lastConfig: Record<string, unknown> | undefined;
  static isSupported = () => true;
  static Events = new Proxy({}, { get: (_t, p) => String(p) }) as Record<string, string>;
  static ErrorTypes = { NETWORK_ERROR: 'networkError', MEDIA_ERROR: 'mediaError', KEY_SYSTEM_ERROR: 'keySystemError' };

  levels: unknown[] = [];
  subtitleTracks: unknown[] = [];
  audioTracks: unknown[] = [];
  constructor(config: Record<string, unknown>) {
    FakeHls.lastConfig = config;
  }
  on() {}
  attachMedia() {}
  loadSource() {}
  destroy() {}
}

function makeController(config: Record<string, unknown> = {}, liveMode = 'live-dvr') {
  const state: Record<string, unknown> = { liveMode, error: null };
  return {
    config,
    getState: () => state,
    updateStatePublic: vi.fn(),
    reportFatalError: vi.fn(),
    dispatchEvent: vi.fn(),
    emit: vi.fn(),
    setManagedSubtitleTracks: vi.fn(),
    updateLiveState: vi.fn(),
  };
}

async function loadWith(
  config: Record<string, unknown> | undefined,
  options: { liveMode?: string; sourceDrm?: Record<string, unknown> } = {}
) {
  const handler = new HlsHandler();
  const controller = makeController(config, options.liveMode);
  handler.load(
    { src: 'https://example.test/a.m3u8', type: 'hls', drm: options.sourceDrm } as never,
    document.createElement('video'),
    controller as never
  );
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(0);
  return { handler, controller, hlsConfig: FakeHls.lastConfig! };
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeHls.lastConfig = undefined;
  (globalThis as { Hls?: unknown }).Hls = FakeHls;
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  delete (globalThis as { Hls?: unknown }).Hls;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('config.hls passthrough', () => {
  it('keeps the existing defaults when no hls config is given', async () => {
    const { hlsConfig } = await loadWith({});

    expect(hlsConfig).toMatchObject({
      enableWorker: true,
      lowLatencyMode: true,
      liveSyncDurationCount: 3,
    });
  });

  it('lets the integrator turn off lowLatencyMode', async () => {
    const { hlsConfig } = await loadWith({ hls: { lowLatencyMode: false } });

    expect(hlsConfig.lowLatencyMode).toBe(false);
  });

  it('forwards arbitrary hls.js options (capLevelToPlayerSize, buffers, fragLoadPolicy)', async () => {
    const fragLoadPolicy = {
      default: {
        maxTimeToFirstByteMs: 5000,
        maxLoadTimeMs: 15000,
        timeoutRetry: { maxNumRetry: 1, retryDelayMs: 0, maxRetryDelayMs: 0 },
        errorRetry: { maxNumRetry: 1, retryDelayMs: 500, maxRetryDelayMs: 1000 },
      },
    };
    const { hlsConfig } = await loadWith({
      hls: {
        capLevelToPlayerSize: true,
        maxBufferLength: 12,
        backBufferLength: 30,
        fragLoadPolicy,
      },
    });

    expect(hlsConfig.capLevelToPlayerSize).toBe(true);
    expect(hlsConfig.maxBufferLength).toBe(12);
    expect(hlsConfig.backBufferLength).toBe(30);
    expect(hlsConfig.fragLoadPolicy).toBe(fragLoadPolicy);
    // Untouched defaults survive next to the overrides.
    expect(hlsConfig.enableWorker).toBe(true);
    expect(hlsConfig.lowLatencyMode).toBe(true);
  });

  it('preserves non-serialisable options such as a custom loader class', async () => {
    class CustomLoader {}
    const { hlsConfig } = await loadWith({ hls: { loader: CustomLoader } });

    expect(hlsConfig.loader).toBe(CustomLoader);
  });

  it('lets the integrator override the live-latency defaults', async () => {
    const live = await loadWith({}, { liveMode: 'live-only' });
    expect(live.hlsConfig.liveMaxLatencyDurationCount).toBe(10);

    const tuned = await loadWith(
      { hls: { liveMaxLatencyDurationCount: 6, liveSyncDurationCount: 2 } },
      { liveMode: 'live-only' }
    );
    expect(tuned.hlsConfig.liveMaxLatencyDurationCount).toBe(6);
    expect(tuned.hlsConfig.liveSyncDurationCount).toBe(2);
  });

  it('never lets hls overrides disable or replace the DRM setup', async () => {
    const { hlsConfig } = await loadWith(
      {
        hls: {
          emeEnabled: false,
          licenseServers: { 'org.w3.clearkey': 'https://attacker.test' },
        },
      },
      { sourceDrm: { clearkey: { licenseUrl: 'https://license.test/ck' } } }
    );

    expect(hlsConfig.emeEnabled).toBe(true);
    expect(hlsConfig.licenseServers).toEqual({ 'org.w3.clearkey': 'https://license.test/ck' });
  });

  it('ignores an hls value that is not an object', async () => {
    const { hlsConfig } = await loadWith({ hls: 'nonsense' as never });

    expect(hlsConfig).toMatchObject({ enableWorker: true, lowLatencyMode: true });
  });
});
