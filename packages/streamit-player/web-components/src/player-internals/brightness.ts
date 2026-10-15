/**
 * Brightness model for the swipe gesture.
 *
 * Players show brightness as a 0-100% level (MX Player, VLC, YouTube mobile).
 * Web pages cannot change device brightness, so the level drives a CSS
 * `filter: brightness()` on the video. 50% is the untouched picture, below it
 * dims and above it brightens, so a swipe can go both ways from the default.
 */
export const BRIGHTNESS_DEFAULT_LEVEL = 0.5;
export const BRIGHTNESS_STORAGE_KEY = 'player_brightness';

const FILTER_MIN = 0.2;
const FILTER_NEUTRAL = 1;
const FILTER_MAX = 1.5;

export function clampBrightnessLevel(level: number): number {
  if (!Number.isFinite(level)) return BRIGHTNESS_DEFAULT_LEVEL;
  return Math.max(0, Math.min(1, level));
}

/** Level (0-1) to the CSS `brightness()` multiplier: 0 -> 0.2, 0.5 -> 1, 1 -> 1.5. */
export function brightnessLevelToFilter(level: number): number {
  const l = clampBrightnessLevel(level);
  if (l <= BRIGHTNESS_DEFAULT_LEVEL) {
    return FILTER_MIN + (l / BRIGHTNESS_DEFAULT_LEVEL) * (FILTER_NEUTRAL - FILTER_MIN);
  }
  return (
    FILTER_NEUTRAL +
    ((l - BRIGHTNESS_DEFAULT_LEVEL) / (1 - BRIGHTNESS_DEFAULT_LEVEL)) * (FILTER_MAX - FILTER_NEUTRAL)
  );
}

/** The `filter` value to put on the video; empty at the neutral level so no filter layer is created. */
export function brightnessFilterValue(level: number): string {
  const l = clampBrightnessLevel(level);
  if (l === BRIGHTNESS_DEFAULT_LEVEL) return '';
  return `brightness(${brightnessLevelToFilter(l).toFixed(3)})`;
}

export function loadBrightnessLevel(): number {
  try {
    const raw = localStorage.getItem(BRIGHTNESS_STORAGE_KEY);
    if (raw === null) return BRIGHTNESS_DEFAULT_LEVEL;
    return clampBrightnessLevel(parseFloat(raw));
  } catch {
    return BRIGHTNESS_DEFAULT_LEVEL;
  }
}

export function saveBrightnessLevel(level: number): void {
  try {
    localStorage.setItem(BRIGHTNESS_STORAGE_KEY, String(clampBrightnessLevel(level)));
  } catch {
    // Storage unavailable (private mode, blocked): brightness just won't persist.
  }
}
