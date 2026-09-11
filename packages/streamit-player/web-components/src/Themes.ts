import type { PlayerThemeConfig } from '../../core/src/index';

export const THEME_PRESETS: Record<string, Record<string, string>> = {
  light: {
    '--player-primary-color': '#4f46e5',
    '--player-accent-color': '#818cf8',
    '--player-bg-color': '#ffffff',
    '--player-text-color': '#1f2937',
    '--player-glass-bg': 'rgba(255, 255, 255, 0.75)',
    '--player-glass-border': 'rgba(0, 0, 0, 0.08)',
    '--player-glass-shadow': '0 8px 32px rgba(31, 38, 135, 0.07)',
    '--player-menu-bg': 'rgba(255, 255, 255, 0.95)',
    '--player-seekbar-bg': 'rgba(0, 0, 0, 0.1)',
    '--player-seekbar-buffer': 'rgba(0, 0, 0, 0.15)',
    '--tooltip-bg': 'rgba(255, 255, 255, 0.95)',
    '--player-tooltip-color': '#1f2937',
    '--marker-color-default': '#6b7280',
    '--player-primary-glow': 'rgba(79, 70, 229, 0.35)',
    '--player-glass-panel': 'rgba(255, 255, 255, 0.95)',
    '--player-button-color': '#4b5563',
    '--player-button-hover-color': '#1f2937',
    '--player-button-hover-bg': 'rgba(0, 0, 0, 0.05)',
    '--player-volume-played-bg': '#4f46e5',
    '--player-volume-unplayed-bg': 'rgba(0, 0, 0, 0.15)',
    '--player-vertical-max-width': '450px',
    '--player-overlay-bg': '#f8fafc',
    '--player-ad-badge-bg': 'rgba(15, 23, 42, 0.85)',
    '--player-ad-badge-color': '#ffffff',
    '--player-ad-skip-bg': 'rgba(15, 23, 42, 0.9)',
    '--player-ad-skip-color': '#ffffff',
    '--player-ad-skip-disabled-bg': 'rgba(15, 23, 42, 0.9)',
    '--player-ad-progress-bg': 'rgba(255, 255, 255, 0.2)',
    '--player-ad-progress-fill': '#f59e0b',
    '--player-live-badge-live-bg': 'rgba(239, 68, 68, 0.15)',
    '--player-live-badge-live-border': 'rgba(239, 68, 68, 0.3)',
    '--player-live-badge-live-color': '#ef4444',
    '--player-live-badge-behind-bg': 'rgba(0, 0, 0, 0.05)',
    '--player-live-badge-behind-border': 'rgba(0, 0, 0, 0.1)',
    '--player-live-badge-behind-color': '#4b5563',
    '--player-preview-border-color': '#ffffff',
    '--player-preview-border-width': '2px',
    '--player-preview-border-radius': '12px',
    '--player-preview-shadow': '0 10px 25px rgba(0, 0, 0, 0.5)',
    '--player-preview-bg': '#08080c',
    '--player-preview-time-bg':
      'linear-gradient(to top, rgba(0, 0, 0, 0.55) 0%, rgba(0, 0, 0, 0) 100%)',
    '--player-preview-time-color': '#ffffff',
    '--player-preview-time-font': "var(--player-font-family, 'Outfit', sans-serif)",
    '--player-preview-time-size': '12px',
    '--player-preview-width': '200px',
    '--player-preview-height': '112px',
    '--player-preview-offset': '16px',
    '--player-preview-animation':
      'opacity var(--player-transition-duration, 0.15s) var(--player-ease-smooth)',
    '--player-preview-opacity': '1',
    '--player-preview-blur': 'none',
    '--player-preview-arrow-color': '#ffffff',
    '--player-preview-arrow-size': '6px',
    '--player-preview-arrow-visible': 'block',
    '--player-preview-transition':
      'opacity var(--player-transition-duration, 0.15s) var(--player-ease-smooth)',
    '--player-preview-z-index': '50',
    '--player-preview-padding': '0',
    '--player-preview-spacing': '0',
    '--player-preview-backdrop-filter': 'none',
    '--player-preview-vertical-width': '90px',
    '--player-preview-vertical-height': '160px',
  },
  dark: {
    '--player-primary-color': '#6366f1',
    '--player-accent-color': '#818cf8',
    '--player-bg-color': '#0f172a',
    '--player-text-color': '#f8fafc',
    '--player-glass-bg': 'rgba(15, 23, 42, 0.65)',
    '--player-glass-border': 'rgba(255, 255, 255, 0.08)',
    '--player-glass-shadow': '0 8px 32px rgba(0, 0, 0, 0.3)',
    '--player-menu-bg': 'rgba(15, 23, 42, 0.95)',
    '--player-seekbar-bg': 'rgba(255, 255, 255, 0.15)',
    '--player-seekbar-buffer': 'rgba(255, 255, 255, 0.25)',
    '--tooltip-bg': 'rgba(15, 23, 42, 0.95)',
    '--player-tooltip-color': '#f8fafc',
    '--marker-color-default': '#ffffff',
    '--player-primary-glow': 'rgba(99, 102, 241, 0.35)',
    '--player-glass-panel': 'rgba(15, 23, 42, 0.95)',
    '--player-button-color': '#cbd5e1',
    '--player-button-hover-color': '#ffffff',
    '--player-button-hover-bg': 'rgba(255, 255, 255, 0.08)',
    '--player-volume-played-bg': '#6366f1',
    '--player-volume-unplayed-bg': 'rgba(255, 255, 255, 0.2)',
    '--player-vertical-max-width': '450px',
    '--player-overlay-bg': '#08080c',
    '--player-ad-badge-bg': 'rgba(15, 23, 42, 0.85)',
    '--player-ad-badge-color': '#ffffff',
    '--player-ad-skip-bg': 'rgba(15, 23, 42, 0.9)',
    '--player-ad-skip-color': '#ffffff',
    '--player-ad-skip-disabled-bg': 'rgba(15, 23, 42, 0.9)',
    '--player-ad-progress-bg': 'rgba(255, 255, 255, 0.2)',
    '--player-ad-progress-fill': '#f59e0b',
    '--player-live-badge-live-bg': 'rgba(239, 68, 68, 0.15)',
    '--player-live-badge-live-border': 'rgba(239, 68, 68, 0.3)',
    '--player-live-badge-live-color': '#ef4444',
    '--player-live-badge-behind-bg': 'rgba(255, 255, 255, 0.08)',
    '--player-live-badge-behind-border': 'rgba(255, 255, 255, 0.12)',
    '--player-live-badge-behind-color': '#94a3b8',
    '--player-preview-border-color': '#ffffff',
    '--player-preview-border-width': '2px',
    '--player-preview-border-radius': '12px',
    '--player-preview-shadow': '0 10px 25px rgba(0, 0, 0, 0.5)',
    '--player-preview-bg': '#08080c',
    '--player-preview-time-bg':
      'linear-gradient(to top, rgba(0, 0, 0, 0.55) 0%, rgba(0, 0, 0, 0) 100%)',
    '--player-preview-time-color': '#ffffff',
    '--player-preview-time-font': "var(--player-font-family, 'Outfit', sans-serif)",
    '--player-preview-time-size': '12px',
    '--player-preview-width': '200px',
    '--player-preview-height': '112px',
    '--player-preview-offset': '16px',
    '--player-preview-animation':
      'opacity var(--player-transition-duration, 0.15s) var(--player-ease-smooth)',
    '--player-preview-opacity': '1',
    '--player-preview-blur': 'none',
    '--player-preview-arrow-color': '#ffffff',
    '--player-preview-arrow-size': '6px',
    '--player-preview-arrow-visible': 'block',
    '--player-preview-transition':
      'opacity var(--player-transition-duration, 0.15s) var(--player-ease-smooth)',
    '--player-preview-z-index': '50',
    '--player-preview-padding': '0',
    '--player-preview-spacing': '0',
    '--player-preview-backdrop-filter': 'none',
    '--player-preview-vertical-width': '90px',
    '--player-preview-vertical-height': '160px',
  },
  'glass-dark': {
    '--player-primary-color': '#6366f1',
    '--player-accent-color': '#818cf8',
    '--player-bg-color': 'transparent',
    '--player-text-color': '#f8fafc',
    '--player-glass-bg': 'rgba(8, 8, 12, 0.45)',
    '--player-glass-border': 'rgba(255, 255, 255, 0.06)',
    '--player-glass-shadow': '0 20px 50px rgba(0, 0, 0, 0.45)',
    '--player-menu-bg': 'rgba(8, 8, 12, 0.85)',
    '--player-seekbar-bg': 'rgba(255, 255, 255, 0.15)',
    '--player-seekbar-buffer': 'rgba(255, 255, 255, 0.25)',
    '--marker-color-default': '#ffffff',
    '--tooltip-bg': 'rgba(8, 8, 12, 0.9)',
    '--player-tooltip-color': '#f8fafc',
    '--player-primary-glow': 'rgba(99, 102, 241, 0.35)',
    '--player-glass-panel': 'rgba(10, 10, 15, 0.85)',
    '--player-button-color': '#cbd5e1',
    '--player-button-hover-color': '#ffffff',
    '--player-button-hover-bg': 'rgba(255, 255, 255, 0.08)',
    '--player-volume-played-bg': '#6366f1',
    '--player-volume-unplayed-bg': 'rgba(255, 255, 255, 0.2)',
    '--player-vertical-max-width': '450px',
    '--player-overlay-bg': '#08080c',
    '--player-ad-badge-bg': 'rgba(8, 8, 12, 0.85)',
    '--player-ad-badge-color': '#ffffff',
    '--player-ad-skip-bg': 'rgba(8, 8, 12, 0.9)',
    '--player-ad-skip-color': '#ffffff',
    '--player-ad-skip-disabled-bg': 'rgba(8, 8, 12, 0.9)',
    '--player-ad-progress-bg': 'rgba(255, 255, 255, 0.2)',
    '--player-ad-progress-fill': '#f59e0b',
    '--player-live-badge-live-bg': 'rgba(239, 68, 68, 0.15)',
    '--player-live-badge-live-border': 'rgba(239, 68, 68, 0.3)',
    '--player-live-badge-live-color': '#ef4444',
    '--player-live-badge-behind-bg': 'rgba(255, 255, 255, 0.08)',
    '--player-live-badge-behind-border': 'rgba(255, 255, 255, 0.12)',
    '--player-live-badge-behind-color': '#94a3b8',
    '--player-preview-border-color': '#ffffff',
    '--player-preview-border-width': '2px',
    '--player-preview-border-radius': '12px',
    '--player-preview-shadow': '0 10px 25px rgba(0, 0, 0, 0.5)',
    '--player-preview-bg': '#08080c',
    '--player-preview-time-bg':
      'linear-gradient(to top, rgba(0, 0, 0, 0.55) 0%, rgba(0, 0, 0, 0) 100%)',
    '--player-preview-time-color': '#ffffff',
    '--player-preview-time-font': "var(--player-font-family, 'Outfit', sans-serif)",
    '--player-preview-time-size': '12px',
    '--player-preview-width': '200px',
    '--player-preview-height': '112px',
    '--player-preview-offset': '16px',
    '--player-preview-animation':
      'opacity var(--player-transition-duration, 0.15s) var(--player-ease-smooth)',
    '--player-preview-opacity': '1',
    '--player-preview-blur': 'none',
    '--player-preview-arrow-color': '#ffffff',
    '--player-preview-arrow-size': '6px',
    '--player-preview-arrow-visible': 'block',
    '--player-preview-transition':
      'opacity var(--player-transition-duration, 0.15s) var(--player-ease-smooth)',
    '--player-preview-z-index': '50',
    '--player-preview-padding': '0',
    '--player-preview-spacing': '0',
    '--player-preview-backdrop-filter': 'none',
    '--player-preview-vertical-width': '90px',
    '--player-preview-vertical-height': '160px',
  },
  'glass-light': {
    '--player-primary-color': '#db2777',
    '--player-accent-color': '#f472b6',
    '--player-bg-color': 'transparent',
    '--player-text-color': '#111827',
    '--player-glass-bg': 'rgba(255, 255, 255, 0.45)',
    '--player-glass-border': 'rgba(0, 0, 0, 0.05)',
    '--player-glass-shadow': '0 20px 50px rgba(0, 0, 0, 0.1)',
    '--player-menu-bg': 'rgba(255, 255, 255, 0.85)',
    '--player-seekbar-bg': 'rgba(0, 0, 0, 0.1)',
    '--player-seekbar-buffer': 'rgba(0, 0, 0, 0.15)',
    '--marker-color-default': '#db2777',
    '--tooltip-bg': 'rgba(255, 255, 255, 0.9)',
    '--player-tooltip-color': '#111827',
    '--player-primary-glow': 'rgba(219, 39, 119, 0.35)',
    '--player-glass-panel': 'rgba(255, 255, 255, 0.85)',
    '--player-button-color': '#4b5563',
    '--player-button-hover-color': '#111827',
    '--player-button-hover-bg': 'rgba(0, 0, 0, 0.05)',
    '--player-volume-played-bg': '#db2777',
    '--player-volume-unplayed-bg': 'rgba(0, 0, 0, 0.15)',
    '--player-vertical-max-width': '450px',
    '--player-overlay-bg': '#ffffff',
    '--player-ad-badge-bg': 'rgba(15, 23, 42, 0.85)',
    '--player-ad-badge-color': '#ffffff',
    '--player-ad-skip-bg': 'rgba(15, 23, 42, 0.9)',
    '--player-ad-skip-color': '#ffffff',
    '--player-ad-skip-disabled-bg': 'rgba(15, 23, 42, 0.9)',
    '--player-ad-progress-bg': 'rgba(255, 255, 255, 0.2)',
    '--player-ad-progress-fill': '#f59e0b',
    '--player-live-badge-live-bg': 'rgba(239, 68, 68, 0.15)',
    '--player-live-badge-live-border': 'rgba(239, 68, 68, 0.3)',
    '--player-live-badge-live-color': '#ef4444',
    '--player-live-badge-behind-bg': 'rgba(0, 0, 0, 0.05)',
    '--player-live-badge-behind-border': 'rgba(0, 0, 0, 0.1)',
    '--player-live-badge-behind-color': '#4b5563',
    '--player-preview-border-color': '#ffffff',
    '--player-preview-border-width': '2px',
    '--player-preview-border-radius': '12px',
    '--player-preview-shadow': '0 10px 25px rgba(0, 0, 0, 0.5)',
    '--player-preview-bg': '#08080c',
    '--player-preview-time-bg':
      'linear-gradient(to top, rgba(0, 0, 0, 0.55) 0%, rgba(0, 0, 0, 0) 100%)',
    '--player-preview-time-color': '#ffffff',
    '--player-preview-time-font': "var(--player-font-family, 'Outfit', sans-serif)",
    '--player-preview-time-size': '12px',
    '--player-preview-width': '200px',
    '--player-preview-height': '112px',
    '--player-preview-offset': '16px',
    '--player-preview-animation':
      'opacity var(--player-transition-duration, 0.15s) var(--player-ease-smooth)',
    '--player-preview-opacity': '1',
    '--player-preview-blur': 'none',
    '--player-preview-arrow-color': '#ffffff',
    '--player-preview-arrow-size': '6px',
    '--player-preview-arrow-visible': 'block',
    '--player-preview-transition':
      'opacity var(--player-transition-duration, 0.15s) var(--player-ease-smooth)',
    '--player-preview-z-index': '50',
    '--player-preview-padding': '0',
    '--player-preview-spacing': '0',
    '--player-preview-backdrop-filter': 'none',
    '--player-preview-vertical-width': '90px',
    '--player-preview-vertical-height': '160px',
  },
};

export function compileTheme(themeConfig: PlayerThemeConfig = {}): Record<string, string> {
  const preset = themeConfig.preset || 'glass-dark';
  const selectedPreset = THEME_PRESETS[preset] || THEME_PRESETS['glass-dark'];

  const compiled: Record<string, string> = {
    ...selectedPreset,
  };

  if (themeConfig.primaryColor) compiled['--player-primary-color'] = themeConfig.primaryColor;
  if (themeConfig.accentColor) compiled['--player-accent-color'] = themeConfig.accentColor;
  if (themeConfig.backgroundColor) compiled['--player-bg-color'] = themeConfig.backgroundColor;
  if (themeConfig.textColor) compiled['--player-text-color'] = themeConfig.textColor;
  if (themeConfig.menuColor) compiled['--player-menu-bg'] = themeConfig.menuColor;
  if (themeConfig.seekbarBg) compiled['--player-seekbar-bg'] = themeConfig.seekbarBg;
  if (themeConfig.seekbarPlayed) compiled['--player-seekbar-played'] = themeConfig.seekbarPlayed;
  if (themeConfig.seekbarBuffered)
    compiled['--player-seekbar-buffer'] = themeConfig.seekbarBuffered;
  if (themeConfig.borderRadius) compiled['--player-border-radius'] = themeConfig.borderRadius;
  if (themeConfig.fontFamily) compiled['--player-font-family'] = themeConfig.fontFamily;
  if (themeConfig.fontSize) compiled['--player-cue-font-size'] = themeConfig.fontSize;
  if (themeConfig.blur) {
    compiled['--player-glass-blur'] = themeConfig.blur;
    compiled['--player-glass-blur-webkit'] = themeConfig.blur;
  }
  if (themeConfig.shadows) compiled['--player-shadow'] = themeConfig.shadows;
  if (themeConfig.spacing) compiled['--player-spacing'] = themeConfig.spacing;
  if (themeConfig.transitions) compiled['--player-transition-duration'] = themeConfig.transitions;

  // Compile new configuration properties if they exist:
  if (themeConfig.primaryGlow) compiled['--player-primary-glow'] = themeConfig.primaryGlow;
  if (themeConfig.glassBg) compiled['--player-glass-bg'] = themeConfig.glassBg;
  if (themeConfig.glassPanel) compiled['--player-glass-panel'] = themeConfig.glassPanel;
  if (themeConfig.glassBorder) compiled['--player-glass-border'] = themeConfig.glassBorder;
  if (themeConfig.glassShadow) compiled['--player-glass-shadow'] = themeConfig.glassShadow;
  if (themeConfig.menuBg) compiled['--player-menu-bg'] = themeConfig.menuBg;
  if (themeConfig.tooltipBg) compiled['--tooltip-bg'] = themeConfig.tooltipBg;
  if (themeConfig.tooltipColor) compiled['--player-tooltip-color'] = themeConfig.tooltipColor;
  if (themeConfig.buttonColor) compiled['--player-button-color'] = themeConfig.buttonColor;
  if (themeConfig.buttonHoverColor)
    compiled['--player-button-hover-color'] = themeConfig.buttonHoverColor;
  if (themeConfig.buttonHoverBg) compiled['--player-button-hover-bg'] = themeConfig.buttonHoverBg;
  if (themeConfig.buttonIconSize)
    compiled['--player-button-icon-size'] = themeConfig.buttonIconSize;
  if (themeConfig.volumePlayedBg)
    compiled['--player-volume-played-bg'] = themeConfig.volumePlayedBg;
  if (themeConfig.volumeUnplayedBg)
    compiled['--player-volume-unplayed-bg'] = themeConfig.volumeUnplayedBg;
  if (themeConfig.verticalMaxWidth)
    compiled['--player-vertical-max-width'] = themeConfig.verticalMaxWidth;
  if (themeConfig.overlayBg) compiled['--player-overlay-bg'] = themeConfig.overlayBg;
  if (themeConfig.liveBadgeLiveBg)
    compiled['--player-live-badge-live-bg'] = themeConfig.liveBadgeLiveBg;
  if (themeConfig.liveBadgeLiveBorder)
    compiled['--player-live-badge-live-border'] = themeConfig.liveBadgeLiveBorder;
  if (themeConfig.liveBadgeLiveColor)
    compiled['--player-live-badge-live-color'] = themeConfig.liveBadgeLiveColor;
  if (themeConfig.liveBadgeBehindBg)
    compiled['--player-live-badge-behind-bg'] = themeConfig.liveBadgeBehindBg;
  if (themeConfig.liveBadgeBehindBorder)
    compiled['--player-live-badge-behind-border'] = themeConfig.liveBadgeBehindBorder;
  if (themeConfig.liveBadgeBehindColor)
    compiled['--player-live-badge-behind-color'] = themeConfig.liveBadgeBehindColor;

  // Smart Seek custom variables mappings:
  if (themeConfig.previewBorderColor)
    compiled['--player-preview-border-color'] = themeConfig.previewBorderColor;
  if (themeConfig.previewBorderWidth)
    compiled['--player-preview-border-width'] = themeConfig.previewBorderWidth;
  if (themeConfig.previewBorderRadius)
    compiled['--player-preview-border-radius'] = themeConfig.previewBorderRadius;
  if (themeConfig.previewShadow) compiled['--player-preview-shadow'] = themeConfig.previewShadow;
  if (themeConfig.previewBg) compiled['--player-preview-bg'] = themeConfig.previewBg;
  if (themeConfig.previewTimeBg) compiled['--player-preview-time-bg'] = themeConfig.previewTimeBg;
  if (themeConfig.previewTimeColor)
    compiled['--player-preview-time-color'] = themeConfig.previewTimeColor;
  if (themeConfig.previewTimeFont)
    compiled['--player-preview-time-font'] = themeConfig.previewTimeFont;
  if (themeConfig.previewTimeSize)
    compiled['--player-preview-time-size'] = themeConfig.previewTimeSize;
  if (themeConfig.previewWidth) compiled['--player-preview-width'] = themeConfig.previewWidth;
  if (themeConfig.previewHeight) compiled['--player-preview-height'] = themeConfig.previewHeight;
  if (themeConfig.previewOffset) compiled['--player-preview-offset'] = themeConfig.previewOffset;
  if (themeConfig.previewAnimation)
    compiled['--player-preview-animation'] = themeConfig.previewAnimation;
  if (themeConfig.previewOpacity) compiled['--player-preview-opacity'] = themeConfig.previewOpacity;
  if (themeConfig.previewBlur) compiled['--player-preview-blur'] = themeConfig.previewBlur;
  if (themeConfig.previewArrowColor)
    compiled['--player-preview-arrow-color'] = themeConfig.previewArrowColor;
  if (themeConfig.previewArrowSize)
    compiled['--player-preview-arrow-size'] = themeConfig.previewArrowSize;
  if (themeConfig.previewArrowVisible)
    compiled['--player-preview-arrow-visible'] = themeConfig.previewArrowVisible;
  if (themeConfig.previewTransition)
    compiled['--player-preview-transition'] = themeConfig.previewTransition;
  if (themeConfig.previewZIndex) compiled['--player-preview-z-index'] = themeConfig.previewZIndex;
  if (themeConfig.previewPadding) compiled['--player-preview-padding'] = themeConfig.previewPadding;
  if (themeConfig.previewSpacing) compiled['--player-preview-spacing'] = themeConfig.previewSpacing;
  if (themeConfig.previewBackdropFilter)
    compiled['--player-preview-backdrop-filter'] = themeConfig.previewBackdropFilter;
  if (themeConfig.previewVerticalWidth)
    compiled['--player-preview-vertical-width'] = themeConfig.previewVerticalWidth;
  if (themeConfig.previewVerticalHeight)
    compiled['--player-preview-vertical-height'] = themeConfig.previewVerticalHeight;

  if (themeConfig.customVariables) {
    for (const [key, val] of Object.entries(themeConfig.customVariables)) {
      if (typeof val === 'string') {
        compiled[key] = val;
      }
    }
  }

  return compiled;
}
