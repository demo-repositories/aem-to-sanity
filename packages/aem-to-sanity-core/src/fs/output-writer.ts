import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}

export async function writeTextFile(
  filePath: string,
  content: string,
): Promise<void> {
  await ensureDir(dirname(filePath));
  await writeFile(filePath, content, "utf8");
}

export interface WriteJsonOptions {
  /** Pretty-print with 2-space indent. Default: true. */
  pretty?: boolean;
}

export async function writeJson(
  filePath: string,
  data: unknown,
  opts: WriteJsonOptions = {},
): Promise<void> {
  const pretty = opts.pretty ?? true;
  const content = pretty
    ? JSON.stringify(data, null, 2) + "\n"
    : JSON.stringify(data);
  await writeTextFile(filePath, content);
}
