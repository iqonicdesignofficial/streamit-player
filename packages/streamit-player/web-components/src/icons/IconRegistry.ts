import { html, TemplateResult } from 'lit';
import { unsafeSVG } from 'lit/directives/unsafe-svg.js';

export type IconName =
  | 'play'
  | 'pause'
  | 'replay'
  | 'loading'
  | 'volume'
  | 'volume-mute'
  | 'volume-low'
  | 'volume-medium'
  | 'settings'
  | 'settings-vertical'
  | 'fullscreen'
  | 'fullscreen-exit'
  | 'pip'
  | 'captions'
  | 'seek-backward'
  | 'seek-forward'
  | 'live'
  | 'playlist-prev'
  | 'playlist-next'
  | 'chapters'
  | 'markers'
  | 'arrow-back'
  | 'arrow-forward'
  | 'check'
  | 'audio-only'
  | 'speed-feedback';

export type IconValue =
  | string
  | TemplateResult
  | Element
  | ((params?: Record<string, unknown>) => string | TemplateResult | Element);

export class IconRegistry {
  private static globalPacks = new Map<string, Record<string, IconValue>>();
  private static defaultIcons = new Map<IconName, IconValue>();

  public static registerDefaultIcon(name: IconName, value: IconValue) {
    this.defaultIcons.set(name, value);
  }

  public static registerIconPack(packName: string, pack: Record<string, IconValue>) {
    this.globalPacks.set(packName, pack);
  }

  public static getGlobalPack(packName: string): Record<string, IconValue> | undefined {
    return this.globalPacks.get(packName);
  }

  public static getDefaultIcon(name: IconName): IconValue | undefined {
    return this.defaultIcons.get(name);
  }
}

export class PlayerIconRegistry {
  private overrides = new Map<IconName, IconValue>();
  private activePack: Record<string, IconValue> | null = null;

  constructor(configIcons?: Record<string, IconValue>, packName?: string) {
    if (packName) {
      this.useIconPack(packName);
    }
    if (configIcons) {
      for (const [key, value] of Object.entries(configIcons)) {
        this.setIcon(key as IconName, value);
      }
    }
  }

  public setIcon(name: IconName, value: IconValue) {
    this.overrides.set(name, value);
  }

  public useIconPack(packName: string) {
    const pack = IconRegistry.getGlobalPack(packName);
    if (pack) {
      this.activePack = pack;
    }
  }

  public getIcon(
    name: IconName,
    params?: Record<string, unknown>
  ): string | TemplateResult | Element {
    let rawIcon: IconValue | undefined;
    if (this.overrides.has(name)) {
      rawIcon = this.overrides.get(name);
    } else if (this.activePack && this.activePack[name]) {
      rawIcon = this.activePack[name];
    } else {
      rawIcon = IconRegistry.getDefaultIcon(name);
    }

    if (!rawIcon) return '';
    if (typeof rawIcon === 'function') {
      return rawIcon(params);
    }
    return rawIcon as string | TemplateResult | Element;
  }
}

import { DirectiveResult } from 'lit/directive.js';
import { UnsafeSVGDirective } from 'lit/directives/unsafe-svg.js';

export function renderIcon(
  value: IconValue
): string | TemplateResult | Element | DirectiveResult<typeof UnsafeSVGDirective> {
  if (typeof value === 'string') {
    return unsafeSVG(value);
  }
  if (value instanceof Element) {
    return value.cloneNode(true);
  }
  return value;
}

// Register default built-in icons
IconRegistry.registerDefaultIcon(
  'play',
  html`<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>`
);
IconRegistry.registerDefaultIcon(
  'pause',
  html`<svg viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" /></svg>`
);
IconRegistry.registerDefaultIcon(
  'replay',
  html`<svg viewBox="0 0 24 24">
    <path
      d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"
    />
  </svg>`
);
IconRegistry.registerDefaultIcon('loading', html``); // premium-spinner handles this fallback
IconRegistry.registerDefaultIcon(
  'volume',
  html`<svg viewBox="0 0 24 24">
    <path
      d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"
    />
  </svg>`
);
IconRegistry.registerDefaultIcon(
  'volume-mute',
  html`<svg viewBox="0 0 24 24">
    <path
      d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.21.05-.42.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"
    />
  </svg>`
);
IconRegistry.registerDefaultIcon(
  'volume-low',
  html`<svg viewBox="0 0 24 24">
    <path
      d="M7 9v6h4l5 5V4l-5 5H7zm11.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"
    />
  </svg>`
);
IconRegistry.registerDefaultIcon(
  'volume-medium',
  html`<svg viewBox="0 0 24 24">
    <path
      d="M5 9v6h4l5 5V4L9 9H5zm11.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.74 2.5-2.26 2.5-4.02z"
    />
  </svg>`
);
IconRegistry.registerDefaultIcon(
  'settings',
  html`<svg viewBox="0 0 24 24">
    <path
      d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"
    />
  </svg>`
);
IconRegistry.registerDefaultIcon(
  'settings-vertical',
  html`<svg viewBox="0 0 24 24">
    <path
      d="M6 10c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm12 0c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm-6 0c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"
    />
  </svg>`
);
IconRegistry.registerDefaultIcon(
  'fullscreen',
  html`<svg viewBox="0 0 24 24">
    <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z" />
  </svg>`
);
IconRegistry.registerDefaultIcon(
  'fullscreen-exit',
  html`<svg viewBox="0 0 24 24">
    <path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z" />
  </svg>`
);
IconRegistry.registerDefaultIcon(
  'pip',
  html`<svg viewBox="0 0 24 24">
    <path
      d="M21 3H3c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H3V5h18v14zm-10-7h9v6h-9z"
    />
  </svg>`
);
IconRegistry.registerDefaultIcon(
  'captions',
  html`<svg viewBox="0 0 24 24">
    <path
      d="M19 4H5c-1.11 0-2 .9-2 2v12c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm-8 7H9.5v-.5h-2v3h2V13H11v1c0 .55-.45 1-1 1H7c-.55 0-1-.45-1-1v-4c0-.55.45-1 1-1h3c.55 0 1 .45 1 1v1zm7 0h-1.5v-.5h-2v3h2V13H18v1c0 .55-.45 1-1 1h-3c-.55 0-1-.45-1-1v-4c0-.55.45-1 1-1h3c.55 0 1 .45 1 1v1z"
    />
  </svg>`
);
IconRegistry.registerDefaultIcon(
  'seek-backward',
  (params) => html`
    <svg viewBox="0 0 24 24">
      <path
        d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"
      />
      <text
        x="12"
        y="15.5"
        font-size="7.5"
        font-family="system-ui, -apple-system, sans-serif"
        font-weight="bold"
        text-anchor="middle"
        fill="currentColor"
      >
        ${params && 'amount' in params ? params.amount : 10}
      </text>
    </svg>
  `
);
IconRegistry.registerDefaultIcon(
  'seek-forward',
  (params) => html`
    <svg viewBox="0 0 24 24">
      <path
        d="M18 13c0 3.31-2.69 6-6 6s-6-2.69-6-6 2.69-6 6-6v4l5-5-5-5v4c-4.42 0-8 3.58-8 8s3.58 8 8 8 8-3.58 8-8h-2z"
      />
      <text
        x="12"
        y="15.5"
        font-size="7.5"
        font-family="system-ui, -apple-system, sans-serif"
        font-weight="bold"
        text-anchor="middle"
        fill="currentColor"
      >
        ${params && 'amount' in params ? params.amount : 10}
      </text>
    </svg>
  `
);
IconRegistry.registerDefaultIcon('live', html``); // Fallback to live dot CSS styles
IconRegistry.registerDefaultIcon(
  'playlist-prev',
  html`<svg viewBox="0 0 24 24"><path d="M7.41 15.41L12 10.83l4.59 4.58L18 14l-6-6-6 6z" /></svg>`
);
IconRegistry.registerDefaultIcon(
  'playlist-next',
  html`<svg viewBox="0 0 24 24"><path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6z" /></svg>`
);
IconRegistry.registerDefaultIcon(
  'chapters',
  html`<svg viewBox="0 0 24 24">
    <path d="M4 6h2v2H4zm0 5h2v2H4zm0 5h2v2H4zm4-10h12v2H8zm0 5h12v2H8zm0 5h12v2H8z" />
  </svg>`
);
IconRegistry.registerDefaultIcon('markers', html``); // Fallback to markers dot CSS styles
IconRegistry.registerDefaultIcon(
  'arrow-back',
  html`<svg viewBox="0 0 24 24"><path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z" /></svg>`
);
IconRegistry.registerDefaultIcon(
  'arrow-forward',
  html`<svg viewBox="0 0 24 24"><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z" /></svg>`
);
IconRegistry.registerDefaultIcon(
  'check',
  html`<svg class="check-icon" viewBox="0 0 24 24">
    <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
  </svg>`
);
IconRegistry.registerDefaultIcon(
  'audio-only',
  html`<svg viewBox="0 0 24 24">
    <path
      d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 14.5c-2.49 0-4.5-2.01-4.5-4.5S9.51 7.5 12 7.5s4.5 2.01 4.5 4.5-2.01 4.5-4.5 4.5zm0-5.5c-.55 0-1 .45-1 1s.45 1 1 1 1-.45 1-1-.45-1-1-1z"
    />
  </svg>`
);
IconRegistry.registerDefaultIcon(
  'speed-feedback',
  html`<svg viewBox="0 0 24 24">
    <path
      d="M20.38 8.57l-1.23 1.85a8 8 0 0 1-.22 7.58H5.07A8 8 0 0 1 15.58 8.57l1.23-1.85A10 10 0 0 0 2 17h20a10 10 0 0 0-1.62-8.43zM10.59 15.41a2 2 0 1 0 2.83 0 2 2 0 0 0-2.83 0z"
    />
  </svg>`
);
