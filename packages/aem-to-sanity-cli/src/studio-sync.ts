/**
 * Sync a project's Studio with the template Studio's file surface.
 *
 * Monorepo mode:
 *   aem-to-sanity studio-sync <slug> [--fix]
 *   aem-to-sanity studio-sync --all [--fix]
 *
 * Standalone mode (studio/ at the project root):
 *   aem-to-sanity studio-sync [--fix]
 *
 * - file in template but missing from the studio  → reported; copied with --fix
 * - dependency in the template studio's package.json missing → reported;
 *   added with --fix (run install afterwards)
 * - file present in both but different → reported as drift, NEVER overwritten
 *
 * schemas/generated/ is skipped (owned by `migrate:schema`), as are .env
 * files, node_modules, and build output. Code-level Studio surface ships via
 * the `aem-to-sanity-studio` package and updates with the toolkit — this
 * command covers the thin file shell around it.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

import { IGNORED_NAMES } from "./lib/tenant-template.ts";
import { inferTenantSlug, type WorkspaceContext } from "./paths.ts";

const SKIP_NAMES = new Set([...IGNORED_NAMES, "dist", ".env"]);
const SKIP_RELATIVE = new Set(["schemas/generated", "package.json"]);

interface Report {
  missing: string[];
  drift: string[];
  missingDeps: string[];
}

function fail(msg: string): never {
  console.error(`[studio-sync] ${msg}`);
  process.exit(2);
}

function walkTemplate(templateStudioDir: string, dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_NAMES.has(entry.name)) continue;
    const abs = join(dir, entry.name);
    const rel = relative(templateStudioDir, abs);
    if (SKIP_RELATIVE.has(rel)) continue;
    if (entry.isDirectory()) walkTemplate(templateStudioDir, abs, out);
    else out.push(rel);
  }
  return out;
}

function syncStudio(
  ctx: WorkspaceContext,
  label: string,
  studioDir: string,
  fix: boolean,
): Report | null {
  if (!existsSync(studioDir)) {
    const hint =
      ctx.mode === "monorepo"
        ? `scaffold one with \`pnpm -w studio:init ${label}\``
        : "no studio/ folder in this project";
    console.log(`[studio-sync] ${label}: no studio/ — ${hint}`);
    return null;
  }

  const templateStudioDir = ctx.studioTemplateDir;
  const report: Report = { missing: [], drift: [], missingDeps: [] };

  for (const rel of walkTemplate(templateStudioDir, templateStudioDir)) {
    const src = join(templateStudioDir, rel);
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

  const templatePkg = JSON.parse(readFileSync(join(templateStudioDir, "package.json"), "utf8"));
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
      `  [drift]   studio/${rel} differs from the template (kept yours — diff against the template's ${rel})`,
    );
  }
  if (report.missing.length + report.drift.length + report.missingDeps.length === 0) {
    console.log("  in sync with the template");
  }
  return report;
}

export function runStudioSync(args: string[], ctx: WorkspaceContext): never {
  const fix = args.includes("--fix");
  const rest = args.filter((a) => a !== "--fix");
  const all = rest.includes("--all");
  const slug = rest.find((a) => !a.startsWith("--"));

  interface Target {
    label: string;
    studioDir: string;
  }
  let targets: Target[];

  if (ctx.mode === "standalone") {
    if (all || slug) {
      fail("standalone project — run `aem-to-sanity studio-sync [--fix]` with no tenant argument");
    }
    targets = [{ label: ".", studioDir: join(ctx.root, "studio") }];
  } else {
    const tenantsDir = ctx.tenantsDir!;
    const effectiveSlug = slug ?? inferTenantSlug(ctx);
    if (!all && !effectiveSlug) {
      fail("usage: aem-to-sanity studio-sync <slug> [--fix]   (or --all)");
    }
    const slugs = all
      ? readdirSync(tenantsDir, { withFileTypes: true })
          .filter((e) => e.isDirectory() && e.name !== "template" && !IGNORED_NAMES.has(e.name))
          .map((e) => e.name)
      : [effectiveSlug as string];
    targets = slugs.map((s) => ({ label: s, studioDir: join(tenantsDir, s, "studio") }));
  }

  let unfixed = 0;
  for (const t of targets) {
    console.log(`[studio-sync] ${t.label}:`);
    const report = syncStudio(ctx, t.label, t.studioDir, fix);
    if (report && !fix) unfixed += report.missing.length + report.missingDeps.length;
  }

  if (fix) {
    console.log("[studio-sync] run install to link any newly added dependencies");
    process.exit(0);
  }
  if (unfixed > 0) {
    console.log(`[studio-sync] ${unfixed} fixable finding(s) — rerun with --fix to apply`);
    process.exit(1);
  }
  process.exit(0);
}
