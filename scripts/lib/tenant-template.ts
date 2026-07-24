/**
 * Repo-side shim over the `aem-to-sanity-cli` package's template helpers.
 *
 * The helpers themselves (env parsing, template classification, fixtures
 * inspection, copyTree/renameWorkspace) live in the published package so the
 * standalone `aem-to-sanity` CLI and this monorepo share one implementation.
 * This shim adds the monorepo path constants used by the init scripts.
 */
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export * from "aem-to-sanity-cli";

const here = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(here, "..", "..");
export const TENANTS_DIR = join(REPO_ROOT, "tenants");
export const TEMPLATE_DIR = join(TENANTS_DIR, "template");
/** Per-tenant Studio template, scaffolded by studio:init / migrate:init. */
export const STUDIO_TEMPLATE_DIR = join(TEMPLATE_DIR, "studio");

export function tenantDir(slug: string): string {
  return join(TENANTS_DIR, slug);
}
