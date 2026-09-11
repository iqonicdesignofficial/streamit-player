import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { fixture, html, elementUpdated } from '@open-wc/testing-helpers';
import type { PlayerPlayer } from './Player';
import './Player';

/**
 * Characterization tests for the UI-only concerns that live in Player.ts:
 * the pointer/touch gesture state machine (long-press-to-speed with its
 * lock/unlock states, double-tap-to-seek, swipe-to-navigate) and the
 * canvas double-buffer vertical-feed transition.
 *
 * These assert CURRENT behavior so that splitting Player.ts into
 * player-internals/* modules is provably behavior-preserving.
 *
 * jsdom gaps that have to be stubbed for any of this to run at all:
 *  - HTMLMediaElement.textTracks is a plain array-like with no
 *    addEventListener, which PlayerController subscribes to on construction.
 *  - play()/pause()/load() are "not implemented" in jsdom.
 *  - HTMLCanvasElement.getContext() is "not implemented"; the transition code
 *    already tolerates a null context, but stubbing a recording context lets
 *    the tests assert that frames are actually drawn into the double buffer.
 *  - getBoundingClientRect() always returns an all-zero rect (no layout
 *    engine), so element rects are stubbed where a gesture reads geometry.
 */

interface Ctx2DCall {
  op: string;
  args: unknown[];
}

const canvasCalls = new WeakMap<HTMLCanvasElement, Ctx2DCall[]>();

function makeTrackList(): unknown[] {
  const tracks: unknown[] & {
    addEventListener?: () => void;
    removeEventListener?: () => void;
    addTrack?: () => void;
  } = [];
  tracks.addEventListener = () => {};
  tracks.removeEventListener = () => {};
  tracks.addTrack = () => {};
  return tracks;
}

function installJsdomMediaStubs(): void {
  for (const name of ['textTracks', 'audioTracks', 'videoTracks']) {
    const list = makeTrackList();
    Object.defineProperty(HTMLMediaElement.prototype, name, {
      configurable: true,
      get: () => list,
    });
  }
  HTMLMediaElement.prototype.play = () => Promise.resolve();
  HTMLMediaElement.prototype.pause = () => {};
  HTMLMediaElement.prototype.load = () => {};

  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement) {
    const calls: Ctx2DCall[] = canvasCalls.get(this) || [];
    canvasCalls.set(this, calls);
    const record =
      (op: string) =>
      (...args: unknown[]) => {
        calls.push({ op, args });
      };
    return {
      fillStyle: '',
      fillRect: record('fillRect'),
      drawImage: record('drawImage'),
      clearRect: record('clearRect'),
    } as unknown as CanvasRenderingContext2D;
  } as unknown as typeof HTMLCanvasElement.prototype.getContext;
}

function stubRect(el: Element, rect: Partial<DOMRect>): void {
  const full = {
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    toJSON() {
      return this;
    },
    ...rect,
  } as DOMRect;
  (el as HTMLElement).getBoundingClientRect = () => full;
}

/**
 * jsdom implements neither the TouchEvent nor the Touch constructor, so touch
 * interaction is simulated with a plain Event carrying the only fields the
 * gesture code reads: `touches` / `changedTouches` with clientX / clientY.
 */
function makeTouchEvent(
  type: string,
  points: Array<{ clientX: number; clientY: number }>
): Event {
  const event = new Event(type, { bubbles: true, cancelable: true, composed: true });
  Object.defineProperty(event, 'touches', { value: points });
  Object.defineProperty(event, 'changedTouches', { value: points });
  return event;
}

function makeMouseEvent(type: string, init: { clientX: number; clientY: number }): MouseEvent {
  return new MouseEvent(type, {
    ...init,
    button: 0,
    bubbles: true,
    cancelable: true,
    composed: true,
  });
}

async function mountPlayer(
  props: Partial<Record<string, unknown>> = {}
): Promise<PlayerPlayer> {
  const el = await fixture<PlayerPlayer>(html`<player-player></player-player>`);
  Object.assign(el, props);
  await elementUpdated(el);
  return el;
}

function videoOf(el: PlayerPlayer): HTMLVideoElement {
  return el.shadowRoot!.querySelector('video') as HTMLVideoElement;
}

function containerOf(el: PlayerPlayer): HTMLElement {
  return el.shadowRoot!.querySelector('.player-container') as HTMLElement;
}

function speedOverlayText(el: PlayerPlayer): string | null {
  const overlay = el.shadowRoot!.querySelector('.speed-feedback-overlay');
  return overlay ? (overlay.textContent || '').trim() : null;
}

/** Puts the element into vertical display mode with a 2-item playlist. */
async function mountVerticalFeed(configOverrides: Record<string, unknown> = {}) {
  const el = await mountPlayer({
    displayMode: 'vertical',
    config: { displayMode: 'vertical', autoplay: false, muted: true, ...configOverrides },
  });
  el.loadPlaylist([{ src: 'https://example.test/a.mp4' }, { src: 'https://example.test/b.mp4' }], 0);
  await elementUpdated(el);
  return el;
}

beforeAll(() => {
  installJsdomMediaStubs();
});

beforeEach(() => {
  // PlayerController persists the playback rate (and other preferences) to
  // localStorage, so without this a test that locks 2× speed would leak that
  // rate into every player mounted afterwards.
  localStorage.clear();
});

describe('PlayerPlayer gesture state machine', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('long-press-to-speed lock/unlock', () => {
    it('enters HOLDING after the 500ms hold and raises the playback rate', async () => {
      const el = await mountVerticalFeed();
      const setRate = vi.spyOn(el.controllerInstance, 'setPlaybackRate');
      const video = videoOf(el);

      video.dispatchEvent(makeMouseEvent('mousedown', { clientX: 10, clientY: 100 }));
      // Nothing happens before the 500ms long-press threshold.
      vi.advanceTimersByTime(400);
      expect(setRate).not.toHaveBeenCalled();

      vi.advanceTimersByTime(150);
      await elementUpdated(el);

      expect(setRate).toHaveBeenCalledWith(2.0);
      expect(speedOverlayText(el)).toBe('Slide down to lock 2× speed');
    });

    it('HOLDING -> READY_TO_LOCK -> HOLDING follows the 40px vertical threshold', async () => {
      const el = await mountVerticalFeed();
      const video = videoOf(el);

      video.dispatchEvent(makeMouseEvent('mousedown', { clientX: 10, clientY: 100 }));
      vi.advanceTimersByTime(600);
      await elementUpdated(el);
      expect(speedOverlayText(el)).toBe('Slide down to lock 2× speed');

      // 30px down: still under the 40px threshold -> stays HOLDING.
      video.dispatchEvent(makeMouseEvent('mousemove', { clientX: 10, clientY: 130 }));
      await elementUpdated(el);
      expect(speedOverlayText(el)).toBe('Slide down to lock 2× speed');

      // 50px down: crosses the threshold -> READY_TO_LOCK.
      video.dispatchEvent(makeMouseEvent('mousemove', { clientX: 10, clientY: 150 }));
      await elementUpdated(el);
      expect(speedOverlayText(el)).toBe('Release to lock 2× speed');

      // Back under the threshold -> returns to HOLDING.
      video.dispatchEvent(makeMouseEvent('mousemove', { clientX: 10, clientY: 120 }));
      await elementUpdated(el);
      expect(speedOverlayText(el)).toBe('Slide down to lock 2× speed');
    });

    it('releasing from HOLDING restores the pre-long-press rate and clears the overlay', async () => {
      const el = await mountVerticalFeed();
      const setRate = vi.spyOn(el.controllerInstance, 'setPlaybackRate');
      const video = videoOf(el);

      video.dispatchEvent(makeMouseEvent('mousedown', { clientX: 10, clientY: 100 }));
      vi.advanceTimersByTime(600);
      await elementUpdated(el);
      setRate.mockClear();

      video.dispatchEvent(makeMouseEvent('mouseup', { clientX: 10, clientY: 100 }));
      await elementUpdated(el);
      // Restored to the rate captured before the long press began.
      expect(setRate).toHaveBeenCalledWith(1);

      // Overlay fades out over 250ms, then disappears entirely.
      vi.advanceTimersByTime(300);
      await elementUpdated(el);
      expect(speedOverlayText(el)).toBeNull();
    });

    it('releasing from READY_TO_LOCK locks the speed instead of restoring it', async () => {
      const el = await mountVerticalFeed();
      const setRate = vi.spyOn(el.controllerInstance, 'setPlaybackRate');
      const video = videoOf(el);

      video.dispatchEvent(makeMouseEvent('mousedown', { clientX: 10, clientY: 100 }));
      vi.advanceTimersByTime(600);
      video.dispatchEvent(makeMouseEvent('mousemove', { clientX: 10, clientY: 150 }));
      await elementUpdated(el);
      setRate.mockClear();

      video.dispatchEvent(makeMouseEvent('mouseup', { clientX: 10, clientY: 150 }));
      await elementUpdated(el);

      // LOCKED: the rate is deliberately NOT restored.
      expect(setRate).not.toHaveBeenCalled();
      expect(speedOverlayText(el)).toBe('Slide down for normal speed');
    });

    it('a locked press re-enters LOCKED_HOLDING and can be released to unlock', async () => {
      const el = await mountVerticalFeed();
      const video = videoOf(el);

      // First press: lock it.
      video.dispatchEvent(makeMouseEvent('mousedown', { clientX: 10, clientY: 100 }));
      vi.advanceTimersByTime(600);
      video.dispatchEvent(makeMouseEvent('mousemove', { clientX: 10, clientY: 150 }));
      video.dispatchEvent(makeMouseEvent('mouseup', { clientX: 10, clientY: 150 }));
      await elementUpdated(el);
      expect(speedOverlayText(el)).toBe('Slide down for normal speed');

      const setRate = vi.spyOn(el.controllerInstance, 'setPlaybackRate');

      // Second press while LOCKED -> LOCKED_HOLDING (no rate change made).
      video.dispatchEvent(makeMouseEvent('mousedown', { clientX: 10, clientY: 100 }));
      vi.advanceTimersByTime(600);
      await elementUpdated(el);
      expect(setRate).not.toHaveBeenCalled();
      expect(speedOverlayText(el)).toBe('Slide down for normal speed');

      // Slide past the threshold -> READY_TO_UNLOCK.
      video.dispatchEvent(makeMouseEvent('mousemove', { clientX: 10, clientY: 150 }));
      await elementUpdated(el);
      expect(speedOverlayText(el)).toBe('Release for normal speed');

      // Release -> rate restored, state machine returns to IDLE.
      video.dispatchEvent(makeMouseEvent('mouseup', { clientX: 10, clientY: 150 }));
      await elementUpdated(el);
      expect(setRate).toHaveBeenCalledWith(1);

      vi.advanceTimersByTime(300);
      await elementUpdated(el);
      expect(speedOverlayText(el)).toBeNull();
    });

    it('cancels the pending long press when the gesture turns into a horizontal swipe', async () => {
      const el = await mountVerticalFeed();
      const setRate = vi.spyOn(el.controllerInstance, 'setPlaybackRate');
      const seek = vi.spyOn(el.controllerInstance, 'seek');
      const video = videoOf(el);
      stubRect(video, { left: 0, top: 0, width: 400, height: 800, right: 400, bottom: 800 });

      video.dispatchEvent(makeMouseEvent('mousedown', { clientX: 100, clientY: 400 }));
      // Move horizontally past the 10px hypot threshold before 500ms elapses.
      video.dispatchEvent(makeMouseEvent('mousemove', { clientX: 160, clientY: 402 }));
      vi.advanceTimersByTime(1000);
      await elementUpdated(el);

      expect(setRate).not.toHaveBeenCalled();
      expect(speedOverlayText(el)).toBeNull();
      // Horizontal drag scrubs instead - but only with a known duration, which
      // jsdom's media element never reports, so no seek is issued here.
      expect(seek).not.toHaveBeenCalled();
    });
  });

  describe('double-tap-to-seek', () => {
    it('seeks backward on a double tap in the left half and shows the rewind overlay', async () => {
      const el = await mountVerticalFeed();
      const seekBy = vi.spyOn(el.controllerInstance, 'seekBy');
      const video = videoOf(el);
      stubRect(video, { left: 0, top: 0, width: 400, height: 800, right: 400, bottom: 800 });

      // First tap: starts the 250ms single-tap timer.
      video.dispatchEvent(makeMouseEvent('mousedown', { clientX: 50, clientY: 400 }));
      video.dispatchEvent(makeMouseEvent('mouseup', { clientX: 50, clientY: 400 }));
      vi.advanceTimersByTime(100);
      // Second tap inside the 300ms double-tap window.
      video.dispatchEvent(makeMouseEvent('mousedown', { clientX: 50, clientY: 400 }));
      video.dispatchEvent(makeMouseEvent('mouseup', { clientX: 50, clientY: 400 }));

      expect(seekBy).toHaveBeenCalledWith(-10);

      // The seek feedback overlay is scheduled behind two rAFs.
      await vi.advanceTimersByTimeAsync(50);
      await elementUpdated(el);
      const overlay = el.shadowRoot!.querySelector('.feedback-overlay');
      expect(overlay).toBeTruthy();
      expect(overlay!.classList.contains('rewind')).toBe(true);
      expect((overlay!.textContent || '').replace(/\s+/g, '')).toContain('10s');
    });

    it('seeks forward on a double tap in the right half', async () => {
      const el = await mountVerticalFeed();
      const seekBy = vi.spyOn(el.controllerInstance, 'seekBy');
      const video = videoOf(el);
      stubRect(video, { left: 0, top: 0, width: 400, height: 800, right: 400, bottom: 800 });

      video.dispatchEvent(makeMouseEvent('mousedown', { clientX: 350, clientY: 400 }));
      video.dispatchEvent(makeMouseEvent('mouseup', { clientX: 350, clientY: 400 }));
      vi.advanceTimersByTime(100);
      video.dispatchEvent(makeMouseEvent('mousedown', { clientX: 350, clientY: 400 }));
      video.dispatchEvent(makeMouseEvent('mouseup', { clientX: 350, clientY: 400 }));

      expect(seekBy).toHaveBeenCalledWith(10);
    });

    it('a lone tap falls through to the single-tap play toggle after 250ms', async () => {
      const el = await mountVerticalFeed();
      const togglePlay = vi.spyOn(el.controllerInstance, 'togglePlay');
      const video = videoOf(el);
      stubRect(video, { left: 0, top: 0, width: 400, height: 800, right: 400, bottom: 800 });

      video.dispatchEvent(makeMouseEvent('mousedown', { clientX: 50, clientY: 400 }));
      video.dispatchEvent(makeMouseEvent('mouseup', { clientX: 50, clientY: 400 }));
      expect(togglePlay).not.toHaveBeenCalled();

      vi.advanceTimersByTime(260);
      expect(togglePlay).toHaveBeenCalledTimes(1);
    });
  });
});

describe('PlayerPlayer vertical-feed transition (canvas double buffer)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('drives the transition stages and locks out a concurrent navigation', async () => {
    const el = await mountVerticalFeed();
    const next = vi.spyOn(el.controllerInstance, 'next');

    el.next();
    await elementUpdated(el);

    const container = containerOf(el);
    expect(container.classList.contains('feed-transitioning')).toBe(true);
    expect(container.classList.contains('transition-direction-next')).toBe(true);
    expect(container.classList.contains('transition-stage-start')).toBe(true);
    // The source switch is deliberately deferred until the animation starts.
    expect(next).not.toHaveBeenCalled();

    // A second navigation while the transition is locked is a no-op.
    el.next();
    el.previous();

    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    await elementUpdated(el);

    expect(containerOf(el).classList.contains('transition-stage-active')).toBe(true);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('paints the outgoing frame into the double-height buffer canvas', async () => {
    const el = await mountVerticalFeed();
    const canvas = el.shadowRoot!.querySelector('canvas.transition-canvas') as HTMLCanvasElement;
    const wrapper = el.shadowRoot!.querySelector('.video-wrapper') as HTMLElement;
    stubRect(wrapper, { left: 0, top: 0, width: 360, height: 640, right: 360, bottom: 640 });

    el.next();
    await elementUpdated(el);

    // Double buffer: one viewport-sized slot for the outgoing frame and one
    // for the incoming frame, stacked vertically in a single canvas.
    expect(canvas.width).toBe(360);
    expect(canvas.height).toBe(1280);

    const calls = canvasCalls.get(canvas) || [];
    // Both halves are painted (outgoing at y=0, incoming at y=canvasHeight for
    // direction 'next'); jsdom's video never reaches readyState>=2 so both
    // land as black fills rather than drawImage.
    const fills = calls.filter((c) => c.op === 'fillRect');
    expect(fills.map((c) => c.args)).toEqual(
      expect.arrayContaining([
        [0, 0, 360, 640],
        [0, 640, 360, 640],
      ])
    );
  });

  it('ends the transition once the animation timeout fires and the video reports data', async () => {
    const el = await mountVerticalFeed();

    el.next();
    await elementUpdated(el);
    expect(containerOf(el).classList.contains('feed-transitioning')).toBe(true);

    // Fallback timeout (700ms) stands in for a missing `transitionend`.
    await new Promise((resolve) => setTimeout(resolve, 750));
    // The animation is finished but the incoming video is not ready yet
    // (jsdom never loads media), so the transition is held open until the
    // media both reports readyState >= HAVE_CURRENT_DATA and fires an event.
    const video = videoOf(el);
    Object.defineProperty(video, 'readyState', { configurable: true, get: () => 2 });
    video.dispatchEvent(new Event('loadeddata'));
    await elementUpdated(el);

    const container = containerOf(el);
    expect(container.classList.contains('feed-transitioning')).toBe(false);
    expect(container.classList.contains('transition-stage-idle')).toBe(true);
  });

  it('swiping up past the threshold commits a next-item drag preview', async () => {
    const el = await mountVerticalFeed();
    const next = vi.spyOn(el.controllerInstance, 'next');
    const canvas = el.shadowRoot!.querySelector('canvas.transition-canvas') as HTMLCanvasElement;
    const wrapper = el.shadowRoot!.querySelector('.video-wrapper') as HTMLElement;
    stubRect(wrapper, { left: 0, top: 0, width: 360, height: 640, right: 360, bottom: 640 });
    const video = videoOf(el);

    video.dispatchEvent(makeTouchEvent('touchstart', [{ clientX: 100, clientY: 500 }]));
    video.dispatchEvent(makeTouchEvent('touchmove', [{ clientX: 100, clientY: 420 }]));
    // beginDragPreview defers its canvas work to the next update.
    await elementUpdated(el);
    await el.updateComplete;

    video.dispatchEvent(makeTouchEvent('touchmove', [{ clientX: 100, clientY: 380 }]));
    expect(canvas.style.transform).toBe('translateY(-120px)');

    video.dispatchEvent(makeTouchEvent('touchend', [{ clientX: 100, clientY: 380 }]));
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('releasing a drag preview below the threshold cancels without navigating', async () => {
    const el = await mountVerticalFeed();
    const next = vi.spyOn(el.controllerInstance, 'next');
    const wrapper = el.shadowRoot!.querySelector('.video-wrapper') as HTMLElement;
    stubRect(wrapper, { left: 0, top: 0, width: 360, height: 640, right: 360, bottom: 640 });
    const video = videoOf(el);

    video.dispatchEvent(makeTouchEvent('touchstart', [{ clientX: 100, clientY: 500 }]));
    video.dispatchEvent(makeTouchEvent('touchmove', [{ clientX: 100, clientY: 480 }]));
    await elementUpdated(el);
    await el.updateComplete;

    video.dispatchEvent(makeTouchEvent('touchend', [{ clientX: 100, clientY: 480 }]));
    expect(next).not.toHaveBeenCalled();
  });
});
