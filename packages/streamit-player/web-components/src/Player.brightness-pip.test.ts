import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { fixture, html, elementUpdated } from '@open-wc/testing-helpers';
import type { PlayerPlayer } from './Player';
import './Player';

/** jsdom gaps PlayerController needs stubbed to mount (see Player.gestures.test.ts). */
function installJsdomMediaStubs(): void {
  for (const name of ['textTracks', 'audioTracks', 'videoTracks']) {
    const list: unknown[] & Record<string, unknown> = [];
    list.addEventListener = () => {};
    list.removeEventListener = () => {};
    list.addTrack = () => {};
    Object.defineProperty(HTMLMediaElement.prototype, name, { configurable: true, get: () => list });
  }
  HTMLMediaElement.prototype.play = () => Promise.resolve();
  HTMLMediaElement.prototype.pause = () => {};
  HTMLMediaElement.prototype.load = () => {};
}

function stubRect(el: Element, rect: { width: number; height: number; left?: number }): void {
  const left = rect.left ?? 0;
  (el as HTMLElement).getBoundingClientRect = () =>
    ({
      x: left,
      y: 0,
      top: 0,
      left,
      right: left + rect.width,
      bottom: rect.height,
      width: rect.width,
      height: rect.height,
      toJSON() {
        return this;
      },
    }) as DOMRect;
}

function mouse(type: string, clientX: number, clientY: number): MouseEvent {
  return new MouseEvent(type, { clientX, clientY, button: 0, bubbles: true, cancelable: true, composed: true });
}

async function mountPlayer(config: Record<string, unknown> = {}): Promise<PlayerPlayer> {
  const el = await fixture<PlayerPlayer>(html`<player-player></player-player>`);
  el.config = { autoplay: false, muted: true, ...config };
  await elementUpdated(el);
  // Without a source the player renders its empty state instead of the overlays.
  el.controllerInstance.updateStatePublic({ currentSource: { src: 'https://example.test/a.mp4' } });
  await elementUpdated(el);
  return el;
}

const root = (el: PlayerPlayer) => el.shadowRoot!;
const videoOf = (el: PlayerPlayer) => root(el).querySelector('video') as HTMLVideoElement;

beforeAll(installJsdomMediaStubs);
beforeEach(() => localStorage.clear());

describe('left-side brightness swipe', () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: false }));
  afterEach(() => vi.useRealTimers());

  async function swipeUp(el: PlayerPlayer, startX: number) {
    const video = videoOf(el);
    stubRect(video, { width: 400, height: 200 });
    video.dispatchEvent(mouse('mousedown', startX, 150));
    video.dispatchEvent(mouse('mousemove', startX, 100));
    video.dispatchEvent(mouse('mousemove', startX, 50));
    await elementUpdated(el);
  }

  it('brightens on swipe up on the left half and shows a percentage', async () => {
    const el = await mountPlayer();
    await swipeUp(el, 50);

    // 100px up over a 200px tall video = +50% from the 50% default.
    expect(el.brightnessLevel).toBeCloseTo(1);
    expect(videoOf(el).style.filter).toBe('brightness(1.500)');
    expect(root(el).querySelector('.brightness-feedback-overlay')?.textContent).toContain('100%');
    expect(localStorage.getItem('player_brightness')).toBe('1');
  });

  it('dims on swipe down on the left half', async () => {
    const el = await mountPlayer();
    const video = videoOf(el);
    stubRect(video, { width: 400, height: 200 });
    video.dispatchEvent(mouse('mousedown', 50, 50));
    video.dispatchEvent(mouse('mousemove', 50, 100));
    video.dispatchEvent(mouse('mousemove', 50, 150));
    await elementUpdated(el);

    expect(el.brightnessLevel).toBeCloseTo(0);
    expect(videoOf(el).style.filter).toBe('brightness(0.200)');
  });

  it('leaves brightness alone (and drives volume) on the right half', async () => {
    const el = await mountPlayer();
    const setVolume = vi.spyOn(el.controllerInstance, 'setVolume');
    await swipeUp(el, 350);

    expect(el.brightnessLevel).toBe(0.5);
    expect(setVolume).toHaveBeenCalled();
  });

  it('can be disabled with gestures.brightness = false', async () => {
    const el = await mountPlayer({ gestures: { brightness: false } });
    await swipeUp(el, 50);
    expect(el.brightnessLevel).toBe(0.5);
    expect(root(el).querySelector('.brightness-feedback-overlay')).toBeNull();
  });

  it('fades the indicator out after a second', async () => {
    const el = await mountPlayer();
    await swipeUp(el, 50);
    expect(root(el).querySelector('.brightness-feedback-overlay')).not.toBeNull();

    vi.advanceTimersByTime(1300);
    await elementUpdated(el);
    expect(root(el).querySelector('.brightness-feedback-overlay')).toBeNull();
  });
});

describe('Picture-in-Picture placeholder', () => {
  it('shows an icon + label placeholder only while in PiP', async () => {
    const el = await mountPlayer();
    expect(root(el).querySelector('.pip-placeholder')).toBeNull();

    el.controllerInstance.updateStatePublic({ pictureInPicture: true });
    await elementUpdated(el);
    const placeholder = root(el).querySelector('.pip-placeholder');
    expect(placeholder).not.toBeNull();
    expect(placeholder!.textContent).toContain('Playing in Picture-in-Picture');
    expect(placeholder!.querySelector('svg')).not.toBeNull();
    // No poster configured: icon only, no thumbnail.
    expect(placeholder!.querySelector('img')).toBeNull();

    el.controllerInstance.updateStatePublic({ pictureInPicture: false });
    await elementUpdated(el);
    expect(root(el).querySelector('.pip-placeholder')).toBeNull();
  });

  it('uses the configured poster as a dimmed backdrop', async () => {
    const el = await mountPlayer({ poster: 'https://example.test/poster.jpg' });
    el.controllerInstance.updateStatePublic({ pictureInPicture: true });
    await elementUpdated(el);
    const img = root(el).querySelector('.pip-placeholder img') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe('https://example.test/poster.jpg');
  });
});
