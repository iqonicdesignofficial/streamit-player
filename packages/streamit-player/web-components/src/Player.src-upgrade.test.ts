import { describe, it, expect, beforeAll } from 'vitest';
import type { PlayerPlayer } from './Player';

/**
 * The `src` attribute must survive the element being created before its
 * module registers it (frameworks that load the player lazily). Booleans such
 * as `autoplay` / `muted` were reported to come through while `src` sometimes
 * ended up empty and the video never loaded.
 *
 * Nothing here imports './Player' up front: the elements are created first,
 * then the module is loaded, which upgrades them.
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

const tick = () => new Promise((r) => setTimeout(r, 30));

function loadedSource(el: PlayerPlayer): string | undefined {
  return el.controllerInstance?.getState().currentSource ?? undefined;
}

describe('src before the element is upgraded', () => {
  let a: PlayerPlayer;
  let b: PlayerPlayer;
  let c: PlayerPlayer;
  let d: PlayerPlayer;
  let e: PlayerPlayer;

  beforeAll(async () => {
    installJsdomMediaStubs();

    // A: parsed markup, upgraded when the module registers the tag.
    document.body.innerHTML =
      '<streamit-player id="a" src="https://e.test/a.m3u8" autoplay muted></streamit-player>';
    // B: attribute set by script, then attached, before registration.
    b = document.createElement('streamit-player') as PlayerPlayer;
    b.setAttribute('src', 'https://e.test/b.m3u8');
    document.body.appendChild(b);
    // C: own property set on the not-yet-upgraded element.
    c = document.createElement('streamit-player') as PlayerPlayer;
    (c as unknown as Record<string, unknown>).src = 'https://e.test/c.m3u8';
    document.body.appendChild(c);
    // D: attribute set before registration, connected only afterwards.
    d = document.createElement('streamit-player') as PlayerPlayer;
    d.setAttribute('src', 'https://e.test/d.m3u8');
    // E: the legacy tag name.
    e = document.createElement('player-player') as PlayerPlayer;
    e.setAttribute('src', 'https://e.test/e.m3u8');
    document.body.appendChild(e);

    await import('./Player');
    await customElements.whenDefined('streamit-player');
    document.body.appendChild(d);
    a = document.getElementById('a') as PlayerPlayer;
    await tick();
  });

  it('keeps src from parsed markup (and the boolean attributes)', () => {
    expect(a.src).toBe('https://e.test/a.m3u8');
    expect(a.autoplay).toBe(true);
    expect(a.muted).toBe(true);
    expect(loadedSource(a)).toBe('https://e.test/a.m3u8');
  });

  it('keeps src set with setAttribute before registration', () => {
    expect(b.src).toBe('https://e.test/b.m3u8');
    expect(loadedSource(b)).toBe('https://e.test/b.m3u8');
  });

  it('keeps src set as a property before registration', () => {
    expect(c.src).toBe('https://e.test/c.m3u8');
    expect(loadedSource(c)).toBe('https://e.test/c.m3u8');
  });

  it('keeps src when the element is connected after registration', () => {
    expect(d.src).toBe('https://e.test/d.m3u8');
    expect(loadedSource(d)).toBe('https://e.test/d.m3u8');
  });

  it('keeps src on the legacy <player-player> tag', () => {
    expect(e.src).toBe('https://e.test/e.m3u8');
    expect(loadedSource(e)).toBe('https://e.test/e.m3u8');
  });

  it('loads the source exactly once per element', async () => {
    const f = document.createElement('streamit-player') as PlayerPlayer;
    f.setAttribute('src', 'https://e.test/f.m3u8');
    document.body.appendChild(f);
    await f.updateComplete;
    const controller = f.controllerInstance;
    let loads = 0;
    controller.addEventListener('sourcechange', () => loads++);
    await tick();

    expect(f.src).toBe('https://e.test/f.m3u8');
    expect(loads).toBe(0); // the initial load happened during the first update, not again afterwards
  });

  it('falls back to the attribute when the property is empty at first render', async () => {
    // The shape of the reported failure: the attribute carries the URL but the
    // property is still ''. Setting the property back to '' after the
    // attribute simulates it.
    const g = document.createElement('streamit-player') as PlayerPlayer;
    g.setAttribute('src', 'https://e.test/g.m3u8');
    g.src = '';
    document.body.appendChild(g);
    await g.updateComplete;
    await tick();

    expect(g.getAttribute('src')).toBe('https://e.test/g.m3u8');
    expect(g.src).toBe('https://e.test/g.m3u8');
  });
});
