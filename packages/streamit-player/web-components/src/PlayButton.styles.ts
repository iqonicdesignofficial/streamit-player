import { css } from 'lit';

export const styles = css`
  :host {
    display: inline-block;
    width: var(--player-button-width, 40px);
    height: var(--player-button-height, 40px);
    outline: none;
  }

  button {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
    background: transparent;
    border: none;
    color: var(--player-button-color, #cbd5e1);
    cursor: pointer;
    padding: 0;
    border-radius: var(--player-border-radius-button, 50%);
    transition:
      color var(--player-transition-duration, 0.25s) var(--player-ease-smooth),
      background-color var(--player-transition-duration, 0.25s) var(--player-ease-smooth),
      transform var(--player-transition-duration, 0.25s) var(--player-ease-smooth);
    outline: none;
  }

  button:hover {
    color: var(--player-button-hover-color, #ffffff);
    background-color: var(--player-button-hover-bg, rgba(255, 255, 255, 0.08));
    transform: scale(var(--player-button-hover-scale, 1.12));
  }

  button:active {
    transform: scale(var(--player-button-active-scale, 0.95));
  }

  button:focus-visible {
    box-shadow: 0 0 0 2px var(--player-primary-color, #6366f1);
  }

  svg {
    width: var(--player-button-icon-size, 22px);
    height: var(--player-button-icon-size, 22px);
    fill: currentColor;
  }
`;
