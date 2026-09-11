# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Commands

This is an npm workspaces monorepo (root `package.json` has `workspaces: ["packages/*", "apps/*"]`). Run commands from the repo root unless noted.

```bash
npm install                          # install all workspace deps
npm run dev                          # runs the sandbox app's vite dev server (apps/sandbox)
npm run build                        # builds all workspaces that have a build script (core, web-components, sandbox)
npm run format                       # prettier --write across ts/json/css/html/md
```

Per-package builds (each package builds independently via its own `vite build`):
```bash
npm run build -w @player/core
npm run build -w @player/web-components
npm run build -w @player/sandbox
```

There is no `lint` script wired up in `package.json` despite `.eslintrc.json` existing; run ESLint directly if needed: `npx eslint packages apps --ext .ts`.

TypeScript is strict (`strict: true`) with `experimentalDecorators` enabled (required for Lit's `@property`/`@state` decorators used throughout `packages/web-components`).

## Architecture

Three workspace packages with a hard dependency direction: `@player/core` → `@player/web-components` → `@player/sandbox` (demo app). `@player/core` has **zero UI dependencies** and must stay that way - it's designed to be driven by any UI layer, not just the bundled web components.

### `packages/core` - headless playback engine

- **`PlayerController.ts`** is the single source of truth. It owns the `<video>` element, holds all `PlayerState`, and exposes every playback API (`play`, `seek`, `setVolume`, playlist management, live/DVR, subtitles, chapters/markers, sleep timer, Media Session integration, plugin system). UI layers subscribe via `controller.onStateChange(callback)`; state updates are diffed per-key (`isStateValueEqual`) before firing callbacks to avoid redundant re-renders.
- **`SourceManager.ts`** dispatches to per-protocol `SourceHandler` implementations - `Mp4Handler`, `HlsHandler` (hls.js, lazy-imported), `DashHandler` (dash.js, lazy-imported), `EmbedHandler` (YouTube/Vimeo iframe embeds). Each handler independently wires up DRM, quality switching, and audio-track deduplication, and has its own retry/recovery logic for network/media errors.
- **`DrmManager.ts`** supports Widevine, PlayReady, FairPlay (including legacy prefixed WebKit APIs), and ClearKey. It monkey-patches `MediaKeys.prototype.createSession` and `HTMLVideoElement.prototype.setMediaKeys` at module load time (via module-level `WeakMap`s) so it can intercept EME sessions created internally by hls.js/dash.js, which don't expose session objects directly.
- **Ads subsystem** (`AdsManager.ts`, `AdsController.ts`, `providers/VastProvider.ts`, `providers/VmapProvider.ts`, `providers/ImaProvider.ts`, `simid/`, `html-overlay/`): `AdsManager` runs a strict `AdState` transition table and uses `ContentSnapshot` to capture/restore full playback state around ad breaks. Ads suppress normal playback via the `PlaybackInterceptor` interface - `PlayerController.play/pause/seek/setVolume/setMuted` all check registered interceptors first, and `AdsManager` swallows the call while `isInterceptionActive` is true. `VastProvider`/`VmapProvider` are hand-rolled namespace-aware XML parsers (no third-party VAST library). `simid/` implements the SIMID interactive-ad protocol over a sandboxed iframe + postMessage bridge (`SimidBridge`) with origin allowlisting.
- **`providers/ThumbnailProviders.ts`** implements the "Smart Seek" filmstrip: `VideoFrameThumbnailProvider` does on-the-fly canvas frame capture from a hidden video element (lazy-loads hls.js/dashjs as needed), plus `VTTThumbnailProvider`, `SpriteThumbnailProvider`, and an `AutoThumbnailProvider` that picks the best strategy from config.
- **`types.ts`** is the entire public contract (`PlayerState`, `PlayerConfiguration`, `PlayerEvents`, ads/DRM/subtitle types) - check here first when adding a new config option or event.

### `packages/web-components` - Lit-based UI

- **`Player.ts`** (`<player-player>`) is the largest file by far and is a thin reactive shell around `PlayerController`: it subscribes to controller state and re-renders, but owns UI-only concerns that don't belong in core - gesture handling (long-press-to-speed with a lock/unlock state machine, double-tap seek, swipe-to-navigate), the canvas-based double-buffer crossfade transition for vertical-feed playlist swiping, the multi-screen settings menu stack (`activeMenuScreen`), thumbnail preloading/eviction cache, idle-callback-scheduled prefetching of the next/previous playlist source, and theme application (`compileTheme()` → CSS custom properties on the host).
- Sub-components (`Seekbar.ts`, `VolumeControl.ts`, `PlayButton.ts`, `SeekButton.ts`, `ChaptersButton.ts`, `VerticalControls.ts`) are self-contained Lit elements that receive a `.player` property (for icon/localization lookups) and communicate upward via bubbling, composed `player-*` CustomEvents that `Player.ts` listens for - they never call the controller directly.
- **`Themes.ts`** defines 4 presets (`light`/`dark`/`glass-dark`/`glass-light`); `compileTheme()` merges a preset with per-property overrides into a flat `--player-*` CSS-var map.
- **`icons/IconRegistry.ts`** has a static default-icon registry plus a per-instance `PlayerIconRegistry` for overrides/icon-packs. Icon values can be a string, Lit `TemplateResult`, `Element`, or a function - always go through `renderIcon()`.
- Extension points for consumers: `registerControl`, `registerOverlay`/`setOverlayTemplate`, `registerSettingsItem`/`registerSettingsScreen`, `registerContextMenuItem`, and the `PlayerPlugin` interface (`getControlButtons`, `renderSettingsScreen`, `getSettingsItems`, lifecycle hooks).

### `apps/sandbox`

Demo/manual-test harness (`main.ts`) exercising every feature - source type switching, playlists, live/DVR modes, DRM, all four ad provider types, chapters/markers, subtitle appearance, and telemetry/metadata event logging. Useful as a reference for how the public API is meant to be consumed end-to-end.

## Key cross-cutting patterns

- User preferences (volume, mute, loop, playback rate, subtitle language/appearance, audio language) persist to `localStorage` through a `safeStorage` wrapper in `PlayerController.ts` that no-ops safely when `localStorage` is unavailable.
- Network code with retry semantics (VAST/VMAP fetch, DRM license/certificate fetch) uses hand-rolled exponential backoff plus `AbortController`s tied to a per-instance `destroyAbortController`, so in-flight requests are cancelled cleanly on destroy/source-change.
- Live streaming behavior (`live-only` vs `live-dvr`) is driven entirely by what the HLS/DASH manifest reports (`dvrWindow`, `seekableRange`) - the player never fabricates DVR history locally, and falls back to `live-only` if the manifest exposes no DVR window.
