import { css } from 'lit';

export const styles = css`
  :host {
    display: block;
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    pointer-events: none;
    z-index: 10;
  }

  .vertical-controls-container {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    pointer-events: none;
  }

  /* Right-side Action Rail styling */
  .vertical-action-rail {
    position: absolute;
    right: -64px;
    bottom: 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    align-items: center;
    pointer-events: auto;
    z-index: 20;
  }

  .vertical-action-rail.rail-position-left {
    left: -64px;
    right: auto;
  }

  @media (max-width: 600px) {
    .vertical-action-rail {
      right: 16px;
      bottom: 40px;
    }

    .vertical-action-rail.rail-position-left {
      left: 16px;
      right: auto;
    }

    .prev-btn,
    .next-btn {
      display: none !important;
    }
  }

  /* Rail button premium styling */
  .rail-btn {
    background: var(--player-glass-bg, rgba(8, 8, 12, 0.45));
    border: 1px solid var(--player-glass-border, rgba(255, 255, 255, 0.06));
    backdrop-filter: blur(var(--player-glass-blur, 16px));
    -webkit-backdrop-filter: blur(var(--player-glass-blur, 16px));
    color: var(--player-button-color, #cbd5e1);
    cursor: pointer;
    padding: 0;
    border-radius: var(--player-border-radius-button, 50%);
    width: var(--player-rail-button-width, var(--player-button-width, 44px));
    height: var(--player-rail-button-height, var(--player-button-height, 44px));
    display: flex;
    align-items: center;
    justify-content: center;
    outline: none;
    transition:
      color var(--player-transition-duration, 0.2s) var(--player-ease-smooth),
      background-color var(--player-transition-duration, 0.2s) var(--player-ease-smooth),
      transform var(--player-transition-duration, 0.2s) var(--player-ease-smooth),
      box-shadow var(--player-transition-duration, 0.2s) var(--player-ease-smooth);
    box-shadow: var(--player-rail-btn-shadow, 0 4px 12px rgba(0, 0, 0, 0.25));
  }

  .rail-btn:hover {
    color: var(--player-button-hover-color, #ffffff);
    transform: scale(var(--player-button-hover-scale, 1.1));
    box-shadow: var(--player-rail-btn-hover-shadow, 0 6px 16px rgba(0, 0, 0, 0.35));
  }

  .rail-btn:active {
    transform: scale(var(--player-button-active-scale, 0.95));
  }

  .rail-btn.active {
    color: var(--player-primary-color, #6366f1);
    border-color: var(--player-rail-btn-active-border, rgba(99, 102, 241, 0.2));
    box-shadow: var(--player-rail-btn-active-shadow, 0 0 12px rgba(99, 102, 241, 0.25));
  }

  .rail-btn:focus-visible {
    outline: 2px solid var(--player-primary-color, #6366f1);
    outline-offset: 2px;
  }

  .rail-btn svg {
    width: var(--player-button-icon-size, 22px);
    height: var(--player-button-icon-size, 22px);
    fill: currentColor;
  }

  /* Bottom Seekbar Wrapper */
  .vertical-seekbar-wrapper {
    position: absolute;
    bottom: 16px;
    left: 16px;
    right: 16px;
    pointer-events: auto;
    z-index: 20;
    opacity: 0;
    visibility: hidden;
    transition: opacity var(--player-transition-duration, 0.25s) var(--player-ease-smooth),
      visibility 0s linear var(--player-transition-duration, 0.25s);
  }

  .vertical-controls-container.visible .vertical-seekbar-wrapper {
    opacity: 1;
    visibility: visible;
    transition: opacity var(--player-transition-duration, 0.25s) var(--player-ease-smooth),
      visibility 0s linear 0s;
  }

  /* Live Badge Overlay */
  .live-badge-container {
    position: absolute;
    top: 16px;
    right: 16px;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    border-radius: var(--player-border-radius-badge, 6px);
    cursor: pointer;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.05em;
    user-select: none;
    pointer-events: auto;
    z-index: 20;
    opacity: 0;
    visibility: hidden;
    transition:
      background-color var(--player-transition-duration, 0.2s),
      opacity var(--player-transition-duration, 0.25s) var(--player-ease-smooth),
      transform var(--player-transition-duration, 0.2s),
      visibility 0s linear var(--player-transition-duration, 0.25s);
  }

  .vertical-controls-container.visible .live-badge-container {
    opacity: 1;
    visibility: visible;
    transition:
      background-color var(--player-transition-duration, 0.2s),
      opacity var(--player-transition-duration, 0.25s) var(--player-ease-smooth),
      transform var(--player-transition-duration, 0.2s),
      visibility 0s linear 0s;
  }

  .live-badge-container.live {
    background: var(--player-live-badge-live-bg, rgba(239, 68, 68, 0.15));
    border: 1px solid var(--player-live-badge-live-border, rgba(239, 68, 68, 0.3));
    color: var(--player-live-badge-live-color, #ef4444);
  }

  .live-badge-container.behind {
    background: var(--player-live-badge-behind-bg, rgba(255, 255, 255, 0.08));
    border: 1px solid var(--player-live-badge-behind-border, rgba(255, 255, 255, 0.12));
    color: var(--player-live-badge-behind-color, #94a3b8);
  }

  .live-badge-container:hover {
    transform: scale(1.04);
  }

  .live-badge-container.behind:hover {
    background: var(--player-live-badge-behind-hover-bg, rgba(255, 255, 255, 0.15));
    color: var(--player-live-badge-behind-hover-color, #ffffff);
  }

  .live-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    display: inline-block;
  }

  .live-badge-container.live .live-dot {
    background-color: var(--player-live-badge-live-color, #ef4444);
    animation: livePulse 1.5s infinite;
  }

  .live-badge-container.behind .live-dot {
    background-color: var(--player-live-badge-behind-hover-color, #ffffff);
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

  slot {
    display: contents;
  }

  .vertical-volume-control {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
  }

  .vertical-volume-popover {
    position: relative;
    width: 32px;
    height: 0;
    margin-bottom: 0;
    opacity: 0;
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--player-glass-bg, rgba(8, 8, 12, 0.75));
    border: 1px solid transparent;
    backdrop-filter: blur(var(--player-glass-blur, 16px));
    -webkit-backdrop-filter: blur(var(--player-glass-blur, 16px));
    border-radius: var(--player-border-radius-menu, 12px);
    box-shadow: var(--player-glass-shadow, 0 4px 12px rgba(0, 0, 0, 0.25));
    transition: height var(--player-transition-duration, 0.25s) var(--player-ease-smooth),
                opacity var(--player-transition-duration, 0.25s) var(--player-ease-smooth),
                margin-bottom var(--player-transition-duration, 0.25s) var(--player-ease-smooth),
                border-color var(--player-transition-duration, 0.25s) var(--player-ease-smooth);
    z-index: 30;
    pointer-events: none;
  }

  .vertical-volume-popover::after {
    content: '';
    position: absolute;
    bottom: -10px;
    left: 0;
    right: 0;
    height: 10px;
    background: transparent;
  }

  @media (hover: hover) {
    .vertical-volume-control:hover .vertical-volume-popover {
      height: 100px;
      opacity: 1;
      margin-bottom: 8px;
      border-color: var(--player-glass-border, rgba(255, 255, 255, 0.08));
      pointer-events: auto;
    }
  }

  .vertical-volume-control.slider-active .vertical-volume-popover {
    height: 100px;
    opacity: 1;
    margin-bottom: 8px;
    border-color: var(--player-glass-border, rgba(255, 255, 255, 0.08));
    pointer-events: auto;
  }

  .vertical-volume-popover input[type='range'] {
    -webkit-appearance: none;
    appearance: none;
    width: 76px;
    height: 3px;
    background: var(--player-volume-unplayed-bg, rgba(255, 255, 255, 0.2));
    border-radius: 1.5px;
    outline: none;
    cursor: pointer;
    transform: rotate(-90deg);
    transform-origin: center center;
  }

  .vertical-volume-popover input[type='range']::-webkit-slider-thumb {
    -webkit-appearance: none;
    height: 10px;
    width: 10px;
    border-radius: 50%;
    background: var(--player-seekbar-handle-bg, #ffffff);
    cursor: pointer;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.4);
  }

  .vertical-volume-popover input[type='range']::-moz-range-thumb {
    border: none;
    height: 10px;
    width: 10px;
    border-radius: 50%;
    background: var(--player-seekbar-handle-bg, #ffffff);
    cursor: pointer;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.4);
  }
`;
