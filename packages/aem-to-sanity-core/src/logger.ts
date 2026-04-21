export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

export interface Logger {
  debug: (msg: string, meta?: Record<string, unknown>) => void;
  info: (msg: string, meta?: Record<string, unknown>) => void;
  warn: (msg: string, meta?: Record<string, unknown>) => void;
  error: (msg: string, meta?: Record<string, unknown>) => void;
}

export interface LoggerOptions {
  level?: LogLevel;
  stream?: NodeJS.WritableStream;
  /** Emit one JSON object per line (NDJSON). Otherwise a compact text format. */
  json?: boolean;
}

const LEVEL_ORDER: Record<Exclude<LogLevel, "silent">, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export function createLogger(opts: LoggerOptions = {}): Logger {
  const level: LogLevel = opts.level ?? "info";
  const stream = opts.stream ?? process.stderr;
  const json = opts.json ?? false;

  const threshold = level === "silent" ? Infinity : LEVEL_ORDER[level];

  const write = (
    lvl: Exclude<LogLevel, "silent">,
    msg: string,
    meta?: Record<string, unknown>,
  ) => {
    if (LEVEL_ORDER[lvl] < threshold) return;
    if (json) {
      const line = JSON.stringify({ t: lvl, msg, ...(meta ?? {}) });
      stream.write(`${line}\n`);
    } else {
      const metaStr = meta ? ` ${JSON.stringify(meta)}` : "";
      stream.write(`[${lvl}] ${msg}${metaStr}\n`);
    }
  };

  return {
    debug: (msg, meta) => write("debug", msg, meta),
    info: (msg, meta) => write("info", msg, meta),
    warn: (msg, meta) => write("warn", msg, meta),
    error: (msg, meta) => write("error", msg, meta),
  };
}
