import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { fixture, html, elementUpdated } from '@open-wc/testing-helpers';
import type { PlayerPlayer } from './Player';
import './Player';

/**
 * `config.recovery` set on the element reaches the controller that uses it
 * (the stall watchdog reads it live; HLS/DASH read it when a source loads).
 */

function installJsdomMediaStubs(): void {
  for (const name of ['textTracks', 'audioTracks', 'videoTracks']) {
    const list: unknown[] & Record<string, unknown> = [] as never;
    list.addEventListener = () => {};
    list.removeEventListener = () => {};
    list.addTrack = () => {};
    Object.defineProperty(HTMLMediaElement.prototype, name, {
      configurable: true,
      get: () => list,
    });
  }
  HTMLMediaElement.prototype.play = () => Promise.resolve();
  HTMLMediaElement.prototype.pause = () => {};
  HTMLMediaElement.prototype.load = () => {};
}

beforeAll(() => {
  installJsdomMediaStubs();
});

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const recoveryOf = (el: PlayerPlayer) =>
  (el.controllerInstance as unknown as { config: { recovery?: unknown } }).config.recovery;

describe('config.recovery on <streamit-player>', () => {
  it('reaches the controller when set before the first render', async () => {
    const el = document.createElement('streamit-player') as PlayerPlayer;
    el.config = { recovery: { stall: { failAfterMs: 90000 }, network: { maxRetries: 5 } } };
    document.body.appendChild(el);
    await elementUpdated(el);

    expect(recoveryOf(el)).toEqual({ stall: { failAfterMs: 90000 }, network: { maxRetries: 5 } });
    el.remove();
  });

  it('reaches the controller when set afterwards, without a reload', async () => {
    const el = (await fixture(html`<streamit-player></streamit-player>`)) as PlayerPlayer;
    await elementUpdated(el);

    el.config = { recovery: { stall: { enabled: false } } };
    await elementUpdated(el);

    expect(recoveryOf(el)).toEqual({ stall: { enabled: false } });
  });

  it('warns about a bad value but still builds a working player', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const el = document.createElement('streamit-player') as PlayerPlayer;
    el.config = { recovery: { network: { maxRetries: 'many' } } } as never;
    document.body.appendChild(el);
    await elementUpdated(el);

    expect(warn.mock.calls.map((c) => String(c[0])).join('\n')).toMatch(/recovery\.network\.maxRetries/);
    expect(el.controllerInstance).toBeDefined();
    el.remove();
  });
});
