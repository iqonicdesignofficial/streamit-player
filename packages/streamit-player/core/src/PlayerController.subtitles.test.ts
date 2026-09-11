import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PlayerController } from './PlayerController';
import type { SubtitleAppearance, SubtitleTrackKind } from './types';

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
}

/**
 * jsdom's `video.textTracks` is a plain array (see
 * node_modules/jsdom/lib/jsdom/living/nodes/HTMLMediaElement-impl.js -
 * `this.textTracks = []`), not a real TextTrackList (which extends
 * EventTarget in browsers, and which real browsers also populate
 * automatically when a `<track>` child element is added). jsdom does
 * neither: appending a `<track>` element does not add anything to
 * `video.textTracks`, and the array has no addEventListener/dispatchEvent.
 * PlayerController's constructor unconditionally calls
 * `.addEventListener`/`.removeEventListener` on `video.textTracks`
 * (setupEventListeners / destroy()), which is correct against a real
 * browser but throws against jsdom's stand-in. This patches jsdom's gap so
 * the controller can be constructed at all, and so tests can simulate a
 * track being added/changed by pushing a fake TextTrack-like object into
 * the array and dispatching 'addtrack'/'change' - exactly the events
 * PlayerController's `handleTrackChange` listens for to call
 * `refreshSubtitleTracks()`.
 */
function patchTextTracksEventTarget(video: HTMLVideoElement) {
  const tracks = video.textTracks as unknown as EventTarget;
  if (typeof (tracks as any).addEventListener !== 'function') {
    const target = new EventTarget();
    (tracks as any).addEventListener = target.addEventListener.bind(target);
    (tracks as any).removeEventListener = target.removeEventListener.bind(target);
    (tracks as any).dispatchEvent = target.dispatchEvent.bind(target);
  }
}

interface FakeTextTrack {
  id: string;
  kind: SubtitleTrackKind;
  language: string;
  label: string;
  mode: 'disabled' | 'hidden' | 'showing';
  default?: boolean;
}

/** Pushes a fake TextTrack-like object into `video.textTracks` and fires
 * 'addtrack' on the (patched) textTracks EventTarget, mirroring what a real
 * browser does when a `<track>` element's cues become available. */
function addFakeTextTrack(video: HTMLVideoElement, track: FakeTextTrack) {
  (video.textTracks as unknown as FakeTextTrack[]).push(track);
  (video.textTracks as unknown as EventTarget).dispatchEvent(new Event('addtrack'));
}

/** Minimal in-memory Storage mock - a real backing store (not just a spy),
 * so persistence across two separately-constructed PlayerController
 * instances genuinely round-trips through get/set, rather than merely
 * recording that setItem was called. */
function createMockLocalStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => {
      store.set(key, String(value));
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size;
    },
  } as Storage;
}

function makeController(): { video: HTMLVideoElement; controller: PlayerController } {
  const video = document.createElement('video');
  patchTextTracksEventTarget(video);
  // Disable seek-smoothing's volume-ducking setTimeout so tests don't leave
  // a pending timer behind - unrelated to the behavior under test.
  const controller = new PlayerController(video, {
    preciseSeek: { seekSmoothing: false },
  });
  return { video, controller };
}

describe('PlayerController subtitles', () => {
  let originalLocalStorage: Storage;

  beforeEach(() => {
    stubMediaMethods();
    originalLocalStorage = globalThis.localStorage;
    Object.defineProperty(globalThis, 'localStorage', {
      value: createMockLocalStorage(),
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    Object.defineProperty(globalThis, 'localStorage', {
      value: originalLocalStorage,
      configurable: true,
      writable: true,
    });
  });

  describe('track discovery: hasSubtitles / getSubtitleTracks / getActiveSubtitleTrack', () => {
    it('reports no subtitles before any track is added', () => {
      const { controller } = makeController();
      expect(controller.hasSubtitles()).toBe(false);
      expect(controller.getSubtitleTracks()).toEqual([]);
      expect(controller.getActiveSubtitleTrack()).toBeNull();
    });

    it('picks up a native text track added after construction, via the addtrack event', () => {
      const { video, controller } = makeController();

      addFakeTextTrack(video, {
        id: 'en-track',
        kind: 'subtitles',
        language: 'en',
        label: 'English',
        mode: 'disabled',
      });

      expect(controller.hasSubtitles()).toBe(true);
      const tracks = controller.getSubtitleTracks();
      expect(tracks).toHaveLength(1);
      expect(tracks[0]).toMatchObject({
        id: 'en-track',
        language: 'en',
        label: 'English',
        kind: 'subtitles',
        source: 'native',
      });
      // Track exists but its native mode is still 'disabled' -> not active.
      expect(controller.getActiveSubtitleTrack()).toBeNull();
    });

    it('ignores non-subtitle/caption text track kinds (e.g. chapters/metadata)', () => {
      const { video, controller } = makeController();

      addFakeTextTrack(video, {
        id: 'chapters-track',
        kind: 'chapters',
        language: 'en',
        label: 'Chapters',
        mode: 'disabled',
      });

      expect(controller.hasSubtitles()).toBe(false);
      expect(controller.getSubtitleTracks()).toEqual([]);
    });
  });

  describe('setSubtitleTrack / disableSubtitles', () => {
    it('setSubtitleTrack(id) sets the matching native track mode to showing and disables the rest', () => {
      const { video, controller } = makeController();
      addFakeTextTrack(video, {
        id: 'en-track',
        kind: 'subtitles',
        language: 'en',
        label: 'English',
        mode: 'disabled',
      });
      addFakeTextTrack(video, {
        id: 'fr-track',
        kind: 'subtitles',
        language: 'fr',
        label: 'French',
        mode: 'disabled',
      });

      controller.setSubtitleTrack('fr-track');

      const rawTracks = video.textTracks as unknown as FakeTextTrack[];
      expect(rawTracks.find((t) => t.id === 'fr-track')!.mode).toBe('showing');
      expect(rawTracks.find((t) => t.id === 'en-track')!.mode).toBe('disabled');

      const active = controller.getActiveSubtitleTrack();
      expect(active).not.toBeNull();
      expect(active!.id).toBe('fr-track');
    });

    it('setSubtitleTrack with an unknown id falls back to disableSubtitles()', () => {
      const { video, controller } = makeController();
      addFakeTextTrack(video, {
        id: 'en-track',
        kind: 'subtitles',
        language: 'en',
        label: 'English',
        mode: 'disabled',
      });
      controller.setSubtitleTrack('en-track');
      expect(controller.getActiveSubtitleTrack()!.id).toBe('en-track');

      controller.setSubtitleTrack('does-not-exist');

      expect(controller.getActiveSubtitleTrack()).toBeNull();
      const rawTracks = video.textTracks as unknown as FakeTextTrack[];
      expect(rawTracks.find((t) => t.id === 'en-track')!.mode).toBe('disabled');
    });

    it('disableSubtitles() turns off an active track and clears the active-track id', () => {
      const { video, controller } = makeController();
      addFakeTextTrack(video, {
        id: 'en-track',
        kind: 'subtitles',
        language: 'en',
        label: 'English',
        mode: 'disabled',
      });
      controller.setSubtitleTrack('en-track');
      expect(controller.getActiveSubtitleTrack()!.id).toBe('en-track');

      controller.disableSubtitles();

      expect(controller.getActiveSubtitleTrack()).toBeNull();
      const rawTracks = video.textTracks as unknown as FakeTextTrack[];
      expect(rawTracks.find((t) => t.id === 'en-track')!.mode).toBe('disabled');
    });
  });

  describe('toggleCaptions', () => {
    it('toggleCaptions(true) with available tracks activates the default track', () => {
      const { video: v, controller } = makeController();
      addFakeTextTrack(v, {
        id: 'en-track',
        kind: 'subtitles',
        language: 'en',
        label: 'English',
        mode: 'disabled',
        default: false,
      });
      addFakeTextTrack(v, {
        id: 'fr-track',
        kind: 'subtitles',
        language: 'fr',
        label: 'French',
        mode: 'disabled',
        default: true,
      });

      controller.toggleCaptions(true);

      expect(controller.getActiveSubtitleTrack()!.id).toBe('fr-track');
      expect(controller.getState().captionsEnabled).toBe(true);
    });

    it('toggleCaptions(true) prefers a saved language from localStorage over the default flag', () => {
      const { video: v, controller } = makeController();
      globalThis.localStorage.setItem('player_subtitle_language', 'en');

      addFakeTextTrack(v, {
        id: 'en-track',
        kind: 'subtitles',
        language: 'en',
        label: 'English',
        mode: 'disabled',
        default: false,
      });
      addFakeTextTrack(v, {
        id: 'fr-track',
        kind: 'subtitles',
        language: 'fr',
        label: 'French',
        mode: 'disabled',
        default: true,
      });

      controller.toggleCaptions(true);

      expect(controller.getActiveSubtitleTrack()!.id).toBe('en-track');
    });

    it('toggleCaptions(false) / toggleCaptions() with no argument toggles off an active track', () => {
      const { video: v, controller } = makeController();
      addFakeTextTrack(v, {
        id: 'en-track',
        kind: 'subtitles',
        language: 'en',
        label: 'English',
        mode: 'disabled',
      });
      controller.setSubtitleTrack('en-track');
      expect(controller.getState().captionsEnabled).toBe(true);

      controller.toggleCaptions();

      expect(controller.getState().captionsEnabled).toBe(false);
      expect(controller.getActiveSubtitleTrack()).toBeNull();
    });
  });

  describe('loadCaptions', () => {
    it('appends a <track> element to the video with the given src/label/srclang/default', () => {
      const { video, controller } = makeController();

      controller.loadCaptions({ src: 'https://example.com/en.vtt', label: 'English', srclang: 'en' });

      const trackEls = video.querySelectorAll('track');
      expect(trackEls).toHaveLength(1);
      expect(trackEls[0].label).toBe('English');
      expect(trackEls[0].srclang).toBe('en');
      expect(trackEls[0].src).toBe('https://example.com/en.vtt');
      expect(trackEls[0].kind).toBe('subtitles');
      expect(trackEls[0].default).toBe(false);
    });

    it('replaces any previously loaded <track> element rather than accumulating them', () => {
      const { video, controller } = makeController();

      controller.loadCaptions({ src: 'https://example.com/en.vtt', label: 'English', srclang: 'en' });
      controller.loadCaptions({ src: 'https://example.com/fr.vtt', label: 'French', srclang: 'fr' });

      const trackEls = video.querySelectorAll('track');
      expect(trackEls).toHaveLength(1);
      expect(trackEls[0].label).toBe('French');
    });

    it('auto-enables captions after load when the track is default and nothing was previously persisted', () => {
      vi.useFakeTimers();
      const { controller } = makeController();

      controller.loadCaptions({
        src: 'https://example.com/en.vtt',
        label: 'English',
        srclang: 'en',
        default: true,
      });

      // loadCaptions defers the auto-enable via a 100ms setTimeout.
      expect(controller.getState().captionsEnabled).toBe(false);
      vi.advanceTimersByTime(100);
      expect(controller.getState().captionsEnabled).toBe(true);
    });

    it('does NOT auto-enable a default track when persisted state says subtitles were disabled', () => {
      vi.useFakeTimers();
      globalThis.localStorage.setItem('player_subtitles_enabled', 'false');
      const { controller } = makeController();

      controller.loadCaptions({
        src: 'https://example.com/en.vtt',
        label: 'English',
        srclang: 'en',
        default: true,
      });

      vi.advanceTimersByTime(100);
      expect(controller.getState().captionsEnabled).toBe(false);
    });
  });

  describe('subtitle appearance: get/set/reset and localStorage persistence', () => {
    it('getSubtitleAppearance() returns the current appearance and setSubtitleAppearance() merges a partial update', () => {
      const { controller } = makeController();
      const before = controller.getSubtitleAppearance();
      expect(before.fontFamily).toBe('default');

      controller.setSubtitleAppearance({ fontSize: 150, fontColor: 'red' });

      const after = controller.getSubtitleAppearance();
      expect(after.fontSize).toBe(150);
      expect(after.fontColor).toBe('red');
      // Unrelated fields are preserved from the previous appearance, not reset.
      expect(after.backgroundColor).toBe(before.backgroundColor);
    });

    it('setSubtitleAppearance() persists to localStorage, and a NEW controller instance reads the persisted value back', () => {
      const { controller: controller1 } = makeController();

      controller1.setSubtitleAppearance({ fontSize: 200, fontColor: 'yellow', windowOpacity: 40 });
      const persisted = controller1.getSubtitleAppearance();

      // Genuinely construct a second, independent controller sharing the
      // same mocked localStorage (set up once in beforeEach for this test)
      // and confirm ITS getSubtitleAppearance() reflects the persisted
      // value read from storage during construction - not merely that
      // localStorage.setItem was called.
      const video2 = document.createElement('video');
      patchTextTracksEventTarget(video2);
      const controller2 = new PlayerController(video2, {
        preciseSeek: { seekSmoothing: false },
      });

      const appearance2 = controller2.getSubtitleAppearance();
      expect(appearance2.fontSize).toBe(persisted.fontSize);
      expect(appearance2.fontColor).toBe(persisted.fontColor);
      expect(appearance2.windowOpacity).toBe(persisted.windowOpacity);
      expect(appearance2).toEqual(persisted);
    });

    it('resetSubtitleAppearance() restores the same defaults a fresh, never-customized controller starts with', () => {
      // Establish the true default by reading a controller that never had
      // any persisted appearance or customization applied.
      const referenceVideo = document.createElement('video');
      patchTextTracksEventTarget(referenceVideo);
      const referenceController = new PlayerController(referenceVideo, {
        preciseSeek: { seekSmoothing: false },
      });
      const trueDefault: SubtitleAppearance = referenceController.getSubtitleAppearance();

      const { controller } = makeController();
      controller.setSubtitleAppearance({ fontSize: 300, fontColor: 'blue', characterEdgeStyle: 'raised' });
      expect(controller.getSubtitleAppearance()).not.toEqual(trueDefault);

      controller.resetSubtitleAppearance();

      expect(controller.getSubtitleAppearance()).toEqual(trueDefault);
      // resetSubtitleAppearance also persists the reset value.
      const storedRaw = globalThis.localStorage.getItem('player_subtitle_appearance');
      expect(storedRaw).not.toBeNull();
      expect(JSON.parse(storedRaw!)).toEqual(trueDefault);
    });
  });
});
