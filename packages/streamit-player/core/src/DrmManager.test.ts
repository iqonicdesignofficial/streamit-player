import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { normalizeClearKeyValue, normalizeClearKeys } from './DrmManager';
import type { DrmConfig } from './types';
import type { PlayerController } from './PlayerController';

const nullController = null as unknown as PlayerController;

/**
 * DrmManager.ts monkey-patches `MediaKeys.prototype.createSession` (and a
 * couple of related EME prototypes) exactly once, at module load time via a
 * module-scope `isCreateSessionPatched` boolean guarded inside the private
 * `patchCreateSession()` function (called lazily from `DrmManager.load()`).
 *
 * Because that flag lives on the module instance, tests that need to observe
 * the *first* patch application must get a fresh module instance via
 * `vi.resetModules()` + a dynamic `import('./DrmManager')` - otherwise a
 * prior test in this file would have already flipped the flag to `true` and
 * `patchCreateSession()` would silently no-op for every subsequent test.
 */

function base64UrlToBytes(b64url: string): Uint8Array {
  let b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4 !== 0) b64 += '=';
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

describe('normalizeClearKeyValue / normalizeClearKeys (pure ClearKey key-format mapping)', () => {
  it('converts a hex key id/key into unpadded base64url', () => {
    const hex = '000102030405060708090a0b0c0d0e0f';
    const result = normalizeClearKeyValue(hex);

    expect(result).not.toMatch(/[+/=]/);
    expect(base64UrlToBytes(result)).toEqual(
      Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15])
    );
  });

  it('strips whitespace, colons, and dashes from hex input before encoding', () => {
    const withSeparators = normalizeClearKeyValue('00 01:02-03');
    const withoutSeparators = normalizeClearKeyValue('00010203');
    expect(withSeparators).toBe(withoutSeparators);
  });

  it('treats an already-base64(url) value as such, converting +/ and stripping = padding', () => {
    // Not valid hex (contains '+', '/', '='), so it takes the base64url-normalization branch.
    expect(normalizeClearKeyValue('ab+c/d==')).toBe('ab-c_d');
  });

  it('returns an empty string for empty/whitespace-only input', () => {
    expect(normalizeClearKeyValue('')).toBe('');
    expect(normalizeClearKeyValue('   ')).toBe('');
  });

  it('normalizeClearKeys normalizes both the key id and the key for every entry', () => {
    const result = normalizeClearKeys({
      '000102030405060708090a0b0c0d0e0f': '0f0e0d0c0b0a09080706050403020100',
    });
    const [kid] = Object.keys(result);
    expect(kid).not.toMatch(/[+/=]/);
    expect(result[kid]).not.toMatch(/[+/=]/);
    expect(base64UrlToBytes(kid)).toEqual(
      Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15])
    );
  });

  it('normalizeClearKeys returns an empty object when passed undefined', () => {
    expect(normalizeClearKeys(undefined)).toEqual({});
  });
});

describe('DrmManager monkey-patch re-entry guard (isCreateSessionPatched)', () => {
  const originalMediaKeys = (globalThis as any).MediaKeys;
  const originalRMKSA = (navigator as any).requestMediaKeySystemAccess;

  afterEach(() => {
    (globalThis as any).MediaKeys = originalMediaKeys;
    (navigator as any).requestMediaKeySystemAccess = originalRMKSA;
    vi.resetModules();
  });

  it('patching MediaKeys.prototype.createSession is idempotent across multiple load() calls', async () => {
    vi.resetModules();

    class FakeMediaKeys {
      createSession(_type?: MediaKeySessionType) {
        return {} as any;
      }
    }
    (globalThis as any).MediaKeys = FakeMediaKeys;

    const originalCreateSession = FakeMediaKeys.prototype.createSession;

    const { DrmManager } = await import('./DrmManager');

    const video1 = document.createElement('video');
    const video2 = document.createElement('video');
    const manager1 = new DrmManager();
    const manager2 = new DrmManager();

    const config: DrmConfig = { clearkey: { clearkeys: {} } };

    manager1.load(video1, config, nullController, true);
    const patchedAfterFirstLoad = FakeMediaKeys.prototype.createSession;

    // The prototype method must actually have been wrapped (patch ran once).
    expect(patchedAfterFirstLoad).not.toBe(originalCreateSession);

    manager2.load(video2, config, nullController, true);
    const patchedAfterSecondLoad = FakeMediaKeys.prototype.createSession;

    // Re-entry guard must prevent a second wrap: same function reference.
    expect(patchedAfterSecondLoad).toBe(patchedAfterFirstLoad);

    manager1.destroy();
    manager2.destroy();
  });
});

describe('DrmManager ClearKey path (inline keys, no external license server)', () => {
  const originalMediaKeys = (globalThis as any).MediaKeys;
  const originalRMKSA = (navigator as any).requestMediaKeySystemAccess;
  const originalSetMediaKeys = (HTMLMediaElement.prototype as any).setMediaKeys;

  afterEach(() => {
    (globalThis as any).MediaKeys = originalMediaKeys;
    (navigator as any).requestMediaKeySystemAccess = originalRMKSA;
    (HTMLMediaElement.prototype as any).setMediaKeys = originalSetMediaKeys;
    vi.resetModules();
  });

  it('maps a ClearKey config to a JWK-format EME license response and passes initDataType through unchanged', async () => {
    vi.resetModules();

    class FakeMediaKeySession extends EventTarget {
      generateRequest = vi.fn(async function (this: FakeMediaKeySession) {
        // Simulate the browser firing the 'message' event once a request is generated.
        const evt = new Event('message');
        (evt as any).messageType = 'license-request';
        (evt as any).message = new ArrayBuffer(0);
        this.dispatchEvent(evt);
      });
      update = vi.fn(async (_response: BufferSource) => undefined);
      close = vi.fn(async () => undefined);
      keyStatuses = new Map<string, string>();
    }

    let capturedSession: FakeMediaKeySession | undefined;

    class FakeMediaKeys {
      createSession(_type?: MediaKeySessionType) {
        const session = new FakeMediaKeySession();
        capturedSession = session;
        return session as unknown as MediaKeySession;
      }
      setServerCertificate = vi.fn(async () => true);
    }

    class FakeMediaKeySystemAccess {
      constructor(public keySystem: string) {}
      async createMediaKeys() {
        return new FakeMediaKeys() as unknown as MediaKeys;
      }
    }

    (globalThis as any).MediaKeys = FakeMediaKeys;
    (navigator as any).requestMediaKeySystemAccess = vi.fn(
      async (keySystem: string) => new FakeMediaKeySystemAccess(keySystem)
    );
    (HTMLMediaElement.prototype as any).setMediaKeys = vi.fn(async function (
      this: HTMLVideoElement,
      _mediaKeys: MediaKeys | null
    ) {
      return undefined;
    });

    const { DrmManager } = await import('./DrmManager');

    const kid = '000102030405060708090a0b0c0d0e0f';
    const key = '100102030405060708090a0b0c0d0e0f';
    const config: DrmConfig = { clearkey: { clearkeys: { [kid]: key } } };

    const video = document.createElement('video');
    const manager = new DrmManager();
    manager.load(video, config, nullController, true);

    const initData = new Uint8Array([1, 2, 3, 4]).buffer;
    const event = { initDataType: 'keyids', initData } as unknown as MediaEncryptedEvent;

    await manager.handleEncryptedEvent(event);

    await vi.waitFor(() => {
      expect(capturedSession?.update).toHaveBeenCalledTimes(1);
    });

    // initDataType/initData are passed through to generateRequest unchanged.
    expect(capturedSession!.generateRequest).toHaveBeenCalledWith(
      'keyids',
      new Uint8Array(initData)
    );

    // The inline ClearKey license response is a JWK key set: kty 'oct', base64url kid/k.
    const [responseBytes] = capturedSession!.update.mock.calls[0];
    const decoded = JSON.parse(new TextDecoder().decode(responseBytes as Uint8Array));

    expect(decoded).toEqual({
      type: 'temporary',
      keys: [
        {
          kty: 'oct',
          kid: normalizeClearKeyValue(kid),
          k: normalizeClearKeyValue(key),
        },
      ],
    });

    manager.destroy();
  });
});
