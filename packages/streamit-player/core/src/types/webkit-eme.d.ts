/**
 * Ambient type declarations for the legacy, vendor-prefixed WebKit
 * Encrypted Media Extensions (EME) API used by older Safari/WebKit
 * browsers (and embedded WebViews) to implement Apple FairPlay Streaming
 * before the standard, unprefixed W3C EME API (`navigator.requestMediaKeySystemAccess`,
 * `HTMLMediaElement.setMediaKeys`, `MediaKeySession`, ...) was available.
 *
 * These shapes are not part of `lib.dom.d.ts` because they were never
 * standardized. They are modeled here from Apple's FairPlay Streaming
 * documentation and observed WebKit behavior:
 * https://developer.apple.com/streaming/fps/
 *
 * Only the members actually consumed by `DrmManager.ts` are declared.
 */

/** The prefixed WebKit equivalent of the standard `MediaKeySession`. */
interface WebKitMediaKeySession extends EventTarget {
  readonly sessionId: string;
  readonly keySystem: string;
  readonly error: { code: number; systemCode?: number } | null;
  close(): void;
  update(key: Uint8Array): void;
}

/** Dispatched as `webkitkeymessage` with the CDM's license request challenge. */
interface WebKitMediaKeyMessageEvent extends Event {
  readonly message: ArrayBuffer;
  readonly destinationURL: string | null;
}

/** Dispatched as `webkitkeyerror` when the legacy CDM reports a failure. */
interface WebKitMediaKeyErrorEvent extends Event {
  readonly code?: number;
  readonly systemCode?: number;
}

/** The prefixed WebKit equivalent of the standard `MediaKeys`. */
interface WebKitMediaKeys {
  createSession(mimeType: string, initData: Uint8Array): WebKitMediaKeySession;
}

interface WebKitMediaKeysConstructor {
  new (keySystem: string): WebKitMediaKeys;
  isTypeSupported(keySystem: string, mimeType: string): boolean;
}

/** Dispatched as `webkitneedkey` on the `<video>` element, the legacy analog of `encrypted`. */
interface WebKitNeedKeyEvent extends Event {
  readonly initData: ArrayBuffer | Uint8Array | null;
}

interface Window {
  /** Present only on older WebKit-based browsers that predate standard EME support. */
  WebKitMediaKeys?: WebKitMediaKeysConstructor;
}

interface HTMLVideoElement {
  /** Legacy prefixed equivalent of `setMediaKeys`, present only on older WebKit browsers. */
  webkitSetMediaKeys?(mediaKeys: WebKitMediaKeys | null): void;
}
