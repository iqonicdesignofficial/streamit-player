import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Hls from 'hls.js';
import { PlayerController } from './PlayerController';

/**
 * Subtitle selection on HLS, against the REAL hls.js (only the network and
 * MediaSource are faked). hls.js announces the subtitle tracks and then, still
 * inside the same call, selects its own default track - so a track the
 * integrator picks in a `subtitletrackschanged` listener used to be wiped
 * again a moment later.
 */

const MASTER = `#EXTM3U
#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="English",LANGUAGE="en",DEFAULT=NO,AUTOSELECT=NO,URI="subs/en.m3u8"
#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="French",LANGUAGE="fr",DEFAULT=NO,AUTOSELECT=NO,URI="subs/fr.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360,CODECS="avc1.42e01e,mp4a.40.2",SUBTITLES="subs"
v/360.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=1600000,RESOLUTION=1280x720,CODECS="avc1.64001f,mp4a.40.2",SUBTITLES="subs"
v/720.m3u8
`;

const MASTER_WITH_DEFAULT = MASTER.replace(
  'NAME="English",LANGUAGE="en",DEFAULT=NO,AUTOSELECT=NO',
  'NAME="English",LANGUAGE="en",DEFAULT=YES,AUTOSELECT=YES'
);

const MEDIA = `#EXTM3U
#EXT-X-TARGETDURATION:4
#EXT-X-VERSION:3
#EXT-X-MEDIA-SEQUENCE:0
#EXTINF:4,
seg0.ts
#EXT-X-ENDLIST
`;

let masterText = MASTER;

class TestLoader {
  context: unknown = null;
  stats = {
    aborted: false,
    loaded: 0,
    retry: 0,
    total: 0,
    chunkCount: 0,
    bwEstimate: 0,
    loading: { start: 0, first: 0, end: 0 },
    parsing: { start: 0, end: 0 },
    buffering: { start: 0, first: 0, end: 0 },
  };
  destroy() {}
  abort() {}
  getCacheAge() {
    return null;
  }
  getResponseHeader() {
    return null;
  }
  load(
    context: { url: string },
    _config: unknown,
    callbacks: { onSuccess: (r: unknown, s: unknown, c: unknown, n: unknown) => void }
  ) {
    this.context = context;
    // Media segments never answer: these tests are about playlists/tracks, and
    // fake segment bytes would only trigger unrelated media-error recovery.
    if (/\.(ts|vtt)$/.test(context.url)) return;
    const data = context.url.endsWith('master.m3u8') ? masterText : MEDIA;
    setTimeout(() => callbacks.onSuccess({ url: context.url, data }, this.stats, context, null), 0);
  }
}

class FakeMediaSource extends EventTarget {
  static isTypeSupported = () => true;
  readyState = 'closed';
  duration = NaN;
  addSourceBuffer() {
    return Object.assign(new EventTarget(), {
      appendBuffer() {},
      remove() {},
      abort() {},
      buffered: { length: 0 },
    });
  }
  removeSourceBuffer() {}
  endOfStream() {}
}

function makeVideo(): HTMLVideoElement {
  const video = document.createElement('video');
  const tracks = video.textTracks as unknown as Record<string, unknown>;
  if (typeof tracks.addEventListener !== 'function') {
    const target = new EventTarget();
    tracks.addEventListener = target.addEventListener.bind(target);
    tracks.removeEventListener = target.removeEventListener.bind(target);
  }
  return video;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor(check: () => boolean, ms = 3000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out waiting for condition');
    await sleep(2);
  }
}

beforeEach(() => {
  masterText = MASTER;
  (globalThis as { MediaSource?: unknown }).MediaSource = FakeMediaSource;
  (window as { MediaSource?: unknown }).MediaSource = FakeMediaSource;
  // jsdom's <track> element has no TextTrack; hls.js renders subtitle tracks natively through one.
  Object.defineProperty(HTMLTrackElement.prototype, 'track', {
    configurable: true,
    get(this: HTMLTrackElement & { __t?: unknown }) {
      return (this.__t ??= {
        mode: 'disabled',
        kind: this.kind,
        label: this.label,
        language: this.srclang,
        cues: null,
        addCue() {},
        removeCue() {},
        addEventListener() {},
        removeEventListener() {},
      });
    },
  });
  // Assigning the object URL to video.src is what makes a real MediaSource open.
  (URL as { createObjectURL?: unknown }).createObjectURL = (ms: FakeMediaSource) => {
    setTimeout(() => {
      ms.readyState = 'open';
      ms.dispatchEvent(new Event('sourceopen'));
    }, 0);
    return 'blob:test';
  };
  (URL as { revokeObjectURL?: unknown }).revokeObjectURL = () => {};
  (globalThis as { Hls?: unknown }).Hls = Hls;
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  delete (globalThis as { Hls?: unknown }).Hls;
  vi.restoreAllMocks();
});

function start() {
  const controller = new PlayerController(makeVideo(), {
    hls: { loader: TestLoader, enableWorker: false },
    preciseSeek: { seekSmoothing: false },
  } as never);
  controller.loadSource({ src: 'https://example.test/master.m3u8', type: 'hls' } as never);
  return controller;
}

describe('HLS subtitle selection survives the track announcement', () => {
  it('announces the tracks', async () => {
    const controller = start();
    await waitFor(() => controller.getState().subtitleTracks.length === 2);
    expect(controller.getState().subtitleTracks.map((t) => t.language)).toEqual(['en', 'fr']);
    controller.destroy();
  });

  it('keeps a track selected inside the subtitletrackschanged listener', async () => {
    const controller = start();
    let selected = false;
    controller.addEventListener('subtitletrackschanged', (detail) => {
      const tracks = (detail as { tracks: Array<{ id: string; language: string }> }).tracks;
      if (!selected && tracks.length === 2) {
        selected = true;
        controller.setSubtitleTrack(tracks[1].id);
      }
    });

    await waitFor(() => selected);
    await sleep(100); // let the rest of manifest / level parsing run

    const state = controller.getState();
    expect(state.activeSubtitleTrack).toBe(1);
    expect(state.captionsEnabled).toBe(true);
    expect(state.subtitleTracks[state.activeSubtitleTrack].language).toBe('fr');
    controller.destroy();
  });

  it('keeps a track selected right after the tracks appear in state', async () => {
    const controller = start();
    await waitFor(() => controller.getState().subtitleTracks.length === 2);
    controller.setSubtitleTrack(controller.getState().subtitleTracks[1].id);
    await sleep(100);

    expect(controller.getState().activeSubtitleTrack).toBe(1);
    expect(controller.getState().captionsEnabled).toBe(true);
    controller.destroy();
  });

  it('keeps an integrator choice that differs from the manifest default track', async () => {
    masterText = MASTER_WITH_DEFAULT; // English is DEFAULT=YES
    const controller = start();
    let selected = false;
    controller.addEventListener('subtitletrackschanged', (detail) => {
      const tracks = (detail as { tracks: Array<{ id: string; language: string }> }).tracks;
      const french = tracks.find((t) => t.language === 'fr');
      if (!selected && french) {
        selected = true;
        controller.setSubtitleTrack(french.id);
      }
    });

    await waitFor(() => selected);
    await sleep(100);

    const state = controller.getState();
    expect(state.subtitleTracks[state.activeSubtitleTrack]?.language).toBe('fr');
    controller.destroy();
  });

  it('emits subtitletrackschanged once the tracks are known, with the default already selected', async () => {
    masterText = MASTER_WITH_DEFAULT;
    const controller = start();
    const seen: Array<{ count: number; active: number }> = [];
    controller.addEventListener('subtitletrackschanged', (detail) => {
      const tracks = (detail as { tracks: unknown[] }).tracks;
      seen.push({ count: tracks.length, active: controller.getState().activeSubtitleTrack });
    });

    await waitFor(() => seen.length > 0);
    await sleep(50);

    expect(seen[0].count).toBe(2);
    expect(seen[0].active).toBe(0); // English (default) is already active when announced
    controller.destroy();
  });

  it('still auto-selects the manifest default track when the integrator does nothing', async () => {
    masterText = MASTER_WITH_DEFAULT;
    const controller = start();
    await waitFor(() => controller.getState().subtitleTracks.length === 2);
    await sleep(100);

    const state = controller.getState();
    expect(state.captionsEnabled).toBe(true);
    expect(state.subtitleTracks[state.activeSubtitleTrack].language).toBe('en');
    controller.destroy();
  });

  it('lets the integrator switch off captions after the announcement', async () => {
    masterText = MASTER_WITH_DEFAULT;
    const controller = start();
    await waitFor(() => controller.getState().subtitleTracks.length === 2);
    await sleep(100);
    controller.disableSubtitles();
    await sleep(100);

    expect(controller.getState().captionsEnabled).toBe(false);
    expect(controller.getState().activeSubtitleTrack).toBe(-1);
    controller.destroy();
  });
});
