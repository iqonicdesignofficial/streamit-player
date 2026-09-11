# NPM Distribution Readiness - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Take `@player/core` + `@player/web-components` from "5/10, not ready" to "10/10, ready for public npm distribution" by closing every gap named in the prior audit: zero tests, no CI, 205 `: any` occurrences, two god-object files, missing publish metadata, no CHANGELOG, and undocumented React/Next.js integration.

**Architecture:** Work proceeds in strict dependency order: (1) test infrastructure must exist before (2) any refactor of `PlayerController.ts`/`Player.ts`, because those files currently have zero regression coverage and are the two largest, highest-risk files in the repo. Metadata/CI/docs tasks have no code-risk and can run in parallel with the test-writing phase. `any`-elimination runs last, after the split, so type fixes land in the smaller post-split files rather than being redone twice.

**Tech Stack:** Vitest (unit/integration - pairs cleanly with the existing Vite build, unlike Jest which needs extra ESM config), `@open-wc/testing-helpers` + `jsdom` for Lit component tests, GitHub Actions for CI.

**Spec:** The audit report pasted into this conversation on 2026-08-24 (no separate file - the report text is the spec; see conversation history for full text). Confirmed decisions from user: tests-first before splitting god objects; full `any` elimination (not a prioritized subset); one commit per fixed issue; license = Apache-2.0; author/repo pulled from `git config user.name` (`Iqonic Design`) and `git remote -v` (`https://github.com/iqonicdesignofficial/streamit-player`).

## Global Constraints

- TypeScript `strict: true` must stay on (`tsconfig.json`) - no task may weaken it to make typing easier.
- `packages/core` must keep **zero UI dependencies** - tests for core go in `packages/core`, never import Lit.
- Every `customElements.define(...)` guard pattern (`typeof window !== 'undefined' && typeof customElements !== 'undefined' && !customElements.get(...)`) must remain intact through the `Player.ts` split - this is the repo's actual SSR-safety mechanism and the audit specifically praised it.
- No dependency version changes to `hls.js`, `dashjs`, or `lit` as part of this plan - those are unrelated upgrades.
- One commit per task (per user decision), each with a message describing the audit issue it closes, e.g. `test: add TimelineMath unit coverage`.
- Do not run `npm publish` at any point in this plan - that is a separate, explicit action the user has not authorized.

---

## Phase 1 - Foundation (no code-risk, parallelizable)

### Task 1: Vitest test infrastructure

**Files:**
- Create: `vitest.config.ts` (root)
- Create: `packages/core/vitest.config.ts`
- Create: `packages/web-components/vitest.config.ts`
- Modify: `package.json` (root) - add `"test"` script and devDependencies
- Modify: `packages/core/package.json` - add `"test"` script
- Modify: `packages/web-components/package.json` - add `"test"` script
- Create: `packages/core/src/__tests__/setup.smoke.test.ts` (placeholder to verify the harness runs)

**Interfaces:**
- Produces: `npm test` (root) runs all workspace tests via `npm run test --workspaces --if-present`. `npm run test -w @player/core` and `-w @player/web-components` run per-package.

- [ ] **Step 1: Install devDependencies**

```bash
npm install -D vitest @vitest/coverage-v8 jsdom @open-wc/testing-helpers -w @player/core -w @player/web-components
npm install -D vitest -D
```

- [ ] **Step 2: Root `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
  },
});
```

- [ ] **Step 3: `packages/core/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
    },
  },
});
```

- [ ] **Step 4: `packages/web-components/vitest.config.ts`** (same shape, `environment: 'jsdom'`, `include: ['src/**/*.test.ts']`)

- [ ] **Step 5: Add scripts**

Root `package.json` scripts block gains:
```json
"test": "npm run test --workspaces --if-present"
```
Each package's `package.json` scripts block gains:
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 6: Placeholder smoke test**

```ts
// packages/core/src/__tests__/setup.smoke.test.ts
import { describe, it, expect } from 'vitest';

describe('test harness', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 7: Run `npm test -w @player/core` and confirm the placeholder passes, then delete the placeholder file once Task 4 lands (it's superseded by real coverage).**

- [ ] **Step 8: Commit**

```bash
git add vitest.config.ts packages/core/vitest.config.ts packages/web-components/vitest.config.ts package.json packages/core/package.json packages/web-components/package.json packages/core/src/__tests__/setup.smoke.test.ts
git commit -m "test: add Vitest infrastructure to root and both packages"
```

---

### Task 2: LICENSE + package.json publish metadata

**Files:**
- Create: `LICENSE` (repo root)
- Modify: `packages/core/package.json`
- Modify: `packages/web-components/package.json`

**Interfaces:** none (metadata-only, no code contract).

- [ ] **Step 1: Create `LICENSE`** - standard Apache License 2.0 text, copyright line:
```
Copyright 2026 Iqonic Design
```
(Use the canonical Apache-2.0 text from https://www.apache.org/licenses/LICENSE-2.0.txt - copy verbatim, do not paraphrase a legal license.)

- [ ] **Step 2: Add fields to `packages/core/package.json`** (insert after `"version"`):

```json
"description": "Headless, framework-agnostic video playback engine with HLS/DASH/DRM, VAST/VMAP/SIMID ads, and Smart Seek thumbnails.",
"license": "Apache-2.0",
"author": "Iqonic Design",
"repository": {
  "type": "git",
  "url": "git+https://github.com/iqonicdesignofficial/streamit-player.git",
  "directory": "packages/core"
},
"homepage": "https://github.com/iqonicdesignofficial/streamit-player#readme",
"bugs": {
  "url": "https://github.com/iqonicdesignofficial/streamit-player/issues"
},
"keywords": ["video", "player", "hls", "dash", "drm", "vast", "vmap", "ads", "headless", "player-sdk"]
```

- [ ] **Step 3: Add equivalent fields to `packages/web-components/package.json`**, with `"description"` changed to: `"Lit-based Custom Elements UI layer for @player/core - drop-in <player-player> web component with theming, plugins, and gesture controls."`, `"directory": "packages/web-components"`, and `"keywords"` extended with `"web-components", "lit", "custom-elements"`.

- [ ] **Step 4: Verify `npm publish --dry-run -w @player/core` and `-w @player/web-components` no longer warn about missing license/repository fields.**

- [ ] **Step 5: Commit**

```bash
git add LICENSE packages/core/package.json packages/web-components/package.json
git commit -m "chore: add LICENSE and npm publish metadata (license, repository, keywords, author)"
```

---

### Task 3: CHANGELOG.md

**Files:**
- Create: `CHANGELOG.md`

- [ ] **Step 1:** Follow [Keep a Changelog](https://keepachangelog.com) format. Seed it from `git log --oneline -20` grouped into an `[Unreleased]` section reflecting the current `1.0.0` state, plus this plan's own entries as they land (Added: test suite, CI; Changed: PlayerController/Player.ts split; Fixed: any-elimination is not user-facing, omit). Keep each entry to one line, dated by the commit that introduced it.

- [ ] **Step 2: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: add CHANGELOG.md"
```

---

## Phase 2 - Safety-net tests (must land before Phase 3 splits)

### Task 4: Unit tests - `TimelineMath.ts`

**Files:**
- Test: `packages/core/src/TimelineMath.test.ts`

- [ ] **Step 1: Write tests covering every static method** (`timeToPercent`, `percentToTime`, `clampToSeekable`, `isMarkerVisible`, `isWithinSeekable`, `shouldPruneMarker`), including boundary cases (`range <= 0`, time before/after seekable window):

```ts
import { describe, it, expect } from 'vitest';
import { TimelineMath } from './TimelineMath';

describe('TimelineMath', () => {
  it('timeToPercent maps mid-range time to 50%', () => {
    expect(TimelineMath.timeToPercent(5, 0, 10)).toBe(50);
  });
  it('timeToPercent clamps below start to 0', () => {
    expect(TimelineMath.timeToPercent(-5, 0, 10)).toBe(0);
  });
  it('timeToPercent clamps above end to 100', () => {
    expect(TimelineMath.timeToPercent(15, 0, 10)).toBe(100);
  });
  it('timeToPercent returns 0 when range is zero or negative', () => {
    expect(TimelineMath.timeToPercent(5, 10, 10)).toBe(0);
    expect(TimelineMath.timeToPercent(5, 10, 5)).toBe(0);
  });
  it('percentToTime is the inverse of timeToPercent', () => {
    expect(TimelineMath.percentToTime(50, 0, 10)).toBe(5);
  });
  it('clampToSeekable clamps both directions', () => {
    expect(TimelineMath.clampToSeekable(-1, 0, 10)).toBe(0);
    expect(TimelineMath.clampToSeekable(11, 0, 10)).toBe(10);
    expect(TimelineMath.clampToSeekable(5, 0, 10)).toBe(5);
  });
  it('isMarkerVisible / isWithinSeekable agree on boundary inclusivity', () => {
    expect(TimelineMath.isMarkerVisible(0, 0, 10)).toBe(true);
    expect(TimelineMath.isMarkerVisible(10, 0, 10)).toBe(true);
    expect(TimelineMath.isMarkerVisible(10.01, 0, 10)).toBe(false);
  });
  it('shouldPruneMarker is true only when marker precedes seekable start', () => {
    expect(TimelineMath.shouldPruneMarker(-1, 0)).toBe(true);
    expect(TimelineMath.shouldPruneMarker(0, 0)).toBe(false);
  });
});
```

- [ ] **Step 2: Run `npm run test -w @player/core -- TimelineMath` and confirm all pass.**
- [ ] **Step 3: Commit** - `git commit -m "test: add TimelineMath unit coverage"`

---

### Task 5: Unit tests - `utils.ts`

**Files:**
- Test: `packages/core/src/utils.test.ts`

- [ ] **Step 1: Cover all five exports** - `formatTime` (sub-hour vs `forceHours`, negative/zero input), `isSameOriginAsHost` (same-origin URL, cross-origin URL, malformed URL, `null`/`undefined`), `defaultHtmlSanitizer` (strips `<script>`, strips `on*` attributes, preserves safe tags), `resolveSafeSandbox`, `sanitizeAndConvertEmbedUrl` (YouTube/Vimeo URL normalization, rejects `javascript:` URLs). Read `packages/core/src/utils.ts` in full first to match actual behavior - do not assume implementation details not in the source.
- [ ] **Step 2: Run and confirm passing.**
- [ ] **Step 3: Commit** - `git commit -m "test: add utils.ts unit coverage"`

---

### Task 6: Unit tests - `KeyboardManager.ts`

**Files:**
- Test: `packages/core/src/KeyboardManager.test.ts`

- [ ] **Step 1: Read `packages/core/src/KeyboardManager.ts` in full**, identify its public API (key binding registration, event dispatch to bound actions, destroy/cleanup).
- [ ] **Step 2: Write tests using a `jsdom` `KeyboardEvent` dispatched on a mock target**, asserting the correct player action fires for each default keybinding (space=toggle play, arrow keys=seek, `m`=mute, `f`=fullscreen, etc. - verify actual bindings in source, don't guess) and that unbound keys are ignored, and that `destroy()` removes the listener (dispatch after destroy → no action fires).
- [ ] **Step 3: Run and confirm passing.**
- [ ] **Step 4: Commit** - `git commit -m "test: add KeyboardManager unit coverage"`

---

### Task 7: Unit tests - VAST/VMAP XML parsers

**Files:**
- Test: `packages/core/src/providers/VastProvider.test.ts`
- Test: `packages/core/src/providers/VmapProvider.test.ts`
- Create fixtures: `packages/core/src/providers/__fixtures__/vast-linear.xml`, `vast-wrapper.xml`, `vast-nonlinear.xml`, `vmap-basic.xml`, `vmap-multiple-breaks.xml`

**Interfaces:**
- Consumes: whatever public parse entry point `VastProvider`/`VmapProvider` expose (read the files first - do not assume method names).

- [ ] **Step 1: Read both provider files in full** to find their public parse method signatures and returned ad-model shape (check `types.ts` for the VAST/VMAP-related interfaces).
- [ ] **Step 2: Write realistic golden-file fixtures** for: a single linear VAST ad, a VAST wrapper (redirect) response, a non-linear VAST ad, a VMAP document with one ad break, a VMAP document with pre-roll + mid-roll + post-roll breaks. Use real VAST 4.x / VMAP 1.0.1 XML structure (IAB spec shape - `<VAST><Ad><InLine>...`).
- [ ] **Step 3: Write parser tests asserting the parsed model matches expected ad break count, media file URLs, tracking URIs, and skip-offset**, plus a malformed-XML case that the parser should reject/error on without throwing an uncaught exception.
- [ ] **Step 4: Run and confirm passing.**
- [ ] **Step 5: Commit** - `git commit -m "test: add VAST/VMAP parser coverage with golden fixtures"`

---

### Task 8: Unit tests - `DrmManager.ts` SSR guard + ClearKey path

**Files:**
- Test: `packages/core/src/DrmManager.test.ts`

- [ ] **Step 1: Read `packages/core/src/DrmManager.ts` in full**, focusing on the `typeof window === 'undefined'` guard and `isCreateSessionPatched` flag described in CLAUDE.md.
- [ ] **Step 2: Write a Node-environment (`environment: 'node'`, override via a `// @vitest-environment node` docblock at the top of this test file) test that imports `DrmManager` with no `window`/`MediaKeys` global present and asserts the import does not throw** - this is the actual regression the audit praised; it needs a test that runs in a genuinely window-less environment, not jsdom (which fakes `window`).
- [ ] **Step 3: In a separate jsdom-environment test, verify `isCreateSessionPatched`-style idempotency - calling whatever triggers the monkey-patch twice does not double-patch** (read source to find the exact re-entry guard).
- [ ] **Step 4: Write tests for the ClearKey DRM path** (the one DRM system that doesn't require external license servers - construct a ClearKey config, verify it maps to the correct EME `initDataType`/key format per the code).
- [ ] **Step 5: Run and confirm passing.**
- [ ] **Step 6: Commit** - `git commit -m "test: add DrmManager SSR-guard and ClearKey coverage"`

---

### Task 9: SSR/Node import smoke tests (both packages)

**Files:**
- Test: `packages/core/src/__tests__/ssr-smoke.test.ts` (`// @vitest-environment node`)
- Test: `packages/web-components/src/__tests__/ssr-smoke.test.ts` (`// @vitest-environment node`)

- [ ] **Step 1: In the core smoke test, `import` the package's main entry (`../index`) and assert it does not throw** in a window-less Node environment.
- [ ] **Step 2: In the web-components smoke test, `import` `../index` (which triggers every `customElements.define` call across all 7 components) in a window-less Node environment and assert no throw** - this directly validates the guard pattern CLAUDE.md and the audit both call out as the repo's main SSR-safety mechanism.
- [ ] **Step 3: Run both and confirm passing.**
- [ ] **Step 4: Commit** - `git commit -m "test: add SSR/Node import smoke tests for core and web-components"`

---

### Task 10: Integration tests - `PlayerController` state diffing and playback API

**Files:**
- Test: `packages/core/src/PlayerController.test.ts`

**Interfaces:**
- Consumes: `new PlayerController(video: HTMLVideoElement, config?: PlayerConfiguration)`, `.onStateChange(cb)`, `.getState()`, `.play()`, `.pause()`, `.seek(time)`, `.setVolume(v)`, `.setMuted(m)`, `.destroy()` (all confirmed present in the source at the line numbers found during audit: `play` L1999, `pause` L2044, `seek` L2066, `setVolume` L2145).

- [ ] **Step 1: Set up a jsdom test harness** - create a real `<video>` element via `document.createElement('video')`, stub `HTMLMediaElement.prototype.play`/`pause`/`load` (jsdom doesn't implement real media playback), construct `new PlayerController(video, { sources: [{ src: 'test.mp4', type: 'video/mp4' }] })`.
- [ ] **Step 2: Test `onStateChange` per-key diffing** - subscribe a spy callback, trigger a state change that only touches `currentTime`, assert the callback fires with only `currentTime` in the changed keys (per `isStateValueEqual` diffing described in CLAUDE.md - read `updateState` at L697 to confirm exact behavior), and assert calling `updateState` with identical values does NOT fire the callback again.
- [ ] **Step 3: Test `play()`/`pause()`/`seek()`/`setVolume()`/`setMuted()` update state and call through to the underlying `<video>` element's stubbed methods.**
- [ ] **Step 4: Test the unsubscribe function returned by `onStateChange`** actually stops future callbacks.
- [ ] **Step 5: Test `destroy()`** removes event listeners (dispatch a `timeupdate` event on the video after destroy, assert no state-change callback fires).
- [ ] **Step 6: Run and confirm passing.**
- [ ] **Step 7: Commit** - `git commit -m "test: add PlayerController state-diffing and playback API coverage"`

---

### Task 11: Integration tests - `PlayerController` playlist API

**Files:**
- Test: `packages/core/src/PlayerController.playlist.test.ts`

- [ ] **Step 1: Cover `loadPlaylist`, `next`/`previous`, `appendPlaylistItem`, `insertPlaylistItem`, `removePlaylistItem`, `clearPlaylist`, `replacePlaylistItem`, `movePlaylistItem`, `isFirstPlaylistItem`/`isLastPlaylistItem`, and repeat-mode behavior (`setPlaylistRepeatMode('repeat-all')` wraps `next()` from last item back to first).** These are the exact methods that Task 13 will extract into `PlaylistManager.ts` - this coverage is what makes that extraction safe.
- [ ] **Step 2: Run and confirm passing.**
- [ ] **Step 3: Commit** - `git commit -m "test: add PlayerController playlist API coverage"`

---

### Task 12: Integration tests - `PlayerController` subtitle + PiP API

**Files:**
- Test: `packages/core/src/PlayerController.subtitles.test.ts`
- Test: `packages/core/src/PlayerController.pip.test.ts`

- [ ] **Step 1: Cover `loadCaptions`, `toggleCaptions`, `setSubtitleTrack`, `disableSubtitles`, `hasSubtitles`, `getSubtitleTracks`, `getActiveSubtitleTrack`, `getSubtitleAppearance`/`setSubtitleAppearance`/`resetSubtitleAppearance`** (persistence to `localStorage` via `safeStorage` - mock `localStorage` and assert appearance persists across a new controller instance).
- [ ] **Step 2: Cover `isPictureInPictureSupported`, `enterPictureInPicture`, `exitPictureInPicture`, `togglePictureInPicture`** - stub `video.requestPictureInPicture`/`document.exitPictureInPicture` since jsdom doesn't implement PiP.
- [ ] **Step 3: Run and confirm passing.**
- [ ] **Step 4: Commit** - `git commit -m "test: add PlayerController subtitle and Picture-in-Picture coverage"`

---

### Task 13: Component tests - `Seekbar.ts`

**Files:**
- Test: `packages/web-components/src/Seekbar.test.ts`

- [ ] **Step 1: Read `packages/web-components/src/Seekbar.ts` in full** (per CLAUDE.md: "interactive timeline, marker support, and drag-to-seek" - this is the most recently modified component per git log, `efda242`, so it's the highest-value target for regression coverage before any refactor touches shared code it depends on).
- [ ] **Step 2: Using `@open-wc/testing-helpers`' `fixture()`, render `<player-seekbar>` with a `.player` property set to a minimal fake controller**, and test: pointer-down + pointer-move simulates drag-to-seek and dispatches the correct `player-seek` CustomEvent with the computed time; marker elements render at the correct percent position for a given `TimelineMarker[]`; keyboard arrow-key interaction (if present in source) adjusts position.
- [ ] **Step 3: Run and confirm passing.**
- [ ] **Step 4: Commit** - `git commit -m "test: add Seekbar drag-to-seek and marker rendering coverage"`

---

## Phase 3 - God-object splits (only after Phase 2 lands)

### Task 14: Split `PlayerController.ts` into lifecycle core + 3 managers

**Files:**
- Modify: `packages/core/src/PlayerController.ts` (shrinks - keeps constructor, state machine, `onStateChange`/`updateState`, `play`/`pause`/`seek`/`setVolume`/`setMuted`/`setPlaybackRate`, `loadSource`, `destroy`)
- Create: `packages/core/src/PlaylistManager.ts` (playlist methods currently at L855–L1210: `loadPlaylist`, `next`, `previous`, `appendPlaylistItem`, `insertPlaylistItem`, `removePlaylistItem`, `clearPlaylist`, `replacePlaylistItem`, `movePlaylistItem`, `setPlaylistRepeatMode`, `checkPlaylistNearEnd`, etc.)
- Create: `packages/core/src/SubtitleManager.ts` (subtitle methods at L1766–L1814 and L2677–L2771: `setManagedSubtitleTracks`, `refreshSubtitleTracks`, `loadCaptions`, `toggleCaptions`, `setSubtitleTrack`, `disableSubtitles`, subtitle appearance persistence)
- Create: `packages/core/src/PictureInPictureManager.ts` (L2227–L2277: `isPictureInPictureSupported`, `enterPictureInPicture`, `exitPictureInPicture`, `togglePictureInPicture`)
- Modify: `packages/core/vite.config.ts` - add new entry points for the extracted managers (matching the existing subpath-export pattern already used for `KeyboardManager`, `DrmManager`, etc.)
- Modify: `packages/core/package.json` - add `exports` subpaths for the three new managers
- Modify: `packages/core/src/index.ts` - re-export the new manager classes if they're meant to be part of the public API (check whether current callers only ever go through `PlayerController` - if so, these can stay internal and just be imported by `PlayerController.ts`, not re-exported; default to **not exporting** unless something outside `PlayerController.ts` already needs them)

**Interfaces:**
- Each manager takes the owning `PlayerController` instance (or the minimal subset it needs - prefer passing `{ getState, updateState, video }` accessors over the whole controller, to keep the manager's dependency surface explicit) via constructor.
- `PlayerController` delegates: `controller.next()` becomes `this.playlistManager.next()`, etc. - **public method names and signatures on `PlayerController` must not change**, since Task 10/11/12's tests assert against the current public API and external consumers depend on it.

- [ ] **Step 1: Run the full Phase 2 test suite (`npm run test -w @player/core`) and confirm 100% pass before starting the split** - this is the safety net; do not proceed if anything is red.
- [ ] **Step 2: Extract `PlaylistManager.ts` first** (smallest, most self-contained seam). Move the playlist-related private state (`playlist`, `currentPlaylistIndex`, `historyStack`, `nearEndThreshold`, `playlistRepeatMode`) and all playlist methods into the new class. Replace each `PlayerController` playlist method with a one-line delegation.
- [ ] **Step 3: Run `npm run test -w @player/core -- PlayerController.playlist` - confirm still green.**
- [ ] **Step 4: Extract `SubtitleManager.ts`** the same way, using Task 12's subtitle tests as the safety net.
- [ ] **Step 5: Run `npm run test -w @player/core -- PlayerController.subtitles` - confirm still green.**
- [ ] **Step 6: Extract `PictureInPictureManager.ts`** the same way, using Task 12's PiP tests as the safety net.
- [ ] **Step 7: Run `npm run test -w @player/core -- PlayerController.pip` - confirm still green.**
- [ ] **Step 8: Run the ENTIRE core test suite (`npm run test -w @player/core`) to catch any cross-manager regression, and `npm run build -w @player/core` to confirm the TypeScript still compiles clean and the vite-plugin-dts output is well-formed.**
- [ ] **Step 9: Confirm `PlayerController.ts` line count dropped substantially** (`wc -l packages/core/src/PlayerController.ts` - target under 2,500 lines; document the actual resulting count in the commit message).
- [ ] **Step 10: Commit**

```bash
git add packages/core/src/PlayerController.ts packages/core/src/PlaylistManager.ts packages/core/src/SubtitleManager.ts packages/core/src/PictureInPictureManager.ts packages/core/vite.config.ts packages/core/package.json
git commit -m "refactor: split PlayerController.ts into lifecycle core + PlaylistManager/SubtitleManager/PictureInPictureManager"
```

---

### Task 15: Split `Player.ts` into shell + 4 UI-concern modules

**Files:**
- Modify: `packages/web-components/src/Player.ts` (shrinks - keeps the Lit component shell, `render()`, controller subscription, and composition of the extracted pieces)
- Create: `packages/web-components/src/player-internals/GestureController.ts` (long-press-to-speed lock/unlock state machine, double-tap seek, swipe-to-navigate)
- Create: `packages/web-components/src/player-internals/SettingsMenuController.ts` (multi-screen settings menu stack / `activeMenuScreen`)
- Create: `packages/web-components/src/player-internals/ThumbnailCache.ts` (thumbnail preloading/eviction cache)
- Create: `packages/web-components/src/player-internals/PrefetchController.ts` (idle-callback-scheduled prefetching of next/previous playlist source)
- Modify: `packages/web-components/vite.config.ts` - these are internal to `Player.ts`, not new public subpath exports (they don't need `exports` entries unless a consumer already imports them directly - check first)

**Interfaces:**
- Each extracted controller takes the `Player` Lit element instance (or a narrow interface into it - e.g. `GestureController` needs the host element for event dispatch and the current `PlayerController` for seek/rate calls, not the whole `Player` class) via constructor, and exposes the specific event handlers `Player.ts` currently wires up inline (e.g. `onPointerDown`, `onPointerMove`, `onPointerUp` for gestures).
- `Player.ts`'s public API (attributes/properties/events it exposes to consumers) must not change.

- [ ] **Step 1: Before extracting, add characterization tests for the crossfade transition and gesture state machine if Phase 2 didn't already cover them** - read `Player.ts` in full first to confirm what's genuinely covered by Task 13's Seekbar tests (nothing, since Seekbar is a separate component) versus what's still untested. If gesture/crossfade logic has zero coverage, write focused tests for it here before extracting (same pattern as Task 13: `fixture()` + simulated pointer events, asserting dispatched events / DOM state).
- [ ] **Step 2: Extract `ThumbnailCache.ts` first** (least entangled with rendering - pure cache logic with an eviction policy).
- [ ] **Step 3: Run the web-components test suite, confirm green, then extract `PrefetchController.ts`.**
- [ ] **Step 4: Run tests, confirm green, then extract `SettingsMenuController.ts`** (the menu-stack state machine - keep its rendering templates in `Player.ts` if Lit's `html` templating makes clean separation of state-vs-template impractical; extract state/transition logic at minimum).
- [ ] **Step 5: Run tests, confirm green, then extract `GestureController.ts`** last (highest-risk - touches the canvas double-buffer crossfade transition too, so do this after the other three are proven out).
- [ ] **Step 6: Run the full web-components suite + `npm run build -w @player/web-components`, confirm clean.**
- [ ] **Step 7: Confirm `Player.ts` line count dropped substantially** (`wc -l` - target under 3,500 lines; document actual count in commit message).
- [ ] **Step 8: Commit**

```bash
git add packages/web-components/src/Player.ts packages/web-components/src/player-internals/
git commit -m "refactor: split Player.ts into shell + GestureController/SettingsMenuController/ThumbnailCache/PrefetchController"
```

---

## Phase 4 - Eliminate `: any` (full elimination, post-split)

### Task 16: Type `types.ts` fully (20 occurrences)

**Files:**
- Modify: `packages/core/src/types.ts`

- [ ] **Step 1: Grep current occurrences** (`grep -n ": any" packages/core/src/types.ts`), and for each: replace with the real shape (an existing interface, a union, or a new named type added to this file), OR - only where the value is genuinely a caller-supplied opaque payload with no fixed shape (e.g. custom plugin metadata) - replace with `unknown` plus a narrowing accessor, never leave `any`.
- [ ] **Step 2: Run `npx tsc --noEmit -p packages/core` and fix any resulting type errors in files that consume the now-stricter types.**
- [ ] **Step 3: Run the full core test suite to confirm no behavior changed.**
- [ ] **Step 4: Commit** - `git commit -m "refactor: eliminate any usages in core types.ts"`

### Task 17: Type `PlayerController.ts` + new managers fully (20 occurrences, now split across 4 files post-Task 14)

- [ ] Same process as Task 16, applied to `PlayerController.ts`, `PlaylistManager.ts`, `SubtitleManager.ts`, `PictureInPictureManager.ts`. Commit: `"refactor: eliminate any usages in PlayerController and extracted managers"`.

### Task 18: Type `SourceManager.ts` + handlers fully (29 occurrences - largest single file)

- [ ] Read `SourceManager.ts` and its handler files in full first. Most `any` here likely comes from hls.js/dash.js event payloads and internal handler dispatch - use the actual types exported by `hls.js`/`dashjs` (`import type { ErrorData } from 'hls.js'` etc.) instead of `any`; where a third-party type genuinely doesn't cover a runtime shape, define a local interface matching the documented event payload rather than widening to `any`. Commit: `"refactor: eliminate any usages in SourceManager and source handlers"`.

### Task 19: Type `DrmManager.ts` fully (19 occurrences)

- [ ] EME types (`MediaKeySession`, `MediaKeySystemAccess`) are already in `lib.dom.d.ts` - most `any` here is likely from the legacy prefixed WebKit FairPlay APIs (`WebKitMediaKeys` etc.), which need local ambient type declarations (a `.d.ts` augmentation file, e.g. `packages/core/src/types/webkit-eme.d.ts`) instead of `any`. Commit: `"refactor: eliminate any usages in DrmManager, add WebKit EME ambient types"`.

### Task 20: Type remaining core files fully (providers, simid, html-overlay - ~61 occurrences across `ImaProvider.ts`, `ThumbnailProviders.ts`, `VastProvider.ts`, `SimidRuntime.ts`, `VmapProvider.ts`, `SimidBridge.ts`, `HtmlOverlayRenderer.ts`, `AdsManager.ts`, `SimidSession.ts`, `SimidManager.ts`, `DrmValidator.ts`, `simid/types.ts`, `fetchXmlWithPolicy.ts`)

- [ ] Same process, one commit per file or small group of related files (per user's "one commit per fixed issue" preference - group only files that are tightly coupled, e.g. all three `simid/` files can be one commit since they share types).

### Task 21: Type `web-components/Player.ts` fully (27 occurrences)

- [ ] Do this after Task 15's split so the `any`s are fixed in their final smaller files (`Player.ts` + the 4 extracted controllers), not redone twice. Commit: `"refactor: eliminate any usages in Player.ts and extracted UI controllers"`.

### Task 22: Type remaining web-components files fully (`VerticalControls.ts`, `Seekbar.ts`, `Themes.ts` - 5 occurrences)

- [ ] Commit: `"refactor: eliminate any usages in VerticalControls, Seekbar, Themes"`.

### Task 23: Zero-`any` verification gate

**Files:**
- Modify: `.eslintrc.json` - add `"@typescript-eslint/no-explicit-any": "error"` to the `rules` block.

- [ ] **Step 1: Run `grep -rn ": any" packages/core/src packages/web-components/src --include=*.ts` and confirm zero results** (excluding, if unavoidable, a single documented exception with a `// eslint-disable-next-line @typescript-eslint/no-explicit-any` and an inline comment explaining exactly why - expect zero such exceptions given the per-file work above).
- [ ] **Step 2: Run `npx eslint packages apps --ext .ts` and confirm it passes with the new rule enabled** (this also indirectly fixes the "no lint script wired up" gap noted in the audit - see Task 25).
- [ ] **Step 3: Commit** - `git commit -m "chore: enforce no-explicit-any via ESLint now that the codebase is any-free"`

---

## Phase 5 - CI

### Task 24: GitHub Actions workflow

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Write a workflow that runs on `push` and `pull_request` to `main`/`working-branch`**, with a single job: checkout → `actions/setup-node@v4` (Node 20) → `npm ci` → `npm run build` → `npm test` → `npx eslint packages apps --ext .ts` → `npx tsc --noEmit` (root + both package tsconfigs, or a root script that does all three).

```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
jobs:
  build-test-lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'npm'
      - run: npm ci
      - run: npm run build
      - run: npm test
      - run: npx eslint packages apps --ext .ts
      - run: npx tsc --noEmit -p packages/core
      - run: npx tsc --noEmit -p packages/web-components
```

- [ ] **Step 2: Add a `"lint"` script to root `package.json`** (`"lint": "eslint packages apps --ext .ts"`) - closes the audit's "no lint script wired up despite `.eslintrc.json` existing" gap directly, and lets the workflow call `npm run lint` instead of the raw `npx` command.
- [ ] **Step 3: Push a throwaway branch or open a draft PR to confirm the workflow actually runs green on GitHub Actions** (cannot be verified locally - `act` is not assumed installed; ask the user to confirm after push if `act` isn't available).
- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml package.json
git commit -m "ci: add GitHub Actions workflow for build/test/lint/typecheck"
```

---

## Phase 6 - DX / Cross-technology documentation

### Task 25: React integration guide

**Files:**
- Modify: `README.md` - add a new top-level section "React Integration" to the existing 28-section table of contents.

- [ ] **Step 1: Document the imperative ref pattern** the audit found is the only working path today, with a real code sample:

```tsx
import { useEffect, useRef } from 'react';
import '@player/web-components/Player';
import type { PlayerConfiguration } from '@player/core';

function VideoPlayer({ config }: { config: PlayerConfiguration }) {
  const ref = useRef<HTMLElement & { config?: PlayerConfiguration }>(null);

  useEffect(() => {
    if (ref.current) {
      ref.current.config = config;
    }
  }, [config]);

  return <player-player ref={ref} />;
}
```

- [ ] **Step 2: Explain why** - JSX on custom elements serializes complex props to string attributes unless the framework specifically recognizes the property (React ≥19 does this automatically for properties matching known custom-element schemas; earlier React versions need the ref pattern above). Note the React ≥19 alternative briefly.
- [ ] **Step 3: Add a TypeScript module augmentation snippet** for `JSX.IntrinsicElements` so `<player-player>` type-checks in `.tsx` files.
- [ ] **Step 4: Commit** - `git commit -m "docs: add React integration guide to README"`

### Task 26: Next.js SSR documentation

**Files:**
- Modify: `README.md` - add a "Next.js Integration" section.

- [ ] **Step 1: Document the required `next/dynamic(..., { ssr: false })` wrapping pattern**, explain why (custom elements need `window`/`customElements` at import time to self-register, which the repo's guard pattern already handles safely - but Next's SSR pass still needs to skip rendering the element itself), with a working code sample.
- [ ] **Step 2: Commit** - `git commit -m "docs: add Next.js SSR integration guide to README"`

---

## Phase 7 - Final audit report

### Task 27: Write the "before/after" completion report

**Files:**
- Create: `docs/superpowers/plans/2026-08-24-npm-distribution-readiness-RESULTS.md`

- [ ] **Step 1: For each of the 6 "Actionable Recommendations" in the original audit, record: original finding, what was done (with links to the specific commits from this plan), and the new measurable state** (e.g. "205 `any` → 0, verified via `grep -rn ": any" packages/core/src packages/web-components/src --include=*.ts` returning no results, enforced going forward via `@typescript-eslint/no-explicit-any: error`"; "`Player.ts` 6,363 → N lines; `PlayerController.ts` 3,965 → N lines"; "0 tests → N test files / N assertions, `npm test` wired into CI").
- [ ] **Step 2: Re-score each of the 4 audit categories (Code Quality, NPM Readiness, DX, Cross-Technology Compatibility) with justification tied to the measurable changes**, and give a new overall readiness score.
- [ ] **Step 3: Explicitly flag anything NOT fixed by this plan** (e.g. no `@player/react` wrapper package was built, only documentation - note this as a residual gap if it wasn't built) so the report doesn't overclaim.
- [ ] **Step 4: Commit** - `git commit -m "docs: add NPM distribution readiness completion report"`

---

## Self-Review Notes (for the plan author, already applied above)

- **Spec coverage:** All 6 audit recommendations map to phases - tests+CI (Phase 1 Task1/Phase5), LICENSE+metadata (Phase1 Task2), any-elimination (Phase4), file splits (Phase3), React docs (Phase6 Task25), CHANGELOG+Next.js docs (Phase1 Task3, Phase6 Task26).
- **Sequencing matches user's explicit decision:** tests (Phase 2) strictly precede splits (Phase 3); any-elimination (Phase 4) strictly follows splits so it isn't redone twice.
- **Type/name consistency:** `PlaylistManager`, `SubtitleManager`, `PictureInPictureManager`, `GestureController`, `SettingsMenuController`, `ThumbnailCache`, `PrefetchController` are named consistently between Task 14/15's Files blocks and their Steps.
- **Residual scope risk flagged honestly in Task 27** rather than silently dropped: this plan documents React integration, it does not ship a `@player/react` package (that was the audit's "ideally" stretch goal, not its baseline recommendation).
