/**
 * Tiny ANSI color helper for CLI output. Zero-dependency.
 *
 * Respects the two de-facto standards:
 *   - `NO_COLOR`    (https://no-color.org)        → always off
 *   - `FORCE_COLOR` (https://force-color.org)     → always on (unless NO_COLOR)
 * Otherwise falls back to the target stream's `isTTY` flag.
 *
 * If we ever outgrow this (Windows legacy terminals, 256-color / truecolor
 * gradients, nested composition) the `Colors` shape is small enough to swap
 * for `chalk` without touching call sites — keep this surface stable.
 */

const ANSI = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
} as const;

export type AnsiCode = (typeof ANSI)[keyof typeof ANSI];

export interface Colors {
  /** Whether ANSI escape sequences will actually be emitted. */
  enabled: boolean;
  dim: (s: string | number) => string;
  bold: (s: string | number) => string;
  red: (s: string | number) => string;
  green: (s: string | number) => string;
  yellow: (s: string | number) => string;
  cyan: (s: string | number) => string;
  gray: (s: string | number) => string;
  /** Wrap a string in an arbitrary ANSI code (use `ANSI_CODES` for known values). */
  paint: (code: string, s: string | number) => string;
}

export interface CreateColorsOptions {
  /**
   * Target stream. Used only for TTY detection — nothing is actually written
   * here; callers pick which stream to write to themselves. Default:
   * `process.stderr`, matching the default Logger stream.
   */
  stream?: NodeJS.WritableStream;
  /**
   * Force-enable or force-disable colors. When omitted, auto-detects from
   * `NO_COLOR` / `FORCE_COLOR` / `stream.isTTY`.
   */
  enabled?: boolean;
}

/** Detect whether ANSI colors should be emitted for the given stream. */
export function detectColor(
  stream: NodeJS.WritableStream = process.stderr,
): boolean {
  if (process.env.NO_COLOR) return false;
  if (process.env.FORCE_COLOR && process.env.FORCE_COLOR !== "0") return true;
  const s = stream as NodeJS.WritableStream & { isTTY?: boolean };
  return s.isTTY === true;
}

/** Build a `Colors` object whose methods no-op when color output is disabled. */
export function createColors(opts: CreateColorsOptions = {}): Colors {
  const enabled = opts.enabled ?? detectColor(opts.stream);
  const wrap =
    (code: string) =>
    (s: string | number): string =>
      enabled ? `${code}${String(s)}${ANSI.reset}` : String(s);
  const paint = (code: string, s: string | number): string =>
    enabled ? `${code}${String(s)}${ANSI.reset}` : String(s);
  return {
    enabled,
    dim: wrap(ANSI.dim),
    bold: wrap(ANSI.bold),
    red: wrap(ANSI.red),
    green: wrap(ANSI.green),
    yellow: wrap(ANSI.yellow),
    cyan: wrap(ANSI.cyan),
    gray: wrap(ANSI.gray),
    paint,
  };
}

/** Named ANSI codes, exported for advanced callers that need `paint(code, s)`. */
export const ANSI_CODES: Readonly<typeof ANSI> = ANSI;
