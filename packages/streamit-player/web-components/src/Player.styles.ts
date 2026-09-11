import { css } from 'lit';

export const styles = css`
  :host {
    display: block;
    position: relative;
    width: 100%;
    aspect-ratio: 16 / 9;
    background: var(--player-bg-color, #000000);
    font-family: var(--player-font-family, 'Outfit', system-ui, -apple-system, sans-serif);
    line-height: var(--player-line-height, 1.5);
    overflow: hidden;
    border-radius: var(--player-border-radius, 16px);
    box-shadow: var(--player-shadow, 0 20px 50px rgba(0, 0, 0, 0.45));
    user-select: none;
    -webkit-user-select: none;
    -webkit-tap-highlight-color: transparent;
    outline: none;

    /* Premium Design Tokens */
    --player-primary-glow: rgba(99, 102, 241, 0.35);
    --player-glass-bg: rgba(8, 8, 12, 0.45);
    --player-glass-panel: rgba(10, 10, 15, 0.85);
    --player-glass-border: rgba(255, 255, 255, 0.06);
    --player-glass-blur: 16px;
    --player-glass-shadow: 0 12px 40px rgba(0, 0, 0, 0.65), inset 0 1px 0 rgba(255, 255, 255, 0.08);
    --player-menu-bg: rgba(15, 23, 42, 0.95);
    --player-seekbar-bg: rgba(255, 255, 255, 0.15);
    --player-seekbar-buffer: rgba(255, 255, 255, 0.25);
    --player-ease-smooth: cubic-bezier(0.16, 1, 0.3, 1);
    --player-transition-duration: 0.25s;

    /* Dynamic Safe Area & Controls Layout Tokens */
    --player-controls-bottom: 20px;
    --player-controls-height: 64px;
    --player-overlay-safe-bottom: calc(var(--player-controls-bottom) + var(--player-controls-height) + 28px + env(safe-area-inset-bottom, 0px));
  }

  :host(.controls-hidden) {
    --player-overlay-safe-bottom: calc(16px + env(safe-area-inset-bottom, 0px));
  }

  .player-ads-overlay {
    position: absolute;
    inset: 0;
    pointer-events: none;
    z-index: 20;
    overflow: hidden;
  }

  .player-ad-ui-overlay {
    position: absolute;
    inset: 0;
    pointer-events: none;
    z-index: 25;
  }

  .ad-badge-top {
    position: absolute;
    top: 12px;
    right: 12px;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: var(--player-ad-badge-bg, rgba(15, 23, 42, 0.85));
    backdrop-filter: blur(12px);
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 14px;
    padding: 3px 4px;
    color: var(--player-ad-badge-color, #ffffff);
    font-size: 12px;
    font-weight: 500;
    pointer-events: auto;
    cursor: pointer;
  }

  .ad-pill {
    background: #f59e0b;
    color: #000000;
    font-size: 11px;
    font-weight: 700;
    padding: 2px 8px;
    border-radius: 10px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .ad-skip-container {
    position: absolute;
    bottom: 16px;
    right: 12px;
    pointer-events: auto;
  }

  .ad-skip-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: var(--player-ad-skip-bg, rgba(15, 23, 42, 0.9));
    border: 1px solid rgba(255, 255, 255, 0.2);
    color: var(--player-ad-skip-color, #ffffff);
    padding: 8px 16px;
    border-radius: 8px;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s ease;
    backdrop-filter: blur(8px);
  }

  .ad-skip-btn.active:hover {
    background: rgba(245, 158, 11, 0.95);
    color: #000000;
    border-color: #f59e0b;
  }

  .ad-skip-btn.disabled {
    background: var(--player-ad-skip-disabled-bg, rgba(15, 23, 42, 0.9));
    opacity: 0.8;
    cursor: not-allowed;
  }

  .ad-countdown {
    background: rgba(15, 23, 42, 0.85);
    border: 1px solid rgba(255, 255, 255, 0.15);
    color: #e2e8f0;
    padding: 6px 14px;
    border-radius: 8px;
    font-size: 13px;
    font-weight: 500;
    backdrop-filter: blur(8px);
  }

  .ad-progress-bar-track {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    height: 3px;
    background: var(--player-ad-progress-bg, rgba(255, 255, 255, 0.2));
    pointer-events: none;
  }

  .ad-progress-bar-fill {
    height: 100%;
    background: var(--player-ad-progress-fill, #f59e0b);
  }

  :host([display-mode='vertical']) {
    aspect-ratio: 9 / 16;
    max-width: var(--player-vertical-max-width, 450px);
    margin: 0 auto;
    overflow: visible;
  }

  :host([display-mode='audio-only']) {
    aspect-ratio: auto;
    height: 140px;
    overflow: hidden;
  }

  :host([display-mode='mini']) {
    position: fixed;
    bottom: 20px;
    right: 20px;
    width: 320px;
    height: 180px;
    aspect-ratio: 16 / 9;
    z-index: 9999;
    overflow: hidden;
  }

  :host([display-mode='floating']) {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 640px;
    height: 360px;
    aspect-ratio: 16 / 9;
    z-index: 1000;
    overflow: hidden;
  }

  :host([display-mode='vertical']:fullscreen),
  :host([display-mode='vertical']:-webkit-full-screen) {
    background: var(--player-bg-color, #000000) !important;
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    overflow: visible !important;
  }

  :host([display-mode='vertical']:fullscreen) .player-container,
  :host([display-mode='vertical']:-webkit-full-screen) .player-container {
    width: 100% !important;
    height: 100% !important;
    max-width: calc(100vh * 9 / 16) !important;
    max-height: calc(100vw * 16 / 9) !important;
    /* dvh accounts for mobile browser chrome (address bar) resizing; falls
       back to the vh values above on browsers that don't support it. */
    max-width: calc(100dvh * 9 / 16) !important;
    max-height: calc(100dvw * 16 / 9) !important;
    aspect-ratio: 9 / 16 !important;
    margin: auto !important;
    position: relative !important;
    background: var(--player-bg-color, #000000) !important;
  }

  :host([display-mode='vertical']) .video-wrapper {
    touch-action: none;
  }

  :host([display-mode='vertical']) .controls-bar {
    bottom: 12px;
    left: 12px;
    right: 12px;
    max-width: calc(100% - 24px);
    padding: 12px 14px;
    border-radius: 12px;
  }

  :host([display-mode='vertical']) .controls-row {
    flex-direction: column;
    gap: 12px;
    align-items: stretch;
  }

  :host([display-mode='vertical']) .controls-group {
    width: 100%;
    justify-content: space-between;
    gap: 8px;
  }

  :host([display-mode='vertical']) .settings-drag-handle {
    display: block;
  }

  :host([display-mode='vertical']) .settings-menu {
    bottom: 0;
    right: 0;
    left: 0;
    width: 100%;
    max-width: 100%;
    border-radius: 20px 20px 0 0;
    border-bottom: none;
    border-left: none;
    border-right: none;
    padding: 0 0 24px 0;
    transform: translateY(100%);
    opacity: 0;
    transition:
      opacity 0.35s cubic-bezier(0.16, 1, 0.3, 1),
      transform 0.35s cubic-bezier(0.16, 1, 0.3, 1);
  }

  :host([display-mode='vertical']) .settings-menu.visible {
    opacity: 1;
    transform: translateY(0);
  }

  :host(.controls-hidden) {
    cursor: none;
  }

  .player-container {
    position: relative;
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .player-container.source-type-embed .controls-bar,
  .player-container.source-type-embed .scrim,
  .player-container.source-type-embed .play-pause-overlay,
  .player-container.source-type-embed .spinner-overlay,
  .player-container.source-type-embed .replay-overlay {
    display: none !important;
    pointer-events: none !important;
  }

  .video-wrapper {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    overflow: hidden;
    background: var(--player-bg-color, #000000);
    z-index: 1;
    pointer-events: auto;
  }

  video {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: contain;
    cursor: pointer;
    background: var(--player-bg-color, #000000);
    will-change: transform;
  }

  .transition-canvas {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    object-fit: contain;
    pointer-events: none;
    z-index: 10;
    background: var(--player-bg-color, #000000);
    will-change: transform;
    display: none;
  }

  .player-container.feed-transitioning video {
    transform: translateY(0) !important;
    transition: none !important;
  }

  .player-container.feed-transitioning .transition-canvas {
    display: block;
    height: 200%;
    object-fit: fill;
  }

  /* Transition starts: initial positions */
  .player-container.transition-stage-start.transition-direction-next .transition-canvas {
    transform: translateY(0);
    transition: none !important;
  }

  .player-container.transition-stage-start.transition-direction-prev .transition-canvas {
    transform: translateY(-50%);
    transition: none !important;
  }

  /* Transition active: animating to final positions */
  .player-container.transition-stage-active.transition-direction-next .transition-canvas {
    transform: translateY(-50%);
    transition: transform var(--player-vertical-transition-duration, 0.6s)
      var(--player-vertical-transition-easing, cubic-bezier(0.16, 1, 0.3, 1)) !important;
  }

  .player-container.transition-stage-active.transition-direction-prev .transition-canvas {
    transform: translateY(0);
    transition: transform var(--player-vertical-transition-duration, 0.6s)
      var(--player-vertical-transition-easing, cubic-bezier(0.16, 1, 0.3, 1)) !important;
  }

  .player-container.feed-transitioning .spinner-overlay {
    z-index: 15;
  }

  video::cue {
    font-family: var(--player-cue-font-family, inherit) !important;
    font-size: var(--player-cue-font-size, inherit) !important;
    color: var(--player-cue-font-color, inherit) !important;
    background-color: var(--player-cue-background-color, inherit) !important;
    text-shadow: var(--player-cue-text-shadow, inherit) !important;
    font-variant: var(--player-cue-font-variant, inherit) !important;
    border-radius: 6px;
    padding: 4px 10px;
  }

  video::-webkit-media-text-track-container {
    background-color: var(--player-cue-window-color, transparent) !important;
    transform: translateY(0);
    transition: transform 0.25s cubic-bezier(0.16, 1, 0.3, 1) !important;
  }

  .player-container.controls-visible video::-webkit-media-text-track-container {
    transform: translateY(-80px) !important;
  }

  /* Ambient Scrim Vignette Overlay */
  .scrim {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background:
      linear-gradient(to bottom, rgba(0, 0, 0, 0.4) 0%, rgba(0, 0, 0, 0) 25%),
      linear-gradient(to top, rgba(0, 0, 0, 0.5) 0%, rgba(0, 0, 0, 0) 30%);
    pointer-events: none;
    transition: opacity var(--player-transition-duration) var(--player-ease-smooth);
    opacity: 0;
    z-index: 2;
  }

  .scrim.visible {
    opacity: 1;
  }

  /* Overlays Styling */
  .spinner-overlay {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(8, 8, 12, 0.35);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 5;
    pointer-events: none;
  }

  .spinner-overlay::after {
    content: '';
    width: 44px;
    height: 44px;
    border: 3px solid rgba(255, 255, 255, 0.1);
    border-left-color: var(--player-primary-color, #6366f1);
    border-radius: 50%;
    animation: spin 1s linear infinite;
    box-shadow: 0 0 16px rgba(99, 102, 241, 0.2);
  }

  @keyframes spin {
    0% {
      transform: rotate(0deg);
    }
    100% {
      transform: rotate(360deg);
    }
  }

  .empty-overlay,
  .error-overlay {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: var(--player-overlay-bg, #08080c);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--player-spacing, 16px);
    z-index: 20;
    padding: 24px;
    text-align: center;
  }

  .overlay-title {
    font-size: 1.35rem;
    font-weight: 600;
    color: var(--player-text-color, #ffffff);
    line-height: 1.3;
    letter-spacing: -0.01em;
  }

  .overlay-desc {
    font-size: 0.95rem;
    color: var(--player-text-secondary-color, #94a3b8);
    max-width: 400px;
    line-height: 1.5;
  }

  .btn-retry {
    background: var(--player-primary-color, #6366f1);
    color: white;
    border: none;
    padding: 10px 20px;
    border-radius: var(--player-border-radius, 8px);
    cursor: pointer;
    font-family: inherit;
    font-weight: 500;
    transition:
      transform var(--player-transition-duration) var(--player-ease-smooth),
      background-color var(--player-transition-duration) var(--player-ease-smooth),
      box-shadow var(--player-transition-duration) var(--player-ease-smooth);
  }

  .btn-retry:hover {
    background: var(--player-btn-retry-hover-bg, #4f46e5);
    transform: scale(1.04);
    box-shadow: 0 0 12px var(--player-primary-glow, rgba(99, 102, 241, 0.3));
  }

  /* Floating Dock Controls Bar */
  .controls-bar {
    position: absolute;
    bottom: 20px;
    left: 20px;
    right: 20px;
    width: auto;
    max-width: calc(100% - 40px);
    margin: 0 auto;
    padding: 6px 16px;
    background: var(--player-glass-bg);
    backdrop-filter: blur(var(--player-glass-blur));
    -webkit-backdrop-filter: blur(var(--player-glass-blur));
    border: 1px solid var(--player-glass-border);
    border-radius: 16px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    box-shadow: var(--player-glass-shadow);
    transition:
      opacity var(--player-transition-duration) var(--player-ease-smooth),
      transform var(--player-transition-duration) var(--player-ease-smooth),
      visibility 0s linear var(--player-transition-duration);
    opacity: 0;
    transform: translateY(12px);
    pointer-events: none;
    visibility: hidden;
    z-index: 30;
  }

  .controls-bar.visible {
    opacity: 0.72;
    transform: translateY(0);
    pointer-events: auto;
    visibility: visible;
    transition:
      opacity var(--player-transition-duration) var(--player-ease-smooth),
      transform var(--player-transition-duration) var(--player-ease-smooth),
      visibility 0s linear 0s;
  }

  :host(:hover) .controls-bar.visible {
    opacity: 0.85;
  }

  .controls-bar.visible:hover {
    opacity: 1 !important;
  }

  .controls-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
  }

  .controls-group {
    display: flex;
    align-items: center;
    gap: 12px; /* Slimmer spacing balance */
  }

  .center-controls {
    flex: 1;
    justify-content: center;
  }

  .caption-btn,
  .settings-btn,
  .pip-btn,
  .fullscreen-btn {
    background: transparent;
    border: none;
    color: var(--player-button-color, #cbd5e1);
    cursor: pointer;
    padding: var(--player-button-padding, 6px);
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    transition:
      color var(--player-transition-duration) var(--player-ease-smooth),
      background-color var(--player-transition-duration) var(--player-ease-smooth),
      transform var(--player-transition-duration) var(--player-ease-smooth);
    outline: none;
    width: var(--player-button-width, 36px);
    height: var(--player-button-height, 36px);
  }

  .caption-btn:hover,
  .settings-btn:hover,
  .pip-btn:hover,
  .fullscreen-btn:hover {
    color: var(--player-button-hover-color, #ffffff);
    background: var(--player-button-hover-bg, rgba(255, 255, 255, 0.08));
    transform: scale(var(--player-button-hover-scale, 1.12));
  }

  .caption-btn.active {
    color: var(--player-primary-color, #6366f1);
  }

  .caption-btn:focus-visible,
  .settings-btn:focus-visible,
  .pip-btn:focus-visible,
  .fullscreen-btn:focus-visible {
    outline: 2px solid var(--player-primary-color, #6366f1);
    outline-offset: 2px;
  }

  .live-badge-container:focus-visible {
    outline: 2px solid var(--player-primary-color, #6366f1);
    outline-offset: 2px;
  }

  .sleep-timer-btn:focus-visible {
    outline: 2px solid var(--player-primary-color, #6366f1);
    outline-offset: 2px;
  }

  .context-menu-item:focus-visible {
    outline: 2px solid var(--player-primary-color, #6366f1);
    outline-offset: -2px;
    background: rgba(255, 255, 255, 0.1);
  }

  /* Toast Notification Overlay */
  .toast-overlay {
    position: absolute;
    top: 24px;
    left: 50%;
    transform: translate(-50%, -20px);
    background: var(--player-toast-bg, var(--player-menu-bg, rgba(15, 23, 42, 0.95)));
    backdrop-filter: blur(var(--player-glass-blur, 12px));
    -webkit-backdrop-filter: blur(var(--player-glass-blur, 12px));
    border: 1px solid
      var(--player-toast-border, var(--player-glass-border, rgba(255, 255, 255, 0.15)));
    color: var(--player-toast-color, #ffffff);
    padding: 8px 16px;
    font-size: 13px;
    font-weight: 500;
    border-radius: var(--player-border-radius, 8px);
    box-shadow: var(--player-toast-shadow, 0 10px 25px -5px rgba(0, 0, 0, 0.5));
    z-index: 100;
    pointer-events: none;
    opacity: 0;
    transition:
      opacity var(--player-transition-duration) var(--player-ease-smooth),
      transform var(--player-transition-duration) var(--player-ease-smooth);
  }

  .toast-overlay.visible {
    opacity: 1;
    transform: translate(-50%, 0);
  }

  .toast-overlay.success {
    border-left: 3px solid var(--player-toast-success-color, #10b981);
  }

  .toast-overlay.error {
    border-left: 3px solid var(--player-toast-error-color, #ef4444);
  }

  .toast-overlay.info {
    border-left: 3px solid var(--player-toast-info-color, #3b82f6);
  }

  .settings-toggle {
    position: relative;
    width: 36px;
    height: 20px;
    background: var(--player-toggle-inactive-bg, rgba(255, 255, 255, 0.15));
    border-radius: var(--player-border-radius-toggle, 10px);
    transition: background-color var(--player-transition-duration, 0.2s);
  }

  .settings-toggle.active {
    background: var(--player-primary-color, #6366f1);
  }

  .settings-toggle::after {
    content: '';
    position: absolute;
    top: 2px;
    left: 2px;
    width: 16px;
    height: 16px;
    background: var(--player-toggle-handle-color, #ffffff);
    border-radius: 50%;
    transition: transform var(--player-transition-duration, 0.2s) var(--player-ease-smooth);
  }

  .settings-toggle.active::after {
    transform: translateX(16px);
  }

  @keyframes fadeIn {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  @keyframes scaleIn {
    from {
      transform: scale(0.9);
      opacity: 0;
    }
    to {
      transform: scale(1);
      opacity: 1;
    }
  }

  .settings-menu-wrapper {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    overflow: hidden;
    pointer-events: none;
    z-index: 100;
  }

  .settings-drag-handle {
    width: 36px;
    height: 4px;
    background: rgba(255, 255, 255, 0.25);
    border-radius: 2px;
    margin: 8px auto 4px auto;
    display: none;
  }

  /* Popover Settings Menu styling */
  .settings-menu {
    position: absolute;
    bottom: 84px;
    right: 20px;
    width: var(--player-settings-menu-width, 270px);
    max-width: calc(100% - 32px);
    background: var(--player-glass-panel);
    backdrop-filter: blur(var(--player-glass-blur, 24px));
    -webkit-backdrop-filter: blur(var(--player-glass-blur, 24px));
    border: 1px solid var(--player-glass-border);
    border-radius: var(--player-border-radius, 16px);
    padding: 10px 0;
    box-shadow: var(--player-glass-shadow);
    display: flex;
    flex-direction: column;
    z-index: 100;
    font-size: 13.5px;
    color: var(--player-button-color, #e2e8f0);
    opacity: 0;
    transform: translateY(8px) scale(0.95);
    pointer-events: none;
    transition:
      opacity var(--player-transition-duration, 0.2s) var(--player-ease-smooth),
      transform var(--player-transition-duration, 0.2s) var(--player-ease-smooth);
  }

  .settings-menu.visible {
    opacity: 1;
    transform: translateY(0) scale(1);
    pointer-events: auto;
  }

  .settings-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 16px 12px 16px;
    border-bottom: 1px solid var(--player-glass-border, rgba(255, 255, 255, 0.06));
    font-weight: 600;
    color: var(--player-primary-color, #6366f1);
    cursor: pointer;
    outline: none;
  }

  .settings-header svg {
    width: 16px;
    height: 16px;
    flex-shrink: 0;
  }

  .settings-group-header {
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--player-text-muted-color, #9ca3af);
    padding: 8px 16px 4px 16px;
    margin: 4px 8px 0 8px;
  }

  .settings-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 16px;
    margin: 2px 8px;
    border-radius: var(--player-border-radius-item, 8px);
    cursor: pointer;
    outline: none;
    transition:
      background var(--player-transition-duration) var(--player-ease-smooth),
      color var(--player-transition-duration) var(--player-ease-smooth);
  }

  .settings-item > span:first-child {
    flex-shrink: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 150px;
  }

  .settings-item-value,
  .settings-item > span:last-child:not(:first-child) {
    color: var(--player-text-muted-color, #9ca3af);
    display: inline-flex;
    align-items: center;
    justify-content: flex-end;
    gap: 4px;
    min-width: 0;
    max-width: 165px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .settings-item-value span,
  .settings-item > span:last-child:not(:first-child) > span:not(svg) {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .settings-item:hover {
    background: var(--player-button-hover-bg, rgba(255, 255, 255, 0.08));
    color: var(--player-button-hover-color, #ffffff);
  }

  .settings-item:focus-visible,
  .settings-header:focus-visible {
    outline: 2px solid var(--player-primary-color, #6366f1);
    outline-offset: -2px;
    background: var(--player-button-hover-bg, rgba(255, 255, 255, 0.08));
    color: var(--player-button-hover-color, #ffffff);
  }

  .settings-item svg {
    width: 16px;
    height: 16px;
    flex-shrink: 0;
  }

  .settings-item svg.check-icon {
    color: var(--player-primary-color, #6366f1);
    flex-shrink: 0;
  }

  .settings-list-scroll {
    max-height: 240px;
    overflow-y: auto;
    scrollbar-width: thin;
    scrollbar-color: rgba(255, 255, 255, 0.15) transparent;
  }

  .settings-list-scroll::-webkit-scrollbar {
    width: 4px;
  }

  .settings-list-scroll::-webkit-scrollbar-track {
    background: transparent;
  }

  .settings-list-scroll::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.15);
    border-radius: 2px;
  }

  /* Central Play/Pause Viewport Ripple Feedback */
  .feedback-overlay.center-feedback {
    left: 0;
    right: 0;
    width: 100%;
    justify-content: center;
  }

  /* Shared Central Button Overlay Design System */
  .feedback-ripple-center,
  .replay-icon-circle {
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(8, 8, 12, 0.72);
    border: 1.5px solid rgba(255, 255, 255, 0.25);
    width: 56px;
    height: 56px;
    border-radius: 50%;
    box-shadow:
      0 12px 36px rgba(0, 0, 0, 0.6),
      inset 0 1px 0 rgba(255, 255, 255, 0.1);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
  }

  .feedback-ripple-center svg,
  .replay-icon-circle svg {
    width: 24px;
    height: 24px;
    fill: #ffffff;
  }

  /* Specific Animations & Transitions */
  .feedback-ripple-center {
    transform: scale(0.6);
    opacity: 0;
    will-change: transform, opacity;
    animation: centralPop 0.8s cubic-bezier(0.16, 1, 0.3, 1) forwards;
  }

  .feedback-ripple-center svg.play-icon {
    /* Optical center adjustment for play triangle */
    transform: translateX(0.5px);
  }

  @keyframes centralPop {
    0% {
      transform: scale(0.6);
      opacity: 0;
    }
    20% {
      transform: scale(1.1);
      opacity: 1;
    }
    80% {
      transform: scale(1);
      opacity: 1;
    }
    100% {
      transform: scale(0.85);
      opacity: 0;
    }
  }

  /* Ambient Tap Skip / Volume / Playback Speed gesture feedback ripples */
  .feedback-overlay {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 40%;
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
    z-index: 15;
  }

  .feedback-overlay.rewind {
    left: 0;
    border-top-left-radius: inherit;
    border-bottom-left-radius: inherit;
    background: linear-gradient(to right, rgba(0, 0, 0, 0.45) 0%, rgba(0, 0, 0, 0) 100%);
  }

  .feedback-overlay.fastforward {
    right: 0;
    border-top-right-radius: inherit;
    border-bottom-right-radius: inherit;
    background: linear-gradient(to left, rgba(0, 0, 0, 0.45) 0%, rgba(0, 0, 0, 0) 100%);
  }

  .feedback-seek-circle {
    display: flex;
    flex-direction: row;
    align-items: center;
    justify-content: center;
    gap: 6px;
    background: transparent;
    border: none;
    padding: 0;
    box-shadow: none;
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
    transform: scale(0.6);
    opacity: 0;
    will-change: transform, opacity;
    animation: seekPop 0.8s cubic-bezier(0.16, 1, 0.3, 1) forwards;
  }

  /* .seek-icon-wrap is a CSS-reachable span that wraps the registry-resolved SVG
     inside the seek feedback overlay. It ensures the SVG selector works even
     when the icon comes from a <slot>, renderIcon(), or an icon pack. */
  .feedback-seek-circle .seek-icon-wrap {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: 32px;
    height: 32px;
  }

  .feedback-seek-circle .seek-icon-wrap svg {
    display: block;
    width: 32px;
    height: 32px;
    fill: #ffffff;
    filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.5));
  }

  .feedback-seek-circle .feedback-text {
    font-size: 20px;
    font-weight: 500;
    color: #ffffff;
    letter-spacing: -0.01em;
    line-height: 1;
    text-shadow: 0 2px 6px rgba(0, 0, 0, 0.6);
  }

  @keyframes seekPop {
    0% {
      transform: scale(0.6);
      opacity: 0;
    }
    20% {
      transform: scale(1.1);
      opacity: 1;
    }
    80% {
      transform: scale(1);
      opacity: 1;
    }
    100% {
      transform: scale(0.85);
      opacity: 0;
    }
  }

  svg {
    width: 20px;
    height: 20px;
    fill: currentColor;
  }

  @media (max-width: 600px) {
    .empty-overlay,
    .error-overlay {
      padding: 16px;
      gap: 10px;
    }

    .empty-overlay svg,
    .error-overlay svg {
      width: 32px !important;
      height: 32px !important;
    }

    .overlay-title {
      font-size: 1.05rem;
    }

    .overlay-desc {
      font-size: 0.85rem;
      max-width: 300px;
    }

    .btn-retry {
      padding: 8px 16px;
      font-size: 12.5px;
      border-radius: 6px;
    }

    .controls-bar {
      bottom: 12px;
      left: 12px;
      right: 12px;
      max-width: calc(100% - 24px);
      padding: 8px 12px;
      gap: 8px;
      border-radius: 12px;
    }

    .controls-group {
      gap: 10px;
    }

    .controls-row {
      gap: 8px;
    }

    .volume-feedback-pill {
      padding: 8px 16px;
      gap: 6px;
      border-radius: 20px;
    }

    .volume-feedback-pill svg {
      width: 18px;
      height: 18px;
    }

    .volume-feedback-pill span {
      font-size: 12px;
    }

    .settings-menu {
      bottom: 74px;
      right: 12px;
      width: 240px;
      max-width: calc(100% - 24px);
      max-height: calc(100% - 90px);
      font-size: 12px;
    }

    .settings-list-scroll {
      max-height: 120px;
    }

    .settings-item {
      padding: 8px 12px;
      margin: 1px 4px;
    }

    .settings-header {
      padding: 6px 12px 8px 12px;
    }
  }

  @media (max-width: 480px) {
    :host {
      --player-button-width: 30px;
      --player-button-height: 30px;
      --player-button-icon-size: 18px;
    }

    .controls-bar {
      bottom: 8px;
      left: 8px;
      right: 8px;
      max-width: calc(100% - 16px);
      padding: 6px 10px;
      gap: 6px;
      border-radius: 10px;
    }

    .controls-group {
      gap: 6px;
    }

    .controls-row {
      gap: 6px;
    }

    .caption-btn,
    .settings-btn,
    .pip-btn,
    .fullscreen-btn {
      width: 30px;
      height: 30px;
      padding: 4px;
    }

    .caption-btn svg,
    .settings-btn svg,
    .pip-btn svg,
    .fullscreen-btn svg {
      width: 18px;
      height: 18px;
    }

    .settings-menu {
      bottom: 64px;
      right: 8px;
      width: 240px;
      max-width: calc(100% - 16px);
    }
  }

  /* Volume Overlay Feedback styling */
  .volume-feedback-overlay {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
    z-index: 15;
    transition: opacity 0.2s ease, transform 0.2s ease;
    opacity: 1;
    transform: translateY(0);
  }

  .volume-feedback-overlay.fade-out {
    opacity: 0;
    transform: translateY(-10px);
  }

  .volume-feedback-pill {
    display: flex;
    flex-direction: row;
    align-items: center;
    justify-content: center;
    gap: 8px;
    background: var(--player-glass-bg, rgba(15, 23, 42, 0.75));
    border: 1px solid var(--player-glass-border, rgba(255, 255, 255, 0.12));
    padding: 10px 20px;
    border-radius: 24px;
    box-shadow: var(--player-glass-shadow, 0 12px 32px rgba(0, 0, 0, 0.45));
    backdrop-filter: blur(var(--player-glass-blur, 16px));
    -webkit-backdrop-filter: blur(var(--player-glass-blur, 16px));
    transform: scale(0.85);
    opacity: 0;
    animation: volumePop 0.2s cubic-bezier(0.16, 1, 0.3, 1) forwards;
  }

  .volume-feedback-pill svg {
    width: 20px;
    height: 20px;
    fill: var(--player-text-color, #ffffff);
    flex-shrink: 0;
    display: block;
  }

  .volume-feedback-pill span {
    font-size: 14px;
    font-weight: 600;
    color: var(--player-text-color, #ffffff);
    line-height: 1;
    letter-spacing: -0.01em;
    display: flex;
    align-items: center;
  }

  /* Replay Overlay Glassmorphism styling */
  .replay-overlay {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(8, 8, 12, 0.4);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 9;
    cursor: pointer;
    animation: fadeIn var(--player-transition-duration) var(--player-ease-smooth) forwards;
  }

  .replay-icon-circle {
    transform: scale(0.9);
    transition:
      transform var(--player-transition-duration) var(--player-ease-smooth),
      background-color var(--player-transition-duration) var(--player-ease-smooth),
      border-color var(--player-transition-duration) var(--player-ease-smooth);
    outline: none;
  }

  .replay-overlay:hover .replay-icon-circle,
  .replay-icon-circle:focus-visible {
    background: rgba(255, 255, 255, 0.15);
    border-color: var(--player-primary-color, #6366f1);
    transform: scale(1.05);
    box-shadow: 0 0 20px var(--player-primary-glow);
  }

  .replay-icon-circle:focus-visible {
    outline: 2px solid var(--player-primary-color, #6366f1);
    outline-offset: 4px;
  }

  /* Speed Overlay Feedback styling */
  .speed-feedback-overlay {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
    z-index: 15;
  }

  .speed-feedback-overlay.lock-mode {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 72px;
    top: auto;
    display: flex;
    justify-content: center;
    align-items: center;
    z-index: 15;
    pointer-events: none;
  }

  .speed-feedback-overlay.lock-mode .speed-feedback-pill {
    animation: none;
    opacity: 1;
    transform: scale(1);
    transition: opacity 0.25s ease, transform 0.25s ease;
  }

  .speed-feedback-overlay.lock-mode.fade-out .speed-feedback-pill {
    opacity: 0;
    transform: scale(0.9);
  }

  .speed-feedback-pill {
    display: flex;
    flex-direction: row;
    align-items: center;
    justify-content: center;
    gap: 6px;
    background: rgba(15, 23, 42, 0.65);
    border: 1px solid rgba(255, 255, 255, 0.08);
    padding: 10px 18px;
    border-radius: 22px;
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    transform: scale(0.8);
    opacity: 0;
    animation: volumePop 0.8s cubic-bezier(0.16, 1, 0.3, 1) forwards;
  }

  .speed-feedback-pill svg {
    width: 20px;
    height: 20px;
    fill: #ffffff;
  }

  .speed-feedback-pill span {
    font-size: 14px;
    font-weight: 600;
    color: #ffffff;
    line-height: 1;
    letter-spacing: -0.01em;
  }

  /* Quality Overlay Feedback styling */
  .quality-feedback-overlay {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
    z-index: 15;
  }

  .quality-feedback-pill {
    display: flex;
    flex-direction: row;
    align-items: center;
    justify-content: center;
    gap: 10px;
    background: rgba(15, 23, 42, 0.65);
    border: 1px solid rgba(255, 255, 255, 0.08);
    padding: 12px 24px;
    border-radius: 28px;
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    transform: scale(0.8);
    opacity: 0;
    animation: volumePop 0.8s cubic-bezier(0.16, 1, 0.3, 1) forwards;
  }

  .quality-feedback-pill svg {
    width: 24px;
    height: 24px;
    fill: none;
    stroke: #ffffff;
    stroke-width: 1.9;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .quality-feedback-pill span {
    font-size: 16px;
    font-weight: 600;
    color: #ffffff;
    line-height: 1;
    letter-spacing: -0.01em;
  }

  .hd-badge {
    font-size: 9px;
    font-weight: 800;
    background: var(--player-primary-color, #6366f1);
    color: #ffffff;
    padding: 1px 3.5px;
    border-radius: 3px;
    line-height: 1;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-left: 5px;
    display: inline-block;
    vertical-align: middle;
  }

  @keyframes volumePop {
    0% {
      transform: scale(0.7);
      opacity: 0;
    }
    100% {
      transform: scale(1);
      opacity: 1;
    }
  }

  /* Precise Seek Filmstrip Styling */
  .precise-seek-container {
    width: 100%;
    overflow: hidden;
    position: relative;
    display: flex;
    justify-content: center;
    align-items: center;
    border-radius: 8px;
  }

  .precise-seek-filmstrip {
    display: flex;
    justify-content: center;
    align-items: center;
    gap: 6px;
    padding: 8px 0;
    width: auto;
    flex-shrink: 0;
    box-sizing: border-box;
    will-change: transform;
  }

  .filmstrip-thumbnail-cell {
    position: relative;
    width: var(--cell-width, 112px);
    aspect-ratio: 16 / 9;
    height: auto;
    border-radius: 6px;
    overflow: hidden;
    border: 2px solid transparent;
    transition:
      border-color 0.15s ease,
      transform 0.15s ease,
      box-shadow 0.15s ease;
    background: #08080c;
    box-sizing: border-box;
    cursor: pointer;
  }

  .filmstrip-thumbnail-cell:hover {
    transform: scale(1.04);
  }

  .filmstrip-thumbnail-cell.active {
    border-color: var(--player-precise-seek-active-border, var(--player-primary-color, #ffffff));
    transform: scale(1.06);
    box-shadow: var(--player-precise-seek-active-shadow, 0 4px 12px rgba(255, 255, 255, 0.3));
  }

  .filmstrip-thumbnail-preview {
    width: 100%;
    height: 100%;
    background-repeat: no-repeat;
    background-color: var(--player-bg-color, #000000);
  }

  .filmstrip-time-badge {
    position: absolute;
    bottom: 2px;
    right: 4px;
    background: var(--player-toast-bg, rgba(0, 0, 0, 0.75));
    color: var(--player-toast-color, #ffffff);
    font-size: 8px;
    font-family: inherit;
    padding: 1px 3px;
    border-radius: var(--player-border-radius-badge, 2px);
    font-weight: 600;
  }

  /* Shimmer placeholder for loading filmstrip cells */
  .filmstrip-thumbnail-cell.loading {
    background: var(--player-glass-panel, #0b0f19);
  }

  .filmstrip-thumbnail-cell.loading .filmstrip-thumbnail-preview {
    opacity: 0.6;
  }

  .filmstrip-thumbnail-cell.loading .thumbnail-placeholder-shimmer {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: linear-gradient(
      90deg,
      rgba(15, 23, 42, 0) 0%,
      rgba(255, 255, 255, 0.08) 50%,
      rgba(15, 23, 42, 0) 100%
    );
    background-size: 200% 100%;
    animation: shimmer-swipe 1.5s infinite;
  }

  /* Sleep Timer Expiration Dialog Overlay (YouTube-style) */
  .sleep-timer-dialog-overlay {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: var(--player-overlay-bg, rgba(0, 0, 0, 0.6));
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 200;
    animation: fadeIn var(--player-transition-duration, 0.2s) ease-out;
  }

  .sleep-timer-dialog-card {
    background: var(--player-sleep-dialog-bg, #212121);
    border: 1px solid var(--player-sleep-dialog-border, rgba(255, 255, 255, 0.08));
    border-radius: var(--player-border-radius, 16px);
    padding: 24px 28px;
    width: 420px;
    max-width: 90%;
    box-shadow: var(--player-sleep-dialog-shadow, 0 16px 40px rgba(0, 0, 0, 0.8));
    display: flex;
    flex-direction: column;
    gap: 4px;
    text-align: left;
    box-sizing: border-box;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    animation: scaleIn var(--player-transition-duration, 0.2s) var(--player-ease-smooth);
  }

  .sleep-timer-dialog-title {
    font-size: 20px;
    font-weight: 700;
    color: var(--player-text-color, #ffffff);
    letter-spacing: -0.015em;
    margin: 0 0 8px 0;
    line-height: 1.3;
  }

  .sleep-timer-dialog-message {
    font-size: 14px;
    color: var(--player-text-secondary-color, #aaaaaa);
    line-height: 1.45;
    margin: 0 0 20px 0;
  }

  .sleep-timer-dialog-buttons {
    display: flex;
    gap: 10px;
    justify-content: flex-end;
    align-items: center;
  }

  .sleep-timer-btn {
    border: none;
    height: 36px;
    padding: 0 16px;
    border-radius: 18px;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    font-family: inherit;
    transition:
      background-color var(--player-transition-duration, 0.15s) ease,
      transform 0.1s ease;
    outline: none;
    line-height: 36px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
  }

  .sleep-timer-btn:active {
    transform: scale(0.96);
  }

  .sleep-timer-btn-add {
    background: var(--player-sleep-timer-btn-secondary-bg, #3f3f3f);
    color: var(--player-sleep-timer-btn-secondary-color, #ffffff);
  }

  .sleep-timer-btn-add:hover {
    background: var(--player-sleep-timer-btn-secondary-hover-bg, #4f4f4f);
  }

  .sleep-timer-btn-close {
    background: var(--player-sleep-timer-btn-primary-bg, #ffffff);
    color: var(--player-sleep-timer-btn-primary-color, #0f0f0f);
    font-weight: 600;
  }

  .sleep-timer-btn-close:hover {
    background: var(--player-sleep-timer-btn-primary-hover-bg, #f2f2f2);
  }

  /* Centered Play Overlay for Paused Vertical Mode */
  .vertical-play-overlay {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 12;
    cursor: pointer;
    background: rgba(0, 0, 0, 0.15);
    transition: background-color 0.25s ease;
  }

  .vertical-play-overlay:hover {
    background: rgba(0, 0, 0, 0.25);
  }

  .vertical-play-overlay .play-icon-circle {
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(15, 23, 42, 0.65);
    border: 1px solid rgba(255, 255, 255, 0.12);
    width: 52px;
    height: 52px;
    border-radius: 50%;
    box-shadow: 0 12px 30px rgba(0, 0, 0, 0.4);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    transition:
      transform 0.2s cubic-bezier(0.16, 1, 0.3, 1),
      background-color 0.2s ease;
  }

  .vertical-play-overlay:hover .play-icon-circle {
    transform: scale(1.08);
    background: rgba(15, 23, 42, 0.75);
    border-color: rgba(255, 255, 255, 0.2);
  }

  .vertical-play-overlay .play-icon-circle svg {
    width: 22px;
    height: 22px;
    fill: #ffffff;
    /* Slight offset to optically center the triangular play icon */
    margin-left: 2px;
  }

  /* Live Badge Overlay */
  .live-badge-container {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.05em;
    user-select: none;
    transition:
      background-color 0.2s,
      opacity 0.2s,
      transform 0.2s;
  }

  .live-badge-container.live {
    background: rgba(239, 68, 68, 0.15);
    border: 1px solid rgba(239, 68, 68, 0.3);
    color: #ef4444;
  }

  .live-badge-container.behind {
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.12);
    color: #94a3b8;
  }

  .live-badge-container:hover {
    transform: scale(1.04);
  }

  .live-badge-container.behind:hover {
    background: rgba(255, 255, 255, 0.15);
    color: #ffffff;
  }

  .live-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    display: inline-block;
  }

  .live-badge-container.live .live-dot {
    background-color: #ef4444;
    animation: livePulse 1.5s infinite;
  }

  .live-badge-container.behind .live-dot {
    background-color: #ffffff;
  }

  @keyframes livePulse {
    0% {
      box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.7);
    }
    70% {
      box-shadow: 0 0 0 6px rgba(239, 68, 68, 0);
    }
    100% {
      box-shadow: 0 0 0 0 rgba(239, 68, 68, 0);
    }
  }

  /* Persistent Live Badge for Vertical Mode */
  .vertical-persistent-live-badge {
    position: absolute;
    top: 16px;
    right: 16px;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    border-radius: 6px;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.05em;
    user-select: none;
    pointer-events: auto;
    cursor: pointer;
    z-index: 30;
    transition:
      background-color 0.2s,
      color 0.2s,
      transform 0.2s;
  }

  .vertical-persistent-live-badge:hover {
    transform: scale(1.04);
  }

  .vertical-persistent-live-badge.live {
    background: rgba(239, 68, 68, 0.15);
    border: 1px solid rgba(239, 68, 68, 0.3);
    color: #ef4444;
  }

  .vertical-persistent-live-badge.behind {
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.12);
    color: #94a3b8;
  }

  .vertical-persistent-live-badge .live-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    display: inline-block;
  }

  .vertical-persistent-live-badge.live .live-dot {
    background-color: #ef4444;
    animation: livePulse 1.5s infinite;
  }

  .vertical-persistent-live-badge.behind .live-dot {
    background-color: #94a3b8;
  }

  /* Audio-only layout styles */
  .player-container.layout-audio-only {
    aspect-ratio: auto;
    height: 140px;
    background: var(--player-bg-color, #0f172a);
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
  }
  .player-container.layout-audio-only .video-wrapper {
    display: none !important;
  }
  .audio-only-cover {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 16px;
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 60px;
    color: var(--player-text-color, #ffffff);
  }
  .audio-only-album-art {
    width: 44px;
    height: 44px;
    border-radius: 8px;
    background: var(--player-primary-color, #6366f1);
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
  }
  .audio-only-album-art svg {
    width: 24px;
    height: 24px;
    fill: #ffffff;
  }
  .audio-only-title {
    font-size: 14px;
    font-weight: 600;
  }

  /* Mini player layout styles */
  .player-container.layout-mini {
    width: 100% !important;
    height: 100% !important;
    border-radius: 12px;
    box-shadow: 0 20px 50px rgba(0, 0, 0, 0.5);
  }

  /* Floating player layout styles */
  .player-container.layout-floating {
    width: 100% !important;
    height: 100% !important;
    box-shadow: 0 30px 60px rgba(0, 0, 0, 0.6);
  }

  slot {
    display: contents;
  }

  /* Center Play Button Overlay styles */
  .vertical-center-play-overlay {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10;
    cursor: pointer;
    background: rgba(0, 0, 0, 0.15);
    backdrop-filter: blur(2px);
    animation: fadeIn var(--player-transition-duration, 0.25s) ease-out;
  }

  .vertical-center-play-btn {
    width: 72px;
    height: 72px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.15);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    border: 1px solid rgba(255, 255, 255, 0.3);
    display: flex;
    align-items: center;
    justify-content: center;
    color: #ffffff;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
    transition:
      transform 0.2s ease,
      background 0.2s ease;
  }

  .vertical-center-play-btn:hover {
    transform: scale(1.1);
    background: rgba(255, 255, 255, 0.25);
  }

  .vertical-center-play-btn svg {
    width: 36px;
    height: 36px;
    fill: currentColor;
    transform: translateX(2px);
  }

  /* Custom Context Menu styles */
  .custom-context-menu {
    position: absolute;
    background: rgba(17, 24, 39, 0.85);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    border: 1px solid rgba(255, 255, 255, 0.1);
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
    border-radius: 12px;
    padding: 6px;
    z-index: 1000;
    min-width: 160px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    animation: fadeIn var(--player-transition-duration, 0.15s) ease-out;
  }

  .context-menu-item {
    font-size: 13px;
    font-weight: 500;
    color: #f3f4f6;
    padding: 8px 14px;
    border-radius: 8px;
    cursor: pointer;
    transition:
      background 0.15s ease,
      color 0.15s ease;
    user-select: none;
  }

  .context-menu-item:hover:not(.disabled) {
    background: rgba(255, 255, 255, 0.1);
    color: #ffffff;
  }

  .context-menu-item.disabled {
    color: #6b7280;
    font-size: 11px;
    cursor: default;
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
    padding-bottom: 6px;
    margin-bottom: 2px;
  }

  /* --- Empty State Styles --- */
  .player-empty-state {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: var(--player-bg-color, #000000);
    display: flex;
    align-items: center;
    justify-content: center;
    text-align: center;
    z-index: 100;
    padding: 24px;
    box-sizing: border-box;
  }

  .player-empty-state-content {
    display: flex;
    flex-direction: column;
    align-items: center;
    max-width: 320px;
    gap: 12px;
  }

  .player-empty-state-icon {
    font-size: 40px;
    color: var(--player-accent-color, #6366f1);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .player-empty-state-title {
    font-size: 20px;
    font-weight: 700;
    color: #ffffff;
    margin: 0;
  }

  .player-empty-state-subtitle {
    font-size: 14px;
    color: #9ca3af;
    margin: 0;
  }

  .player-empty-state-btn {
    margin-top: 8px;
    background: var(--player-accent-color, #6366f1);
    color: #ffffff;
    border: none;
    border-radius: 8px;
    padding: 10px 20px;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s ease, transform 0.1s ease;
  }

  .player-empty-state-btn:hover {
    background: var(--player-accent-hover-color, #4f46e5);
  }

  .player-empty-state-btn:active {
    transform: scale(0.98);
  }
`;
