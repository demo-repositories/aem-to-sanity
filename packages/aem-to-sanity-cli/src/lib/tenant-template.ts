/**
 * Shared template helpers for the aem-to-sanity CLI (doctor, studio-sync) and
 * the monorepo's init scripts. Path resolution (where the template and
 * tenants live) is the caller's concern — see paths.ts.
 *
 * Knows which files in tenants/template/ are template-owned (drift checked,
 * safe to refresh) vs operator-owned (do not touch, never compare) vs
 * ignored (caches, node_modules, output).
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

/** Committed tenants that are not created via migrate:init. */
export const COMMITTED_TENANTS = new Set(["demo"]);

/**
 * Files whose contents come from the template. Doctor compares these and
 * reports drift; init seeds them verbatim.
 */
export const TEMPLATE_FILES = [
  "README.md",
  ".env.example",
  "aem-content-roots.example",
] as const;

/**
 * Files the operator owns and customizes. Doctor never compares contents;
 * init seeds them from the template's empty/example version once.
 */
export const OPERATOR_FILES = [
  ".env",
  "aem-content-roots",
  "aem-component-paths",
  "aem-component-containers.json",
  "aem-component-hints.json",
  "aem-component-names.json",
  "aem-component-exceptions",
  "aem-page-components.json",
  "aem-tag-roots",
] as const;

/**
 * Names that must be skipped during init copy + doctor walks regardless of
 * where they appear.
 */
export const IGNORED_NAMES = new Set([
  "node_modules",
  "output",
  ".turbo",
  ".DS_Store",
]);

export interface EnvLine {
  key: string;
  value: string;
  /** True if the line is uncommented in .env.example — operator must set it. */
  required: boolean;
  /** Placeholder value from .env.example (e.g. "your-project-id"). */
  placeholder: string;
}

/**
 * Parse `.env`-style content into a key→value map. Skips comments + blank
 * lines, strips matched surrounding quotes.
 */
export function parseEnv(content: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out.set(key, value);
  }
  return out;
}

/**
 * Introspect `.env.example`. Returns one entry per `KEY=value` line found,
 * with `required=true` when the line is uncommented (operator must set it
 * before running the migration) and `required=false` when commented
 * (informational / optional override).
 *
 * `placeholder` always holds the value as it appears in `.env.example` so
 * the doctor can detect "operator forgot to replace the placeholder".
 */
export function parseEnvExample(content: string): EnvLine[] {
  const out: EnvLine[] = [];
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const required = !line.startsWith("#");
    const body = required ? line : line.replace(/^#+\s*/, "");
    if (!/^[A-Z][A-Z0-9_]*=/.test(body)) continue;
    const eq = body.indexOf("=");
    const key = body.slice(0, eq).trim();
    let value = body.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out.push({ key, value, required, placeholder: value });
  }
  return out;
}

export function readFileIfExists(path: string): string | null {
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}

/** Recursive template copy, skipping {@link IGNORED_NAMES}. */
export function copyTree(src: string, dest: string): void {
  mkdirSync(dest, { recursive: true });
  for (const name of readdirSync(src)) {
    if (IGNORED_NAMES.has(name)) continue;
    const srcPath = join(src, name);
    const destPath = join(dest, name);
    if (statSync(srcPath).isDirectory()) {
      copyTree(srcPath, destPath);
    } else {
      copyFileSync(srcPath, destPath);
    }
  }
}

/** Rewrite a scaffolded package.json's workspace name. */
export function renameWorkspace(packageJsonPath: string, name: string): void {
  const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
    name: string;
    [k: string]: unknown;
  };
  pkg.name = name;
  writeFileSync(packageJsonPath, JSON.stringify(pkg, null, 2) + "\n", "utf8");
}

/**
 * AEM authentication is "pick one of three flows" rather than "all required",
 * so the env doctor needs a dedicated check instead of a per-var check.
 */
export const AEM_AUTH_FLOWS = [
  {
    name: "service credentials",
    keys: ["AEM_SERVICE_CREDENTIALS_FILE", "AEM_SERVICE_CREDENTIALS"],
    mode: "any-of",
  },
  { name: "developer token", keys: ["AEM_TOKEN"], mode: "any-of" },
  {
    name: "basic auth",
    keys: ["AEM_AUTHOR_USERNAME", "AEM_AUTHOR_PASSWORD"],
    mode: "all-of",
  },
] as const;

/**
 * Heuristic to detect leftover template placeholder values. Matches anything
 * containing a `your-…` token, runs of x/X, or angle-bracketed `<…>` slugs.
 * Sensible defaults shipped in .env.example (e.g. `author`, `production`)
 * deliberately do NOT match — those are values the operator may keep as-is.
 */
const PLACEHOLDER_RE = /your-|<[^>]+>|x{3,}|X{3,}/;

export function isMeaningfulValue(value: string | undefined): boolean {
  if (!value) return false;
  if (PLACEHOLDER_RE.test(value)) return false;
  return true;
}

/** Env keys tied to live AEM HTTP — not required when `AEM_FIXTURES_DIR` is set. */
export const AEM_CONNECTIVITY_KEYS = new Set([
  "AEM_ENV",
  "AEM_AUTHOR_URL",
  "AEM_AUTHOR_USERNAME",
  "AEM_AUTHOR_PASSWORD",
  "AEM_PUBLISH_URL",
  "AEM_PUBLISH_USERNAME",
  "AEM_PUBLISH_PASSWORD",
  "AEM_TOKEN",
  "AEM_SERVICE_CREDENTIALS_FILE",
  "AEM_SERVICE_CREDENTIALS",
]);

export interface FixturesLayout {
  fixturesRoot: string;
  exists: boolean;
  isDirectory: boolean;
  /** Path-mirror or legacy `.infinity.json` bodies under `content/`. */
  contentJsonCount: number;
  /** Path-mirror or legacy `.infinity.json` bodies under `apps/`. */
  componentsJsonCount: number;
  /** Legacy flat `.infinity.json` files at the fixtures root. */
  flatInfinityJsonCount: number;
  assetCount: number;
}

function isInfinityBodyFile(name: string): boolean {
  return name.endsWith(".infinity.json") && !name.endsWith(".infinity.json.meta.json");
}

function walkInfinityFixtures(
  dir: string,
  relPrefix: string,
  layout: FixturesLayout,
): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if ((entry.name === "assets" || entry.name === "images") && relPrefix === "") continue;
    const relPath = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walkInfinityFixtures(full, relPath, layout);
      continue;
    }
    if (!isInfinityBodyFile(entry.name)) continue;
    if (relPrefix === "" && entry.name.includes("__")) {
      layout.flatInfinityJsonCount++;
    }
    const inLegacyContentBucket = relPrefix === "content" || relPath.startsWith("content/");
    const inLegacyAppsBucket = relPrefix === "components" || relPath.startsWith("components/");
    if (
      relPath.startsWith("content/") ||
      entry.name.startsWith("content__") ||
      (inLegacyContentBucket && !entry.name.startsWith("apps__"))
    ) {
      layout.contentJsonCount++;
    } else if (
      relPath.startsWith("apps/") ||
      entry.name.startsWith("apps__") ||
      inLegacyAppsBucket
    ) {
      layout.componentsJsonCount++;
    }
  }
}

/** Resolve `AEM_FIXTURES_DIR` relative to the tenant folder. */
export function resolveFixturesRoot(tenantDirPath: string, envValue: string): string {
  const trimmed = envValue.trim();
  return isAbsolute(trimmed) ? trimmed : resolve(tenantDirPath, trimmed);
}

/** Count `.infinity.json` fixture bodies (path-mirror or legacy layout). */
export function inspectFixturesLayout(fixturesRoot: string): FixturesLayout {
  const layout: FixturesLayout = {
    fixturesRoot,
    exists: existsSync(fixturesRoot),
    isDirectory: false,
    contentJsonCount: 0,
    componentsJsonCount: 0,
    flatInfinityJsonCount: 0,
    assetCount: 0,
  };
  if (!layout.exists) return layout;
  if (!statSync(fixturesRoot).isDirectory()) return layout;
  layout.isDirectory = true;

  walkInfinityFixtures(fixturesRoot, "", layout);

  for (const subdir of ["assets", "images"] as const) {
    const dir = join(fixturesRoot, subdir);
    if (!existsSync(dir) || !statSync(dir).isDirectory()) continue;
    for (const name of readdirSync(dir)) {
      if (!name.startsWith(".")) layout.assetCount++;
    }
    break;
  }

  return layout;
}

export function hasFixturesContent(layout: FixturesLayout): boolean {
  return (
    layout.contentJsonCount > 0 ||
    layout.componentsJsonCount > 0 ||
    layout.flatInfinityJsonCount > 0
  );
}
