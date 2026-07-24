/**
 * Build step: embed the project template into the publishable package.
 *
 * Copies `tenants/template/` → `<pkg>/template/` and rewrites the parts that
 * assume the monorepo:
 *
 * - `workspace:*` dependency specs → `^<version>` (this package's version —
 *   the whole toolkit is a Changesets fixed group, so one version fits all).
 * - README.md → the standalone-flavored copy from `template-overrides/`.
 * - Adds `.gitignore` + `pnpm-workspace.yaml` (npm users get the
 *   `"workspaces"` field already present in package.json; pnpm needs the
 *   yaml file).
 *
 * Runs as part of `pnpm build`, so the published tarball always carries the
 * template matching this version of the toolkit.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const PKG_ROOT = resolve(here, "..");
const REPO_TEMPLATE = resolve(PKG_ROOT, "..", "..", "tenants", "template");
const OUT = join(PKG_ROOT, "template");
const OVERRIDES = join(PKG_ROOT, "template-overrides");

const SKIP = new Set(["node_modules", "output", ".turbo", ".DS_Store", ".env", "dist", ".sanity"]);

function copyTree(src: string, dest: string): void {
  mkdirSync(dest, { recursive: true });
  for (const name of readdirSync(src)) {
    if (SKIP.has(name)) continue;
    const s = join(src, name);
    const d = join(dest, name);
    if (statSync(s).isDirectory()) copyTree(s, d);
    else cpSync(s, d);
  }
}

function rewriteWorkspaceSpecs(pkgPath: string, version: string): void {
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as Record<string, any>;
  for (const section of ["dependencies", "devDependencies"]) {
    const deps = pkg[section] as Record<string, string> | undefined;
    if (!deps) continue;
    for (const [name, spec] of Object.entries(deps)) {
      if (spec.startsWith("workspace:")) deps[name] = `^${version}`;
    }
  }
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
}

function main(): void {
  if (!existsSync(REPO_TEMPLATE)) {
    throw new Error(`template source not found: ${REPO_TEMPLATE}`);
  }
  const version = (
    JSON.parse(readFileSync(join(PKG_ROOT, "package.json"), "utf8")) as { version: string }
  ).version;

  rmSync(OUT, { recursive: true, force: true });
  copyTree(REPO_TEMPLATE, OUT);

  rewriteWorkspaceSpecs(join(OUT, "package.json"), version);
  rewriteWorkspaceSpecs(join(OUT, "studio", "package.json"), version);

  // Standalone-only files. `dot-*` names are kept verbatim — npm pack strips
  // `.gitignore` (and friends) from tarballs, so the rename to `.*` happens in
  // create-aem-to-sanity's copyTemplate at scaffold time, not here.
  for (const name of readdirSync(OVERRIDES)) {
    cpSync(join(OVERRIDES, name), join(OUT, name));
  }
  writeFileSync(join(OUT, "pnpm-workspace.yaml"), 'packages:\n  - "studio"\n');

  // Standalone scaffolds always carry their Studio at ./studio — activate the
  // schema out-dir so migrate:schema feeds it instead of {OUTPUT_DIR}/schemas
  // (which the Studio never loads).
  const envExample = join(OUT, ".env.example");
  writeFileSync(
    envExample,
    readFileSync(envExample, "utf8").replace(
      "# SCHEMAS_OUT_DIR=./studio/schemas/generated",
      "SCHEMAS_OUT_DIR=./studio/schemas/generated",
    ),
  );

  console.log(`[embed-template] ${REPO_TEMPLATE} → ${OUT} (workspace:* → ^${version})`);
}

main();
