import type { PlayerController } from './PlayerController';

export interface KeyboardActionDetail {
  key?: string;
  seconds?: number;
  volume?: number;
  isMuted?: boolean;
}

export type ShortcutAction = (
  controller: PlayerController,
  event: KeyboardEvent,
  detail?: KeyboardActionDetail
) => void;

export interface ShortcutBinding {
  key: string; // Case-insensitive key name (e.g., ' ', 'k', 'arrowleft', '1', '>', '<', ',', '.')
  shiftKey?: boolean; // Whether Shift modifier is required (optional)
  ctrlKey?: boolean; // Whether Ctrl modifier is required (optional)
  altKey?: boolean; // Whether Alt modifier is required (optional)
  action: string; // Name of the action to execute
}

export type ActionHook = (actionName: string, detail?: KeyboardActionDetail) => void;

export class KeyboardManager {
  private controller: PlayerController;
  private bindings: ShortcutBinding[] = [];
  private actions: Map<string, ShortcutAction> = new Map();
  private hooks: Set<ActionHook> = new Set();
  private enabled = true;

  constructor(controller: PlayerController) {
    this.controller = controller;
    this.registerDefaultActions();
    this.registerDefaultBindings();

    // Load custom configuration
    const hotkeysConfig = this.controller.config?.hotkeys;
    if (hotkeysConfig && typeof hotkeysConfig === 'object') {
      if (hotkeysConfig.bindings) {
        this.setMap(hotkeysConfig.bindings);
      }
      if (hotkeysConfig.overrides) {
        for (const b of hotkeysConfig.overrides) {
          this.bind(b);
        }
      }
    }
  }

  // --- Public APIs for custom hotkeys mapping ---

  /**
   * Enable keyboard shortcuts processing.
   */
  public enable() {
    this.enabled = true;
  }

  /**
   * Disable keyboard shortcuts processing.
   */
  public disable() {
    this.enabled = false;
  }

  /**
   * Check if shortcuts are enabled.
   */
  public isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Register a custom action handler.
   */
  public registerAction(name: string, handler: ShortcutAction) {
    this.actions.set(name, handler);
  }

  /**
   * Unregister an action handler.
   */
  public unregisterAction(name: string) {
    this.actions.delete(name);
  }

  /**
   * Bind a shortcut combo to an action.
   */
  public bind(binding: ShortcutBinding) {
    // Remove existing binding with same key combo to prevent duplicate execution
    this.unbind(binding.key, binding.shiftKey, binding.ctrlKey, binding.altKey);
    this.bindings.push({
      ...binding,
      key: binding.key.toLowerCase(),
    });
  }

  /**
   * Unbind a shortcut combo.
   */
  public unbind(key: string, shiftKey = false, ctrlKey = false, altKey = false) {
    const keyLower = key.toLowerCase();
    this.bindings = this.bindings.filter(
      (b) =>
        !(
          b.key === keyLower &&
          !!b.shiftKey === shiftKey &&
          !!b.ctrlKey === ctrlKey &&
          !!b.altKey === altKey
        )
    );
  }

  /**
   * Set a completely new shortcut mapping configuration.
   */
  public setMap(newBindings: ShortcutBinding[]) {
    this.bindings = newBindings.map((b) => ({
      ...b,
      key: b.key.toLowerCase(),
    }));
  }

  /**
   * Subscribe to executed actions to show overlays or dispatch events in UI layer.
   */
  public onAction(callback: ActionHook): () => void {
    this.hooks.add(callback);
    return () => this.hooks.delete(callback);
  }

  // --- Core Keyboard Event Handler ---

  /**
   * Process and route keydown events.
   */
  public handleKeyDown(e: KeyboardEvent) {
    if (!this.enabled) return;

    // Check if hotkeys are globally disabled in config
    const hotkeysConfig = this.controller.config?.hotkeys;
    if (
      hotkeysConfig === false ||
      (hotkeysConfig && typeof hotkeysConfig === 'object' && hotkeysConfig.enabled === false)
    ) {
      return;
    }

    const keyLower = e.key.toLowerCase();
    const shift = e.shiftKey;
    const ctrl = e.ctrlKey;
    const alt = e.altKey;

    // Find first matching binding in registry
    const match = this.bindings.find((b) => {
      if (b.key === keyLower) {
        // Verify modifiers match exactly (default to false if not specified)
        const shiftMatch = (b.shiftKey || false) === shift;
        const ctrlMatch = (b.ctrlKey || false) === ctrl;
        const altMatch = (b.altKey || false) === alt;
        return shiftMatch && ctrlMatch && altMatch;
      }
      return false;
    });

    if (match) {
      // Suspend content seeking & navigation shortcuts during ad playback
      if (this.controller.getState().isAdPlaying) {
        const allowedAdActions = ['playPause', 'muteToggle', 'volumeUp', 'volumeDown', 'fullscreenToggle'];
        if (!allowedAdActions.includes(match.action)) {
          return;
        }
      }

      // Check if control is enabled for this action
      const configControls = this.controller.config?.controls;
      if (configControls) {
        if (match.action === 'playPause') {
          if (configControls.play === false || configControls.playButton === false) {
            return;
          }
        }
        if (
          match.action === 'volumeUp' ||
          match.action === 'volumeDown' ||
          match.action === 'muteToggle'
        ) {
          if (configControls.volume === false || configControls.mute === false) {
            return;
          }
        }
        if (
          match.action === 'seekBackward10' ||
          match.action === 'seekForward10' ||
          match.action === 'seekStart' ||
          match.action === 'seekEnd' ||
          match.action === 'frameBackward' ||
          match.action === 'frameForward' ||
          match.action === 'seekPercent'
        ) {
          if (configControls.seekbar === false) {
            return;
          }
        }
        if (match.action === 'fullscreenToggle') {
          if (configControls.fullscreen === false) {
            return;
          }
        }
        if (match.action === 'pipToggle') {
          if (configControls.pip === false || configControls.pictureInPicture === false) {
            return;
          }
        }
        if (match.action === 'speedIncrease' || match.action === 'speedDecrease') {
          if (configControls.playbackSpeed === false) {
            return;
          }
        }
        if (match.action === 'nextChapter' || match.action === 'prevChapter') {
          if (configControls.chapters === false) {
            return;
          }
        }
      }

      const handler = this.actions.get(match.action);
      if (handler) {
        e.preventDefault();
        e.stopPropagation();

        // Pass the key character to support numerical jumps 0-9
        handler(this.controller, e, { key: e.key });
      }
    }
  }

  private dispatchHook(actionName: string, detail?: KeyboardActionDetail) {
    this.hooks.forEach((hook) => hook(actionName, detail));
  }

  // --- Defaults Configurations Initialization ---

  private registerDefaultActions() {
    this.registerAction('playPause', (ctrl) => {
      ctrl.togglePlay();
    });

    this.registerAction('seekBackward10', (ctrl) => {
      const state = ctrl.getState();
      if (state.isLive && !state.canSeekInDvr) return;
      ctrl.seekBy(-10);
      this.dispatchHook('seek', { seconds: -10 });
    });

    this.registerAction('seekForward10', (ctrl) => {
      const state = ctrl.getState();
      if (state.isLive && !state.canSeekInDvr) return;
      ctrl.seekBy(10);
      this.dispatchHook('seek', { seconds: 10 });
    });

    this.registerAction('volumeUp', (ctrl) => {
      const currentVol = ctrl.getState().volume;
      const nextVol = Math.min(1.0, currentVol + 0.1);
      ctrl.setVolume(nextVol);
      this.dispatchHook('volume', { volume: nextVol, isMuted: ctrl.getState().isMuted });
    });

    this.registerAction('volumeDown', (ctrl) => {
      const currentVol = ctrl.getState().volume;
      const nextVol = Math.max(0, currentVol - 0.1);
      ctrl.setVolume(nextVol);
      this.dispatchHook('volume', { volume: nextVol, isMuted: ctrl.getState().isMuted });
    });

    this.registerAction('muteToggle', (ctrl) => {
      ctrl.toggleMute();
      this.dispatchHook('volume', {
        volume: ctrl.getState().volume,
        isMuted: ctrl.getState().isMuted,
      });
    });

    this.registerAction('fullscreenToggle', (ctrl) => {
      // Dispatch custom hook for fullscreen, letting the UI layer request fullscreen on host
      this.dispatchHook('fullscreen');
    });

    this.registerAction('pipToggle', (ctrl) => {
      ctrl.togglePictureInPicture();
    });

    this.registerAction('loopToggle', (ctrl) => {
      ctrl.toggleLoop();
    });

    this.registerAction('nextChapter', (ctrl) => {
      ctrl.nextChapter();
    });

    this.registerAction('prevChapter', (ctrl) => {
      ctrl.prevChapter();
    });

    this.registerAction('seekStart', (ctrl) => {
      const state = ctrl.getState();
      if (state.isLive && !state.canSeekInDvr) return;
      const current = state.currentTime;
      ctrl.seek(0);
      this.dispatchHook('seek', { seconds: -current });
    });

    this.registerAction('seekEnd', (ctrl) => {
      const state = ctrl.getState();
      if (state.isLive && !state.canSeekInDvr) return;
      const current = state.currentTime;
      const duration = state.duration;
      ctrl.seek(duration);
      this.dispatchHook('seek', { seconds: duration - current });
    });

    this.registerAction('seekPercent', (ctrl, _, detail) => {
      const key = detail?.key;
      if (key && key >= '0' && key <= '9') {
        const percent = parseInt(key, 10) / 10;
        const state = ctrl.getState();
        if (state.isLive && !state.canSeekInDvr) return;
        let targetTime = 0;
        if (state.isLive) {
          const start = state.seekableRange?.start ?? 0;
          const end = state.seekableRange?.end ?? 0;
          targetTime = start + (end - start) * percent;
        } else {
          const duration = state.duration || 0;
          targetTime = duration * percent;
        }
        const current = state.currentTime;
        ctrl.seek(targetTime);
        this.dispatchHook('seek', { seconds: targetTime - current });
      }
    });

    this.registerAction('frameBackward', (ctrl) => {
      if (!ctrl.isKeyboardPrecisionEnabled()) return;
      const state = ctrl.getState();
      if (state.isLive && !state.canSeekInDvr) return;
      const current = state.currentTime;
      const targetTime = Math.max(0, current - 0.04); // 25fps default step (0.04s)
      ctrl.seek(targetTime);
      this.dispatchHook('seek', { seconds: targetTime - current });
    });

    this.registerAction('frameForward', (ctrl) => {
      if (!ctrl.isKeyboardPrecisionEnabled()) return;
      const state = ctrl.getState();
      if (state.isLive && !state.canSeekInDvr) return;
      const current = state.currentTime;
      const duration = state.duration || 0;
      const targetTime = Math.min(duration, current + 0.04);
      ctrl.seek(targetTime);
      this.dispatchHook('seek', { seconds: targetTime - current });
    });

    this.registerAction('speedIncrease', (ctrl) => {
      const speeds = [0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0, 4.0];
      const currentSpeed = ctrl.getState().playbackRate;
      const idx = speeds.indexOf(currentSpeed);
      if (idx !== -1 && idx < speeds.length - 1) {
        ctrl.setPlaybackRate(speeds[idx + 1]);
      }
    });

    this.registerAction('speedDecrease', (ctrl) => {
      const speeds = [0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0, 4.0];
      const currentSpeed = ctrl.getState().playbackRate;
      const idx = speeds.indexOf(currentSpeed);
      if (idx !== -1 && idx > 0) {
        ctrl.setPlaybackRate(speeds[idx - 1]);
      }
    });
  }

  private registerDefaultBindings() {
    // Play / Pause
    this.bind({ key: ' ', action: 'playPause' });
    this.bind({ key: 'k', action: 'playPause' });

    // Seeking (10s)
    this.bind({ key: 'arrowleft', action: 'seekBackward10' });
    this.bind({ key: 'arrowright', action: 'seekForward10' });
    this.bind({ key: 'j', action: 'seekBackward10' });
    this.bind({ key: 'l', action: 'seekForward10' });

    // Volume controls
    this.bind({ key: 'arrowup', action: 'volumeUp' });
    this.bind({ key: 'arrowdown', action: 'volumeDown' });
    this.bind({ key: 'm', action: 'muteToggle' });

    // Fullscreen controls
    this.bind({ key: 'f', action: 'fullscreenToggle' });

    // Picture-in-Picture controls
    this.bind({ key: 'p', action: 'pipToggle' });

    // Loop Mode controls
    this.bind({ key: 'r', action: 'loopToggle' });

    // Chapter Navigation controls
    this.bind({ key: 'arrowright', action: 'nextChapter', ctrlKey: true });
    this.bind({ key: 'arrowleft', action: 'prevChapter', ctrlKey: true });

    // Timeline navigation (Home/End)
    this.bind({ key: 'home', action: 'seekStart' });
    this.bind({ key: 'end', action: 'seekEnd' });

    // Frame stepping (comma / period)
    this.bind({ key: ',', action: 'frameBackward' });
    this.bind({ key: '.', action: 'frameForward' });

    // Playback Speed (Shift + > / Shift + <)
    this.bind({ key: '>', action: 'speedIncrease', shiftKey: true });
    this.bind({ key: '<', action: 'speedDecrease', shiftKey: true });

    // Percentage Jumps (0-9)
    for (let i = 0; i <= 9; i++) {
      this.bind({ key: i.toString(), action: 'seekPercent' });
    }
  }

  /**
   * Release references and clean up all bindings, actions and hooks.
   */
  public destroy() {
    this.bindings = [];
    this.actions.clear();
    this.hooks.clear();
  }
}
