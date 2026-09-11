import { describe, it, expect, beforeEach } from 'vitest';
import { PlayerPlayer } from '../web-components/src/Player';
import '../src/index';

describe('Custom Elements Registration and Backwards Compatibility Aliases', () => {
  it('registers <streamit-player> as the official custom element', () => {
    expect(customElements.get('streamit-player')).toBeDefined();
  });

  it('registers <player-player> as a functional alias subclassing PlayerPlayer', () => {
    const AliasClass = customElements.get('player-player');
    expect(AliasClass).toBeDefined();
    expect(AliasClass?.prototype instanceof PlayerPlayer || AliasClass === PlayerPlayer).toBe(true);
  });

  it('instantiates <streamit-player> and <player-player> DOM elements sharing same capabilities', () => {
    const streamitEl = document.createElement('streamit-player') as any;
    const playerEl = document.createElement('player-player') as any;

    expect(streamitEl).toBeDefined();
    expect(playerEl).toBeDefined();
    expect(streamitEl instanceof PlayerPlayer).toBe(true);
    expect(playerEl instanceof PlayerPlayer).toBe(true);
    expect(typeof streamitEl.localize).toBe('function');
    expect(typeof playerEl.localize).toBe('function');
  });

  it('registers all sub-component pairs (streamit-* and player-*)', () => {
    const subComponents = [
      ['streamit-play-button', 'player-play-button'],
      ['streamit-seekbar', 'player-seekbar'],
      ['streamit-volume-control', 'player-volume-control'],
      ['streamit-seek-button', 'player-seek-button'],
      ['streamit-chapters-button', 'player-chapters-button'],
      ['streamit-vertical-controls', 'player-vertical-controls'],
    ];

    for (const [official, alias] of subComponents) {
      expect(customElements.get(official)).toBeDefined();
      expect(customElements.get(alias)).toBeDefined();
    }
  });
});
