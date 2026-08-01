export interface ContentBundle {
  html?: string;
  text?: string;
  code?: string;
  sourceHint?: string;
}

const HTML_KEYS = ["html", "htmlContent", "pageHtml", "markup"] as const;
const TEXT_KEYS = ["text", "body", "copy", "content"] as const;
const CODE_KEYS = ["code", "sourceCode", "source", "fileContent", "file"] as const;

function flattenInput(
  input: Record<string, unknown> | undefined
): Record<string, unknown> {
  if (!input) return {};
  const nested =
    typeof input.input === "object" && input.input !== null
      ? (input.input as Record<string, unknown>)
      : null;
  return nested ? { ...input, ...nested, input: undefined } : { ...input };
}

function pickString(
  data: Record<string, unknown>,
  keys: readonly string[]
): string | undefined {
  for (const key of keys) {
    const value = data[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

export function extractContentBundle(
  input: Record<string, unknown> | undefined
): ContentBundle {
  const data = flattenInput(input);
  const html = pickString(data, HTML_KEYS);
  const text = pickString(data, TEXT_KEYS);
  const code = pickString(data, CODE_KEYS);
  const sourceHint =
    typeof data.sourceHint === "string" ? data.sourceHint : undefined;

  if (html) {
    return { html, text: text || undefined, code, sourceHint };
  }

  const content = pickString(data, ["content"]);
  if (content) {
    if (content.includes("<html") || content.includes("<!DOCTYPE")) {
      return { html: content, text, code, sourceHint };
    }
    return { text: text || content, code, sourceHint };
  }

  return { html, text, code, sourceHint };
}

export function hasDirectContent(bundle: ContentBundle): boolean {
  return Boolean(bundle.html || bundle.text || bundle.code);
}

export function shouldEnhanceWithBackendTools(
  input: Record<string, unknown> | undefined
): boolean {
  const data = flattenInput(input);
  // Opt-in only — local HTML/text audits stay free unless enhance:true
  return data.enhance === true;
}
