import { constants } from "../config";

function isToolFileResponse(data: unknown): boolean {
  if (!data || typeof data !== "object") return false;
  const o = data as Record<string, unknown>;
  return (
    o.status === 200 &&
    typeof o.result === "object" &&
    o.result !== null &&
    typeof (o.result as Record<string, unknown>).downloadUrl === "string"
  );
}

function truncateJson(data: unknown, maxBytes: number): unknown {
  const text = JSON.stringify(data);
  if (text.length <= maxBytes) return data;
  return {
    summary: "Response truncated for LLM context",
    preview: text.slice(0, maxBytes),
    truncated: true,
    originalBytes: text.length,
  };
}

export function shapeResponseForLlm(
  operationId: string,
  status: number,
  data: unknown,
  text: string
): unknown {
  if (status < 200 || status >= 300) {
    return {
      status,
      error: typeof data === "object" ? data : { message: text.slice(0, 500) },
    };
  }

  if (isToolFileResponse(data)) {
    const envelope = data as { status: number; result: Record<string, unknown> };
    return {
      status: 200,
      type: "file",
      fileName: envelope.result.fileName,
      mimeType: envelope.result.mimeType,
      downloadUrl: envelope.result.downloadUrl,
      expiresAt: envelope.result.expiresAt,
      hint: "Download via downloadUrl; do not request raw bytes in context",
    };
  }

  const bytes = text.length;
  if (bytes <= constants.summarizeThresholdBytes) {
    return { status: 200, operationId, data };
  }

  return {
    status: 200,
    operationId,
    data: truncateJson(data, constants.summarizedMaxBytes),
    dataRef: null,
    summarized: true,
  };
}
