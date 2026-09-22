import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { fixture, html, elementUpdated } from '@open-wc/testing-helpers';
import type { PlayerPlayer } from './Player';
import './Player';

/**
 * The vertical layout has three inputs that all mean "be a vertical player":
 * the `display-mode` attribute/property, `config.displayMode`, and
 * `config.layout.mode`. The host stylesheet keys off the reflected attribute
 * while render() picks the control set, so any of the three disagreeing
 * produces a 9:16 box wearing the standard control bar. These pin all three
 * entry points to the same resolved mode.
 */

function installJsdomMediaStubs(): void {
  for (const name of ['textTracks', 'audioTracks', 'videoTracks']) {
    const list: unknown[] & Record<string, unknown> = [] as never;
    list.addEventListener = () => {};
    list.removeEventListener = () => {};
    list.addTrack = () => {};
    Object.defineProperty(HTMLMediaElement.prototype, name, {
      configurable: true,
      get: () => list,
    });
  }
  HTMLMediaElement.prototype.play = () => Promise.resolve();
  HTMLMediaElement.prototype.pause = () => {};
  HTMLMediaElement.prototype.load = () => {};
}

beforeAll(() => {
  installJsdomMediaStubs();
});

beforeEach(() => {
  localStorage.clear();
});

/** True when the vertical action rail / vertical seekbar is the rendered UI. */
function isVerticalUi(el: PlayerPlayer): boolean {
  return !!el.shadowRoot?.querySelector('player-vertical-controls');
}

/** True when the landscape control bar is the rendered UI. */
function isStandardUi(el: PlayerPlayer): boolean {
  return !!el.shadowRoot?.querySelector('.controls-bar');
}

async function mount(template: unknown): Promise<PlayerPlayer> {
  const el = (await fixture(template as never)) as PlayerPlayer;
  await elementUpdated(el);
  await elementUpdated(el);
  return el;
}

describe('vertical display mode resolution', () => {
  it('renders the vertical UI from the display-mode attribute', async () => {
    const el = await mount(html`<player-player src="https://e.test/a.mp4" display-mode="vertical"></player-player>`);
    expect(el.displayMode).toBe('vertical');
    expect(isVerticalUi(el)).toBe(true);
    expect(isStandardUi(el)).toBe(false);
  });

  it('renders the vertical UI from config.displayMode alone', async () => {
    const el = await mount(
      html`<player-player src="https://e.test/a.mp4" .config=${{ displayMode: 'vertical' }}></player-player>`
    );
    expect(isVerticalUi(el)).toBe(true);
    expect(isStandardUi(el)).toBe(false);
  });

  it('renders the vertical UI from config.layout.mode alone', async () => {
    const el = await mount(
      html`<player-player src="https://e.test/a.mp4" .config=${{ layout: { mode: 'vertical' } }}></player-player>`
    );
    expect(isVerticalUi(el)).toBe(true);
    expect(isStandardUi(el)).toBe(false);
  });

  it('reflects display-mode on the host so the 9:16 host styles apply', async () => {
    const el = await mount(
      html`<player-player src="https://e.test/a.mp4" .config=${{ displayMode: 'vertical' }}></player-player>`
    );
    expect(el.getAttribute('display-mode')).toBe('vertical');
  });

  it('keeps the host attribute and the rendered controls in agreement', async () => {
    for (const config of [
      { displayMode: 'vertical' },
      { layout: { mode: 'vertical' } },
      { displayMode: 'vertical', layout: { mode: 'vertical' } },
    ]) {
      const el = await mount(html`<player-player src="https://e.test/a.mp4" .config=${config}></player-player>`);
      expect(el.getAttribute('display-mode') === 'vertical').toBe(isVerticalUi(el));
    }
  });

  it('still switches modes when the property is set after mount', async () => {
    const el = await mount(html`<player-player src="https://e.test/a.mp4"></player-player>`);
    expect(isStandardUi(el)).toBe(true);

    el.displayMode = 'vertical';
    await elementUpdated(el);
    await elementUpdated(el);
    expect(isVerticalUi(el)).toBe(true);
    expect(isStandardUi(el)).toBe(false);

    el.displayMode = 'standard';
    await elementUpdated(el);
    await elementUpdated(el);
    expect(isVerticalUi(el)).toBe(false);
    expect(isStandardUi(el)).toBe(true);
  });

  it('lets a later display-mode change win over the mode the config asked for', async () => {
    const el = await mount(
      html`<player-player src="https://e.test/a.mp4" .config=${{ displayMode: 'vertical' }}></player-player>`
    );
    expect(isVerticalUi(el)).toBe(true);

    el.displayMode = 'standard';
    await elementUpdated(el);
    await elementUpdated(el);
    expect(isStandardUi(el)).toBe(true);
    expect(isVerticalUi(el)).toBe(false);
  });

  it('adopts a vertical mode delivered by a later config assignment', async () => {
    const el = await mount(html`<player-player src="https://e.test/a.mp4"></player-player>`);
    expect(isStandardUi(el)).toBe(true);

    el.config = { displayMode: 'vertical' };
    await elementUpdated(el);
    await elementUpdated(el);
    expect(isVerticalUi(el)).toBe(true);
    expect(el.getAttribute('display-mode')).toBe('vertical');
  });
});

describe('mode delivered as a framework-lowercased attribute', () => {
  /** Mounts through raw attributes, the way React 18 hands values to a custom element. */
  async function viaAttributes(attrs: Record<string, string>) {
    const el = document.createElement('player-player') as PlayerPlayer;
    el.setAttribute('src', 'https://e.test/a.mp4');
    for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
    document.body.appendChild(el);
    await elementUpdated(el);
    await elementUpdated(el);
    const result = {
      vertical: isVerticalUi(el),
      standard: isStandardUi(el),
      mode: el.displayMode,
      config: el.config,
    };
    el.remove();
    return result;
  }

  it('honours displaymode, the spelling a React displayMode prop produces', async () => {
    const r = await viaAttributes({ displaymode: 'vertical' });
    expect(r.mode).toBe('vertical');
    expect(r.vertical).toBe(true);
    expect(r.standard).toBe(false);
  });

  it('honours the snake_cased spelling too', async () => {
    const r = await viaAttributes({ display_mode: 'vertical' });
    expect(r.mode).toBe('vertical');
    expect(r.vertical).toBe(true);
  });

  it('keeps aliasing other hyphenated attributes', async () => {
    const r = await viaAttributes({ displaymode: 'vertical', livemode: 'live-only' });
    expect(r.mode).toBe('vertical');
    const el = document.createElement('player-player') as PlayerPlayer;
    el.setAttribute('autoscroll', '');
    document.body.appendChild(el);
    await elementUpdated(el);
    expect(el.autoScroll).toBe(true);
    el.remove();
  });

  it('drops a stringified config attribute instead of half-applying it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const r = await viaAttributes({ 'display-mode': 'vertical', config: '[object Object]' });
    expect(r.config).toBeUndefined();
    expect(r.vertical).toBe(true);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('stringified object'));
    warn.mockRestore();
  });

  it('still accepts a JSON config attribute', async () => {
    const r = await viaAttributes({ config: JSON.stringify({ displayMode: 'vertical' }) });
    expect(r.config?.displayMode).toBe('vertical');
    expect(r.vertical).toBe(true);
  });

  it('warns and ignores a config attribute that is not valid JSON', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const r = await viaAttributes({ config: '{nope' });
    expect(r.config).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('not valid JSON'));
    warn.mockRestore();
  });
});

describe('the streamit-player tag resolves the mode the same way', () => {
  it('honours displaymode on the primary tag, not just the legacy alias', async () => {
    const el = document.createElement('streamit-player') as PlayerPlayer;
    el.setAttribute('src', 'https://e.test/a.mp4');
    el.setAttribute('displaymode', 'vertical');
    document.body.appendChild(el);
    await elementUpdated(el);
    await elementUpdated(el);
    expect(el.displayMode).toBe('vertical');
    expect(isVerticalUi(el)).toBe(true);
    expect(isStandardUi(el)).toBe(false);
    el.remove();
  });
});
