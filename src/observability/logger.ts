export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogFields {
  requestId?: string;
  mcpSessionId?: string;
  operationId?: string;
  durationMs?: number;
  transport?: "mcp" | "mcp-sse" | "mcp-http";
  [key: string]: unknown;
}

export function createLogger(level: string = "info") {
  const order: Record<LogLevel, number> = {
    debug: 10,
    info: 20,
    warn: 30,
    error: 40,
  };
  const min = order[(level as LogLevel) in order ? (level as LogLevel) : "info"];

  function log(lv: LogLevel, msg: string, fields?: LogFields) {
    if (order[lv] < min) return;
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      level: lv,
      msg,
      ...fields,
    });
    if (lv === "error") console.error(line);
    else console.log(line);
  }

  return {
    debug: (msg: string, fields?: LogFields) => log("debug", msg, fields),
    info: (msg: string, fields?: LogFields) => log("info", msg, fields),
    warn: (msg: string, fields?: LogFields) => log("warn", msg, fields),
    error: (msg: string, fields?: LogFields) => log("error", msg, fields),
  };
}

export type Logger = ReturnType<typeof createLogger>;
