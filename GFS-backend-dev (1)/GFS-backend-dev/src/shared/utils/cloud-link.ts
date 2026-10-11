import type { CloudLinkProvider } from '@db/models/cloud-link-asset.model';

/**
 * Strips HTML elements from text to get a clean label/anchor representation.
 */
const htmlToText = (html: string): string =>
  html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>(?=\S)/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Decodes Proofpoint URL Defense v2 custom character encoding.
 */
const decodeProofpointV2 = (str: string): string => {
  let decoded = str;

  // Replace Proofpoint v2 hex escapes: -3A -> :, -2D -> -, -40 -> @, -2B -> +, etc.
  decoded = decoded.replace(/-3A/gi, ':');
  decoded = decoded.replace(/-2D/gi, '-');
  decoded = decoded.replace(/-40/gi, '@');
  decoded = decoded.replace(/-2B/gi, '+');
  decoded = decoded.replace(/-2F/gi, '/');
  decoded = decoded.replace(/-3D/gi, '=');
  decoded = decoded.replace(/-3F/gi, '?');
  decoded = decoded.replace(/-26/gi, '&');

  // Handle protocol prefix first to prevent double slash / double underscore conflict
  let protocol = '';
  if (decoded.startsWith('https:__')) {
    protocol = 'https://';
    decoded = decoded.slice(8);
  } else if (decoded.startsWith('http:__')) {
    protocol = 'http://';
    decoded = decoded.slice(7);
  }

  // Replace double underscore with placeholder (Proofpoint encodes original '_' as '__')
  const PLACEHOLDER = '\u0000';
  decoded = decoded.replace(/__/g, PLACEHOLDER);
  // Replace single underscore with '/' (Proofpoint encodes original '/' as '_')
  decoded = decoded.replace(/_/g, '/');
  // Restore original underscores
  decoded = decoded.replace(/\u0000/g, '_');

  return protocol + decoded;
};

/**
 * Unwraps email protection URLs (like Outlook Safelinks and Proofpoint URL Defense).
 */
export const unwrapUrl = (urlStr: string): string => {
  try {
    const parsed = new URL(urlStr);
    const host = parsed.hostname.toLowerCase();

    // Microsoft Safelinks
    if (host.endsWith('safelinks.protection.outlook.com')) {
      const actualUrl = parsed.searchParams.get('url');
      if (actualUrl) {
        return actualUrl;
      }
    }

    // Proofpoint URL Defense v2/v3
    if (host.endsWith('urldefense.proofpoint.com') || host.endsWith('urldefense.com')) {
      const actualUrl = parsed.searchParams.get('u');
      if (actualUrl) {
        const decoded = decodeURIComponent(actualUrl);
        // If it uses Proofpoint v2 formatting (starts with http/https after decoding hex)
        if (decoded.includes('https-3A__') || decoded.includes('http-3A__')) {
          return decodeProofpointV2(decoded);
        }
        return decoded;
      }
    }
  } catch {
    // Return original url if parsing fails
  }
  return urlStr;
};

/**
 * Normalizes a URL by standardizing the protocol/hostname, removing trailing slash,
 * removing tracking/UI params (e.g. utm_*, web=1), and sorting remaining query params.
 */
export const normalizeUrl = (urlStr: string): string => {
  try {
    const unwrapped = unwrapUrl(urlStr.trim());
    const parsed = new URL(unwrapped);

    parsed.protocol = parsed.protocol.toLowerCase();
    parsed.hostname = parsed.hostname.toLowerCase();

    // Standard tracking parameters
    const trackingParams = [
      'utm_source',
      'utm_medium',
      'utm_campaign',
      'utm_term',
      'utm_content',
      'gclid',
      'fbclid',
      'dclid',
      'msclkid',
      'clickid',
      'affiliate',
    ];
    trackingParams.forEach((param) => parsed.searchParams.delete(param));

    // UI/session parameters specific to SharePoint/Microsoft Office
    const uiParams = ['web', 'ct', 'or', 'wdstarton', 'activecell'];
    uiParams.forEach((param) => parsed.searchParams.delete(param));

    // Normalize path (remove trailing slash except for root)
    if (parsed.pathname.length > 1 && parsed.pathname.endsWith('/')) {
      parsed.pathname = parsed.pathname.slice(0, -1);
    }

    // Sort query parameters for canonical consistency
    const sortedEntries = Array.from(parsed.searchParams.entries()).sort((a, b) =>
      a[0].localeCompare(b[0]),
    );
    parsed.search = '';
    sortedEntries.forEach(([key, val]) => parsed.searchParams.set(key, val));

    return parsed.toString();
  } catch {
    return urlStr;
  }
};

/**
 * Classifies a URL hostname pattern into a specific CloudLinkProvider.
 */
export const classifyProvider = (urlStr: string): CloudLinkProvider => {
  try {
    const parsed = new URL(urlStr);
    const host = parsed.hostname.toLowerCase();

    // SharePoint
    if (host === 'sharepoint.com' || host.endsWith('.sharepoint.com')) {
      return 'SHAREPOINT';
    }

    // OneDrive
    if (
      host === 'onedrive.live.com' ||
      host.endsWith('.onedrive.live.com') ||
      host === '1drv.ms' ||
      host.endsWith('.1drv.ms')
    ) {
      return 'ONEDRIVE';
    }

    // Google Drive
    const googleHosts = [
      'drive.google.com',
      'docs.google.com',
      'sheets.google.com',
      'slides.google.com',
    ];
    if (googleHosts.some((h) => host === h || host.endsWith('.' + h))) {
      return 'GOOGLE_DRIVE';
    }

    // Dropbox
    const dropboxHosts = ['dropbox.com', 'www.dropbox.com', 'dl.dropboxusercontent.com'];
    if (dropboxHosts.some((h) => host === h || host.endsWith('.' + h))) {
      return 'DROPBOX';
    }

    // Generic
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return 'GENERIC';
    }

    return 'UNKNOWN';
  } catch {
    return 'UNKNOWN';
  }
};

/**
 * Evaluates whether a URL should be filtered out (unsubscribe, newsletter click links,
 * non-document asset extensions like tracking pixels on generic hosts).
 */
export const shouldFilterUrl = (urlStr: string, linkText: string | null): boolean => {
  try {
    const parsed = new URL(urlStr);

    // Only allow http/https links
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return true;
    }

    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname.toLowerCase();
    const search = parsed.search.toLowerCase();
    const text = (linkText || '').toLowerCase();

    // Standard marketing / unsubscribe / webversion keywords
    const filterKeywords = [
      'unsubscribe',
      'optout',
      'opt-out',
      'preferences',
      'view-in-browser',
      'view_in_browser',
      'webversion',
      'email-click',
      'click.email',
      'tracking-click',
    ];

    if (
      filterKeywords.some(
        (kw) =>
          host.includes(kw) || path.includes(kw) || search.includes(kw) || text.includes(kw),
      )
    ) {
      return true;
    }

    // Ignored media/layout asset extensions (logo, icons, tracking pixels)
    // Only filter these if they are NOT hosted by one of our cloud providers (e.g. image in Google Drive is fine).
    const provider = classifyProvider(urlStr);
    const isCloudProvider =
      provider === 'SHAREPOINT' ||
      provider === 'ONEDRIVE' ||
      provider === 'GOOGLE_DRIVE' ||
      provider === 'DROPBOX';

    if (!isCloudProvider) {
      const ignoredExtensions = [
        '.png',
        '.jpg',
        '.jpeg',
        '.gif',
        '.css',
        '.js',
        '.ico',
        '.svg',
        '.woff',
        '.woff2',
      ];
      if (ignoredExtensions.some((ext) => path.endsWith(ext))) {
        return true;
      }
    }

    return false;
  } catch {
    return true; // Filter invalid URLs
  }
};

/**
 * Trims trailing punctuation (. , ; : ? ! ) ] }) from plain text URLs if they
 * are not part of balanced brackets/parentheses.
 */
export const cleanPlainTextUrl = (url: string): string => {
  let cleaned = url;
  while (cleaned.length > 0 && /[.,;:?!)]$/.test(cleaned)) {
    if (cleaned.endsWith(')') && cleaned.includes('(')) {
      break;
    }
    cleaned = cleaned.slice(0, -1);
  }
  return cleaned;
};

/**
 * Extracts all URLs and labels from HTML body (hrefs) and plain text.
 */
export const extractUrls = (
  html: string | null,
  text: string,
): Array<{ originalUrl: string; linkText: string | null }> => {
  const extractedMap = new Map<string, { originalUrl: string; linkText: string | null }>();

  // 1. Extract from HTML (if present)
  if (html) {
    const hrefRegex = /<a\s+(?:[^>]*?\s+)?href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
    let match;
    while ((match = hrefRegex.exec(html)) !== null) {
      let url = match[1]?.trim();
      if (url) {
        // Decode HTML entities in URL
        url = url
          .replace(/&amp;/gi, '&')
          .replace(/&lt;/gi, '<')
          .replace(/&gt;/gi, '>')
          .replace(/&quot;/gi, '"')
          .replace(/&#39;/gi, "'");

        const rawLabel = match[2] || '';
        const linkText = htmlToText(rawLabel).trim() || null;
        const normalized = normalizeUrl(url);

        if (!extractedMap.has(normalized)) {
          extractedMap.set(normalized, { originalUrl: url, linkText });
        }
      }
    }
  }

  // 2. Extract from Plain Text
  const textUrlRegex = /https?:\/\/[^\s<>'"]+/gi;
  let textMatch;
  while ((textMatch = textUrlRegex.exec(text)) !== null) {
    const rawUrl = textMatch[0];
    if (rawUrl) {
      const url = cleanPlainTextUrl(rawUrl);
      const normalized = normalizeUrl(url);

      if (!extractedMap.has(normalized)) {
        extractedMap.set(normalized, { originalUrl: url, linkText: null });
      }
    }
  }

  return Array.from(extractedMap.values());
};
