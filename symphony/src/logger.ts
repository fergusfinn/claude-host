// Structured logging — spec §13.1-13.2

export type LogLevel = "debug" | "info" | "warn" | "error";

interface LogContext {
  issue_id?: string;
  issue_identifier?: string;
  session_id?: string;
  [key: string]: unknown;
}

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

let minLevel: LogLevel = "info";

export function setLogLevel(level: LogLevel): void {
  minLevel = level;
}

export function log(level: LogLevel, message: string, context?: LogContext): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[minLevel]) return;

  const ts = new Date().toISOString();
  const parts = [`ts=${ts}`, `level=${level}`, `msg=${message}`];

  if (context) {
    for (const [k, v] of Object.entries(context)) {
      if (v !== undefined && v !== null) {
        parts.push(`${k}=${v}`);
      }
    }
  }

  process.stderr.write(parts.join(" ") + "\n");
}

export const logger = {
  debug: (msg: string, ctx?: LogContext) => log("debug", msg, ctx),
  info: (msg: string, ctx?: LogContext) => log("info", msg, ctx),
  warn: (msg: string, ctx?: LogContext) => log("warn", msg, ctx),
  error: (msg: string, ctx?: LogContext) => log("error", msg, ctx),
};
