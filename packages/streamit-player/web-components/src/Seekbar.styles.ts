import { css } from 'lit';

export const styles = css`
  :host {
    display: block;
    width: 100%;
    height: 16px;
    cursor: pointer;
    user-select: none;
    -webkit-user-select: none;
    -webkit-tap-highlight-color: transparent;
    position: relative;
    outline: none;
    touch-action: none;
  }

  :host([aria-disabled='true']) {
    cursor: not-allowed;
    opacity: 0.5;
    pointer-events: none;
  }

  .seekbar-container {
    position: relative;
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    gap: 16px;
    touch-action: none;
  }

  .track {
    position: relative;
    flex: 1;
    min-width: 0;
    height: 3px;
    background: var(--player-seekbar-bg, rgba(255, 255, 255, 0.15));
    border-radius: 1.5px;
    transition: height 0.15s cubic-bezier(0.16, 1, 0.3, 1);
  }

  :host(:hover) .track,
  :host(:focus-visible) .track {
    height: 6px;
  }

  .buffer-bar,
  .progress-bar {
    position: absolute;
    top: 0;
    left: 0;
    height: 100%;
    border-radius: 1.5px;
    will-change: width;
  }

  .buffer-bar {
    background: var(--player-seekbar-buffer, rgba(255, 255, 255, 0.25));
  }

  .progress-bar {
    background: var(
      --player-seekbar-played,
      linear-gradient(
        90deg,
        var(--player-accent-color, #818cf8),
        var(--player-primary-color, #6366f1)
      )
    );
    box-shadow: var(
      --player-seekbar-played-glow,
      0 0 8px var(--player-primary-glow, rgba(99, 102, 241, 0.4))
    );
  }

  .handle {
    position: absolute;
    top: 50%;
    width: var(--player-seekbar-handle-size, 12px);
    height: var(--player-seekbar-handle-size, 12px);
    background: var(--player-seekbar-handle-bg, #ffffff);
    border-radius: 50%;
    transform: translate(-50%, -50%) scale(0);
    box-shadow: var(--player-seekbar-handle-shadow, 0 2px 6px rgba(0, 0, 0, 0.4));
    transition: transform var(--player-transition-duration, 0.15s) var(--player-ease-smooth);
    will-change: left;
  }

  :host(:hover) .handle,
  :host(:focus-visible) .handle,
  .handle.active {
    transform: translate(-50%, -50%) scale(1);
  }

  :host(:focus-visible) .handle {
    box-shadow:
      0 0 0 3px var(--player-primary-glow, rgba(99, 102, 241, 0.4)),
      0 2px 6px rgba(0, 0, 0, 0.4);
  }

  .hover-tooltip {
    position: absolute;
    bottom: var(--player-preview-offset, 16px);
    transform: translateX(-50%);
    transform-origin: bottom center;
    background: var(--tooltip-bg, rgba(15, 23, 42, 0.95));
    backdrop-filter: var(--player-preview-backdrop-filter, blur(var(--player-glass-blur, 8px)));
    -webkit-backdrop-filter: var(
      --player-preview-backdrop-filter,
      blur(var(--player-glass-blur, 8px))
    );
    border: 1px solid var(--player-glass-border, rgba(255, 255, 255, 0.15));
    color: var(--player-tooltip-color, var(--player-text-color, #ffffff));
    padding: 4px 8px;
    font-size: 11px;
    font-weight: 600;
    border-radius: var(--player-border-radius-tooltip, 4px);
    box-shadow: var(--player-glass-shadow, 0 4px 12px rgba(0, 0, 0, 0.4));
    pointer-events: none;
    opacity: 0;
    transition: var(
      --player-preview-transition,
      opacity var(--player-transition-duration, 0.15s) var(--player-ease-smooth)
    );
    z-index: var(--player-preview-z-index, 50);
    white-space: nowrap;
  }

  .hover-tooltip.has-thumbnail {
    background: var(--player-preview-bg, transparent);
    backdrop-filter: var(--player-preview-backdrop-filter, none);
    -webkit-backdrop-filter: var(--player-preview-backdrop-filter, none);
    border: none;
    box-shadow: none;
    padding: var(--player-preview-padding, 0);
    overflow: visible; /* Fix: Allow caret ::after to be visible outside tooltip bounds */
  }

  .hover-tooltip.has-thumbnail .thumbnail-container {
    border: var(--player-preview-border-width, 2px) solid
      var(--player-preview-border-color, #ffffff);
    border-radius: var(--player-preview-border-radius, 12px);
    box-shadow: var(--player-preview-shadow, 0 10px 25px rgba(0, 0, 0, 0.5));
  }

  .hover-tooltip::after {
    content: '';
    position: absolute;
    bottom: calc(-1 * var(--player-preview-arrow-size, 6px));
    left: var(--caret-left, 50%);
    transform: translateX(-50%);
    border-width: var(--player-preview-arrow-size, 6px) var(--player-preview-arrow-size, 6px) 0;
    border-style: solid;
    border-color: var(--tooltip-bg, rgba(15, 23, 42, 0.95)) transparent transparent;
    display: var(--player-preview-arrow-visible, block);
    width: 0;
    height: 0;
    z-index: 51;
    /* Removed transition: left to eliminate cursor pointer tracking lag */
  }

  .hover-tooltip.has-thumbnail::after {
    border-color: var(--player-preview-arrow-color, var(--player-preview-border-color, #ffffff))
      transparent transparent;
  }

  .hover-tooltip.visible {
    opacity: var(--player-preview-opacity, 1);
  }

  .thumbnail-container {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    width: var(--player-preview-width, 200px); /* Fixed width to prevent size shifts */
    height: var(--player-preview-height, 112px); /* Fixed height to prevent size shifts */
    border-radius: var(--player-preview-border-radius, 12px);
    overflow: hidden; /* Clips image/overlay and loader shimmer */
    background: var(--player-preview-bg, #08080c);
  }

  /* Shimmer loader design for smart seek preview loading */
  .thumbnail-container.loading {
    background: var(--player-glass-panel, #0b0f19);
  }

  .thumbnail-placeholder-shimmer {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: linear-gradient(
      90deg,
      rgba(255, 255, 255, 0) 0%,
      rgba(255, 255, 255, 0.05) 20%,
      rgba(255, 255, 255, 0.1) 60%,
      rgba(255, 255, 255, 0) 100%
    );
    background-size: 200% 100%;
    animation: shimmer 1.5s infinite;
  }

  @keyframes shimmer {
    100% {
      background-position: -200% 0;
    }
  }

  .thumbnail-spinner {
    position: absolute;
    width: 22px;
    height: 22px;
    border: 2px solid var(--player-glass-border, rgba(255, 255, 255, 0.25));
    border-top-color: var(--player-primary-color, #6366f1);
    border-radius: 50%;
    animation: spinner-rotate 0.8s linear infinite;
    z-index: 10;
  }

  @keyframes spinner-rotate {
    to {
      transform: rotate(360deg);
    }
  }

  .thumbnail-container::after {
    content: '';
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    height: 28px;
    background: var(
      --player-preview-time-bg,
      linear-gradient(to top, rgba(0, 0, 0, 0.55) 0%, rgba(0, 0, 0, 0) 100%)
    );
    pointer-events: none;
    z-index: 1;
  }

  .thumbnail-preview {
    width: var(--player-preview-width, 200px);
    height: var(--player-preview-height, 112px);
    background-repeat: no-repeat;
    background-color: var(--player-preview-bg, #000000);
  }

  .tooltip-time-text {
    text-align: center;
  }

  .hover-tooltip.has-thumbnail .tooltip-time-text {
    position: absolute;
    bottom: 6px;
    left: 50%;
    transform: translateX(-50%);
    font-family: var(--player-preview-time-font, var(--player-font-family, 'Outfit', sans-serif));
    font-size: var(--player-preview-time-size, 12px);
    font-weight: 600;
    color: var(--player-preview-time-color, #ffffff);
    text-shadow:
      0 1px 3px rgba(0, 0, 0, 0.9),
      0 1px 1px rgba(0, 0, 0, 0.9);
    pointer-events: none;
    margin-top: var(--player-preview-spacing, 0);
    z-index: 2;
    background: none;
    border: none;
    box-shadow: none;
    padding: 0;
  }

  @media (max-width: 480px) {
    .hover-tooltip {
      transform: translateX(-50%) scale(0.85);
      bottom: 12px;
    }
  }

  .time-display {
    font-family: var(--player-font-family, 'Outfit', sans-serif);
    font-size: 13px;
    font-weight: 500;
    color: var(--player-button-color, #cbd5e1);
    font-variant-numeric: tabular-nums;
    letter-spacing: 0.02em;
    user-select: none;
    -webkit-user-select: none;
    pointer-events: auto;
    cursor: pointer;
    white-space: nowrap;
    flex-shrink: 0;
    text-align: right;
    transition:
      color var(--player-transition-duration, 0.15s) var(--player-ease-smooth),
      font-weight var(--player-transition-duration, 0.15s) var(--player-ease-smooth);
  }

  .seekbar-container.interactive .time-display {
    color: var(--player-button-hover-color, #ffffff);
    font-weight: 600;
  }

  .marker {
    position: absolute;
    top: 50%;
    transform: translate(-50%, -50%);
    width: 6px;
    height: 6px;
    border-radius: 50%;
    z-index: 10;
    pointer-events: auto;
    border: 1px solid rgba(0, 0, 0, 0.4);
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
    transition: transform 0.1s ease;
    background-color: var(--marker-color-default, #ffffff);
  }

  /* Theme Driven Marker Colors */
  .marker.ad {
    background-color: var(--marker-color-ad, #fbbf24);
  }
  .marker.bookmark {
    background-color: var(--marker-color-bookmark, #60a5fa);
  }
  .marker.analytics {
    background-color: var(--marker-color-analytics, #f87171);
  }
  .marker.metadata {
    background-color: var(--marker-color-metadata, #a855f7);
  }
  .marker.chapter {
    background-color: var(--marker-color-chapter, #34d399);
  }
  .marker.goal {
    background-color: var(--marker-color-goal, #f472b6);
  }
  .marker.breaking-news {
    background-color: var(--marker-color-news, #ef4444);
  }
  .marker.live-event {
    background-color: var(--marker-color-live, #f97316);
  }

  .marker:hover {
    transform: translate(-50%, -50%) scale(1.5);
  }

  .tooltip-marker-label {
    font-weight: 600;
    font-size: 10px;
    opacity: 0.9;
    color: var(--player-accent-color, #818cf8);
    max-width: 140px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .precise-seek-label {
    font-weight: 600;
    font-size: 11px;
    color: var(--player-text-color, #ffffff);
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.8);
    background: var(--player-glass-bg, rgba(15, 23, 42, 0.8));
    backdrop-filter: blur(var(--player-glass-blur, 4px));
    -webkit-backdrop-filter: blur(var(--player-glass-blur, 4px));
    padding: 4px 10px;
    border-radius: var(--player-border-radius-badge, 12px);
    border: 1px solid var(--player-glass-border, rgba(255, 255, 255, 0.15));
    text-align: center;
    margin-bottom: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    box-shadow: var(--player-glass-shadow, 0 2px 8px rgba(0, 0, 0, 0.3));
  }

  .seekbar-container.vertical .thumbnail-container {
    width: var(--player-preview-vertical-width, 90px);
    height: var(--player-preview-vertical-height, 160px);
  }

  .seekbar-container.vertical .tooltip-marker-label {
    max-width: var(--player-preview-vertical-width, 90px);
  }
`;
