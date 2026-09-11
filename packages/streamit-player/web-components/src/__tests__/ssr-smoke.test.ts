// @vitest-environment node
import { describe, it, expect } from 'vitest';

/**
 * SSR/Node smoke test for @player/web-components.
 *
 * This test runs in a genuinely window-less Node environment (via the
 * `@vitest-environment node` docblock above, overriding any default jsdom).
 * It verifies that importing the web-components package's public entry point
 * (`index.ts`) does not throw in a server-side rendering (SSR) context.
 *
 * Critically: importing `index.ts` triggers every `customElements.define()`
 * call for all 7 components (PlayerPlayer, PlayerPlayButton, PlayerSeekbar,
 * PlayerVolumeControl, PlayerSeekButton, PlayerChaptersButton,
 * PlayerVerticalControls). Each define() call is guarded by:
 *
 *   typeof window !== 'undefined' && typeof customElements !== 'undefined' && !customElements.get(...)
 *
 * This test validates that those guards work correctly when both `window` and
 * `customElements` are absent, proving the repo's main SSR-safety mechanism.
 */
describe('Web-components package SSR smoke test (window-less Node environment)', () => {
  it('confirms window/customElements are absent', () => {
    expect(typeof window).toBe('undefined');
    expect(typeof customElements).toBe('undefined');
  });

  it('importing the web-components package entry point does not throw', async () => {
    await expect(import('../index')).resolves.toBeDefined();
  });

  it('web-components package exports are accessible', async () => {
    const webComponentsPackage = await import('../index');
    expect(webComponentsPackage.PlayerPlayer).toBeDefined();
    expect(webComponentsPackage.PlayerPlayButton).toBeDefined();
    expect(webComponentsPackage.PlayerSeekbar).toBeDefined();
    expect(webComponentsPackage.PlayerVolumeControl).toBeDefined();
    expect(webComponentsPackage.PlayerSeekButton).toBeDefined();
    expect(webComponentsPackage.PlayerChaptersButton).toBeDefined();
    expect(webComponentsPackage.PlayerVerticalControls).toBeDefined();
  });
});
