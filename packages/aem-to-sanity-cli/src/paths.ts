/**
 * Workspace-mode resolution. The CLI runs in two layouts:
 *
 * - **monorepo** — the aem-to-sanity toolkit repo (or a clone-mode scaffold
 *   of it): tenants live under `tenants/<slug>/`, the template at
 *   `tenants/template/`. Detected by walking up from cwd until a directory
 *   containing `tenants/template/package.json` is found.
 *
 * - **standalone** — a thin scaffold from `npm create @shehjad/aem-to-sanity`:
 *   the project root IS the tenant (`.env.example`, `aem-component-paths`,
 *   `studio/` at the top level). The reference template ships inside this
 *   package (`<pkg>/template`, embedded at build time).
 */
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface WorkspaceContext {
  mode: "monorepo" | "standalone";
  /** Repo root (monorepo) or project root (standalone). */
  root: string;
  /** Directory holding the reference template for drift checks / sync. */
  templateDir: string;
  studioTemplateDir: string;
  /** `tenants/` directory — monorepo mode only. */
  tenantsDir: string | undefined;
}

/** The template embedded in this package by scripts/embed-template.ts. */
export function embeddedTemplateDir(): string {
  // dist/index.js → <pkg>/template ; src/paths.ts (tsx dev) → same via ../
  const here = dirname(fileURLToPath(import.meta.url));
  for (const candidate of [join(here, "..", "template"), join(here, "..", "..", "template")]) {
    if (existsSync(join(candidate, "package.json"))) return candidate;
  }
  throw new Error(
    "embedded template not found — this aem-to-sanity-cli build is incomplete (run its build to embed the template)",
  );
}

function isStandaloneRoot(dir: string): boolean {
  return (
    existsSync(join(dir, ".env.example")) &&
    (existsSync(join(dir, "aem-component-paths")) ||
      existsSync(join(dir, "aem-content-roots.example")))
  );
}

export function resolveContext(cwd: string = process.cwd()): WorkspaceContext {
  // Monorepo check must win over the standalone heuristic: inside the
  // toolkit repo, every tenant folder ALSO looks like a standalone root
  // (.env.example + aem-component-paths), so scan the whole ancestor chain
  // for a monorepo marker before settling for standalone.
  const start = resolve(cwd);
  for (let dir = start; ; dir = dirname(dir)) {
    const templateDir = join(dir, "tenants", "template");
    if (existsSync(join(templateDir, "package.json"))) {
      return {
        mode: "monorepo",
        root: dir,
        templateDir,
        studioTemplateDir: join(templateDir, "studio"),
        tenantsDir: join(dir, "tenants"),
      };
    }
    if (dirname(dir) === dir) break;
  }
  for (let dir = start; ; dir = dirname(dir)) {
    if (isStandaloneRoot(dir)) {
      const templateDir = embeddedTemplateDir();
      return {
        mode: "standalone",
        root: dir,
        templateDir,
        studioTemplateDir: join(templateDir, "studio"),
        tenantsDir: undefined,
      };
    }
    if (dirname(dir) === dir) {
      throw new Error(
        "not inside an aem-to-sanity project — run from a scaffolded project (`.env.example` + `aem-component-paths` at the root) or the toolkit monorepo",
      );
    }
  }
}

/**
 * When run from inside `tenants/<slug>/…` with no explicit slug, infer it —
 * lets a tenant's own `npm run doctor` / `studio-sync` scripts work in both
 * monorepo and standalone layouts.
 */
export function inferTenantSlug(ctx: WorkspaceContext, cwd: string = process.cwd()): string | undefined {
  if (ctx.mode !== "monorepo" || !ctx.tenantsDir) return undefined;
  const rel = resolve(cwd).slice(ctx.tenantsDir.length + 1);
  if (!resolve(cwd).startsWith(ctx.tenantsDir + "/")) return undefined;
  const slug = rel.split("/")[0];
  return slug && slug !== "template" ? slug : undefined;
}
