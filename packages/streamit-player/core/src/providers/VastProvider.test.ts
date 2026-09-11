import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { VastProvider, type VastAdvertisement } from './VastProvider';
import { AdState, type AdBreak, type AdError, type ProviderContext } from '../types';
import type { AdsManager } from '../AdsManager';

/**
 * VastProvider.requestAds() is the real, public parsing entry point - it
 * fetches (via fetchXmlWithPolicy -> global fetch), parses the XML with the
 * hand-rolled namespace-safe DOM walker, and hands the resulting AdBreak to
 * AdsManager. These tests mock `fetch` to serve golden VAST fixtures and mock
 * just the slice of AdsManager/PlayerController that VastProvider touches
 * (matching the existing KeyboardManager.test.ts pattern of a minimal mock
 * cast via `as unknown as <RealType>` rather than constructing a real
 * PlayerController), then assert on the actual parsed ad-break model that
 * comes back through `getAdBreakManager().registerBreak(...)`.
 */

const FIXTURES_DIR = join(__dirname, '__fixtures__');

function loadFixture(name: string): string {
  return readFileSync(join(FIXTURES_DIR, name), 'utf-8');
}

interface MockAdsManager {
  transitionTo: ReturnType<typeof vi.fn>;
  triggerAdError: ReturnType<typeof vi.fn>;
  setCurrentAd: ReturnType<typeof vi.fn>;
  getAdBreakManager: ReturnType<typeof vi.fn>;
}

function makeManager(): { manager: MockAdsManager; registerBreak: ReturnType<typeof vi.fn> } {
  const registerBreak = vi.fn();
  const getActiveBreak = vi.fn();
  const manager: MockAdsManager = {
    transitionTo: vi.fn(),
    triggerAdError: vi.fn(),
    setCurrentAd: vi.fn(),
    getAdBreakManager: vi.fn(() => ({ registerBreak, getActiveBreak })),
  };
  return { manager, registerBreak };
}

function makeContext(manager: MockAdsManager): ProviderContext {
  return {
    videoElement: document.createElement('video'),
    adContainer: document.createElement('div'),
    controller: {
      ads: { manager },
      getState: vi.fn(() => ({ sourceType: 'mp4' })),
      destroyAbortController: undefined,
    },
    config: {},
  } as unknown as ProviderContext;
}

/** Registers a fetch mock that serves `urlToXml` by exact URL match. */
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

describe('VastProvider.requestAds', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('parses a single-Ad linear VAST response into an ad break with media, tracking, and skip-offset', async () => {
    const xml = loadFixture('vast-linear.xml');
    mockFetch({ 'https://ads.example.com/vast-linear.xml': xml });

    const { manager, registerBreak } = makeManager();
    const provider = new VastProvider();
    provider.init(makeContext(manager) as any);

    const result = await provider.requestAds('https://ads.example.com/vast-linear.xml');

    expect(result.success).toBe(true);
    expect(manager.transitionTo).toHaveBeenCalledWith(AdState.LOADED);
    expect(registerBreak).toHaveBeenCalledTimes(1);

    const adBreak = registerBreak.mock.calls[0][0] as AdBreak;
    expect(adBreak.type).toBe('preroll');
    expect(adBreak.ads).toHaveLength(1);

    const ad = adBreak.ads[0] as VastAdvertisement;
    expect(ad.title).toBe('Golden Mace Linear Sample Ad');
    expect(ad.adSystem).toBe('GoldenMace Ad Server');
    expect(ad.linear).toBe(true);
    expect(ad.duration).toBe(30);

    // Highest-resolution progressive MediaFile should win selection.
    expect(ad.mediaUrl).toBe('https://cdn.example.com/ads/linear-hi.mp4');
    expect(ad.width).toBe(1920);
    expect(ad.height).toBe(1080);

    // skipoffset="00:00:05" -> 5 seconds, skippable=true
    expect(ad.skippable).toBe(true);
    expect(ad.skipOffset).toBe(5);

    expect(ad.impressionUrls).toEqual([
      'https://track.example.com/impression?id=1',
      'https://track.example.com/impression?id=2',
    ]);
    expect(ad.clickThroughUrl).toBe('https://advertiser.example.com/landing');
    expect(ad.clickTrackingUrls).toEqual(['https://track.example.com/click']);

    expect(ad.trackingUrls).toEqual(
      expect.arrayContaining([
        { url: 'https://track.example.com/start', event: 'start' },
        { url: 'https://track.example.com/firstQuartile', event: 'firstQuartile' },
        { url: 'https://track.example.com/midpoint', event: 'midpoint' },
        { url: 'https://track.example.com/complete', event: 'complete' },
      ])
    );
    expect(ad.trackingUrls).toHaveLength(4);
  });

  it('follows a VAST Wrapper redirect and merges wrapper-level impression/error/tracking into the resolved InLine ad', async () => {
    const wrapperXml = loadFixture('vast-wrapper.xml');
    const linearXml = loadFixture('vast-linear.xml');
    mockFetch({
      'https://ads.example.com/vast-wrapper.xml': wrapperXml,
      'https://ads.example.com/vast-linear.xml': linearXml,
    });

    const { manager, registerBreak } = makeManager();
    const provider = new VastProvider();
    provider.init(makeContext(manager) as any);

    const result = await provider.requestAds('https://ads.example.com/vast-wrapper.xml');

    expect(result.success).toBe(true);
    const adBreak = registerBreak.mock.calls[0][0] as AdBreak;
    const ad = adBreak.ads[0] as VastAdvertisement;

    // The resolved ad is the InLine ad from vast-linear.xml...
    expect(ad.title).toBe('Golden Mace Linear Sample Ad');
    expect(ad.mediaUrl).toBe('https://cdn.example.com/ads/linear-hi.mp4');

    // ...with the Wrapper's own Impression/Error/Tracking merged in per spec.
    expect(ad.impressionUrls).toEqual(
      expect.arrayContaining([
        'https://track.example.com/impression?id=1',
        'https://track.example.com/wrapper/impression',
      ])
    );
    expect(ad.errorUrls).toEqual(
      expect.arrayContaining(['https://track.example.com/wrapper/error?code=[ERRORCODE]'])
    );
    expect(ad.trackingUrls).toEqual(
      expect.arrayContaining([{ url: 'https://track.example.com/wrapper/start', event: 'start' }])
    );
  });

  it('parses a standalone NonLinear VAST ad (no Linear creative) into a non-linear ad model', async () => {
    const xml = loadFixture('vast-nonlinear.xml');
    mockFetch({ 'https://ads.example.com/vast-nonlinear.xml': xml });

    const { manager, registerBreak } = makeManager();
    const provider = new VastProvider();
    provider.init(makeContext(manager) as any);

    const result = await provider.requestAds('https://ads.example.com/vast-nonlinear.xml');

    expect(result.success).toBe(true);
    const adBreak = registerBreak.mock.calls[0][0] as AdBreak;
    expect(adBreak.ads).toHaveLength(1);

    const ad = adBreak.ads[0] as VastAdvertisement;
    expect(ad.linear).toBe(false);
    expect(ad.skippable).toBe(false);
    expect(ad.width).toBe(300);
    expect(ad.height).toBe(60);
    expect(ad.duration).toBe(15);
    expect(ad.imageUrl).toBe('https://cdn.example.com/ads/overlay-banner.png');
    expect(ad.clickThroughUrl).toBe('https://advertiser.example.com/overlay-landing');
    expect(ad.trackingUrls).toEqual([
      { url: 'https://track.example.com/nonlinear/creativeView', event: 'creativeView' },
    ]);
    expect(ad.impressionUrls).toEqual(['https://track.example.com/nonlinear/impression']);
  });

  it('rejects malformed XML without throwing, returning a PARSING-flavored error result', async () => {
    mockFetch({ 'https://ads.example.com/broken.xml': '<VAST version="4.0"><Ad><InLine>' });

    const { manager } = makeManager();
    const provider = new VastProvider();
    provider.init(makeContext(manager) as any);

    let result: Awaited<ReturnType<VastProvider['requestAds']>> | undefined;
    await expect(
      (async () => {
        result = await provider.requestAds('https://ads.example.com/broken.xml');
      })()
    ).resolves.not.toThrow();

    expect(result?.success).toBe(false);
    expect(result?.error?.message).toMatch(/Malformed VAST XML|Missing VAST or Playlist root node/);
    expect(manager.triggerAdError).toHaveBeenCalledTimes(1);
    const err = manager.triggerAdError.mock.calls[0][0] as AdError;
    expect(err.message).toBeTruthy();
  });
});
