/**
 * Detect drift between a migration project and the reference template, plus
 * sanity-check the operator's .env against .env.example.
 *
 * Monorepo mode:
 *   aem-to-sanity doctor <slug> [--fix]     one tenant under tenants/
 *   aem-to-sanity doctor --all [--fix]      every tenant
 *
 * Standalone mode (thin scaffold — the project root is the tenant):
 *   aem-to-sanity doctor [--fix]
 *
 * Exits 0 when clean, 1 when findings remain after any fixes were applied.
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  AEM_AUTH_FLOWS,
  AEM_CONNECTIVITY_KEYS,
  COMMITTED_TENANTS,
  OPERATOR_FILES,
  TEMPLATE_FILES,
  hasFixturesContent,
  inspectFixturesLayout,
  isMeaningfulValue,
  parseEnv,
  parseEnvExample,
  readFileIfExists,
  resolveFixturesRoot,
  type FixturesLayout,
} from "./lib/tenant-template.ts";
import { inferTenantSlug, type WorkspaceContext } from "./paths.ts";

type Severity = "error" | "warn" | "info";

interface Finding {
  severity: Severity;
  area: "package.json" | "template-file" | "env" | "structure" | "fixtures";
  message: string;
}

const findings: Finding[] = [];
const record = (severity: Severity, area: Finding["area"], message: string): void => {
  findings.push({ severity, area, message });
};

function fail(msg: string): never {
  console.error(`[doctor] ${msg}`);
  process.exit(2);
}

/** In standalone mode nothing is a committed tenant. */
function isCommitted(ctx: WorkspaceContext, slug: string): boolean {
  return ctx.mode === "monorepo" && COMMITTED_TENANTS.has(slug);
}

function checkPackageJson(ctx: WorkspaceContext, dir: string, fix: boolean, slug: string): void {
  const templatePkgPath = join(ctx.templateDir, "package.json");
  const tenantPkgPath = join(dir, "package.json");
  if (!existsSync(tenantPkgPath)) {
    record("error", "structure", "package.json is missing");
    return;
  }
  if (isCommitted(ctx, slug)) {
    record("info", "package.json", "committed tenant — scripts block not compared to template");
    return;
  }
  const templatePkg = JSON.parse(readFileSync(templatePkgPath, "utf8")) as Record<string, any>;
  const tenantPkg = JSON.parse(readFileSync(tenantPkgPath, "utf8")) as Record<string, any>;

  const templateScripts = (templatePkg.scripts ?? {}) as Record<string, string>;
  const tenantScripts = (tenantPkg.scripts ?? {}) as Record<string, string>;

  const drift: string[] = [];
  for (const [key, val] of Object.entries(templateScripts)) {
    if (tenantScripts[key] === undefined) {
      drift.push(`+ scripts.${key}: missing`);
    } else if (tenantScripts[key] !== val) {
      drift.push(`~ scripts.${key}: differs from template`);
    }
  }

  if (drift.length === 0) {
    record("info", "package.json", "scripts block matches template");
    return;
  }

  if (fix) {
    tenantPkg.scripts = { ...templateScripts };
    writeFileSync(tenantPkgPath, JSON.stringify(tenantPkg, null, 2) + "\n", "utf8");
    record("info", "package.json", `fixed scripts block (${drift.length} change(s))`);
  } else {
    for (const line of drift) {
      record("warn", "package.json", line);
    }
    record("warn", "package.json", "run with --fix to overwrite the scripts block with the template's");
  }
}

function checkTemplateFiles(ctx: WorkspaceContext, dir: string, slug: string): void {
  if (isCommitted(ctx, slug)) {
    record("info", "template-file", "committed tenant — template file drift not checked");
    return;
  }
  for (const name of TEMPLATE_FILES) {
    const templatePath = join(ctx.templateDir, name);
    const tenantPath = join(dir, name);
    const templateContent = readFileIfExists(templatePath);
    const tenantContent = readFileIfExists(tenantPath);
    if (templateContent === null) continue;
    if (tenantContent === null) {
      record("warn", "template-file", `${name} missing — template has a newer version`);
      continue;
    }
    if (tenantContent !== templateContent) {
      record(
        "warn",
        "template-file",
        `${name} differs from template (re-copy if you haven't customized it)`,
      );
    }
  }
}

function recordFixturesLayoutFindings(
  layout: FixturesLayout,
  opts: { strictImages: boolean; buildHint?: string },
): void {
  if (!layout.exists) {
    record("error", "fixtures", `fixtures directory not found: ${layout.fixturesRoot}`);
    return;
  }
  if (!layout.isDirectory) {
    record("error", "fixtures", `AEM_FIXTURES_DIR is not a directory: ${layout.fixturesRoot}`);
    return;
  }

  const hasContent = layout.contentJsonCount > 0;
  const hasComponents = layout.componentsJsonCount > 0;
  const hasFlat = layout.flatInfinityJsonCount > 0;
  const hint = opts.buildHint ? ` — ${opts.buildHint}` : "";

  if (!hasContent) {
    record("error", "fixtures", `fixtures missing /content/ .infinity.json trees${hint}`);
  }
  if (!hasComponents) {
    record("error", "fixtures", `fixtures missing /apps/ .infinity.json trees${hint}`);
  }
  if (hasFlat && !hasContent && !hasComponents) {
    record(
      "info",
      "fixtures",
      `flat fixture layout (${layout.flatInfinityJsonCount} .infinity.json at root)`,
    );
  }

  if (layout.assetCount === 0) {
    const msg =
      "fixtures assets/ missing or empty — run assets with --link-only or set MIGRATION_LINK_ONLY=true";
    record(opts.strictImages ? "error" : "warn", "fixtures", msg);
  } else {
    record("info", "fixtures", `${layout.assetCount} fixture asset(s) under assets/`);
  }

  if (hasFixturesContent(layout)) {
    record(
      "info",
      "fixtures",
      `${layout.contentJsonCount} content + ${layout.componentsJsonCount} component fixture(s)`,
    );
  }
}

function validateTenantEnvRequired(
  declared: ReturnType<typeof parseEnvExample>,
  tenantEnv: Map<string, string>,
  skipKeys: Set<string>,
): void {
  for (const entry of declared) {
    if (!entry.required || skipKeys.has(entry.key)) continue;
    const value = tenantEnv.get(entry.key);
    if (value === undefined) {
      record("error", "env", `${entry.key} is required but missing in .env`);
    } else if (!value) {
      record("error", "env", `${entry.key} is empty in .env`);
    } else if (!isMeaningfulValue(value)) {
      record("error", "env", `${entry.key}="${value}" still looks like a template placeholder`);
    }
  }
}

/**
 * Required-in-.env.example keys that this tenant's configuration renders
 * unused, so missing / empty / placeholder values must not error.
 *
 * Download-only asset mode (`MIGRATION_ASSETS_DOWNLOAD_ONLY=true`, same as
 * `aem-assets --download-only`) stops after phase 1 (AEM download) — no ML
 * dedup lookup, upload, link, or rewrite, regardless of `MIGRATION_DRY_RUN` —
 * so `SANITY_MEDIA_LIBRARY_ID` is never read. Same for the Bynder backend
 * (`MIGRATION_ASSET_BACKEND=bynder`): assets resolve against the Bynder
 * portal and never touch the Media Library. `SANITY_TOKEN` stays required:
 * `aem-import` needs it even when assets never touch the Media Library.
 */
export function conditionallyUnusedEnvKeys(tenantEnv: Map<string, string>): Set<string> {
  const out = new Set<string>();
  if (
    tenantEnv.get("MIGRATION_ASSETS_DOWNLOAD_ONLY") === "true" ||
    tenantEnv.get("MIGRATION_ASSET_BACKEND") === "bynder"
  ) {
    out.add("SANITY_MEDIA_LIBRARY_ID");
  }
  return out;
}

function recordConditionallyUnused(
  unused: Set<string>,
  tenantEnv: Map<string, string>,
): void {
  if (unused.has("SANITY_MEDIA_LIBRARY_ID")) {
    record(
      "info",
      "env",
      tenantEnv.get("MIGRATION_ASSETS_DOWNLOAD_ONLY") === "true"
        ? "MIGRATION_ASSETS_DOWNLOAD_ONLY=true — SANITY_MEDIA_LIBRARY_ID not required (assets stop after AEM download)"
        : "MIGRATION_ASSET_BACKEND=bynder — SANITY_MEDIA_LIBRARY_ID not required (assets resolve against Bynder)",
    );
  }
}

const BYNDER_REQUIRED_KEYS = [
  "BYNDER_BASE_URL",
  "BYNDER_TOKEN",
  "BYNDER_AEM_PATH_PROPERTY",
] as const;

/**
 * Asset-backend env sanity: an invalid `MIGRATION_ASSET_BACKEND` value is an
 * error (both migrate:schema and aem-assets refuse to start on it), and the
 * Bynder backend needs its portal / token / metaproperty vars — resolution
 * runs even under dry-run (read-only preview), so these aren't gated on
 * `MIGRATION_DRY_RUN=false` the way the Media Library id is.
 */
function checkAssetBackendEnv(tenantEnv: Map<string, string>): void {
  const backend = tenantEnv.get("MIGRATION_ASSET_BACKEND");
  if (backend !== undefined && backend !== "media-library" && backend !== "bynder") {
    record(
      "error",
      "env",
      `MIGRATION_ASSET_BACKEND="${backend}" is invalid — use "media-library" (default) or "bynder"`,
    );
    return;
  }
  if (backend !== "bynder") return;
  // Studio-side reminder: the tenant Studio activates
  // sanity-plugin-bynder-input off its own studio/.env
  // (SANITY_STUDIO_BYNDER_PORTAL_URL), which the doctor doesn't parse — so
  // this is an info nudge, not a check.
  record(
    "info",
    "env",
    "MIGRATION_ASSET_BACKEND=bynder — the Studio needs sanity-plugin-bynder-input active for the generated bynder.asset fields: set SANITY_STUDIO_BYNDER_PORTAL_URL in studio/.env (scaffolded studios wire it via aemBynderPlugin) or register the plugin manually",
  );
  if (tenantEnv.get("MIGRATION_ASSETS_DOWNLOAD_ONLY") === "true") return;
  for (const key of BYNDER_REQUIRED_KEYS) {
    if (!isMeaningfulValue(tenantEnv.get(key))) {
      record(
        "error",
        "env",
        `MIGRATION_ASSET_BACKEND=bynder but ${key} is unset — aem-assets can't resolve assets against Bynder`,
      );
    }
  }
}

function checkEnv(ctx: WorkspaceContext, dir: string, slug: string): void {
  const envExamplePath = join(dir, ".env.example");
  const envPath = join(dir, ".env");
  const envExampleContent = readFileIfExists(envExamplePath);
  if (envExampleContent === null) {
    record("error", "env", ".env.example missing");
    return;
  }

  const declared = parseEnvExample(envExampleContent);
  const isCommittedDemo = slug === "demo" && isCommitted(ctx, slug);

  if (isCommittedDemo) {
    const fixturesVar = declared.find((d) => d.key === "AEM_FIXTURES_DIR");
    if (!fixturesVar || !fixturesVar.required) {
      record("error", "env", "demo tenant .env.example must declare AEM_FIXTURES_DIR");
    }
    record("info", "env", "committed tenant — offline fixtures; AEM auth not required in .env.example");

    const envContent = readFileIfExists(envPath);
    if (envContent === null) {
      record("warn", "env", ".env missing — copy .env.example to .env and fill Sanity vars before migrate");
      const fixturesRoot = resolveFixturesRoot(dir, "./fixtures/aem");
      recordFixturesLayoutFindings(inspectFixturesLayout(fixturesRoot), {
        strictImages: true,
        buildHint: "run pnpm build:demo-fixtures",
      });
      return;
    }

    const tenantEnv = parseEnv(envContent);
    const demoUnused = conditionallyUnusedEnvKeys(tenantEnv);
    recordConditionallyUnused(demoUnused, tenantEnv);
    checkAssetBackendEnv(tenantEnv);
    validateTenantEnvRequired(
      declared,
      tenantEnv,
      new Set([...AEM_CONNECTIVITY_KEYS, ...demoUnused]),
    );

    const fixturesDirRaw = tenantEnv.get("AEM_FIXTURES_DIR");
    if (!isMeaningfulValue(fixturesDirRaw)) {
      record("warn", "env", "AEM_FIXTURES_DIR unset in .env — offline replay requires ./fixtures/aem");
    }

    const fixturesRoot = resolveFixturesRoot(
      dir,
      isMeaningfulValue(fixturesDirRaw) ? fixturesDirRaw! : "./fixtures/aem",
    );
    record("info", "env", "fixture replay mode — AEM HTTP disabled; auth not required");
    recordFixturesLayoutFindings(inspectFixturesLayout(fixturesRoot), {
      strictImages: true,
      buildHint: "run pnpm build:demo-fixtures",
    });

    if (
      tenantEnv.get("MIGRATION_DRY_RUN") === "false" &&
      tenantEnv.get("MIGRATION_ASSETS_DOWNLOAD_ONLY") !== "true" &&
      tenantEnv.get("MIGRATION_ASSET_BACKEND") !== "bynder"
    ) {
      if (!isMeaningfulValue(tenantEnv.get("SANITY_MEDIA_LIBRARY_ID"))) {
        record(
          "error",
          "env",
          "MIGRATION_DRY_RUN=false but SANITY_MEDIA_LIBRARY_ID is unset — aem-assets will fail",
        );
      }
    }
    return;
  }

  const envContent = readFileIfExists(envPath);
  if (envContent === null) {
    record("error", "env", ".env missing — copy .env.example to .env and fill in values");
    return;
  }

  const tenantEnv = parseEnv(envContent);
  const fixturesDirRaw = tenantEnv.get("AEM_FIXTURES_DIR");
  const fixtureMode = isMeaningfulValue(fixturesDirRaw);

  const unused = conditionallyUnusedEnvKeys(tenantEnv);
  recordConditionallyUnused(unused, tenantEnv);
  checkAssetBackendEnv(tenantEnv);
  validateTenantEnvRequired(
    declared,
    tenantEnv,
    fixtureMode ? new Set([...AEM_CONNECTIVITY_KEYS, ...unused]) : unused,
  );

  if (fixtureMode) {
    record("info", "env", "fixture replay mode — AEM HTTP disabled; auth not required");
    const fixturesRoot = resolveFixturesRoot(dir, fixturesDirRaw!);
    recordFixturesLayoutFindings(inspectFixturesLayout(fixturesRoot), {
      strictImages: false,
    });
  } else {
    const aemEnv = tenantEnv.get("AEM_ENV");
    if (aemEnv === "author" || aemEnv === undefined) {
      const matched = AEM_AUTH_FLOWS.some((flow) => {
        if (flow.mode === "any-of") {
          return flow.keys.some((k) => isMeaningfulValue(tenantEnv.get(k)));
        }
        return flow.keys.every((k) => isMeaningfulValue(tenantEnv.get(k)));
      });
      if (!matched) {
        const options = AEM_AUTH_FLOWS.map((f) => `${f.name} (${f.keys.join(" + ")})`).join(" | ");
        record(
          "error",
          "env",
          `no AEM author authentication configured — pick one: ${options} (or set AEM_FIXTURES_DIR for offline replay)`,
        );
      }
    }
  }

  if (
    tenantEnv.get("MIGRATION_DRY_RUN") === "false" &&
    tenantEnv.get("MIGRATION_ASSETS_DOWNLOAD_ONLY") !== "true" &&
    tenantEnv.get("MIGRATION_ASSET_BACKEND") !== "bynder"
  ) {
    if (!isMeaningfulValue(tenantEnv.get("SANITY_MEDIA_LIBRARY_ID"))) {
      record(
        "error",
        "env",
        "MIGRATION_DRY_RUN=false but SANITY_MEDIA_LIBRARY_ID is unset — aem-assets will fail",
      );
    }
  }

  const known = new Set(declared.map((d) => d.key));
  for (const key of tenantEnv.keys()) {
    if (!known.has(key)) {
      record("info", "env", `${key} is set but not documented in .env.example (likely fine)`);
    }
  }
}

function ensureNotIgnoringOperatorFiles(dir: string): void {
  for (const name of OPERATOR_FILES) {
    const path = join(dir, name);
    if (!existsSync(path)) {
      record("warn", "structure", `${name} missing — copy the template's version if you need it`);
    }
  }
}

function render(label: string): number {
  const groups: Record<Severity, Finding[]> = { error: [], warn: [], info: [] };
  for (const f of findings) groups[f.severity].push(f);

  const banner = `[doctor] ${label}`;
  if (groups.error.length === 0 && groups.warn.length === 0) {
    console.log(`${banner} — clean`);
    if (groups.info.length > 0) {
      console.log("");
      for (const f of groups.info) console.log(`  info  [${f.area}] ${f.message}`);
    }
    return 0;
  }

  console.log(banner);
  for (const severity of ["error", "warn", "info"] as const) {
    if (groups[severity].length === 0) continue;
    console.log("");
    for (const f of groups[severity]) {
      const tag = severity === "error" ? "ERROR" : severity === "warn" ? "WARN " : "info ";
      console.log(`  ${tag} [${f.area}] ${f.message}`);
    }
  }

  return groups.error.length > 0 ? 1 : 0;
}

function listTenants(tenantsDir: string): string[] {
  if (!existsSync(tenantsDir)) return [];
  return readdirSync(tenantsDir).filter((name) => {
    if (name === "template") return false;
    const path = join(tenantsDir, name);
    if (!statSync(path).isDirectory()) return false;
    return existsSync(join(path, "package.json"));
  });
}

export function runDoctor(args: string[], ctx: WorkspaceContext): never {
  const fix = args.includes("--fix");
  const all = args.includes("--all");
  const positional = args.filter((a) => !a.startsWith("--"));

  interface Target {
    slug: string;
    dir: string;
    label: string;
  }
  let targets: Target[];

  if (ctx.mode === "standalone") {
    if (all || positional.length > 0) {
      fail("standalone project — run `aem-to-sanity doctor [--fix]` with no tenant argument");
    }
    targets = [{ slug: ".", dir: ctx.root, label: `${ctx.root}/` }];
  } else {
    const tenantsDir = ctx.tenantsDir!;
    let slugs = all ? listTenants(tenantsDir) : positional;
    if (slugs.length === 0) {
      const inferred = inferTenantSlug(ctx);
      if (inferred) slugs = [inferred];
    }
    if (slugs.length === 0) {
      fail("usage: aem-to-sanity doctor <slug> [--fix]   or   aem-to-sanity doctor --all [--fix]");
    }
    targets = slugs.map((slug) => ({
      slug,
      dir: join(tenantsDir, slug),
      label: `tenants/${slug}/`,
    }));
  }

  let exitCode = 0;
  for (let i = 0; i < targets.length; i++) {
    if (i > 0) console.log("");
    const { slug, dir, label } = targets[i]!;
    findings.length = 0;
    if (!existsSync(dir)) {
      console.error(`[doctor] ${label} does not exist`);
      exitCode = Math.max(exitCode, 2);
      continue;
    }
    checkPackageJson(ctx, dir, fix, slug);
    checkTemplateFiles(ctx, dir, slug);
    ensureNotIgnoringOperatorFiles(dir);
    checkEnv(ctx, dir, slug);
    exitCode = Math.max(exitCode, render(label));
  }
  process.exit(exitCode);
}
