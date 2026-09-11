import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PlayerController } from './PlayerController';
import type { PlayerSource } from './types';

/**
 * See PlayerController.test.ts for the rationale behind these stubs. jsdom's
 * `HTMLMediaElement.prototype.play`/`.pause()` are no-ops that never dispatch
 * events, so PlayerController (which learns about play/pause exclusively via
 * those events) needs them stubbed to dispatch synchronously. `.load()` is
 * stubbed to a no-op since jsdom doesn't implement real media loading.
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
  // jsdom doesn't implement canvas 2D contexts and logs a noisy "not
  // implemented" console.error every time PlayerController's Smart Seek
  // thumbnail provider (AutoThumbnailProvider -> VideoFrameThumbnailProvider)
  // is set up during loadSource(). It's caught internally and harmless, but
  // pollutes test output, so stub it to a no-op return here - unrelated to
  // the playlist behavior under test.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null);
}

function patchTextTracksEventTarget(video: HTMLVideoElement) {
  // jsdom's `video.textTracks` is a plain array, not a real TextTrackList
  // (which extends EventTarget in browsers) - see
  // node_modules/jsdom/lib/jsdom/living/nodes/HTMLMediaElement-impl.js
  // (`this.textTracks = []`). PlayerController's constructor unconditionally
  // calls `.addEventListener`/`.removeEventListener` on it, which is correct
  // against a real browser but throws against jsdom's stand-in. This patches
  // jsdom's gap so the controller can be constructed at all; it is not part
  // of the behavior under test.
  const tracks = video.textTracks as unknown as EventTarget;
  if (typeof (tracks as any).addEventListener !== 'function') {
    const target = new EventTarget();
    (tracks as any).addEventListener = target.addEventListener.bind(target);
    (tracks as any).removeEventListener = target.removeEventListener.bind(target);
    (tracks as any).dispatchEvent = target.dispatchEvent.bind(target);
  }
}

function patchAudioTracksEventTarget(video: HTMLVideoElement) {
  // Same gap as `textTracks` above but for `audioTracks`: jsdom exposes a
  // plain array-like, not a real AudioTrackList (which extends EventTarget
  // in browsers). Mp4Handler.load (SourceManager.ts) unconditionally calls
  // `.addEventListener`/`.removeEventListener` on it when present, which is
  // correct against a real browser but throws against jsdom's stand-in.
  const tracks = (video as any).audioTracks;
  if (tracks && typeof tracks.addEventListener !== 'function') {
    const target = new EventTarget();
    tracks.addEventListener = target.addEventListener.bind(target);
    tracks.removeEventListener = target.removeEventListener.bind(target);
    tracks.dispatchEvent = target.dispatchEvent.bind(target);
  }
}

function makeController(): { video: HTMLVideoElement; controller: PlayerController } {
  const video = document.createElement('video');
  patchTextTracksEventTarget(video);
  patchAudioTracksEventTarget(video);
  // Disable seek-smoothing's volume-ducking setTimeout so tests don't leave
  // a pending timer behind - unrelated to the behavior under test.
  const controller = new PlayerController(video, {
    preciseSeek: { seekSmoothing: false },
  });
  return { video, controller };
}

// `PlayerController.loadSource` (called internally by every playlist
// navigation method) requires a source.src that starts with an
// "acceptable" scheme (see `validateSource` in PlayerController.ts) or it
// is treated as invalid and never loaded. Use real-looking absolute URLs so
// the playlist items actually load rather than silently no-op.
function src(n: number): PlayerSource {
  return { src: `https://example.com/video${n}.mp4` };
}

// `PlayerController.loadSource` mutates whichever `PlayerSource` object
// becomes the active item in place (it sets `source.type = detectedType`
// once the type is detected - see PlayerController.ts). That means a
// `PlayerSource` object that has been loaded no longer deep-equals a freshly
// constructed `src(n)` (which has no `type` set yet), even though it's
// logically "the same" playlist item. These helpers compare by `src` (the
// identity that actually matters for these tests) instead of full deep
// equality, so assertions aren't coupled to that mutation side effect.
function expectSameSource(actual: PlayerSource | null, expected: PlayerSource) {
  expect(actual?.src).toBe(expected.src);
}

function expectSamePlaylist(actual: PlayerSource[], expected: PlayerSource[]) {
  expect(actual.map((s) => s.src)).toEqual(expected.map((s) => s.src));
}

describe('PlayerController playlist API', () => {
  beforeEach(() => {
    stubMediaMethods();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('loadPlaylist', () => {
    it('sets the playlist, clamps/loads the start index, and loads that item as the current source', () => {
      const { controller } = makeController();
      const sources = [src(1), src(2), src(3)];

      controller.loadPlaylist(sources, 1);

      expect(controller.getPlaylist()).toEqual(sources);
      expect(controller.getCurrentPlaylistIndex()).toBe(1);
      expectSameSource(controller.getCurrentPlaylistItem(), src(2));
      expect(controller.getState().currentSource).toBe(src(2).src);
    });

    it('clamps an out-of-range startIndex into [0, length - 1]', () => {
      const { controller } = makeController();
      const sources = [src(1), src(2), src(3)];

      controller.loadPlaylist(sources, 99);
      expect(controller.getCurrentPlaylistIndex()).toBe(2);

      controller.loadPlaylist(sources, -5);
      expect(controller.getCurrentPlaylistIndex()).toBe(0);
    });

    it('dispatches playlist-loaded and playlist-change with the new playlist', () => {
      const { controller } = makeController();
      const sources = [src(1), src(2)];
      const loadedSpy = vi.fn();
      const changeSpy = vi.fn();
      controller.addEventListener('playlist-loaded', loadedSpy);
      controller.addEventListener('playlist-change', changeSpy);

      controller.loadPlaylist(sources, 0);

      expect(loadedSpy).toHaveBeenCalledWith({ playlist: sources, startIndex: 0 });
      expect(changeSpy).toHaveBeenCalledWith({ playlist: sources });
    });

    it('loading an empty array clears an existing playlist instead of setting one', () => {
      const { controller } = makeController();
      controller.loadPlaylist([src(1), src(2)], 0);
      expect(controller.hasPlaylist()).toBe(true);

      controller.loadPlaylist([], 0);

      expect(controller.hasPlaylist()).toBe(false);
      expectSamePlaylist(controller.getPlaylist(), []);
      expect(controller.getCurrentPlaylistIndex()).toBe(0);
    });

    it('resets the navigation history stack', () => {
      const { controller } = makeController();
      controller.loadPlaylist([src(1), src(2), src(3)], 0);
      controller.next();
      expect(controller.getHistoryStack()).toEqual([0]);

      controller.loadPlaylist([src(4), src(5)], 0);

      expect(controller.getHistoryStack()).toEqual([]);
    });
  });

  describe('next / previous', () => {
    it('next() is a no-op when the playlist has 0 or 1 items', () => {
      const { controller } = makeController();
      controller.next();
      expect(controller.getCurrentPlaylistIndex()).toBe(0);

      controller.loadPlaylist([src(1)], 0);
      controller.next();
      expect(controller.getCurrentPlaylistIndex()).toBe(0);
      expectSameSource(controller.getCurrentPlaylistItem(), src(1));
    });

    it('next() advances the active index and loads the new item as current source', () => {
      const { controller } = makeController();
      controller.loadPlaylist([src(1), src(2), src(3)], 0);

      controller.next();

      expect(controller.getCurrentPlaylistIndex()).toBe(1);
      expect(controller.getState().currentSource).toBe(src(2).src);
    });

    it('next() wraps from the last item back to the first (independent of repeat mode)', () => {
      const { controller } = makeController();
      controller.loadPlaylist([src(1), src(2), src(3)], 2);
      expect(controller.isLastPlaylistItem()).toBe(true);
      // Verify next() wraps under the default 'off' repeat mode - the
      // wraparound in `next()` is unconditional in the real implementation
      // (it is `getAutoAdvanceIndexOnEnded()`, exercised below, that
      // actually branches on repeat mode), so this must hold regardless.
      expect(controller.getPlaylistRepeatMode()).toBe('off');

      controller.next();

      expect(controller.getCurrentPlaylistIndex()).toBe(0);
      expect(controller.getState().currentSource).toBe(src(1).src);
    });

    it('next() dispatches playlist-next with the target index/source before navigating', () => {
      const { controller } = makeController();
      controller.loadPlaylist([src(1), src(2)], 0);
      const spy = vi.fn();
      controller.addEventListener('playlist-next', spy);

      controller.next();

      expect(spy).toHaveBeenCalledTimes(1);
      const detail = spy.mock.calls[0][0];
      expect(detail.index).toBe(1);
      expect(detail.source.src).toBe(src(2).src);
    });

    it('previous() with empty history wraps from the first item to the last', () => {
      const { controller } = makeController();
      controller.loadPlaylist([src(1), src(2), src(3)], 0);
      expect(controller.getHistoryStack()).toEqual([]);

      controller.previous();

      expect(controller.getCurrentPlaylistIndex()).toBe(2);
      expect(controller.getState().currentSource).toBe(src(3).src);
    });

    it('previous() pops the real navigation history instead of naively decrementing the index', () => {
      const { controller } = makeController();
      controller.loadPlaylist([src(1), src(2), src(3)], 0);

      controller.next(); // index 0 -> 1, history becomes [0]
      controller.next(); // index 1 -> 2, history becomes [0, 1]
      expect(controller.getHistoryStack()).toEqual([0, 1]);
      expect(controller.getCurrentPlaylistIndex()).toBe(2);

      controller.previous(); // pops 1 off the real history stack

      expect(controller.getCurrentPlaylistIndex()).toBe(1);
      expect(controller.getHistoryStack()).toEqual([0]);

      controller.previous(); // pops 0

      expect(controller.getCurrentPlaylistIndex()).toBe(0);
      expect(controller.getHistoryStack()).toEqual([]);
    });

    it('previous() is a no-op when the playlist has 0 or 1 items', () => {
      const { controller } = makeController();
      controller.loadPlaylist([src(1)], 0);

      controller.previous();

      expect(controller.getCurrentPlaylistIndex()).toBe(0);
      expectSameSource(controller.getCurrentPlaylistItem(), src(1));
    });
  });

  describe('appendPlaylistItem', () => {
    it('appends to the playlist without changing the active index when the playlist is non-empty', () => {
      const { controller } = makeController();
      controller.loadPlaylist([src(1), src(2)], 0);

      controller.appendPlaylistItem(src(3));

      expectSamePlaylist(controller.getPlaylist(), [src(1), src(2), src(3)]);
      expect(controller.getCurrentPlaylistIndex()).toBe(0);
      expect(controller.getState().currentSource).toBe(src(1).src);
    });

    it('appending to an empty playlist loads the new item as current', () => {
      const { controller } = makeController();

      controller.appendPlaylistItem(src(1));

      expectSamePlaylist(controller.getPlaylist(), [src(1)]);
      expect(controller.getCurrentPlaylistIndex()).toBe(0);
      expect(controller.getState().currentSource).toBe(src(1).src);
    });

    it('dispatches playlist-item-added with the appended index/source', () => {
      const { controller } = makeController();
      controller.loadPlaylist([src(1)], 0);
      const spy = vi.fn();
      controller.addEventListener('playlist-item-added', spy);

      controller.appendPlaylistItem(src(2));

      expect(spy).toHaveBeenCalledWith({ index: 1, source: src(2) });
    });
  });

  describe('insertPlaylistItem', () => {
    it('inserting at or before the active index shifts the active index forward by one', () => {
      const { controller } = makeController();
      controller.loadPlaylist([src(1), src(2), src(3)], 1); // active = src(2)
      expectSameSource(controller.getCurrentPlaylistItem(), src(2));

      controller.insertPlaylistItem(0, src(9));

      expectSamePlaylist(controller.getPlaylist(), [src(9), src(1), src(2), src(3)]);
      // The active item is still src(2) - its index moved from 1 to 2.
      expect(controller.getCurrentPlaylistIndex()).toBe(2);
      expectSameSource(controller.getCurrentPlaylistItem(), src(2));
    });

    it('inserting after the active index leaves the active index unchanged', () => {
      const { controller } = makeController();
      controller.loadPlaylist([src(1), src(2), src(3)], 0);

      controller.insertPlaylistItem(2, src(9));

      expectSamePlaylist(controller.getPlaylist(), [src(1), src(2), src(9), src(3)]);
      expect(controller.getCurrentPlaylistIndex()).toBe(0);
      expectSameSource(controller.getCurrentPlaylistItem(), src(1));
    });

    it('ignores an out-of-range index', () => {
      const { controller } = makeController();
      controller.loadPlaylist([src(1), src(2)], 0);

      controller.insertPlaylistItem(-1, src(9));
      controller.insertPlaylistItem(99, src(9));

      expectSamePlaylist(controller.getPlaylist(), [src(1), src(2)]);
    });

    it('inserting into an empty playlist loads the new item as current', () => {
      const { controller } = makeController();

      controller.insertPlaylistItem(0, src(1));

      expectSamePlaylist(controller.getPlaylist(), [src(1)]);
      expect(controller.getCurrentPlaylistIndex()).toBe(0);
      expect(controller.getState().currentSource).toBe(src(1).src);
    });
  });

  describe('removePlaylistItem', () => {
    it('removing an item before the active index shifts the active index down by one, keeping the same active item', () => {
      const { controller } = makeController();
      controller.loadPlaylist([src(1), src(2), src(3)], 2); // active = src(3)

      controller.removePlaylistItem(0);

      expectSamePlaylist(controller.getPlaylist(), [src(2), src(3)]);
      expect(controller.getCurrentPlaylistIndex()).toBe(1);
      expectSameSource(controller.getCurrentPlaylistItem(), src(3));
    });

    it('removing an item after the active index leaves the active index unchanged', () => {
      const { controller } = makeController();
      controller.loadPlaylist([src(1), src(2), src(3)], 0);

      controller.removePlaylistItem(2);

      expectSamePlaylist(controller.getPlaylist(), [src(1), src(2)]);
      expect(controller.getCurrentPlaylistIndex()).toBe(0);
      expectSameSource(controller.getCurrentPlaylistItem(), src(1));
    });

    it('removing the active (non-last) item loads the item that slides into its slot', () => {
      const { controller } = makeController();
      controller.loadPlaylist([src(1), src(2), src(3)], 1); // active = src(2)

      controller.removePlaylistItem(1);

      expectSamePlaylist(controller.getPlaylist(), [src(1), src(3)]);
      expect(controller.getCurrentPlaylistIndex()).toBe(1);
      expectSameSource(controller.getCurrentPlaylistItem(), src(3));
      expect(controller.getState().currentSource).toBe(src(3).src);
    });

    it('removing the active last item falls back to index 0 (the removed index no longer fits in bounds)', () => {
      const { controller } = makeController();
      controller.loadPlaylist([src(1), src(2), src(3)], 2); // active = src(3)

      controller.removePlaylistItem(2);

      // Real behavior: `nextIndex = index >= newPlaylist.length ? 0 : index`
      // - removing the last item while it's active resets to index 0 rather
      // than falling back to the new last item.
      expectSamePlaylist(controller.getPlaylist(), [src(1), src(2)]);
      expect(controller.getCurrentPlaylistIndex()).toBe(0);
      expectSameSource(controller.getCurrentPlaylistItem(), src(1));
      expect(controller.getState().currentSource).toBe(src(1).src);
    });

    it('removing the last remaining item empties the playlist and clears the current source', () => {
      const { controller } = makeController();
      controller.loadPlaylist([src(1)], 0);
      const clearedSpy = vi.fn();
      controller.addEventListener('playlist-cleared', clearedSpy);

      controller.removePlaylistItem(0);

      expect(controller.hasPlaylist()).toBe(false);
      expectSamePlaylist(controller.getPlaylist(), []);
      expect(controller.getCurrentPlaylistIndex()).toBe(0);
      expect(clearedSpy).toHaveBeenCalledTimes(1);
      expect(controller.getState().currentSource).toBeNull();
    });

    it('ignores an out-of-range index', () => {
      const { controller } = makeController();
      controller.loadPlaylist([src(1), src(2)], 0);

      controller.removePlaylistItem(99);
      controller.removePlaylistItem(-1);

      expectSamePlaylist(controller.getPlaylist(), [src(1), src(2)]);
    });
  });

  describe('clearPlaylist', () => {
    it('empties the playlist, resets the active index, and clears the current source', () => {
      const { controller } = makeController();
      controller.loadPlaylist([src(1), src(2)], 1);

      controller.clearPlaylist();

      expect(controller.hasPlaylist()).toBe(false);
      expectSamePlaylist(controller.getPlaylist(), []);
      expect(controller.getCurrentPlaylistIndex()).toBe(0);
      expect(controller.getState().currentSource).toBeNull();
    });

    it('dispatches playlist-cleared and is a no-op on an already-empty playlist', () => {
      const { controller } = makeController();
      const spy = vi.fn();
      controller.addEventListener('playlist-cleared', spy);

      controller.clearPlaylist();
      expect(spy).not.toHaveBeenCalled();

      controller.loadPlaylist([src(1)], 0);
      controller.clearPlaylist();
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('resets the navigation history stack', () => {
      const { controller } = makeController();
      controller.loadPlaylist([src(1), src(2), src(3)], 0);
      controller.next();
      expect(controller.getHistoryStack()).toEqual([0]);

      controller.clearPlaylist();

      expect(controller.getHistoryStack()).toEqual([]);
    });
  });

  describe('replacePlaylistItem', () => {
    it('replacing a non-active item swaps it in place without touching the active index/source', () => {
      const { controller } = makeController();
      controller.loadPlaylist([src(1), src(2)], 0);

      controller.replacePlaylistItem(1, src(9));

      expectSamePlaylist(controller.getPlaylist(), [src(1), src(9)]);
      expect(controller.getCurrentPlaylistIndex()).toBe(0);
      expect(controller.getState().currentSource).toBe(src(1).src);
    });

    it('replacing the active item swaps it in place and reloads it as current source', () => {
      const { controller } = makeController();
      controller.loadPlaylist([src(1), src(2)], 0);

      controller.replacePlaylistItem(0, src(9));

      expectSamePlaylist(controller.getPlaylist(), [src(9), src(2)]);
      expect(controller.getCurrentPlaylistIndex()).toBe(0);
      expectSameSource(controller.getCurrentPlaylistItem(), src(9));
      expect(controller.getState().currentSource).toBe(src(9).src);
    });

    it('ignores an out-of-range index', () => {
      const { controller } = makeController();
      controller.loadPlaylist([src(1), src(2)], 0);

      controller.replacePlaylistItem(99, src(9));

      expectSamePlaylist(controller.getPlaylist(), [src(1), src(2)]);
    });
  });

  describe('movePlaylistItem', () => {
    it('moves an item and keeps the active index pointing at the same active item (active item moved)', () => {
      const { controller } = makeController();
      controller.loadPlaylist([src(1), src(2), src(3)], 0); // active = src(1)

      controller.movePlaylistItem(0, 2);

      expectSamePlaylist(controller.getPlaylist(), [src(2), src(3), src(1)]);
      expect(controller.getCurrentPlaylistIndex()).toBe(2);
      expectSameSource(controller.getCurrentPlaylistItem(), src(1));
    });

    it('shifts the active index down by one when an earlier item is moved past it', () => {
      const { controller } = makeController();
      controller.loadPlaylist([src(1), src(2), src(3)], 1); // active = src(2)

      controller.movePlaylistItem(0, 1);

      expectSamePlaylist(controller.getPlaylist(), [src(2), src(1), src(3)]);
      expect(controller.getCurrentPlaylistIndex()).toBe(0);
      expectSameSource(controller.getCurrentPlaylistItem(), src(2));
    });

    it('shifts the active index up by one when a later item is moved before it', () => {
      const { controller } = makeController();
      controller.loadPlaylist([src(1), src(2), src(3)], 1); // active = src(2)

      controller.movePlaylistItem(2, 1);

      expectSamePlaylist(controller.getPlaylist(), [src(1), src(3), src(2)]);
      expect(controller.getCurrentPlaylistIndex()).toBe(2);
      expectSameSource(controller.getCurrentPlaylistItem(), src(2));
    });

    it('leaves the active index unchanged when the move does not span it', () => {
      const { controller } = makeController();
      controller.loadPlaylist([src(1), src(2), src(3)], 0); // active = src(1)

      controller.movePlaylistItem(1, 2);

      expectSamePlaylist(controller.getPlaylist(), [src(1), src(3), src(2)]);
      expect(controller.getCurrentPlaylistIndex()).toBe(0);
      expectSameSource(controller.getCurrentPlaylistItem(), src(1));
    });

    it('is a no-op for out-of-range indices or a same-index move', () => {
      const { controller } = makeController();
      controller.loadPlaylist([src(1), src(2), src(3)], 0);

      controller.movePlaylistItem(0, 0);
      controller.movePlaylistItem(-1, 1);
      controller.movePlaylistItem(1, 99);

      expectSamePlaylist(controller.getPlaylist(), [src(1), src(2), src(3)]);
    });
  });

  describe('isFirstPlaylistItem / isLastPlaylistItem', () => {
    it('are both false when there is no playlist', () => {
      const { controller } = makeController();
      expect(controller.isFirstPlaylistItem()).toBe(false);
      expect(controller.isLastPlaylistItem()).toBe(false);
    });

    it('reflect the boundaries of a loaded playlist as the active index moves', () => {
      const { controller } = makeController();
      controller.loadPlaylist([src(1), src(2), src(3)], 0);

      expect(controller.isFirstPlaylistItem()).toBe(true);
      expect(controller.isLastPlaylistItem()).toBe(false);

      controller.next();
      expect(controller.isFirstPlaylistItem()).toBe(false);
      expect(controller.isLastPlaylistItem()).toBe(false);

      controller.next();
      expect(controller.isFirstPlaylistItem()).toBe(false);
      expect(controller.isLastPlaylistItem()).toBe(true);
    });

    it('a single-item playlist is both first and last', () => {
      const { controller } = makeController();
      controller.loadPlaylist([src(1)], 0);

      expect(controller.isFirstPlaylistItem()).toBe(true);
      expect(controller.isLastPlaylistItem()).toBe(true);
    });
  });

  describe('setPlaylistRepeatMode', () => {
    it('defaults to "off" and updates via getPlaylistRepeatMode()', () => {
      const { controller } = makeController();
      expect(controller.getPlaylistRepeatMode()).toBe('off');

      controller.setPlaylistRepeatMode('repeat-all');

      expect(controller.getPlaylistRepeatMode()).toBe('repeat-all');
    });

    it('dispatches playlist-repeat-change', () => {
      const { controller } = makeController();
      const spy = vi.fn();
      controller.addEventListener('playlist-repeat-change', spy);

      controller.setPlaylistRepeatMode('repeat-all');

      expect(spy).toHaveBeenCalledWith({ repeatMode: 'repeat-all' });
    });

    // setPlaylistRepeatMode does not gate manual next()/previous() wraparound
    // (that is unconditional, exercised above) - it gates what
    // getAutoAdvanceIndexOnEnded() reports for what should play next when
    // the current item ends naturally (e.g. autoplay-next-on-ended UI).
    it('repeat-all makes getAutoAdvanceIndexOnEnded() wrap from the last item back to index 0', () => {
      const { controller } = makeController();
      controller.loadPlaylist([src(1), src(2), src(3)], 2); // last item active
      expect(controller.isLastPlaylistItem()).toBe(true);

      expect(controller.getAutoAdvanceIndexOnEnded()).toBeNull();

      controller.setPlaylistRepeatMode('repeat-all');

      expect(controller.getAutoAdvanceIndexOnEnded()).toBe(0);
    });

    it('"off" leaves getAutoAdvanceIndexOnEnded() at null on the last item (no auto-wrap)', () => {
      const { controller } = makeController();
      controller.loadPlaylist([src(1), src(2), src(3)], 2); // last item active
      controller.setPlaylistRepeatMode('off');

      expect(controller.getAutoAdvanceIndexOnEnded()).toBeNull();
    });

    it('getAutoAdvanceIndexOnEnded() advances to the next index regardless of repeat mode when not on the last item', () => {
      const { controller } = makeController();
      controller.loadPlaylist([src(1), src(2), src(3)], 0);
      controller.setPlaylistRepeatMode('off');

      expect(controller.getAutoAdvanceIndexOnEnded()).toBe(1);
    });
  });
});
