/**
 * Runtime resolution of the optional hls.js / dash.js peer dependencies.
 *
 * A page-level global (`window.Hls` / `window.dashjs`, as set by each
 * library's own <script> build) wins, so pages can self-host the libraries.
 * Otherwise the package is dynamic-imported: npm consumers' bundlers resolve
 * it from node_modules, and the CDN bundles rewrite the specifier to a
 * jsDelivr ESM URL at build time (see vite.config.ts), since a bare 'hls.js'
 * specifier can't resolve in a browser without an import map.
 *
 * Both resolve to the library's main export (the Hls class / the dashjs
 * namespace), unwrapping an ESM `default` export where present.
 */
export function loadHls(): Promise<unknown> {
  const globalHls = (globalThis as { Hls?: unknown }).Hls;
  if (typeof globalHls === 'function') return Promise.resolve(globalHls);
  return import('hls.js').then((mod) => (mod as { default?: unknown }).default ?? mod);
}

function hasMediaPlayer(lib: unknown): boolean {
  return !!lib && typeof (lib as { MediaPlayer?: unknown }).MediaPlayer === 'function';
}

export function loadDashjs(): Promise<unknown> {
  const globalDashjs = (globalThis as { dashjs?: unknown }).dashjs;
  if (hasMediaPlayer(globalDashjs)) return Promise.resolve(globalDashjs);
  return import('dashjs').then((mod) => {
    const defaultExport = (mod as { default?: unknown }).default;
    return hasMediaPlayer(defaultExport) ? defaultExport : mod;
  });
}
