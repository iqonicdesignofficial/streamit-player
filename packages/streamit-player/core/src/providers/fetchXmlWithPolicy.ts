import type { AdsRequestConfig } from '../types';

/**
 * Shared fetch-with-policy for ad document XML (VAST/VMAP): timeout,
 * retry-with-backoff on 5xx, custom headers, credentials. Used by both
 * VastProvider and VmapProvider so their network behavior never drifts.
 */
export async function fetchXmlWithPolicy(
  url: string,
  signal: AbortSignal,
  options: AdsRequestConfig = {}
): Promise<string> {
  const timeoutMs = options.timeout ?? 10000;
  const retryCount = options.retryCount ?? 3;
  const credentials = options.withCredentials ? 'include' : 'same-origin';
  const headers = options.headers || {};

  let attempt = 0;
  const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  while (attempt <= retryCount) {
    if (signal.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    const controller = new AbortController();
    const attemptSignal = controller.signal;

    const onAbort = () => controller.abort();
    signal.addEventListener('abort', onAbort);

    const timeoutId = setTimeout(() => {
      controller.abort();
    }, timeoutMs);

    try {
      const response = await fetch(url, {
        headers,
        credentials,
        signal: attemptSignal,
      });
      clearTimeout(timeoutId);
      signal.removeEventListener('abort', onAbort);

      if (response.ok) {
        return await response.text();
      }

      if (response.status >= 500 && attempt < retryCount) {
        attempt++;
        await delay(Math.pow(2, attempt) * 100);
        continue;
      }

      throw new Error(`Server returned HTTP status ${response.status}`);
    } catch (err) {
      clearTimeout(timeoutId);
      signal.removeEventListener('abort', onAbort);

      if (signal.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }

      if (attempt < retryCount) {
        attempt++;
        await delay(Math.pow(2, attempt) * 100);
        continue;
      }
      throw err;
    }
  }
  throw new Error('Request failed after maximum retries');
}
