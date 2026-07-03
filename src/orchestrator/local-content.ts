import * as cheerio from "cheerio";

export interface ExtractedLink {
  href: string;
  text: string;
  internal: boolean;
}

export interface LocalLinkReport {
  mode: "html-link-extract";
  billed: false;
  summary: {
    total: number;
    internal: number;
    external: number;
    emptyText: number;
  };
  links: ExtractedLink[];
}

export function looksLikeHtml(value: string): boolean {
  const v = value.trim();
  return (
    v.startsWith("<!DOCTYPE") ||
    v.startsWith("<html") ||
    (v.startsWith("<") && v.includes("</"))
  );
}

export function extractPlainTextFromHtml(html: string): string {
  const $ = cheerio.load(html);
  $("script, style, noscript").remove();
  return $("body").text().replace(/\s+/g, " ").trim();
}

export function extractHeadlineTextFromHtml(html: string): string {
  const $ = cheerio.load(html);
  const title = $("title").first().text().trim();
  const h1 = $("h1").first().text().trim();
  const parts = [title, h1].filter(Boolean);
  return parts.join(" — ").trim();
}

export function extractTextFromCode(code: string): string {
  const trimmed = code.trim();
  if (looksLikeHtml(trimmed)) {
    return extractPlainTextFromHtml(trimmed);
  }
  return trimmed
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/.*$/gm, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function resolveWorkingText(bundle: {
  html?: string;
  text?: string;
  code?: string;
}): string | undefined {
  if (bundle.text?.trim()) return bundle.text.trim();
  if (bundle.html) {
    const fromHtml = extractPlainTextFromHtml(bundle.html);
    if (fromHtml) return fromHtml;
  }
  if (bundle.code) {
    const fromCode = extractTextFromCode(bundle.code);
    if (fromCode) return fromCode;
  }
  return undefined;
}

export function extractLinksFromHtml(
  html: string,
  baseUrl?: string
): LocalLinkReport {
  const $ = cheerio.load(html);
  const origin = safeOrigin(baseUrl);
  const links: ExtractedLink[] = [];
  let emptyText = 0;

  $("a[href]").each((_, el) => {
    const hrefRaw = $(el).attr("href")?.trim();
    if (!hrefRaw || hrefRaw.startsWith("#") || hrefRaw.startsWith("javascript:")) {
      return;
    }
    const text = $(el).text().replace(/\s+/g, " ").trim();
    if (!text) emptyText += 1;
    const href = resolveHref(hrefRaw, origin);
    links.push({
      href,
      text,
      internal: isInternalLink(href, origin),
    });
  });

  const internal = links.filter((l) => l.internal).length;
  return {
    mode: "html-link-extract",
    billed: false,
    summary: {
      total: links.length,
      internal,
      external: links.length - internal,
      emptyText,
    },
    links: links.slice(0, 200),
  };
}

function safeOrigin(baseUrl?: string): string | undefined {
  if (!baseUrl) return undefined;
  try {
    return new URL(baseUrl).origin;
  } catch {
    return undefined;
  }
}

function resolveHref(href: string, origin?: string): string {
  if (!origin) return href;
  try {
    return new URL(href, origin).toString();
  } catch {
    return href;
  }
}

function isInternalLink(href: string, origin?: string): boolean {
  if (!origin) return !href.startsWith("http");
  try {
    return new URL(href).origin === origin;
  } catch {
    return true;
  }
}
