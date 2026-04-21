import { ANSI_CODES, detectColor } from "./colors.ts";

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
  /**
   * Force-enable or force-disable ANSI colors. Defaults to auto-detect based on
   * whether the target stream is a TTY and the `NO_COLOR` / `FORCE_COLOR` env
   * vars. JSON mode is always uncolored.
   */
  color?: boolean;
}

const LEVEL_ORDER: Record<Exclude<LogLevel, "silent">, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const LEVEL_COLOR: Record<Exclude<LogLevel, "silent">, string> = {
  debug: ANSI_CODES.gray,
  info: ANSI_CODES.cyan,
  warn: ANSI_CODES.yellow,
  error: ANSI_CODES.red,
};

export function createLogger(opts: LoggerOptions = {}): Logger {
  const level: LogLevel = opts.level ?? "info";
  const stream = opts.stream ?? process.stderr;
  const json = opts.json ?? false;
  const color = json ? false : (opts.color ?? detectColor(stream));

  const threshold = level === "silent" ? Infinity : LEVEL_ORDER[level];

  const paint = (code: string, s: string) =>
    color ? `${code}${s}${ANSI_CODES.reset}` : s;

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
      const prefix = paint(LEVEL_COLOR[lvl], `[${lvl}]`);
      const metaStr = meta ? paint(ANSI_CODES.dim, ` ${JSON.stringify(meta)}`) : "";
      stream.write(`${prefix} ${msg}${metaStr}\n`);
    }
  };

  return {
    debug: (msg, meta) => write("debug", msg, meta),
    info: (msg, meta) => write("info", msg, meta),
    warn: (msg, meta) => write("warn", msg, meta),
    error: (msg, meta) => write("error", msg, meta),
  };
}
