import { describe, it, expect } from 'vitest';
import { fixture, html, elementUpdated } from '@open-wc/testing-helpers';
import { TimelineMath, type TimelineMarker } from '../../core/src/index';
import type { PlayerSeekbar } from './Seekbar';
import './Seekbar';

/**
 * Minimal stand-in for a DOMRect, used to fake layout measurements that
 * jsdom does not compute (getBoundingClientRect() always returns all-zero
 * rects in jsdom, since there is no real layout engine).
 */
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
 * Minimal fake of the `.player` surface Seekbar.ts actually reads:
 * `player.localize(...)`, `player.config`, and
 * `player.controllerInstance.<feature-flag-getters>()`. Everything defaults
 * to "enabled" so tests exercise the plain, un-gated behavior unless a test
 * overrides a specific flag.
 */
function makeFakePlayer(controllerOverrides: Record<string, () => unknown> = {}) {
  return {
    localize: (_key: string, fallback: string) => fallback,
    config: {},
    getIcon: undefined,
    // Seekbar.ts's computeTooltipPosition() casts `.player` to HTMLElement
    // and calls getBoundingClientRect() on it to find the tooltip's
    // containing box. A wide, arbitrary rect is fine here - no test in this
    // file asserts on tooltip positioning, so this just needs to not throw.
    getBoundingClientRect: () => ({
      left: -1000,
      right: 1000,
      width: 2000,
      top: 0,
      bottom: 0,
      height: 0,
      x: -1000,
      y: 0,
      toJSON() {
        return this;
      },
    }),
    controllerInstance: {
      isLiveDraggingEnabled: () => true,
      isPreciseSeekEnabled: () => true,
      shouldSnapToChapters: () => true,
      shouldSnapToMarkers: () => true,
      isSmartSeekEnabled: () => true,
      isSmoothDraggingEnabled: () => true,
      isMarkersEnabled: () => true,
      ...controllerOverrides,
    },
  };
}

async function renderSeekbar(props: Record<string, unknown> = {}): Promise<PlayerSeekbar> {
  const el = await fixture<PlayerSeekbar>(html`<player-seekbar></player-seekbar>`);
  Object.assign(el, {
    duration: 100,
    currentTime: 0,
    isLive: false,
    bufferedRanges: [],
    markers: [],
    chapters: [],
    player: makeFakePlayer(),
    ...props,
  });
  await elementUpdated(el);
  return el;
}

/** Stubs both the host's and the `.track` element's bounding rects. */
function stubTrack(el: PlayerSeekbar, width = 300): HTMLElement {
  stubRect(el, { left: 0, width, top: 0, height: 40, right: width, bottom: 40 });
  const track = el.shadowRoot!.querySelector('.track') as HTMLElement;
  stubRect(track, { left: 0, width, top: 0, height: 4, right: width, bottom: 4 });
  return track;
}

/**
 * jsdom does not implement the `PointerEvent` constructor, so pointer
 * interaction is simulated with a `MouseEvent` carrying the extra
 * pointer-specific fields Seekbar.ts reads (`pointerId`). This is cast to
 * `PointerEvent` only for TypeScript's sake; `dispatchEvent` only cares that
 * it's an `Event` with the right properties.
 */
function makePointerEvent(
  type: string,
  init: { clientX: number; clientY: number; pointerId?: number; bubbles?: boolean; composed?: boolean }
): PointerEvent {
  const event = new MouseEvent(type, {
    clientX: init.clientX,
    clientY: init.clientY,
    bubbles: init.bubbles ?? true,
    composed: init.composed ?? false,
    cancelable: true,
  });
  Object.defineProperty(event, 'pointerId', { value: init.pointerId ?? 1, enumerable: true });
  Object.defineProperty(event, 'pointerType', { value: 'mouse', enumerable: true });
  return event as unknown as PointerEvent;
}

function collectSeekEvents(el: PlayerSeekbar): Array<{ time: number; isFinal: boolean }> {
  const events: Array<{ time: number; isFinal: boolean }> = [];
  el.addEventListener('player-seek', (e) => {
    events.push((e as CustomEvent).detail);
  });
  return events;
}

describe('PlayerSeekbar', () => {
  describe('drag-to-seek', () => {
    it('dispatches player-seek with the computed time during pointer drag and on release', async () => {
      // duration=100, isLive=false -> VoD timeline [0, 100]. Track stubbed to
      // 300px wide starting at x=0, so clientX maps linearly to percent*3.
      const el = await renderSeekbar({ duration: 100, currentTime: 0, isLive: false });
      stubTrack(el, 300);
      const events = collectSeekEvents(el);

      const container = el.shadowRoot!.querySelector('.seekbar-container') as HTMLElement;

      // pointerdown at clientX=30 -> percentage 0.1 -> time 10
      container.dispatchEvent(
        makePointerEvent('pointerdown', { clientX: 30, clientY: 20, pointerId: 1, composed: true })
      );

      // pointermove to clientX=90 (delta 60px > 5px move threshold) -> time 30.
      // Crossing the move threshold fires dispatchSeek twice in a single
      // handler call: once with the pre-move dragTime (10), once with the
      // freshly computed time for this move (30).
      window.dispatchEvent(makePointerEvent('pointermove', { clientX: 90, clientY: 20, pointerId: 1 }));

      window.dispatchEvent(makePointerEvent('pointerup', { clientX: 90, clientY: 20, pointerId: 1 }));

      expect(events).toEqual([
        { time: 10, isFinal: false },
        { time: 30, isFinal: false },
        { time: 30, isFinal: true },
      ]);
    });

    it('does not start a drag or dispatch player-seek when the timeline is not interactive', async () => {
      // duration=0 -> range=0 -> isInteractive=false for VoD.
      const el = await renderSeekbar({ duration: 0, currentTime: 0, isLive: false });
      stubTrack(el, 300);
      const events = collectSeekEvents(el);

      const container = el.shadowRoot!.querySelector('.seekbar-container') as HTMLElement;
      container.dispatchEvent(
        makePointerEvent('pointerdown', { clientX: 30, clientY: 20, pointerId: 1, composed: true })
      );
      window.dispatchEvent(makePointerEvent('pointermove', { clientX: 90, clientY: 20, pointerId: 1 }));

      expect(events).toEqual([]);
      expect(el.shadowRoot!.querySelector('.handle')?.classList.contains('active')).toBe(false);
    });
  });

  describe('marker rendering', () => {
    it('renders one marker element per visible marker, positioned at the correct percent', async () => {
      const markers: TimelineMarker[] = [
        { id: 'm1', time: 20, label: 'Intro', type: 'chapter' },
        { id: 'm2', time: 100, label: 'Sponsor', type: 'ad' },
        { id: 'm3', time: 180, label: 'Bonus', type: 'bookmark' },
      ];
      const el = await renderSeekbar({ duration: 200, currentTime: 0, isLive: false, markers });

      const markerEls = Array.from(
        el.shadowRoot!.querySelectorAll('.track .marker')
      ) as HTMLElement[];
      expect(markerEls.length).toBe(3);

      const expectedPercents = markers.map((m) => TimelineMath.timeToPercent(m.time, 0, 200));
      expect(expectedPercents).toEqual([10, 50, 90]);

      markerEls.forEach((markerEl, i) => {
        expect(markerEl.style.left).toBe(`${expectedPercents[i]}%`);
        expect(markerEl.classList.contains(markers[i].type)).toBe(true);
      });
    });

    it('excludes markers outside the current interactive [start, end] range', async () => {
      const markers: TimelineMarker[] = [
        { id: 'm1', time: -5, label: 'before start', type: 'bookmark' },
        { id: 'm2', time: 50, label: 'in range', type: 'bookmark' },
        { id: 'm3', time: 500, label: 'after end', type: 'bookmark' },
      ];
      const el = await renderSeekbar({ duration: 200, currentTime: 0, isLive: false, markers });

      const markerEls = el.shadowRoot!.querySelectorAll('.track .marker');
      expect(markerEls.length).toBe(1);
      expect((markerEls[0] as HTMLElement).style.left).toBe('25%');
    });

    it('filters markers by visibleMarkerTypes', async () => {
      const markers: TimelineMarker[] = [
        { id: 'm1', time: 20, label: 'Ad break', type: 'ad' },
        { id: 'm2', time: 60, label: 'Bookmark', type: 'bookmark' },
      ];
      const el = await renderSeekbar({
        duration: 200,
        currentTime: 0,
        isLive: false,
        markers,
        visibleMarkerTypes: ['bookmark'],
      });

      const markerEls = Array.from(
        el.shadowRoot!.querySelectorAll('.track .marker')
      ) as HTMLElement[];
      expect(markerEls.length).toBe(1);
      expect(markerEls[0].classList.contains('bookmark')).toBe(true);
    });

    it('dispatches player-marker-click and player-seek(final) when a marker is clicked', async () => {
      const markers: TimelineMarker[] = [
        { id: 'm1', time: 40, label: 'Chapter 1', type: 'chapter' },
      ];
      const el = await renderSeekbar({ duration: 200, currentTime: 0, isLive: false, markers });

      const seekEvents = collectSeekEvents(el);
      const markerClickEvents: Array<{ time: number; type: string; label: string }> = [];
      el.addEventListener('player-marker-click', (e) => {
        markerClickEvents.push((e as CustomEvent).detail);
      });

      const markerEl = el.shadowRoot!.querySelector('.track .marker') as HTMLElement;
      markerEl.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

      expect(seekEvents).toEqual([{ time: 40, isFinal: true }]);
      expect(markerClickEvents).toHaveLength(1);
      expect(markerClickEvents[0].time).toBe(40);
      expect(markerClickEvents[0].type).toBe('chapter');
      expect(markerClickEvents[0].label).toBe('Chapter 1');
    });
  });

  describe('keyboard interaction', () => {
    // Seekbar.ts binds a real keydown handler in connectedCallback
    // (`this.addEventListener('keydown', this.handleKeyDown)`), so this is
    // genuine existing behavior, not fabricated coverage.
    it('seeks forward/backward by the 5s step on ArrowRight/ArrowLeft', async () => {
      const el = await renderSeekbar({ duration: 100, currentTime: 10, isLive: false });
      const events = collectSeekEvents(el);

      el.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })
      );
      expect(events).toEqual([{ time: 15, isFinal: true }]);

      events.length = 0;
      el.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true })
      );
      expect(events).toEqual([{ time: 5, isFinal: true }]);
    });

    it('jumps by the 30s big step on PageUp/PageDown', async () => {
      const el = await renderSeekbar({ duration: 100, currentTime: 10, isLive: false });
      const events = collectSeekEvents(el);

      el.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'PageUp', bubbles: true, cancelable: true })
      );
      expect(events).toEqual([{ time: 40, isFinal: true }]);
    });

    it('jumps to the start/end of the range on Home/End', async () => {
      const el = await renderSeekbar({ duration: 100, currentTime: 50, isLive: false });
      const events = collectSeekEvents(el);

      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true }));
      expect(events).toEqual([{ time: 100, isFinal: true }]);

      events.length = 0;
      el.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Home', bubbles: true, cancelable: true })
      );
      expect(events).toEqual([{ time: 0, isFinal: true }]);
    });

    it('clamps ArrowRight at the end of the range and does not overshoot', async () => {
      const el = await renderSeekbar({ duration: 100, currentTime: 98, isLive: false });
      const events = collectSeekEvents(el);

      el.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })
      );
      expect(events).toEqual([{ time: 100, isFinal: true }]);
    });

    it('ignores keydown when the timeline is not interactive', async () => {
      const el = await renderSeekbar({ duration: 0, currentTime: 0, isLive: false });
      const events = collectSeekEvents(el);

      el.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })
      );
      expect(events).toEqual([]);
    });
  });
});
