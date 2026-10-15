import { describe, it, expect, beforeEach } from 'vitest';
import {
  BRIGHTNESS_DEFAULT_LEVEL,
  BRIGHTNESS_STORAGE_KEY,
  brightnessFilterValue,
  brightnessLevelToFilter,
  clampBrightnessLevel,
  loadBrightnessLevel,
  saveBrightnessLevel,
} from './brightness';

describe('brightness model', () => {
  beforeEach(() => localStorage.clear());

  it('maps 0% / 50% / 100% to a dim, neutral and boosted filter', () => {
    expect(brightnessLevelToFilter(0)).toBeCloseTo(0.2);
    expect(brightnessLevelToFilter(0.5)).toBeCloseTo(1);
    expect(brightnessLevelToFilter(1)).toBeCloseTo(1.5);
  });

  it('is monotonic across the range', () => {
    let prev = -Infinity;
    for (let i = 0; i <= 100; i++) {
      const v = brightnessLevelToFilter(i / 100);
      expect(v).toBeGreaterThan(prev);
      prev = v;
    }
  });

  it('clamps out-of-range and invalid input', () => {
    expect(clampBrightnessLevel(-3)).toBe(0);
    expect(clampBrightnessLevel(7)).toBe(1);
    expect(clampBrightnessLevel(NaN)).toBe(BRIGHTNESS_DEFAULT_LEVEL);
  });

  it('emits no filter at the neutral level', () => {
    expect(brightnessFilterValue(0.5)).toBe('');
    expect(brightnessFilterValue(1)).toBe('brightness(1.500)');
    expect(brightnessFilterValue(0)).toBe('brightness(0.200)');
  });

  it('persists and restores the level, tolerating bad stored data', () => {
    expect(loadBrightnessLevel()).toBe(BRIGHTNESS_DEFAULT_LEVEL);
    saveBrightnessLevel(0.8);
    expect(loadBrightnessLevel()).toBe(0.8);
    localStorage.setItem(BRIGHTNESS_STORAGE_KEY, 'garbage');
    expect(loadBrightnessLevel()).toBe(BRIGHTNESS_DEFAULT_LEVEL);
    localStorage.setItem(BRIGHTNESS_STORAGE_KEY, '42');
    expect(loadBrightnessLevel()).toBe(1);
  });
});
