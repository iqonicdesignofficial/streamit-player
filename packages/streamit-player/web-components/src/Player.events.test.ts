import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { fixture, html, elementUpdated } from '@open-wc/testing-helpers';
import type { PlayerPlayer } from './Player';
import './Player';

/**
 * The README promises that every player event is dispatched on the element as
 * a bubbling `player-<name>` DOM event. These pin the events that used to be
 * emitted by the controller but never re-dispatched, plus the duplicate
 * `metadata` registration that dispatched `player-metadata` twice.
 *
 * (A compile-time guard in Player.ts additionally fails the build if a new
 * `PlayerEvents` key is not forwarded.)
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

async function mount(): Promise<PlayerPlayer> {
  const el = (await fixture(html`<player-player></player-player>`)) as PlayerPlayer;
  await elementUpdated(el);
  return el;
}

type Emit = (name: string, detail?: unknown) => void;

function emitter(el: PlayerPlayer): Emit {
  const controller = el.controllerInstance as unknown as { dispatchEvent: Emit };
  return (name, detail) => controller.dispatchEvent(name, detail);
}

const PREVIOUSLY_MISSING: Array<[string, unknown]> = [
  ['subtitletrackschanged', { tracks: [] }],
  ['subtitletrackchange', { activeTrack: null }],
  ['subtitleenabled', { activeTrack: null }],
  ['subtitledisabled', undefined],
  ['subtitleappearancechange', { appearance: {} }],
  ['audioTracksChanged', { audioTracks: ['English'] }],
  ['audioTrackChanged', { activeAudioTrack: 0 }],
  ['live-status-change', { isLive: true, isLowLatency: false }],
  ['live-sync-update', { latency: 3, isAtLiveEdge: true, playbackRate: 1 }],
  ['live-edge-sync', { latency: 3 }],
  ['sleeptimerstart', { setting: 10, secondsRemaining: 600, endTimeMs: 1 }],
  ['sleeptimerupdate', { secondsRemaining: 599, endTimeMs: 1 }],
  ['sleeptimerexpired', undefined],
  ['sleeptimercancelled', undefined],
  ['adschedulerconflict', { source: 'vmap', reason: 'overlap' }],
];

describe('controller events are re-dispatched on the element', () => {
  it.each(PREVIOUSLY_MISSING)('player-%s', async (name, detail) => {
    const el = await mount();
    const received: CustomEvent[] = [];
    el.addEventListener(`player-${name}`, (e) => received.push(e as CustomEvent));

    emitter(el)(name, detail);

    expect(received).toHaveLength(1);
    expect(received[0].bubbles).toBe(true);
    expect(received[0].composed).toBe(true);
    // CustomEvent turns an undefined detail into null.
    expect(received[0].detail).toEqual(detail ?? null);
  });

  it('dispatches player-metadata exactly once per event', async () => {
    const el = await mount();
    let count = 0;
    el.addEventListener('player-metadata', () => count++);

    emitter(el)('metadata', { timestamp: 0, type: 'ID3', sourceProtocol: 'hls' });

    expect(count).toBe(1);
  });

  it('still forwards the events that always worked', async () => {
    const el = await mount();
    const received: string[] = [];
    for (const name of ['play', 'pause', 'error', 'sourcechange']) {
      el.addEventListener(`player-${name}`, () => received.push(name));
    }

    const emit = emitter(el);
    emit('play');
    emit('pause');
    emit('error', { message: 'x' });
    emit('sourcechange', { source: null });

    expect(received).toEqual(['play', 'pause', 'error', 'sourcechange']);
  });
});
