import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Logger } from "aem-to-sanity-core";

export interface RunSubprocessOptions {
  /** Working directory for the child process. */
  cwd: string;
  args: string[];
  binName: string;
  /**
   * Optional additional starting point for resolving the binary via a walk-up
   * of `node_modules/.bin`. Defaults to `cwd`.
   */
  binSearchCwd?: string;
  logger?: Logger;
}

/**
 * Runs the `sanity` CLI (resolved from `node_modules/.bin/sanity` walking up
 * from `binSearchCwd` or `cwd`) as a child process and streams stdout/stderr
 * through to the parent. Resolves when the process exits 0; rejects otherwise
 * with the captured stderr tail.
 */
export function runSanityCli(opts: RunSubprocessOptions): Promise<void> {
  return runExternalCli(opts);
}

/**
 * Generic version of {@link runSanityCli} usable for other CLIs (e.g. `tsx`).
 * Kept as a separate name so call sites document intent.
 */
export function runExternalCli(opts: RunSubprocessOptions): Promise<void> {
  const { cwd, args, binName, logger } = opts;

  const bin = resolveBinPath(opts.binSearchCwd ?? cwd, binName);

  logger?.debug(`spawn: ${bin} ${args.join(" ")}`, { cwd });

  return new Promise<void>((resolve, reject) => {
    const child = spawn(bin, args, {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stderrTail = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      const s = chunk.toString("utf8").trimEnd();
      if (s) logger?.debug(`[${binName}] ${s}`);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      const s = chunk.toString("utf8");
      stderrTail = (stderrTail + s).slice(-2000);
      const trimmed = s.trimEnd();
      if (trimmed) logger?.debug(`[${binName}] ${trimmed}`);
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else
        reject(
          new Error(
            `${binName} ${args[0] ?? ""} exited with code ${code}. stderr:\n${stderrTail}`,
          ),
        );
    });
  });
}

function resolveBinPath(cwd: string, binName: string): string {
  const seen = new Set<string>();
  const candidates: string[] = [];

  // Walk up from cwd, checking `node_modules/.bin/<name>` at each level.
  let dir = cwd;
  for (let depth = 0; depth < 20; depth++) {
    const candidate = join(dir, "node_modules", ".bin", binName);
    if (!seen.has(candidate)) {
      candidates.push(candidate);
      seen.add(candidate);
    }
    const parent = join(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }

  // Also probe the CWD of the Node process (covers monorepo roots the typegen
  // was invoked from but not its descendants).
  const fromCwd = join(process.cwd(), "node_modules", ".bin", binName);
  if (!seen.has(fromCwd)) candidates.push(fromCwd);

  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return binName;
}
