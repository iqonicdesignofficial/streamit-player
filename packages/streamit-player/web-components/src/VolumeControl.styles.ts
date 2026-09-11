import { css } from 'lit';

export const styles = css`
  :host {
    display: inline-flex;
    align-items: center;
    position: relative;
  }

  .volume-control-wrapper {
    display: inline-flex;
    align-items: center;
    position: relative;
  }

  button {
    display: flex;
    align-items: center;
    justify-content: center;
    width: var(--player-button-width, 36px);
    height: var(--player-button-height, 36px);
    background: transparent;
    border: none;
    color: var(--player-button-color, #cbd5e1);
    cursor: pointer;
    padding: 0;
    border-radius: var(--player-border-radius-button, 50%);
    transition:
      color var(--player-transition-duration, 0.2s) var(--player-ease-smooth),
      background-color var(--player-transition-duration, 0.2s) var(--player-ease-smooth),
      transform var(--player-transition-duration, 0.2s) var(--player-ease-smooth);
    outline: none;
  }

  button:hover {
    color: var(--player-button-hover-color, #ffffff);
    background-color: var(--player-button-hover-bg, rgba(255, 255, 255, 0.08));
    transform: scale(var(--player-button-hover-scale, 1.12));
  }

  button:focus-visible {
    box-shadow: 0 0 0 2px var(--player-primary-color, #6366f1);
  }

  svg {
    width: var(--player-button-icon-size, 20px);
    height: var(--player-button-icon-size, 20px);
    fill: currentColor;
  }

  .slider-container {
    width: 0;
    margin-left: 0;
    overflow: hidden;
    display: flex;
    align-items: center;
    transition:
      width var(--player-transition-duration, 0.25s) var(--player-ease-smooth),
      margin-left var(--player-transition-duration, 0.25s) var(--player-ease-smooth);
  }

  /* Expand slider on hover or keyboard focus of the component */
  :host(:hover) .slider-container,
  :host(:focus-within) .slider-container {
    width: var(--player-volume-slider-width, 70px);
    margin-left: 8px;
  }

  input[type='range'] {
    -webkit-appearance: none;
    -moz-appearance: none;
    appearance: none;
    width: var(--player-volume-slider-width, 70px);
    height: 3px;
    background: var(--player-volume-unplayed-bg, rgba(255, 255, 255, 0.2));
    border-radius: var(--player-border-radius-badge, 1.5px);
    outline: none;
    cursor: pointer;
    transition: height var(--player-transition-duration, 0.15s) var(--player-ease-smooth);
  }

  input[type='range']::-moz-focus-outer {
    border: 0;
  }

  input[type='range']::-webkit-slider-runnable-track {
    width: 100%;
    height: 100%;
    cursor: pointer;
    background: transparent;
    border: none;
  }

  input[type='range']::-moz-range-track {
    width: 100%;
    height: 100%;
    cursor: pointer;
    background: transparent;
    border: none;
  }

  input[type='range']::-webkit-slider-thumb {
    height: 10px;
    width: 10px;
    border-radius: 50%;
    background: var(--player-seekbar-handle-bg, #ffffff);
    cursor: pointer;
    -webkit-appearance: none;
    margin-top: -3.5px;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.4);
    transition:
      transform var(--player-transition-duration, 0.15s) var(--player-ease-smooth),
      background-color var(--player-transition-duration, 0.15s) ease;
  }

  input[type='range']:hover::-webkit-slider-thumb {
    transform: scale(1.2);
    background: var(--player-seekbar-handle-bg, #ffffff);
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.5);
  }

  input[type='range']:active::-webkit-slider-thumb {
    transform: scale(1.4);
    background: var(--player-seekbar-handle-bg, #ffffff);
  }

  input[type='range']::-moz-range-thumb {
    height: 10px;
    width: 10px;
    border: none;
    border-radius: 50%;
    background: var(--player-seekbar-handle-bg, #ffffff);
    cursor: pointer;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.4);
    transition:
      transform var(--player-transition-duration, 0.15s) var(--player-ease-smooth),
      background-color var(--player-transition-duration, 0.15s) ease;
  }

  input[type='range']:hover::-moz-range-thumb {
    transform: scale(1.2);
    background: var(--player-seekbar-handle-bg, #ffffff);
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.5);
  }

  input[type='range']:active::-moz-range-thumb {
    transform: scale(1.4);
    background: var(--player-seekbar-handle-bg, #ffffff);
  }

  /* Mute/Volume Tooltip above the speaker icon */
  .button-tooltip {
    position: absolute;
    bottom: 44px;
    left: 18px;
    transform: translateX(-50%) scale(0.85);
    background: var(--player-toast-bg, var(--player-menu-bg, rgba(15, 23, 42, 0.85)));
    backdrop-filter: blur(var(--player-glass-blur, 8px));
    -webkit-backdrop-filter: blur(var(--player-glass-blur, 8px));
    border: 1px solid var(--player-glass-border, rgba(255, 255, 255, 0.08));
    color: var(--player-toast-color, #ffffff);
    padding: 4px 8px;
    font-size: 11px;
    font-weight: 600;
    border-radius: var(--player-border-radius-tooltip, 6px);
    box-shadow: var(--player-glass-shadow, 0 4px 12px rgba(0, 0, 0, 0.4));
    pointer-events: none;
    opacity: 0;
    transition:
      opacity var(--player-transition-duration, 0.15s) var(--player-ease-smooth),
      transform var(--player-transition-duration, 0.15s) var(--player-ease-smooth);
    z-index: 50;
    white-space: nowrap;
  }

  button:hover ~ .button-tooltip,
  button:focus-visible ~ .button-tooltip {
    opacity: 1;
    transform: translateX(-50%) scale(1);
  }

  /* Hide button tooltip when slider container is hovered */
  .slider-container:hover ~ .button-tooltip {
    opacity: 0;
    transform: translateX(-50%) scale(0.85);
  }
`;
