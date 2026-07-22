// Confluence "storage format" (a constrained XHTML) → plain text / lightweight
// Markdown. CAIRN indexes and audits *text*, so we flatten a page's storage body
// into readable text while preserving the structure that matters for grounding:
// headings, paragraphs, and lists stay legible, and Confluence page links become
// [[Title]] wikilinks so the same link graph the filesystem connector builds also
// works across Confluence. Zero deps — a small, deliberate regex pipeline, not a
// full XML parser (the storage subset we care about is regular enough).

// Decode the handful of XML/HTML entities Confluence storage emits. `&amp;` is
// decoded LAST so an escaped entity like `&amp;lt;` resolves to a literal `&lt;`
// rather than being double-decoded into `<`.
export function decodeEntities(s) {
  return String(s ?? '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => safeCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => safeCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&');
}

const safeCodePoint = (n) => {
  try { return String.fromCodePoint(n); } catch { return ''; }
};

// Remove tags from an inline fragment (heading/list-item/paragraph content) and
// collapse its internal whitespace to single spaces. Entities are decoded once,
// globally, at the end of storageToText — not here — to avoid double-decoding.
const stripInline = (s) => String(s).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * Convert a Confluence storage-format body into text/Markdown.
 * @param {string} xhtml storage body
 * @returns {string}
 */
export function storageToText(xhtml) {
  let s = String(xhtml ?? '').replace(/\r\n/g, '\n');

  // Drop comments and CDATA wrappers (keep the CDATA text, e.g. code macros).
  s = s.replace(/<!--[\s\S]*?-->/g, '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');

  // 1) Confluence page links → [[Title]] wikilinks. A link to a page carries
  //    <ri:page ri:content-title="Target"/>; attribute order varies, so match the
  //    attribute anywhere in the link. Non-page links fall back to their body text.
  s = s.replace(/<ac:link\b[^>]*>([\s\S]*?)<\/ac:link>/g, (_, inner) => {
    const title = inner.match(/ri:content-title="([^"]*)"/);
    if (title) return ` [[${title[1].trim()}]] `;
    const body = inner.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    return body ? ` ${body} ` : '';
  });

  // 2) Block-level structure → text markers.
  s = s.replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/g, (_, lvl, inner) => `\n\n${'#'.repeat(Number(lvl))} ${stripInline(inner)}\n\n`);
  s = s.replace(/<li\b[^>]*>([\s\S]*?)<\/li>/g, (_, inner) => `\n- ${stripInline(inner)}`);
  s = s.replace(/<\/(?:ul|ol)>/g, '\n');
  s = s.replace(/<p\b[^>]*>([\s\S]*?)<\/p>/g, (_, inner) => `\n\n${stripInline(inner)}\n\n`);
  s = s.replace(/<br\s*\/?>/g, '\n');
  s = s.replace(/<hr\s*\/?>/g, '\n\n---\n\n');

  // Light table sanity so tables degrade to readable rows instead of mashed words.
  s = s.replace(/<\/(?:td|th)>/g, ' | ').replace(/<\/tr>/g, '\n');

  // 3) Strip any remaining tags (emphasis, macros, table wrappers…), then decode.
  s = s.replace(/<[^>]+>/g, '');
  s = decodeEntities(s);

  // 4) Tidy: collapse intra-line whitespace, drop the space a stripped inline tag
  //    can leave before punctuation (e.g. "years </strong>." → "years ." → "years."),
  //    and squeeze runs of blank lines.
  s = s.split('\n').map((l) => l.replace(/[ \t]+/g, ' ').replace(/ +([.,;:!?])/g, '$1').trimEnd()).join('\n');
  return s.replace(/\n{3,}/g, '\n\n').trim();
}

// Pull [[wikilink]] targets out of already-converted text — same shape/regex the
// filesystem connector uses on Markdown, so the link graph is source-agnostic.
export function extractWikilinks(text) {
  const links = new Set();
  for (const m of String(text).matchAll(/\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]/g)) links.add(m[1].trim());
  return [...links];
}
