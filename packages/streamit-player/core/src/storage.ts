/**
 * Internal localStorage wrapper that no-ops safely when storage is unavailable
 * (SSR, privacy mode, quota errors). Not part of the published API surface -
 * it is bundled into the consumers that import it.
 */
export const safeStorage = {
  getItem(key: string): string | null {
    try {
      if (typeof localStorage !== 'undefined') {
        return localStorage.getItem(key);
      }
    } catch (e) {
      /* ignore */
    }
    return null;
  },
  setItem(key: string, value: string): void {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(key, value);
      }
    } catch (e) {
      /* ignore */
    }
  },
};
