export function formatTime(seconds: number, forceHours = false): string {
  if (isNaN(seconds) || seconds === Infinity) {
    return forceHours ? '00:00:00' : '00:00';
  }

  const isNegative = seconds < 0;
  const absSec = Math.abs(seconds);

  const s = Math.floor(absSec % 60);
  const m = Math.floor((absSec / 60) % 60);
  const h = Math.floor(absSec / 3600);
  const pad = (n: number) => n.toString().padStart(2, '0');

  const timeStr = h > 0 || forceHours ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;

  return isNegative ? `-${timeStr}` : timeStr;
}

/**
 * True if `url` resolves to the same origin as the host page. Shared between
 * resolveSafeSandbox (decides whether to strip allow-same-origin) and SIMID's
 * origin-allowlist default (SimidSession) so both agree on when an iframe
 * will end up with an opaque origin - the allowlist must expect the literal
 * "null" origin string in that case, not the URL's nominal origin.
 */
export function isSameOriginAsHost(url: string | null | undefined): boolean {
  if (!url || typeof window === 'undefined') return false;
  try {
    return new URL(url, window.location.href).origin === window.location.origin;
  } catch (e) {
    return false;
  }
}

const SANITIZER_BLOCKED_TAGS = ['script', 'iframe', 'object', 'embed', 'link', 'meta', 'base', 'form'];
const SANITIZER_DANGEROUS_URL_PATTERN = /^\s*(javascript:|data:text\/html)/i;

/**
 * Hand-rolled allowlist sanitizer used as the last-resort default for
 * ad-server-supplied HTML overlay creatives when neither a per-ad nor a
 * global `sanitizeHtml` callback is configured. Not a substitute for a
 * dedicated library (e.g. DOMPurify) in high-risk deployments - callers
 * needing stronger guarantees should supply their own `sanitizeHtml`.
 */
export function defaultHtmlSanitizer(html: string): string {
  if (!html) return '';
  if (typeof DOMParser === 'undefined') {
    console.warn('[utils] DOMParser is not defined in this environment. Cannot sanitize HTML.');
    return '';
  }

  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');

    for (const tag of SANITIZER_BLOCKED_TAGS) {
      const nodes = doc.body.getElementsByTagName(tag);
      while (nodes.length > 0) {
        nodes[0].parentNode?.removeChild(nodes[0]);
      }
    }

    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_ELEMENT);
    let el: Element | null = walker.currentNode as Element;
    while (el) {
      for (const attr of Array.from(el.attributes)) {
        const name = attr.name.toLowerCase();
        if (name.startsWith('on')) {
          el.removeAttribute(attr.name);
          continue;
        }
        if ((name === 'href' || name === 'src' || name === 'style') && SANITIZER_DANGEROUS_URL_PATTERN.test(attr.value)) {
          el.removeAttribute(attr.name);
        }
      }
      el = walker.nextNode() as Element | null;
    }

    return doc.body.innerHTML;
  } catch (e) {
    console.warn('[utils] Failed to sanitize HTML overlay content:', e);
    return '';
  }
}

/**
 * Strips `allow-same-origin` from an iframe sandbox token list when granting
 * it would actually be dangerous - i.e. when the iframe's effective origin
 * would resolve to the host page's own origin. That's always true for
 * `srcdoc` content (per spec it inherits the parent's origin when
 * allow-same-origin is granted), and can happen for `src`-based iframes if
 * the ad-tag URL happens to be same-origin with the host page. For any
 * genuinely cross-origin creative, `allow-same-origin` is safe and left
 * intact - it's required for the creative to identify its own origin in
 * postMessage exchanges and load its own resources.
 */
export function resolveSafeSandbox(
  sandboxTokens: string,
  opts: { srcUrl?: string | null; isSrcDoc?: boolean }
): string {
  const tokens = sandboxTokens.split(/\s+/).filter(Boolean);
  if (!tokens.includes('allow-same-origin')) return sandboxTokens;

  const sameOrigin = !!opts.isSrcDoc || isSameOriginAsHost(opts.srcUrl);

  if (!sameOrigin) return sandboxTokens;

  console.warn(
    '[utils] Stripping allow-same-origin from iframe sandbox: creative resolves to the host page\'s own origin, which would otherwise grant it full DOM access to the host document.'
  );
  return tokens.filter(t => t !== 'allow-same-origin').join(' ');
}

export function sanitizeAndConvertEmbedUrl(src: string): string | null {
  if (!src) return null;
  let input = src.trim();
  if (input.length === 0) return null;

  // 1. Check for iframe tag and parse safely
  if (input.toLowerCase().includes('<iframe')) {
    try {
      if (typeof DOMParser === 'undefined') {
        console.warn(
          '[utils] DOMParser is not defined in this environment. Cannot parse iframe HTML.'
        );
        return null;
      }
      const parser = new DOMParser();
      const doc = parser.parseFromString(input, 'text/html');

      // Security check: reject if there are script tags
      const scripts = doc.getElementsByTagName('script');
      if (scripts.length > 0) {
        console.warn('[utils] script tag detected inside iframe HTML. Rejecting.');
        return null;
      }

      const iframe = doc.querySelector('iframe');
      if (!iframe) {
        console.warn('[utils] No iframe element found in input HTML.');
        return null;
      }

      const srcAttr = iframe.getAttribute('src');
      if (!srcAttr) {
        console.warn('[utils] iframe element has no src attribute.');
        return null;
      }

      input = srcAttr.trim();
    } catch (e) {
      console.error('[utils] Error parsing iframe HTML:', e);
      return null;
    }
  }

  // 2. Validate URL protocol (reject javascript:, data:, file:, blob:, etc.)
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(input);
  } catch (e) {
    console.warn('[utils] Invalid URL format for embed: ', input);
    return null;
  }

  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    console.warn('[utils] Protocol not allowed for embed: ', parsedUrl.protocol);
    return null;
  }

  // 3. Validate approved hosts
  const host = parsedUrl.hostname.toLowerCase();
  const approvedHosts = [
    'youtube.com',
    'www.youtube.com',
    'm.youtube.com',
    'youtu.be',
    'vimeo.com',
    'www.vimeo.com',
    'player.vimeo.com',
    'dailymotion.com',
    'www.dailymotion.com',
    'geo.dailymotion.com',
    'twitch.tv',
    'player.twitch.tv',
    'wistia.com',
    'wistia.net',
    'fast.wistia.com',
    'fast.wistia.net',
    'streamable.com',
    'facebook.com',
    'www.facebook.com',
  ];

  const isApproved = approvedHosts.some((approved) => {
    return host === approved || host.endsWith('.' + approved);
  });

  if (!isApproved) {
    console.warn('[utils] Host not approved for embed: ', host);
    return null;
  }

  // 4. Convert YouTube/Vimeo watch URLs to embed URLs
  let embedUrl = input;
  const lowerInput = input.toLowerCase();
  if (lowerInput.includes('youtube.com') || lowerInput.includes('youtu.be')) {
    let videoId = '';
    if (lowerInput.includes('youtube.com/watch')) {
      videoId = parsedUrl.searchParams.get('v') || '';
    } else if (lowerInput.includes('youtu.be/')) {
      videoId = input.split('youtu.be/')[1]?.split('?')[0] || '';
    } else if (lowerInput.includes('youtube.com/embed/')) {
      videoId = input.split('youtube.com/embed/')[1]?.split('?')[0] || '';
    }
    if (videoId) {
      embedUrl = `https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0&modestbranding=1`;
    }
  } else if (lowerInput.includes('vimeo.com')) {
    let videoId = '';
    if (lowerInput.includes('player.vimeo.com/video/')) {
      videoId = input.split('player.vimeo.com/video/')[1]?.split('?')[0] || '';
    } else {
      videoId = input.split('vimeo.com/')[1]?.split('?')[0] || '';
    }
    if (videoId) {
      embedUrl = `https://player.vimeo.com/video/${videoId}?autoplay=1`;
    }
  }

  return embedUrl;
}
