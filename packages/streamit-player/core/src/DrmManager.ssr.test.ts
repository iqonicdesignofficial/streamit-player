// @vitest-environment node
import { describe, it, expect } from 'vitest';

/**
 * These tests run in a genuinely window-less Node environment (via the
 * `@vitest-environment node` docblock above, overriding the package's default
 * jsdom environment set in vitest.config.ts). jsdom always fakes a `window`
 * global, so it cannot exercise DrmManager.ts's `typeof window === 'undefined'`
 * SSR guards - this file is the only place those guards are genuinely tested
 * against an absent `window`/`MediaKeys`.
 */
describe('DrmManager SSR guard (window-less Node environment)', () => {
  it('runs with no window/MediaKeys globals present', () => {
    expect(typeof window).toBe('undefined');
    expect(typeof (globalThis as any).MediaKeys).toBe('undefined');
    expect(typeof (globalThis as any).HTMLVideoElement).toBe('undefined');
  });

  it('importing the module does not throw', async () => {
    await expect(import('./DrmManager')).resolves.toBeDefined();
  });

  it('DrmManager.load() does not throw when window/MediaKeys are absent (patchCreateSession bails out safely)', async () => {
    const { DrmManager } = await import('./DrmManager');
    const manager = new DrmManager();
    const fakeVideo = {
      addEventListener: () => {},
      removeEventListener: () => {},
      setMediaKeys: async () => {},
    } as unknown as HTMLVideoElement;

    expect(() =>
      manager.load(fakeVideo, { clearkey: { clearkeys: {} } }, null as unknown as import('./PlayerController').PlayerController, true)
    ).not.toThrow();

    expect(() => manager.destroy()).not.toThrow();
  });

  it('key-system support helpers resolve to false instead of throwing when window/navigator are absent', async () => {
    const {
      isWidevineSupported,
      isPlayReadySupported,
      isFairPlaySupported,
      isClearKeySupported,
      detectSupportedKeySystems,
    } = await import('./DrmManager');

    await expect(isWidevineSupported()).resolves.toBe(false);
    await expect(isPlayReadySupported()).resolves.toBe(false);
    await expect(isFairPlaySupported()).resolves.toBe(false);
    await expect(isClearKeySupported()).resolves.toBe(false);
    await expect(detectSupportedKeySystems()).resolves.toEqual({
      widevine: false,
      playready: false,
      fairplay: false,
      clearkey: false,
    });
  });
});
