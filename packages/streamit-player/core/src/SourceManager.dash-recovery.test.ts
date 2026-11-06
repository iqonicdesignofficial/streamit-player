import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DashHandler } from './SourceManager';

/**
 * DashHandler network-error retries follow `config.recovery.network`
 * (`maxRetries`, `retryDelayMs`), like HLS. dash.js has no equivalent of the
 * HLS "silent attempt" watchdog, so `attemptTimeoutMs` does not apply here.
 *
 * `handleError` is dash.js' ERROR callback and private, so the handler is put
 * into the state `load()` would leave it in and the callback is invoked directly.
 */

function makeHandler(config: Record<string, unknown> = {}) {
  const player = {
    getSource: vi.fn(() => 'https://example.test/stream.mpd'),
    attachSource: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  };
  const controller = {
    config,
    updateStatePublic: vi.fn(),
    reportFatalError: vi.fn(),
    dispatchEvent: vi.fn(),
  };
  const video = { currentTime: 12, paused: true, play: vi.fn(() => Promise.resolve()) };

  const handler = new DashHandler();
  Object.assign(handler, { player, controller, video });
  const fail = () =>
    (handler as unknown as { handleError: (e: unknown) => void }).handleError({
      error: { message: 'segment download failed', status: 500 },
    });
  return { handler, player, controller, fail };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('DashHandler network error retries', () => {
  it('keeps the defaults: 3 retries at 2s, 4s, 8s, then a fatal error', async () => {
    const { player, controller, fail } = makeHandler();

    for (let attempt = 1; attempt <= 3; attempt++) {
      fail();
      await vi.advanceTimersByTimeAsync(Math.pow(2, attempt) * 1000 - 1);
      expect(player.attachSource).toHaveBeenCalledTimes(attempt - 1);
      await vi.advanceTimersByTimeAsync(1);
      expect(player.attachSource).toHaveBeenCalledTimes(attempt);
    }
    expect(controller.reportFatalError).not.toHaveBeenCalled();

    fail();
    expect(controller.reportFatalError).toHaveBeenCalledTimes(1);
    expect(controller.reportFatalError).toHaveBeenCalledWith(
      expect.stringContaining('DASH streaming error')
    );
  });

  it('honours recovery.network.maxRetries', async () => {
    const { player, controller, fail } = makeHandler({ recovery: { network: { maxRetries: 1 } } });

    fail();
    await vi.advanceTimersByTimeAsync(2000);
    expect(player.attachSource).toHaveBeenCalledTimes(1);

    fail();
    expect(controller.reportFatalError).toHaveBeenCalledTimes(1);
    expect(player.attachSource).toHaveBeenCalledTimes(1);
  });

  it('fails immediately with maxRetries: 0', async () => {
    const { player, controller, fail } = makeHandler({ recovery: { network: { maxRetries: 0 } } });

    fail();
    await vi.advanceTimersByTimeAsync(60000);

    expect(controller.reportFatalError).toHaveBeenCalledTimes(1);
    expect(player.attachSource).not.toHaveBeenCalled();
  });

  it('honours recovery.network.retryDelayMs and doubles it', async () => {
    const { player, fail } = makeHandler({ recovery: { network: { retryDelayMs: 250 } } });

    fail();
    await vi.advanceTimersByTimeAsync(249);
    expect(player.attachSource).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(player.attachSource).toHaveBeenCalledTimes(1);

    fail();
    await vi.advanceTimersByTimeAsync(499);
    expect(player.attachSource).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(player.attachSource).toHaveBeenCalledTimes(2);
  });

  it('never retries an authorization failure, whatever the budget', async () => {
    const { player, controller, handler } = makeHandler({ recovery: { network: { maxRetries: 10 } } });

    (handler as unknown as { handleError: (e: unknown) => void }).handleError({
      error: { message: 'forbidden', status: 403 },
    });
    await vi.advanceTimersByTimeAsync(60000);

    expect(player.attachSource).not.toHaveBeenCalled();
    // This path already reports through the DRM route (state + error event).
    expect(controller.updateStatePublic).toHaveBeenCalledWith({
      error: 'Media license acquisition request was denied.',
    });
    expect(controller.dispatchEvent).toHaveBeenCalledWith('error', {
      message: 'Media license acquisition request was denied.',
    });
  });
});
