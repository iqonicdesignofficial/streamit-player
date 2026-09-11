import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PlayerController } from './PlayerController';
import type { PlayerState } from './types';

/**
 * jsdom does not implement real media playback: `HTMLMediaElement.prototype.play`
 * and `.pause()` are no-ops that log "not implemented" and never dispatch the
 * `play`/`pause` events a real browser would fire. `PlayerController` learns
 * about play/pause state exclusively by listening for those events (see
 * `setupEventListeners` / `handlePlay` / `handlePause` in PlayerController.ts),
 * so the stubs below dispatch the events a real `<video>` would dispatch,
 * matching what `HTMLMediaElement.prototype.play()` returning a Promise and
 * `.pause()` returning synchronously would actually cause downstream.
 *
 * `volume`/`muted` setters, on the other hand, ARE implemented by jsdom and
 * genuinely dispatch a synchronous `volumechange` event on change (verified
 * against node_modules/jsdom's HTMLMediaElement-impl.js), so `setVolume`/
 * `setMuted` tests below rely on real jsdom behavior rather than a stub.
 */
function stubMediaMethods() {
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (
    this: HTMLVideoElement
  ) {
    this.dispatchEvent(new Event('play'));
    return Promise.resolve();
  });
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function (
    this: HTMLVideoElement
  ) {
    this.dispatchEvent(new Event('pause'));
  });
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
}

function patchTextTracksEventTarget(video: HTMLVideoElement) {
  // jsdom's `video.textTracks` is a plain array, not a real TextTrackList
  // (which extends EventTarget in browsers) - see
  // node_modules/jsdom/lib/jsdom/living/nodes/HTMLMediaElement-impl.js
  // (`this.textTracks = []`). PlayerController's constructor unconditionally
  // calls `.addEventListener`/`.removeEventListener` on it (setupEventListeners
  // / destroy()), which is correct against a real browser but throws against
  // jsdom's stand-in. This patches jsdom's gap so the controller can be
  // constructed at all; it is not part of the behavior under test.
  const tracks = video.textTracks as unknown as EventTarget;
  if (typeof (tracks as any).addEventListener !== 'function') {
    const target = new EventTarget();
    (tracks as any).addEventListener = target.addEventListener.bind(target);
    (tracks as any).removeEventListener = target.removeEventListener.bind(target);
    (tracks as any).dispatchEvent = target.dispatchEvent.bind(target);
  }
}

function makeController(): { video: HTMLVideoElement; controller: PlayerController } {
  const video = document.createElement('video');
  patchTextTracksEventTarget(video);
  // Disable seek-smoothing's volume-ducking setTimeout so seek() tests don't
  // leave a pending timer behind - unrelated to the behavior under test.
  const controller = new PlayerController(video, {
    preciseSeek: { seekSmoothing: false },
  });
  return { video, controller };
}

describe('PlayerController', () => {
  beforeEach(() => {
    stubMediaMethods();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('onStateChange diffing', () => {
    it('emits the current state immediately on subscribe', () => {
      const { controller } = makeController();
      const spy = vi.fn();
      controller.onStateChange(spy);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0][0].currentTime).toBe(0);
    });

    it('fires again when a single tracked key actually changes, and the diff between snapshots touches only that key', () => {
      const { controller } = makeController();
      const spy = vi.fn();
      controller.onStateChange(spy);
      expect(spy).toHaveBeenCalledTimes(1);
      const before: PlayerState = spy.mock.calls[0][0];

      controller.updateStatePublic({ currentTime: 42 });

      expect(spy).toHaveBeenCalledTimes(2);
      const after: PlayerState = spy.mock.calls[1][0];

      // Prove per-key diffing actually happened: exactly one key differs
      // between the two snapshots the subscriber received.
      const changedKeys = (Object.keys(after) as Array<keyof PlayerState>).filter(
        (k) => after[k] !== before[k]
      );
      expect(changedKeys).toEqual(['currentTime']);
      expect(after.currentTime).toBe(42);
    });

    it('does NOT re-fire the callback when updateState is called with an identical primitive value', () => {
      const { controller } = makeController();
      const spy = vi.fn();
      controller.onStateChange(spy);
      controller.updateStatePublic({ currentTime: 10 });
      expect(spy).toHaveBeenCalledTimes(2);

      // Same key, exact same value - isStateValueEqual should treat this as
      // a no-op and NOT invoke subscribers again.
      controller.updateStatePublic({ currentTime: 10 });
      expect(spy).toHaveBeenCalledTimes(2);
    });

    it('does NOT re-fire when an object-valued key is structurally identical (not just reference-equal)', () => {
      const { controller } = makeController();
      const spy = vi.fn();
      controller.onStateChange(spy);
      const initialRange = controller.getState().seekableRange;
      expect(spy).toHaveBeenCalledTimes(1);

      // A fresh object literal with the same {start, end} content as the
      // current seekableRange must be recognized as equal via the
      // isStateValueEqual special-case for 'seekableRange', not by
      // reference, so no callback should fire.
      controller.updateStatePublic({
        seekableRange: { start: initialRange.start, end: initialRange.end },
      });
      expect(spy).toHaveBeenCalledTimes(1);

      // Changing the actual content DOES fire.
      controller.updateStatePublic({ seekableRange: { start: 0, end: 5 } });
      expect(spy).toHaveBeenCalledTimes(2);
    });

    it('unsubscribe stops future callbacks', () => {
      const { controller } = makeController();
      const spy = vi.fn();
      const unsubscribe = controller.onStateChange(spy);
      expect(spy).toHaveBeenCalledTimes(1);

      unsubscribe();

      controller.updateStatePublic({ currentTime: 99 });
      expect(spy).toHaveBeenCalledTimes(1);
      // State itself still updates - only the subscription is removed.
      expect(controller.getState().currentTime).toBe(99);
    });
  });

  describe('playback API', () => {
    it('play() calls through to the stubbed video.play() and updates isPlaying via the play event', async () => {
      const { video, controller } = makeController();
      const playSpy = vi.spyOn(video, 'play');

      controller.play();

      expect(playSpy).toHaveBeenCalledTimes(1);
      // Our stub dispatches 'play' synchronously, which PlayerController
      // handles via handlePlay -> updateState({ isPlaying: true, ... }).
      expect(controller.getState().isPlaying).toBe(true);
      expect(controller.getState().status).toBe('playing');
    });

    it('pause() calls through to the stubbed video.pause() and updates isPlaying via the pause event', () => {
      const { video, controller } = makeController();
      controller.play();
      expect(controller.getState().isPlaying).toBe(true);

      const pauseSpy = vi.spyOn(video, 'pause');
      controller.pause();

      expect(pauseSpy).toHaveBeenCalledTimes(1);
      expect(controller.getState().isPlaying).toBe(false);
      expect(controller.getState().status).toBe('paused');
    });

    it('seek() clamps to duration, sets video.currentTime, and updates state', () => {
      const { video, controller } = makeController();
      controller.updateStatePublic({ duration: 100 });

      controller.seek(30);

      expect(video.currentTime).toBe(30);
      expect(controller.getState().currentTime).toBe(30);
      expect(controller.getState().isSeeking).toBe(true);
    });

    it('seek() clamps out-of-range targets into [0, duration]', () => {
      const { video, controller } = makeController();
      controller.updateStatePublic({ duration: 50 });

      controller.seek(9999);
      expect(video.currentTime).toBe(50);

      controller.seek(-20);
      expect(video.currentTime).toBe(0);
    });

    it('setVolume() sets video.volume and, via the real jsdom volumechange event, updates state.volume', () => {
      const { video, controller } = makeController();

      controller.setVolume(0.4);

      expect(video.volume).toBeCloseTo(0.4);
      expect(controller.getState().volume).toBeCloseTo(0.4);
    });

    it('setVolume() clamps into [0, 1]', () => {
      const { video, controller } = makeController();

      controller.setVolume(5);
      expect(video.volume).toBe(1);

      controller.setVolume(-5);
      expect(video.volume).toBe(0);
    });

    it('setMuted() sets video.muted and, via the real jsdom volumechange event, updates state.isMuted', () => {
      const { video, controller } = makeController();

      controller.setMuted(true);

      expect(video.muted).toBe(true);
      expect(controller.getState().isMuted).toBe(true);

      controller.setMuted(false);
      expect(video.muted).toBe(false);
      expect(controller.getState().isMuted).toBe(false);
    });
  });

  describe('destroy()', () => {
    it('removes the video event listeners so the internal handler no longer fires', () => {
      const { video, controller } = makeController();

      controller.destroy();

      // A real browser firing 'timeupdate' after destroy must NOT reach
      // PlayerController's handler (removed in destroy()). handleTimeUpdate
      // mutates this.state.currentTime directly, independent of whether any
      // stateCallbacks subscribers exist, so asserting on getState() here
      // proves the listener itself did not run - unlike asserting on a
      // subscriber spy, which would also pass if only stateCallbacks.clear()
      // ran and removeEventListener('timeupdate', ...) did not.
      const currentTimeBeforeDestroy = controller.getState().currentTime;
      video.currentTime = 5;
      video.dispatchEvent(new Event('timeupdate'));

      expect(controller.getState().currentTime).toBe(currentTimeBeforeDestroy);
    });

    it('clears all state-change subscribers directly (stateCallbacks.clear())', () => {
      const { controller } = makeController();
      const spy = vi.fn();
      controller.onStateChange(spy);
      const callsBeforeDestroy = spy.mock.calls.length;

      controller.destroy();
      controller.updateStatePublic({ currentTime: 123 });

      expect(spy).toHaveBeenCalledTimes(callsBeforeDestroy);
    });

    it('is idempotent - calling destroy() twice does not throw', () => {
      const { controller } = makeController();
      controller.destroy();
      expect(() => controller.destroy()).not.toThrow();
    });
  });
});
