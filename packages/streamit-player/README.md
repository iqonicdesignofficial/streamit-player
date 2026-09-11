# Streamit Player (`streamit-player`)

A high-performance, enterprise-grade video player SDK and Web Component for modern web applications. Featuring adaptive streaming (HLS & MPEG-DASH), multi-DRM protection (Widevine, PlayReady, FairPlay, ClearKey), comprehensive advertising monetization (VAST 2.0-4.2, VMAP, Google IMA, SIMID 1.0, HTML Overlays), Smart Seek filmstrip preview, live DVR, TikTok/Reels-style vertical feeds, and customizable glassmorphism theming.

---

## 📦 Installation

```bash
npm install streamit-player
```

npm (v7+) and pnpm also install the `hls.js` and `dashjs` peer dependencies automatically. With Yarn, add them yourself:

```bash
yarn add streamit-player hls.js dashjs
```

Both libraries are loaded on demand, only when an HLS or DASH source is played.

### CDN Installation (No Build Step)

#### Modern ESM (`<script type="module">`)
```html
<script type="module" src="https://cdn.jsdelivr.net/npm/streamit-player@1/dist/streamit-player.esm.min.js"></script>
```

#### Classic Script (`IIFE` global `window.StreamitPlayer`)
```html
<script src="https://cdn.jsdelivr.net/npm/streamit-player@1/dist/streamit-player.iife.min.js"></script>
```

The CDN bundles download `hls.js` and `dash.js` from jsDelivr the first time an HLS or DASH source plays. To self-host them instead (for example under a strict Content-Security-Policy), load their script builds **before** the player. A page-level `window.Hls` / `window.dashjs` is always used when present:

```html
<script src="https://cdn.jsdelivr.net/npm/hls.js@1/dist/hls.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/dashjs@5/dist/modern/umd/dash.all.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/streamit-player@1/dist/streamit-player.iife.min.js"></script>
```

---

## ⚡ Quick Start

The fastest way to get a player on the page, with no JavaScript required. The source type is detected from the URL (`.m3u8` → HLS, `.mpd` → DASH, otherwise progressive video):

```html
<script src="https://cdn.jsdelivr.net/npm/streamit-player@1/dist/streamit-player.iife.min.js"></script>

<streamit-player
  src="https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8"
  poster="https://example.com/poster.jpg"
  style="display: block; width: 100%; aspect-ratio: 16 / 9;"
></streamit-player>
```

Supported attributes include `src`, `poster`, `autoplay`, `muted`, `loop`, `playsinline`, `preload`, `crossorigin` and `captions`.

---

## 🚀 Package Architecture & Subpath Entry Points

The `streamit-player` package is distributed as a single npm package with clean, optimized subpath exports:

| Entry Point | Description | Lit / UI Included |
|---|---|---|
| `streamit-player` | **Default / All-in-One**: Registers `<streamit-player>` and `<player-player>` custom elements; exports `PlayerPlayer`, sub-components, and the full core API and types. | ✅ Yes |
| `streamit-player/core` | **Headless Playback Engine**: `PlayerController`, DRM manager, VAST/VMAP/IMA/SIMID ad engines, thumbnail providers, and all types. | ❌ **Zero Lit / UI** |
| `streamit-player/web-components` | **Lit Web Component Layer**: `<streamit-player>`, theme presets (`THEME_PRESETS`, `compileTheme`), icon registry (`renderIcon`), and sub-components. | ✅ Yes |

---

## ⚙️ Configuration, Sources & Events

Configuration is a flat object assigned to the element's `config` **property** (not an attribute). Sources are loaded with `loadSource()` (or `loadPlaylist()` for several items):

```js
const player = document.querySelector('streamit-player');

player.config = {
  autoplay: false,
  muted: false,
  volume: 0.8,
  poster: 'https://example.com/poster.jpg',
  theme: { preset: 'glass-dark' },
  drm: { widevine: { licenseUrl: 'https://license.example.com/widevine' } },
  ads: { enabled: true, provider: 'VAST', tagUrl: 'https://example.com/vast.xml' },
};

player.loadSource({
  type: 'hls', // 'hls' | 'dash' | 'mp4' | 'webm' | ...; detected from the URL when omitted
  src: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
  subtitles: [{ src: '/subs/en.vtt', label: 'English', srclang: 'en', default: true }],
});
```

Every player event is dispatched on the element as a bubbling `player-<name>` DOM event, with the payload in `event.detail`. You can also subscribe with `player.on()`:

```js
player.addEventListener('player-play', () => console.log('Playback started'));
player.addEventListener('player-timeupdate', (e) => console.log('Time:', e.detail.currentTime));

player.on('ended', () => console.log('Finished'));
```

For advanced control, `player.controllerInstance` returns the underlying headless `PlayerController`.

---

## 🛠️ Multi-Framework Integration Recipes

### 1. Plain HTML5 & Vanilla JavaScript

#### Modern ESM (no build step)
```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Streamit Player - Plain HTML</title>
  <style>
    .player-wrapper {
      max-width: 960px;
      margin: 40px auto;
      aspect-ratio: 16 / 9;
    }
    streamit-player {
      width: 100%;
      height: 100%;
      display: block;
    }
  </style>
</head>
<body>
  <div class="player-wrapper">
    <streamit-player id="my-player"></streamit-player>
  </div>

  <script type="module">
    import 'https://cdn.jsdelivr.net/npm/streamit-player@1/dist/streamit-player.esm.min.js';

    const player = document.getElementById('my-player');
    player.config = {
      poster: 'https://images.unsplash.com/photo-1536240478700-b869070f9279?w=1200',
      autoplay: false,
      muted: false,
      theme: { preset: 'glass-dark' }
    };
    player.loadSource({
      type: 'hls',
      src: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8'
    });

    player.addEventListener('player-play', () => console.log('Playback started'));
    player.addEventListener('player-timeupdate', (e) => console.log('Current time:', e.detail.currentTime));
  </script>
</body>
</html>
```

With a bundler (Vite, webpack, Rollup, …) use the package name instead: `import 'streamit-player';`.

#### Classic Script (IIFE)
```html
<script src="https://cdn.jsdelivr.net/npm/streamit-player@1/dist/streamit-player.iife.min.js"></script>
<streamit-player id="classic-player" style="width: 100%; aspect-ratio: 16/9; display: block;"></streamit-player>
<script>
  var player = document.getElementById('classic-player');
  player.loadSource({
    type: 'mp4',
    src: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4'
  });
</script>
```

---

### 2. React (18 & 19)

Assign objects such as `config` through a `ref` (React 18 would otherwise stringify them into attributes), and listen for `player-*` events with `addEventListener`:

```tsx
import { useEffect, useRef } from 'react';
import 'streamit-player';
import type { PlayerPlayer, PlayerConfiguration, PlayerSource } from 'streamit-player';

export interface StreamitVideoPlayerProps {
  src: string;
  type?: PlayerSource['type'];
  config?: PlayerConfiguration;
  onPlay?: () => void;
  className?: string;
}

export function StreamitVideoPlayer({ src, type, config, onPlay, className }: StreamitVideoPlayerProps) {
  const playerRef = useRef<PlayerPlayer>(null);

  useEffect(() => {
    if (playerRef.current && config) playerRef.current.config = config;
  }, [config]);

  useEffect(() => {
    playerRef.current?.loadSource({ src, type });
  }, [src, type]);

  useEffect(() => {
    const el = playerRef.current;
    if (!el || !onPlay) return;
    el.addEventListener('player-play', onPlay);
    return () => el.removeEventListener('player-play', onPlay);
  }, [onPlay]);

  return (
    <streamit-player
      ref={playerRef}
      className={className}
      style={{ display: 'block', width: '100%', aspectRatio: '16 / 9' }}
    />
  );
}
```

In React 19 you can also pass `config={config}` directly, because React 19 sets it as a property.

#### TypeScript: declaring the JSX element

TypeScript doesn't know about custom elements in JSX until you declare them. Add this file anywhere in your project (e.g. `src/streamit-player.d.ts`):

```ts
import type { DetailedHTMLProps, HTMLAttributes } from 'react';
import type { PlayerPlayer } from 'streamit-player';

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'streamit-player': DetailedHTMLProps<HTMLAttributes<PlayerPlayer>, PlayerPlayer> & {
        src?: string;
        poster?: string;
      };
    }
  }
}
```

---

### 3. Next.js (App Router & Pages Router)

The player registers custom elements when imported, so load it in the browser only, inside the `useEffect` of a client component:

#### Component (`components/StreamitPlayerClient.tsx`)
```tsx
'use client';

import { useEffect, useRef } from 'react';
import type { PlayerPlayer, PlayerConfiguration } from 'streamit-player';

export default function StreamitPlayerClient({ src, config }: { src: string; config?: PlayerConfiguration }) {
  const playerRef = useRef<PlayerPlayer>(null);

  useEffect(() => {
    let cancelled = false;
    import('streamit-player').then(() => {
      const el = playerRef.current;
      if (cancelled || !el) return;
      if (config) el.config = config;
      el.loadSource({ src });
    });
    return () => {
      cancelled = true;
    };
  }, [src, config]);

  return (
    <streamit-player
      ref={playerRef}
      style={{ display: 'block', width: '100%', aspectRatio: '16 / 9', borderRadius: '12px', overflow: 'hidden' }}
    />
  );
}
```

#### App Router Page (`app/watch/page.tsx`)
```tsx
import StreamitPlayerClient from '@/components/StreamitPlayerClient';

export default function WatchPage() {
  return (
    <main style={{ maxWidth: '1100px', margin: '40px auto', padding: '0 20px' }}>
      <h1>Now Watching</h1>
      <StreamitPlayerClient
        src="https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8"
        config={{ autoplay: true, muted: true, theme: { preset: 'glass-dark' } }}
      />
    </main>
  );
}
```

The same component works unchanged in the Pages Router. Add the JSX declaration from the React section for TypeScript.

---

### 4. Laravel (Blade with Vite)

1. **Install and import in your Vite entry point (`resources/js/app.js`):**
```javascript
import './bootstrap';
import 'streamit-player';
```

2. **Render the custom element in your Blade view (`resources/views/watch.blade.php`):**
```html
@extends('layouts.app')

@section('content')
<div class="max-w-5xl mx-auto py-8">
    <h1 class="text-2xl font-bold mb-4">{{ $video->title }}</h1>

    <div class="rounded-xl overflow-hidden shadow-2xl aspect-video bg-black">
        <streamit-player
            src="{{ $video->stream_url }}"
            poster="{{ $video->poster_url }}"
            style="display:block;width:100%;height:100%"
        ></streamit-player>
    </div>
</div>
@endsection
```

To pass a full `config` object from a script, wait until the element is registered:

```javascript
customElements.whenDefined('streamit-player').then(() => {
  document.querySelector('streamit-player').config = { volume: 0.8, theme: { preset: 'glass-dark' } };
});
```

---

### 5. Vue 3 (incl. Laravel Inertia)

Tell Vue that `streamit-*` tags are custom elements (`vite.config.js`):

```javascript
import vue from '@vitejs/plugin-vue';

export default {
  plugins: [
    vue({
      template: {
        compilerOptions: { isCustomElement: (tag) => tag.startsWith('streamit-') },
      },
    }),
  ],
};
```

Then use the element in a component (`resources/js/Pages/Watch.vue`):

```html
<template>
  <div class="player-container aspect-video w-full rounded-2xl overflow-hidden">
    <streamit-player
      ref="playerRef"
      :config.prop="config"
      style="display:block;width:100%;height:100%"
      @player-play="onPlay"
      @player-timeupdate="onTimeUpdate"
    />
  </div>
</template>

<script setup>
import { ref, onMounted, watch } from 'vue';
import 'streamit-player';

const props = defineProps({
  video: Object
});

const playerRef = ref(null);
const config = { autoplay: false, muted: false, theme: { preset: 'glass-dark' } };

const loadVideo = () => {
  playerRef.value?.loadSource({ src: props.video.url, type: props.video.type });
};

onMounted(loadVideo);
watch(() => props.video, loadVideo, { deep: true });

const onPlay = () => console.log('Playback started');
const onTimeUpdate = (e) => console.log('Time:', e.detail.currentTime);
</script>
```

---

### 6. WordPress (Classic PHP & Gutenberg)

#### WordPress Classic Theme / Shortcode (`functions.php`)
```php
<?php
// Enqueue the Streamit Player IIFE bundle from the CDN
function streamit_player_register_assets() {
    wp_register_script(
        'streamit-player',
        'https://cdn.jsdelivr.net/npm/streamit-player@1/dist/streamit-player.iife.min.js',
        array(),
        null,
        true
    );
}
add_action('wp_enqueue_scripts', 'streamit_player_register_assets');

// Register the [streamit_player src="..." poster="..." autoplay="true"] shortcode
function streamit_player_shortcode($atts) {
    wp_enqueue_script('streamit-player');

    $atts = shortcode_atts(array(
        'src'      => '',
        'poster'   => '',
        'autoplay' => 'false',
    ), $atts, 'streamit_player');

    // Browsers only allow autoplay when muted
    $autoplay = $atts['autoplay'] === 'true' ? ' autoplay muted' : '';

    return sprintf(
        '<div style="width:100%%;max-width:960px;margin:20px auto;aspect-ratio:16/9;">'
        . '<streamit-player src="%s" poster="%s"%s style="display:block;width:100%%;height:100%%;"></streamit-player>'
        . '</div>',
        esc_url($atts['src']),
        esc_url($atts['poster']),
        $autoplay
    );
}
add_shortcode('streamit_player', 'streamit_player_shortcode');
```

#### WordPress Gutenberg Custom HTML Block
Paste directly into a Gutenberg **Custom HTML** block:
```html
<script src="https://cdn.jsdelivr.net/npm/streamit-player@1/dist/streamit-player.iife.min.js"></script>

<div style="width: 100%; aspect-ratio: 16/9; max-width: 900px; margin: 0 auto; border-radius: 12px; overflow: hidden;">
  <streamit-player
    src="https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8"
    style="width: 100%; height: 100%; display: block;"
  ></streamit-player>
</div>
```

---

### 7. Headless & Core-Only TypeScript (Zero Lit / Custom UI)

Build your own bespoke UI around the headless engine without including any Lit or Web Component DOM overhead:

```typescript
import { PlayerController } from 'streamit-player/core';
import type { PlayerConfiguration, PlayerState } from 'streamit-player/core';

// Reference your existing HTML5 <video> element
const videoElement = document.getElementById('my-video') as HTMLVideoElement;

const config: PlayerConfiguration = {
  autoplay: false,
  drm: {
    widevine: {
      licenseUrl: 'https://license.widevine.com/cenc/getlicense'
    }
  },
  ads: {
    enabled: true,
    provider: 'VAST',
    tagUrl: 'https://pubads.g.doubleclick.net/gampad/ads?iu=...'
  }
};

// Initialize headless engine
const controller = new PlayerController(videoElement, config);

// Subscribe to state changes (returns an unsubscribe function)
const unsubscribe = controller.onStateChange((state: PlayerState) => {
  console.log('Status:', state.status, '| playing:', state.isPlaying);
  console.log('Position:', state.currentTime, '/', state.duration);
  console.log('Quality levels:', state.qualities);
  console.log('Audio tracks:', state.audioTracks);
});

// Load a source and control playback
controller.loadSource({
  type: 'hls',
  src: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8'
});
controller.play();
controller.seek(45.5);
controller.setVolume(0.75);

// Teardown when done
// unsubscribe();
// controller.destroy();
```

---

## 🎨 Theming & CSS Custom Properties

Streamit Player ships four theme presets (`glass-dark`, `glass-light`, `dark`, `light`). Pick one and override individual values through `config.theme`:

```js
player.config = {
  theme: {
    preset: 'glass-dark',
    primaryColor: '#3b82f6',
    accentColor: '#60a5fa',
    borderRadius: '12px',
    fontFamily: "'Inter', system-ui, sans-serif",
    // Any CSS custom property can be set directly:
    customVariables: { '--player-seekbar-played': '#3b82f6' }
  }
};
```

Without a `theme` object you can style the player from your own CSS with its `--player-*` custom properties (more than 60 are available):

```css
streamit-player {
  --player-primary-color: #3b82f6;
  --player-accent-color: #60a5fa;
  --player-seekbar-played: #3b82f6;
  --player-seekbar-buffer: rgba(255, 255, 255, 0.4);
  --player-glass-blur: 16px;
  --player-border-radius: 12px;
  --player-font-family: 'Inter', system-ui, sans-serif;
}
```

Values from `config.theme` are written inline on the element, so they take precedence over stylesheet rules.

---

## 🏷️ Tag Name Aliases

`<player-player>` and all `player-*` sub-component tag names (`<player-play-button>`, `<player-seekbar>`, `<player-volume-control>`, etc.) are registered as aliases of their `streamit-*` equivalents.

---

## 📄 License

[Apache-2.0](./LICENSE)
