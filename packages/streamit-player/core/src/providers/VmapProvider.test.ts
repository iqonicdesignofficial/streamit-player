import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { VmapProvider, parseBreakTrackingEvents, type ScheduledBreak } from './VmapProvider';
import type { ProviderContext } from '../types';

/**
 * VmapProvider.requestAds() is the real, public parsing entry point for VMAP
 * documents - it fetches the tag (via fetchXmlWithPolicy -> global fetch) and
 * parses it with the same namespace-safe local-name DOM walker VastProvider
 * uses. There is no public getter that returns the full parsed break list
 * (only aggregate counts via getVmapDiagnostics() and resolved cue times via
 * getCuePoints()), so per-break fields (adTagUrl, tracking URIs) are read off
 * the private `scheduledBreaks` array via a cast - the same private-state
 * inspection tradeoff KeyboardManager.test.ts makes for controller mocks,
 * just applied to the provider's own internal state instead.
 */

const FIXTURES_DIR = join(__dirname, '__fixtures__');

function loadFixture(name: string): string {
  return readFileSync(join(FIXTURES_DIR, name), 'utf-8');
}

function makeContext(): ProviderContext {
  return {
    videoElement: document.createElement('video'),
    adContainer: document.createElement('div'),
    controller: {
      ads: {
        manager: { getProvider: vi.fn() },
        hasActiveManualSchedule: vi.fn(() => false),
      },
      getState: vi.fn(() => ({ sourceType: 'mp4', duration: 0 })),
      emit: vi.fn(),
      destroyAbortController: undefined,
    },
    config: {},
  } as unknown as ProviderContext;
}

function mockFetch(urlToXml: Record<string, string>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const body = urlToXml[url];
      if (body === undefined) {
        return { ok: false, status: 404, text: async () => '' };
      }
      return { ok: true, status: 200, text: async () => body };
    })
  );
}

describe('VmapProvider.requestAds', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('parses a VMAP document with a single pre-roll AdBreak', async () => {
    const xml = loadFixture('vmap-basic.xml');
    mockFetch({ 'https://ads.example.com/vmap-basic.xml': xml });

    const provider = new VmapProvider();
    provider.init(makeContext());

    const result = await provider.requestAds('https://ads.example.com/vmap-basic.xml');

    expect(result.success).toBe(true);
    expect(provider.getVmapDiagnostics().parsedBreaksCount).toBe(1);

    const breaks = (provider as any).scheduledBreaks as ScheduledBreak[];
    expect(breaks).toHaveLength(1);
    expect(breaks[0].id).toBe('preroll-1');
    expect(breaks[0].breakType).toBe('linear');
    expect(breaks[0].adTagUrl).toBe('https://ads.example.com/vast-linear.xml');
    expect(breaks[0].trackingUrls).toEqual([
      { event: 'breakStart', url: 'https://track.example.com/vmap/preroll/breakStart' },
      { event: 'breakEnd', url: 'https://track.example.com/vmap/preroll/breakEnd' },
    ]);

    // 'start' resolves to time 0 immediately, without needing video duration.
    expect(provider.getCuePoints()).toEqual([0]);
  });

  it('parses a VMAP document with pre-roll, mid-roll, and post-roll AdBreaks', async () => {
    const xml = loadFixture('vmap-multiple-breaks.xml');
    mockFetch({ 'https://ads.example.com/vmap-multiple-breaks.xml': xml });

    const provider = new VmapProvider();
    provider.init(makeContext());

    const result = await provider.requestAds('https://ads.example.com/vmap-multiple-breaks.xml');

    expect(result.success).toBe(true);
    expect(provider.getVmapDiagnostics().parsedBreaksCount).toBe(3);

    const breaks = (provider as any).scheduledBreaks as ScheduledBreak[];
    expect(breaks.map(b => b.id)).toEqual(['preroll-1', 'midroll-1', 'postroll-1']);
    expect(breaks.map(b => b.adTagUrl)).toEqual([
      'https://ads.example.com/preroll.xml',
      'https://ads.example.com/midroll.xml',
      'https://ads.example.com/postroll.xml',
    ]);

    const midroll = breaks.find(b => b.id === 'midroll-1')!;
    expect(midroll.timeOffset).toBe('00:00:30.000');
    expect(midroll.trackingUrls).toEqual(
      expect.arrayContaining([
        { event: 'breakStart', url: 'https://track.example.com/vmap/midroll/breakStart' },
        { event: 'breakEnd', url: 'https://track.example.com/vmap/midroll/breakEnd' },
        { event: 'error', url: 'https://track.example.com/vmap/midroll/error' },
      ])
    );

    // 'start' (0) and the absolute mid-roll offset (30s) resolve without a
    // known duration; the 'end' post-roll stays unresolved (< 0) until
    // duration is known, so it's correctly excluded from cue points here.
    expect(provider.getCuePoints().sort((a, b) => a - b)).toEqual([0, 30]);
  });

  it('rejects malformed VMAP XML without throwing, returning a PARSING error result', async () => {
    mockFetch({ 'https://ads.example.com/broken-vmap.xml': '<vmap:VMAP><vmap:AdBreak>' });

    const provider = new VmapProvider();
    provider.init(makeContext());

    let result: Awaited<ReturnType<VmapProvider['requestAds']>> | undefined;
    await expect(
      (async () => {
        result = await provider.requestAds('https://ads.example.com/broken-vmap.xml');
      })()
    ).resolves.not.toThrow();

    expect(result?.success).toBe(false);
    expect(result?.error?.message).toMatch(/Malformed VMAP XML|Missing VMAP root node/);
  });
});

describe('parseBreakTrackingEvents', () => {
  it('extracts only the allow-listed VMAP break-tracking events (breakStart/breakEnd/error)', () => {
    const xml = loadFixture('vmap-multiple-breaks.xml');
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    const breakNode = doc.getElementsByTagName('vmap:AdBreak')[1]; // midroll-1

    const events = parseBreakTrackingEvents(breakNode as unknown as Element);

    expect(events).toEqual([
      { event: 'breakStart', url: 'https://track.example.com/vmap/midroll/breakStart' },
      { event: 'breakEnd', url: 'https://track.example.com/vmap/midroll/breakEnd' },
      { event: 'error', url: 'https://track.example.com/vmap/midroll/error' },
    ]);
  });

  it('returns an empty array when the break has no TrackingEvents node', () => {
    const doc = new DOMParser().parseFromString(
      '<vmap:AdBreak xmlns:vmap="http://www.iab.net/videosuite/vmap" timeOffset="start" breakId="no-tracking" />',
      'text/xml'
    );
    const events = parseBreakTrackingEvents(doc.documentElement);
    expect(events).toEqual([]);
  });
});
