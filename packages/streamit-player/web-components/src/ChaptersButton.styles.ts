import { css } from 'lit';

export const styles = css`
  :host {
    display: inline-block;
    position: relative;
    outline: none;
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

  button:active {
    transform: scale(var(--player-button-active-scale, 0.95));
  }

  button:focus-visible {
    box-shadow: 0 0 0 2px var(--player-primary-color, #6366f1);
  }

  svg {
    width: var(--player-button-icon-size, 20px);
    height: var(--player-button-icon-size, 20px);
    fill: currentColor;
  }

  /* Dropdown popup with premium glassmorphism styling */
  .chapters-popup {
    position: absolute;
    bottom: 48px;
    right: 0;
    width: 260px;
    max-height: 240px;
    background: var(--player-menu-bg, rgba(10, 10, 15, 0.95));
    backdrop-filter: blur(var(--player-glass-blur, 16px));
    -webkit-backdrop-filter: blur(var(--player-glass-blur, 16px));
    border: 1px solid var(--player-glass-border, rgba(255, 255, 255, 0.08));
    border-radius: var(--player-border-radius, 10px);
    box-shadow:
      var(--player-glass-shadow, 0 10px 30px rgba(0, 0, 0, 0.5)),
      0 0 0 1px rgba(255, 255, 255, 0.05);
    overflow-y: auto;
    z-index: 100;
    opacity: 0;
    transform: translateY(10px) scale(0.95);
    pointer-events: none;
    transition:
      opacity var(--player-transition-duration, 0.2s) var(--player-ease-smooth),
      transform var(--player-transition-duration, 0.2s) var(--player-ease-smooth);
  }

  .chapters-popup.visible {
    opacity: 1;
    transform: translateY(0) scale(1);
    pointer-events: auto;
  }

  .popup-header {
    padding: 12px 16px;
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--player-text-secondary-color, #94a3b8);
    border-bottom: 1px solid var(--player-glass-border, rgba(255, 255, 255, 0.06));
  }

  .chapters-list {
    display: flex;
    flex-direction: column;
    padding: 6px 0;
  }

  .chapter-item {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    padding: 8px 16px;
    cursor: pointer;
    transition:
      background-color var(--player-transition-duration, 0.15s) ease,
      color var(--player-transition-duration, 0.15s) ease;
    color: var(--player-button-color, #e2e8f0);
    outline: none;
  }

  .chapter-item:hover,
  .chapter-item:focus-visible {
    background-color: var(--player-button-hover-bg, rgba(255, 255, 255, 0.06));
    color: var(--player-button-hover-color, #ffffff);
  }

  .chapter-item.active {
    background-color: var(--player-primary-glow, rgba(99, 102, 241, 0.15));
    color: var(--player-primary-color, #6366f1);
    font-weight: 600;
  }

  .chapter-title {
    font-size: 13px;
    line-height: 1.4;
    text-align: left;
  }

  .chapter-time {
    font-size: 10px;
    color: var(--player-text-secondary-color, #94a3b8);
  }

  .chapter-item.active .chapter-time {
    color: var(--player-accent-color, rgba(99, 102, 241, 0.7));
  }

  /* Scrollbar styling for a premium feel */
  .chapters-popup::-webkit-scrollbar {
    width: 4px;
  }
  .chapters-popup::-webkit-scrollbar-track {
    background: transparent;
  }
  .chapters-popup::-webkit-scrollbar-thumb {
    background: var(--player-button-hover-bg, rgba(255, 255, 255, 0.15));
    border-radius: var(--player-border-radius-badge, 2px);
  }
  .chapters-popup::-webkit-scrollbar-thumb:hover {
    background: var(--player-button-hover-color, rgba(255, 255, 255, 0.3));
  }

  @media (max-width: 600px) {
    :host {
      position: static !important;
    }
    .chapters-popup {
      bottom: 60px !important;
      right: 0 !important;
      left: auto !important;
      width: 260px !important;
      max-width: 100% !important;
      max-height: 120px !important;
    }
  }

  @media (max-width: 480px) {
    .chapters-popup {
      bottom: 50px !important;
    }
  }
`;
