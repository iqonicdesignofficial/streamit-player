import { describe, it, expect } from 'vitest';
import {
  formatTime,
  isSameOriginAsHost,
  defaultHtmlSanitizer,
  resolveSafeSandbox,
  sanitizeAndConvertEmbedUrl,
} from './utils';

describe('formatTime', () => {
  it('formats zero seconds', () => {
    expect(formatTime(0)).toBe('00:00');
  });

  it('formats sub-hour durations as mm:ss', () => {
    expect(formatTime(65)).toBe('01:05');
  });

  it('formats durations over an hour as hh:mm:ss even without forceHours', () => {
    expect(formatTime(3661)).toBe('01:01:01');
  });

  it('forceHours pads a sub-hour duration to hh:mm:ss', () => {
    expect(formatTime(65, true)).toBe('00:01:05');
  });

  it('forceHours has no additional effect once hours are already present', () => {
    expect(formatTime(3661, true)).toBe('01:01:01');
  });

  it('prefixes negative durations with a minus sign, using the absolute value for digits', () => {
    expect(formatTime(-5)).toBe('-00:05');
    expect(formatTime(-3661)).toBe('-01:01:01');
  });

  it('returns 00:00 for NaN', () => {
    expect(formatTime(NaN)).toBe('00:00');
  });

  it('returns 00:00:00 for NaN with forceHours', () => {
    expect(formatTime(NaN, true)).toBe('00:00:00');
  });

  it('returns 00:00 for positive Infinity', () => {
    expect(formatTime(Infinity)).toBe('00:00');
  });

  it('returns 00:00:00 for positive Infinity with forceHours', () => {
    expect(formatTime(Infinity, true)).toBe('00:00:00');
  });
});

describe('isSameOriginAsHost', () => {
  it('returns false for null', () => {
    expect(isSameOriginAsHost(null)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isSameOriginAsHost(undefined)).toBe(false);
  });

  it('returns false for an empty string', () => {
    expect(isSameOriginAsHost('')).toBe(false);
  });

  it('returns true for a URL resolving to the same origin as the host page', () => {
    expect(isSameOriginAsHost(window.location.origin + '/some/path')).toBe(true);
  });

  it('returns true for a same-origin relative URL', () => {
    expect(isSameOriginAsHost('/some/relative/path')).toBe(true);
  });

  it('returns false for a cross-origin URL', () => {
    expect(isSameOriginAsHost('https://example.com/some/path')).toBe(false);
  });

  it('returns false for a malformed URL that fails to parse', () => {
    expect(isSameOriginAsHost('http://[')).toBe(false);
  });
});

describe('defaultHtmlSanitizer', () => {
  it('returns empty string for empty input', () => {
    expect(defaultHtmlSanitizer('')).toBe('');
  });

  it('strips script tags and their contents', () => {
    const result = defaultHtmlSanitizer('<div>hi</div><script>alert(1)</script>');
    expect(result).not.toContain('<script');
    expect(result).not.toContain('alert(1)');
    expect(result).toContain('<div>hi</div>');
  });

  it('strips other blocked tags (iframe, object, embed, form)', () => {
    const result = defaultHtmlSanitizer(
      '<iframe src="https://evil.com"></iframe><object data="x"></object><embed src="y"><form action="z"></form><p>safe</p>'
    );
    expect(result).not.toContain('<iframe');
    expect(result).not.toContain('<object');
    expect(result).not.toContain('<embed');
    expect(result).not.toContain('<form');
    expect(result).toContain('<p>safe</p>');
  });

  it('removes on* event handler attributes but keeps the element', () => {
    const result = defaultHtmlSanitizer('<div onclick="alert(1)" onmouseover="steal()">hi</div>');
    expect(result).not.toContain('onclick');
    expect(result).not.toContain('onmouseover');
    expect(result).toContain('hi');
  });

  it('strips javascript: URLs from href attributes', () => {
    const result = defaultHtmlSanitizer('<a href="javascript:alert(1)">click</a>');
    expect(result).not.toContain('javascript:');
    expect(result).toContain('click');
  });

  it('strips javascript: URLs from src attributes', () => {
    const result = defaultHtmlSanitizer('<img src="javascript:alert(1)">');
    expect(result).not.toContain('javascript:');
  });

  it('strips data:text/html URLs from style attributes', () => {
    const result = defaultHtmlSanitizer(
      '<div style="data:text/html,<script>alert(1)</script>">hi</div>'
    );
    expect(result).not.toContain('data:text/html');
  });

  it('preserves safe tags, attributes, and nested markup', () => {
    const result = defaultHtmlSanitizer('<p>Hello <b>world</b></p><a href="https://example.com">link</a>');
    expect(result).toContain('<p>Hello <b>world</b></p>');
    expect(result).toContain('href="https://example.com"');
  });

  it('returns empty string when DOMParser is unavailable', () => {
    const original = globalThis.DOMParser;
    // @ts-expect-error deliberately removing DOMParser for this test
    delete globalThis.DOMParser;
    try {
      expect(defaultHtmlSanitizer('<p>hi</p>')).toBe('');
    } finally {
      globalThis.DOMParser = original;
    }
  });
});

describe('resolveSafeSandbox', () => {
  it('returns tokens unchanged when allow-same-origin is not present', () => {
    const tokens = 'allow-scripts allow-popups';
    expect(resolveSafeSandbox(tokens, {})).toBe(tokens);
  });

  it('strips allow-same-origin for srcdoc content', () => {
    const result = resolveSafeSandbox('allow-scripts allow-same-origin', { isSrcDoc: true });
    expect(result).toBe('allow-scripts');
  });

  it('strips allow-same-origin when srcUrl resolves to the host origin', () => {
    const result = resolveSafeSandbox('allow-scripts allow-same-origin', {
      srcUrl: window.location.origin + '/ad.html',
    });
    expect(result).toBe('allow-scripts');
  });

  it('leaves allow-same-origin intact for a genuinely cross-origin src', () => {
    const tokens = 'allow-scripts allow-same-origin';
    const result = resolveSafeSandbox(tokens, { srcUrl: 'https://example.com/ad.html' });
    expect(result).toBe(tokens);
  });

  it('leaves allow-same-origin intact when neither srcUrl nor isSrcDoc is provided', () => {
    const tokens = 'allow-same-origin';
    expect(resolveSafeSandbox(tokens, {})).toBe(tokens);
  });
});

describe('sanitizeAndConvertEmbedUrl', () => {
  it('returns null for empty input', () => {
    expect(sanitizeAndConvertEmbedUrl('')).toBeNull();
  });

  it('returns null for whitespace-only input', () => {
    expect(sanitizeAndConvertEmbedUrl('   ')).toBeNull();
  });

  it('returns null for an invalid URL', () => {
    expect(sanitizeAndConvertEmbedUrl('not a url')).toBeNull();
  });

  it('rejects javascript: URLs', () => {
    expect(sanitizeAndConvertEmbedUrl('javascript:alert(1)')).toBeNull();
  });

  it('rejects data: URLs', () => {
    expect(sanitizeAndConvertEmbedUrl('data:text/html,<script>alert(1)</script>')).toBeNull();
  });

  it('rejects file: URLs', () => {
    expect(sanitizeAndConvertEmbedUrl('file:///etc/passwd')).toBeNull();
  });

  it('rejects hosts not on the approved list', () => {
    expect(sanitizeAndConvertEmbedUrl('https://evil.com/video')).toBeNull();
  });

  it('converts a YouTube watch URL to an embed URL', () => {
    const result = sanitizeAndConvertEmbedUrl('https://www.youtube.com/watch?v=abc123');
    expect(result).toBe('https://www.youtube.com/embed/abc123?autoplay=1&rel=0&modestbranding=1');
  });

  it('converts a youtu.be short URL to an embed URL', () => {
    const result = sanitizeAndConvertEmbedUrl('https://youtu.be/abc123');
    expect(result).toBe('https://www.youtube.com/embed/abc123?autoplay=1&rel=0&modestbranding=1');
  });

  it('re-normalizes an existing YouTube embed URL', () => {
    const result = sanitizeAndConvertEmbedUrl('https://www.youtube.com/embed/abc123');
    expect(result).toBe('https://www.youtube.com/embed/abc123?autoplay=1&rel=0&modestbranding=1');
  });

  it('converts a Vimeo watch URL to a player embed URL', () => {
    const result = sanitizeAndConvertEmbedUrl('https://vimeo.com/123456789');
    expect(result).toBe('https://player.vimeo.com/video/123456789?autoplay=1');
  });

  it('re-normalizes an existing Vimeo player URL', () => {
    const result = sanitizeAndConvertEmbedUrl('https://player.vimeo.com/video/123456789');
    expect(result).toBe('https://player.vimeo.com/video/123456789?autoplay=1');
  });

  it('passes through an approved host that is neither YouTube nor Vimeo unmodified', () => {
    const url = 'https://www.dailymotion.com/video/x7abcde';
    expect(sanitizeAndConvertEmbedUrl(url)).toBe(url);
  });

  it('accepts a subdomain of an approved host', () => {
    const url = 'https://geo.dailymotion.com/video/x7abcde';
    expect(sanitizeAndConvertEmbedUrl(url)).toBe(url);
  });

  it('extracts and converts the src from a well-formed iframe tag', () => {
    const html = '<iframe src="https://www.youtube.com/watch?v=abc123" width="640" height="360"></iframe>';
    const result = sanitizeAndConvertEmbedUrl(html);
    expect(result).toBe('https://www.youtube.com/embed/abc123?autoplay=1&rel=0&modestbranding=1');
  });

  it('rejects iframe HTML that contains a script tag', () => {
    const html = '<iframe src="https://www.youtube.com/embed/abc123"></iframe><script>alert(1)</script>';
    expect(sanitizeAndConvertEmbedUrl(html)).toBeNull();
  });

  it('returns null when iframe HTML has no src attribute', () => {
    const html = '<iframe title="no src here"></iframe>';
    expect(sanitizeAndConvertEmbedUrl(html)).toBeNull();
  });

  it('returns null when the input mentions <iframe but no iframe element is parsed', () => {
    const html = '<!-- <iframe src="https://www.youtube.com/embed/abc123"> -->';
    expect(sanitizeAndConvertEmbedUrl(html)).toBeNull();
  });

  it('returns the original YouTube watch URL when v param is missing (empty videoId fallback)', () => {
    const url = 'https://www.youtube.com/watch';
    expect(sanitizeAndConvertEmbedUrl(url)).toBe(url);
  });

  it('returns the original youtu.be URL when path is empty (empty videoId fallback)', () => {
    const url = 'https://youtu.be/';
    expect(sanitizeAndConvertEmbedUrl(url)).toBe(url);
  });

  it('returns the original Vimeo URL when path is empty (empty videoId fallback)', () => {
    const url = 'https://vimeo.com/';
    expect(sanitizeAndConvertEmbedUrl(url)).toBe(url);
  });

  it('returns the original player.vimeo.com URL when path is empty (empty videoId fallback)', () => {
    const url = 'https://player.vimeo.com/video/';
    expect(sanitizeAndConvertEmbedUrl(url)).toBe(url);
  });
});
