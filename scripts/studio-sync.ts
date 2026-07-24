#!/usr/bin/env node
/**
 * Sync a tenant Studio with the template Studio's file surface.
 *
 *   pnpm -w studio:sync <slug> [--fix]
 *   pnpm -w studio:sync --all [--fix]
 *
 * Tenant studios are copied from tenants/template/studio/ once at init time
 * and then diverge freely, so template additions (a new aspect, script, or
 * config default the migration needs) don't reach existing tenants on their
 * own. This command closes that gap at the file level:
 *
 *   - file in template but missing from the tenant studio  → reported;
 *     copied with --fix
 *   - dependency in the template studio's package.json missing from the
 *     tenant's                                             → reported;
 *     added with --fix (run `pnpm install` afterwards)
 *   - file present in both but different                   → reported as
 *     drift, NEVER overwritten (operator customizations win — diff by hand)
 *
 * schemas/generated/ is skipped (owned by `migrate:schema`), as are .env
 * files, node_modules, and build output. Code-level Studio surface (the
 * category type, aspects, input components) ships via the
 * `aem-to-sanity-studio` package and updates with the toolkit — this command
 * covers the thin file shell around it.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

import {
  IGNORED_NAMES,
  STUDIO_TEMPLATE_DIR,
  TENANTS_DIR,
  tenantDir,
} from "./lib/tenant-template.ts";

const SKIP_NAMES = new Set([...IGNORED_NAMES, "dist", ".env"]);
const SKIP_RELATIVE = new Set(["schemas/generated", "package.json"]);

interface Report {
  missing: string[];
  drift: string[];
  missingDeps: string[];
}

function fail(msg: string): never {
  console.error(`[studio:sync] ${msg}`);
  process.exit(2);
}

function walkTemplate(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_NAMES.has(entry.name)) continue;
    const abs = join(dir, entry.name);
    const rel = relative(STUDIO_TEMPLATE_DIR, abs);
    if (SKIP_RELATIVE.has(rel)) continue;
    if (entry.isDirectory()) walkTemplate(abs, out);
    else out.push(rel);
  }
  return out;
}

function syncStudio(slug: string, fix: boolean): Report | null {
  const studioDir = join(tenantDir(slug), "studio");
  if (!existsSync(studioDir)) {
    console.log(`[studio:sync] ${slug}: no studio/ — scaffold one with \`pnpm -w studio:init ${slug}\``);
    return null;
  }

  const report: Report = { missing: [], drift: [], missingDeps: [] };

  for (const rel of walkTemplate(STUDIO_TEMPLATE_DIR)) {
    const src = join(STUDIO_TEMPLATE_DIR, rel);
    const dest = join(studioDir, rel);
    if (!existsSync(dest)) {
      report.missing.push(rel);
      if (fix) {
        mkdirSync(dirname(dest), { recursive: true });
        copyFileSync(src, dest);
      }
    } else if (readFileSync(src, "utf8") !== readFileSync(dest, "utf8")) {
      report.drift.push(rel);
    }
  }

  const templatePkg = JSON.parse(readFileSync(join(STUDIO_TEMPLATE_DIR, "package.json"), "utf8"));
  const tenantPkgPath = join(studioDir, "package.json");
  const tenantPkg = JSON.parse(readFileSync(tenantPkgPath, "utf8"));
  for (const section of ["dependencies", "devDependencies"] as const) {
    for (const [dep, spec] of Object.entries(templatePkg[section] ?? {})) {
      if (!tenantPkg.dependencies?.[dep] && !tenantPkg.devDependencies?.[dep]) {
        report.missingDeps.push(`${dep} (${section}: ${spec})`);
        if (fix) {
          tenantPkg[section] = { ...(tenantPkg[section] ?? {}), [dep]: spec };
        }
      }
    }
  }
  if (fix && report.missingDeps.length > 0) {
    writeFileSync(tenantPkgPath, `${JSON.stringify(tenantPkg, null, 2)}\n`);
  }

  const verb = fix ? "copied" : "missing";
  for (const rel of report.missing) console.log(`  [${verb}]  studio/${rel}`);
  const depVerb = fix ? "added" : "missing dep";
  for (const dep of report.missingDeps) console.log(`  [${depVerb}]  ${dep}`);
  for (const rel of report.drift) {
    console.log(
      `  [drift]   studio/${rel} differs from the template (kept yours — diff against tenants/template/studio/${rel})`,
    );
  }
  if (report.missing.length + report.drift.length + report.missingDeps.length === 0) {
    console.log("  in sync with the template");
  }
  return report;
}

function main(): void {
  const args = process.argv.slice(2);
  const fix = args.includes("--fix");
  const rest = args.filter((a) => a !== "--fix");
  const all = rest.includes("--all");
  const slug = rest.find((a) => !a.startsWith("--"));

  if (!all && !slug) {
    fail("usage: pnpm -w studio:sync <slug> [--fix]   (or --all)");
  }

  const slugs = all
    ? readdirSync(TENANTS_DIR, { withFileTypes: true })
        .filter((e) => e.isDirectory() && e.name !== "template" && !IGNORED_NAMES.has(e.name))
        .map((e) => e.name)
    : [slug as string];

  let unfixed = 0;
  for (const s of slugs) {
    console.log(`[studio:sync] ${s}:`);
    const report = syncStudio(s, fix);
    if (report && !fix) unfixed += report.missing.length + report.missingDeps.length;
  }

  if (fix) {
    console.log("[studio:sync] run `pnpm install` to link any newly added dependencies");
  } else if (unfixed > 0) {
    console.log(`[studio:sync] ${unfixed} fixable finding(s) — rerun with --fix to apply`);
    process.exit(1);
  }
}

main();
