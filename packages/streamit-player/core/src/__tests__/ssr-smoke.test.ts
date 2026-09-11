// @vitest-environment node
import { describe, it, expect } from 'vitest';

/**
 * SSR/Node smoke test for @player/core.
 *
 * This test runs in a genuinely window-less Node environment (via the
 * `@vitest-environment node` docblock above, overriding any default jsdom).
 * It verifies that importing the core package's public entry point (`index.ts`)
 * does not throw in a server-side rendering (SSR) context where `window` and
 * browser APIs are absent.
 */
describe('Core package SSR smoke test (window-less Node environment)', () => {
  it('confirms window/document are absent', () => {
    expect(typeof window).toBe('undefined');
    expect(typeof document).toBe('undefined');
  });

  it('importing the core package entry point does not throw', async () => {
    await expect(import('../index')).resolves.toBeDefined();
  });

  it('core package exports are accessible', async () => {
    const corePackage = await import('../index');
    expect(corePackage.PlayerController).toBeDefined();
    expect(corePackage.KeyboardManager).toBeDefined();
    expect(corePackage.TimelineMath).toBeDefined();
    expect(corePackage.formatTime).toBeDefined();
  });
});
