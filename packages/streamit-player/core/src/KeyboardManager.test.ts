import { describe, it, expect, vi, beforeEach } from 'vitest';
import { KeyboardManager } from './KeyboardManager';
import type { PlayerController } from './PlayerController';
import type { PlayerState } from './types';

/**
 * NOTE: KeyboardManager does not attach any DOM event listener itself - it has
 * no target (document, element, etc.) to bind to. It only exposes a public
 * `handleKeyDown(e: KeyboardEvent)` method. The web-components layer
 * (`Player.ts`) is the one that calls `addEventListener('keydown', ...)` on
 * itself and forwards events via `this.controller.shortcuts.handleKeyDown(e)`.
 * These tests therefore construct real jsdom `KeyboardEvent`s and invoke
 * `handleKeyDown` directly, matching the actual public API/behavior of this
 * class rather than assuming it owns a listener.
 */

function makeState(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    volume: 0.5,
    isMuted: false,
    currentTime: 30,
    duration: 100,
    playbackRate: 1.0,
    isLive: false,
    canSeekInDvr: false,
    isAdPlaying: false,
    seekableRange: { start: 0, end: 100 },
    ...overrides,
  } as PlayerState;
}

interface MockController {
  config: any;
  getState: ReturnType<typeof vi.fn>;
  togglePlay: ReturnType<typeof vi.fn>;
  seekBy: ReturnType<typeof vi.fn>;
  seek: ReturnType<typeof vi.fn>;
  setVolume: ReturnType<typeof vi.fn>;
  toggleMute: ReturnType<typeof vi.fn>;
  togglePictureInPicture: ReturnType<typeof vi.fn>;
  toggleLoop: ReturnType<typeof vi.fn>;
  nextChapter: ReturnType<typeof vi.fn>;
  prevChapter: ReturnType<typeof vi.fn>;
  setPlaybackRate: ReturnType<typeof vi.fn>;
  isKeyboardPrecisionEnabled: ReturnType<typeof vi.fn>;
}

function makeController(stateOverrides: Partial<PlayerState> = {}): MockController {
  const state = makeState(stateOverrides);
  return {
    config: {},
    getState: vi.fn(() => state),
    togglePlay: vi.fn(),
    seekBy: vi.fn(),
    seek: vi.fn(),
    setVolume: vi.fn(),
    toggleMute: vi.fn(),
    togglePictureInPicture: vi.fn(),
    toggleLoop: vi.fn(),
    nextChapter: vi.fn(),
    prevChapter: vi.fn(),
    setPlaybackRate: vi.fn(),
    isKeyboardPrecisionEnabled: vi.fn(() => true),
  };
}

function press(
  manager: KeyboardManager,
  key: string,
  modifiers: { shiftKey?: boolean; ctrlKey?: boolean; altKey?: boolean } = {}
): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key,
    shiftKey: !!modifiers.shiftKey,
    ctrlKey: !!modifiers.ctrlKey,
    altKey: !!modifiers.altKey,
    bubbles: true,
    cancelable: true,
  });
  manager.handleKeyDown(event);
  return event;
}

describe('KeyboardManager default bindings', () => {
  let controller: MockController;
  let manager: KeyboardManager;

  beforeEach(() => {
    controller = makeController();
    manager = new KeyboardManager(controller as unknown as PlayerController);
  });

  it('space toggles play/pause', () => {
    const e = press(manager, ' ');
    expect(controller.togglePlay).toHaveBeenCalledTimes(1);
    expect(e.defaultPrevented).toBe(true);
  });

  it('k toggles play/pause', () => {
    press(manager, 'k');
    expect(controller.togglePlay).toHaveBeenCalledTimes(1);
  });

  it('ArrowLeft seeks backward 10s', () => {
    press(manager, 'ArrowLeft');
    expect(controller.seekBy).toHaveBeenCalledWith(-10);
  });

  it('ArrowRight seeks forward 10s', () => {
    press(manager, 'ArrowRight');
    expect(controller.seekBy).toHaveBeenCalledWith(10);
  });

  it('j seeks backward 10s', () => {
    press(manager, 'j');
    expect(controller.seekBy).toHaveBeenCalledWith(-10);
  });

  it('l seeks forward 10s', () => {
    press(manager, 'l');
    expect(controller.seekBy).toHaveBeenCalledWith(10);
  });

  it('ArrowUp increases volume by 0.1, clamped to 1.0', () => {
    press(manager, 'ArrowUp');
    expect(controller.setVolume).toHaveBeenCalledWith(0.6);

    controller.getState.mockReturnValue(makeState({ volume: 0.95 }));
    press(manager, 'ArrowUp');
    expect(controller.setVolume).toHaveBeenLastCalledWith(1.0);
  });

  it('ArrowDown decreases volume by 0.1, clamped to 0', () => {
    press(manager, 'ArrowDown');
    expect(controller.setVolume).toHaveBeenCalledWith(0.4);

    controller.getState.mockReturnValue(makeState({ volume: 0.05 }));
    press(manager, 'ArrowDown');
    expect(controller.setVolume).toHaveBeenLastCalledWith(0);
  });

  it('m toggles mute', () => {
    press(manager, 'm');
    expect(controller.toggleMute).toHaveBeenCalledTimes(1);
  });

  it('f dispatches a fullscreen hook (no direct controller call)', () => {
    const hook = vi.fn();
    manager.onAction(hook);
    press(manager, 'f');
    expect(hook).toHaveBeenCalledWith('fullscreen', undefined);
  });

  it('p toggles picture-in-picture', () => {
    press(manager, 'p');
    expect(controller.togglePictureInPicture).toHaveBeenCalledTimes(1);
  });

  it('r toggles loop', () => {
    press(manager, 'r');
    expect(controller.toggleLoop).toHaveBeenCalledTimes(1);
  });

  it('Ctrl+ArrowRight goes to next chapter', () => {
    press(manager, 'ArrowRight', { ctrlKey: true });
    expect(controller.nextChapter).toHaveBeenCalledTimes(1);
    // Plain ArrowRight (no ctrl) must still be seek, not chapter nav.
    expect(controller.prevChapter).not.toHaveBeenCalled();
  });

  it('Ctrl+ArrowLeft goes to previous chapter', () => {
    press(manager, 'ArrowLeft', { ctrlKey: true });
    expect(controller.prevChapter).toHaveBeenCalledTimes(1);
  });

  it('Home seeks to start and reports elapsed seek delta', () => {
    const hook = vi.fn();
    manager.onAction(hook);
    press(manager, 'Home');
    expect(controller.seek).toHaveBeenCalledWith(0);
    expect(hook).toHaveBeenCalledWith('seek', { seconds: -30 });
  });

  it('End seeks to duration and reports elapsed seek delta', () => {
    const hook = vi.fn();
    manager.onAction(hook);
    press(manager, 'End');
    expect(controller.seek).toHaveBeenCalledWith(100);
    expect(hook).toHaveBeenCalledWith('seek', { seconds: 70 });
  });

  it(', steps one frame backward when keyboard precision is enabled', () => {
    press(manager, ',');
    expect(controller.seek).toHaveBeenCalledWith(30 - 0.04);
  });

  it('. steps one frame forward when keyboard precision is enabled', () => {
    press(manager, '.');
    expect(controller.seek).toHaveBeenCalledWith(30 + 0.04);
  });

  it(', and . do nothing when keyboard precision is disabled', () => {
    controller.isKeyboardPrecisionEnabled.mockReturnValue(false);
    press(manager, ',');
    press(manager, '.');
    expect(controller.seek).not.toHaveBeenCalled();
  });

  it('Shift+> increases playback speed to the next step', () => {
    press(manager, '>', { shiftKey: true });
    expect(controller.setPlaybackRate).toHaveBeenCalledWith(1.25);
  });

  it('Shift+< decreases playback speed to the previous step', () => {
    press(manager, '<', { shiftKey: true });
    expect(controller.setPlaybackRate).toHaveBeenCalledWith(0.75);
  });

  it('plain > (no shift) is not bound to speed change', () => {
    press(manager, '>');
    expect(controller.setPlaybackRate).not.toHaveBeenCalled();
  });

  it('speed increase is a no-op at the fastest step (4.0)', () => {
    controller.getState.mockReturnValue(makeState({ playbackRate: 4.0 }));
    press(manager, '>', { shiftKey: true });
    expect(controller.setPlaybackRate).not.toHaveBeenCalled();
  });

  it('speed decrease is a no-op at the slowest step (0.25)', () => {
    controller.getState.mockReturnValue(makeState({ playbackRate: 0.25 }));
    press(manager, '<', { shiftKey: true });
    expect(controller.setPlaybackRate).not.toHaveBeenCalled();
  });

  it.each(['0', '1', '2', '5', '9'])('digit key %s seeks to the matching percent of duration', (digit) => {
    const hook = vi.fn();
    manager.onAction(hook);
    press(manager, digit);
    const expectedTime = 100 * (parseInt(digit, 10) / 10);
    expect(controller.seek).toHaveBeenCalledWith(expectedTime);
    expect(hook).toHaveBeenCalledWith('seek', { seconds: expectedTime - 30 });
  });

  it('digit key seeks within the live seekable range when live', () => {
    controller.getState.mockReturnValue(
      makeState({ isLive: true, canSeekInDvr: true, seekableRange: { start: 20, end: 120 }, currentTime: 60 })
    );
    press(manager, '5');
    // start + (end-start) * 0.5 = 20 + 100*0.5 = 70
    expect(controller.seek).toHaveBeenCalledWith(70);
  });
});

describe('KeyboardManager unbound keys', () => {
  it('ignores a key with no registered binding', () => {
    const controller = makeController();
    const manager = new KeyboardManager(controller as unknown as PlayerController);
    const e = press(manager, 'z');
    expect(controller.togglePlay).not.toHaveBeenCalled();
    expect(controller.seekBy).not.toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(false);
  });

  it('does not match a bound key when required modifiers are absent', () => {
    const controller = makeController();
    const manager = new KeyboardManager(controller as unknown as PlayerController);
    // 'ArrowRight' with shiftKey is not a registered combo (only plain and ctrl variants are).
    press(manager, 'ArrowRight', { shiftKey: true });
    expect(controller.seekBy).not.toHaveBeenCalled();
    expect(controller.nextChapter).not.toHaveBeenCalled();
  });
});

describe('KeyboardManager enable/disable', () => {
  it('disable() suppresses all shortcut processing until re-enabled', () => {
    const controller = makeController();
    const manager = new KeyboardManager(controller as unknown as PlayerController);
    manager.disable();
    expect(manager.isEnabled()).toBe(false);
    press(manager, ' ');
    expect(controller.togglePlay).not.toHaveBeenCalled();

    manager.enable();
    expect(manager.isEnabled()).toBe(true);
    press(manager, ' ');
    expect(controller.togglePlay).toHaveBeenCalledTimes(1);
  });
});

describe('KeyboardManager config gating', () => {
  it('hotkeys: false globally disables shortcut handling', () => {
    const controller = makeController();
    controller.config = { hotkeys: false };
    const manager = new KeyboardManager(controller as unknown as PlayerController);
    press(manager, ' ');
    expect(controller.togglePlay).not.toHaveBeenCalled();
  });

  it('hotkeys: { enabled: false } globally disables shortcut handling', () => {
    const controller = makeController();
    controller.config = { hotkeys: { enabled: false } };
    const manager = new KeyboardManager(controller as unknown as PlayerController);
    press(manager, ' ');
    expect(controller.togglePlay).not.toHaveBeenCalled();
  });

  it('controls.play === false blocks the playPause action specifically', () => {
    const controller = makeController();
    controller.config = { controls: { play: false } };
    const manager = new KeyboardManager(controller as unknown as PlayerController);
    press(manager, ' ');
    expect(controller.togglePlay).not.toHaveBeenCalled();
    // Unrelated action should still work.
    press(manager, 'm');
    expect(controller.toggleMute).toHaveBeenCalledTimes(1);
  });

  it('controls.seekbar === false blocks seek-related actions', () => {
    const controller = makeController();
    controller.config = { controls: { seekbar: false } };
    const manager = new KeyboardManager(controller as unknown as PlayerController);
    press(manager, 'ArrowLeft');
    expect(controller.seekBy).not.toHaveBeenCalled();
  });

  it('controls.fullscreen === false blocks fullscreenToggle', () => {
    const controller = makeController();
    controller.config = { controls: { fullscreen: false } };
    const manager = new KeyboardManager(controller as unknown as PlayerController);
    const hook = vi.fn();
    manager.onAction(hook);
    press(manager, 'f');
    expect(hook).not.toHaveBeenCalled();
  });
});

describe('KeyboardManager ad-playback restrictions', () => {
  it('suppresses non-allowlisted actions while an ad is playing', () => {
    const controller = makeController({ isAdPlaying: true });
    const manager = new KeyboardManager(controller as unknown as PlayerController);
    press(manager, 'ArrowLeft'); // seekBackward10 not in the ad allowlist
    expect(controller.seekBy).not.toHaveBeenCalled();
    press(manager, 'r'); // loopToggle not in the ad allowlist
    expect(controller.toggleLoop).not.toHaveBeenCalled();
  });

  it('still allows playPause, mute, volume, and fullscreen while an ad is playing', () => {
    const controller = makeController({ isAdPlaying: true });
    const manager = new KeyboardManager(controller as unknown as PlayerController);
    press(manager, ' ');
    expect(controller.togglePlay).toHaveBeenCalledTimes(1);
    press(manager, 'm');
    expect(controller.toggleMute).toHaveBeenCalledTimes(1);
    press(manager, 'ArrowUp');
    expect(controller.setVolume).toHaveBeenCalledTimes(1);
    const hook = vi.fn();
    manager.onAction(hook);
    press(manager, 'f');
    expect(hook).toHaveBeenCalledWith('fullscreen', undefined);
  });
});

describe('KeyboardManager live/DVR seek suppression', () => {
  it('ignores seek shortcuts on a pure live stream without DVR seek support', () => {
    const controller = makeController({ isLive: true, canSeekInDvr: false });
    const manager = new KeyboardManager(controller as unknown as PlayerController);
    press(manager, 'ArrowLeft');
    press(manager, 'Home');
    press(manager, 'End');
    expect(controller.seekBy).not.toHaveBeenCalled();
    expect(controller.seek).not.toHaveBeenCalled();
  });
});

describe('KeyboardManager custom bind/unbind/setMap API', () => {
  it('bind() registers a new shortcut that fires a registered action', () => {
    const controller = makeController();
    const manager = new KeyboardManager(controller as unknown as PlayerController);
    manager.registerAction('customAction', (ctrl) => ctrl.togglePlay());
    manager.bind({ key: 'x', action: 'customAction' });
    press(manager, 'x');
    expect(controller.togglePlay).toHaveBeenCalledTimes(1);
  });

  it('bind() replaces an existing binding for the same key/modifier combo', () => {
    const controller = makeController();
    const manager = new KeyboardManager(controller as unknown as PlayerController);
    manager.registerAction('customAction', (ctrl) => ctrl.toggleLoop());
    // Re-bind the default space key to a different action.
    manager.bind({ key: ' ', action: 'customAction' });
    press(manager, ' ');
    expect(controller.togglePlay).not.toHaveBeenCalled();
    expect(controller.toggleLoop).toHaveBeenCalledTimes(1);
  });

  it('unbind() removes a shortcut so the key becomes a no-op', () => {
    const controller = makeController();
    const manager = new KeyboardManager(controller as unknown as PlayerController);
    manager.unbind(' ');
    press(manager, ' ');
    expect(controller.togglePlay).not.toHaveBeenCalled();
  });

  it('setMap() replaces the entire binding set', () => {
    const controller = makeController();
    const manager = new KeyboardManager(controller as unknown as PlayerController);
    manager.setMap([{ key: 'q', action: 'playPause' }]);
    // Old default binding no longer active.
    press(manager, ' ');
    expect(controller.togglePlay).not.toHaveBeenCalled();
    // New binding is active.
    press(manager, 'q');
    expect(controller.togglePlay).toHaveBeenCalledTimes(1);
  });

  it('constructor applies hotkeys.bindings and hotkeys.overrides from config', () => {
    const controller = makeController();
    controller.config = {
      hotkeys: {
        bindings: [{ key: 'q', action: 'playPause' }],
        overrides: [{ key: 'm', action: 'playPause' }],
      },
    };
    const manager = new KeyboardManager(controller as unknown as PlayerController);
    // setMap wiped defaults, so only 'q' is bound from bindings...
    press(manager, 'q');
    expect(controller.togglePlay).toHaveBeenCalledTimes(1);
    // ...plus the override adds 'm' -> playPause (default 'm' was muteToggle).
    press(manager, 'm');
    expect(controller.togglePlay).toHaveBeenCalledTimes(2);
    expect(controller.toggleMute).not.toHaveBeenCalled();
  });
});

describe('KeyboardManager onAction hook subscription', () => {
  it('onAction returns an unsubscribe function that stops future notifications', () => {
    const controller = makeController();
    const manager = new KeyboardManager(controller as unknown as PlayerController);
    const hook = vi.fn();
    const unsubscribe = manager.onAction(hook);
    press(manager, 'ArrowLeft');
    expect(hook).toHaveBeenCalledTimes(1);

    unsubscribe();
    press(manager, 'ArrowLeft');
    expect(hook).toHaveBeenCalledTimes(1);
  });
});

describe('KeyboardManager destroy()', () => {
  it('clears bindings, actions, and hooks so subsequent key events are no-ops', () => {
    const controller = makeController();
    const manager = new KeyboardManager(controller as unknown as PlayerController);
    const hook = vi.fn();
    manager.onAction(hook);

    manager.destroy();

    const e = press(manager, ' ');
    expect(controller.togglePlay).not.toHaveBeenCalled();
    expect(hook).not.toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(false);
  });

  it('re-binding after destroy still works (destroy does not disable the manager)', () => {
    const controller = makeController();
    const manager = new KeyboardManager(controller as unknown as PlayerController);
    manager.destroy();
    manager.registerAction('playPause', (ctrl) => ctrl.togglePlay());
    manager.bind({ key: ' ', action: 'playPause' });
    press(manager, ' ');
    expect(controller.togglePlay).toHaveBeenCalledTimes(1);
  });
});
