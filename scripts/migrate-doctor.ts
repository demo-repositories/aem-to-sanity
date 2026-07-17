#!/usr/bin/env node
/**
 * Detect drift between an operator tenant folder and tenants/template/, plus
 * sanity-check the operator's .env against .env.example.
 *
 *   pnpm migrate:doctor <slug>          report only
 *   pnpm migrate:doctor <slug> --fix    auto-repair safe surfaces (scripts block)
 *
 * Exits 0 when clean, 1 when findings remain after any fixes were applied.
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

import {
  AEM_AUTH_FLOWS,
  AEM_CONNECTIVITY_KEYS,
  COMMITTED_TENANTS,
  OPERATOR_FILES,
  TEMPLATE_DIR,
  TEMPLATE_FILES,
  TENANTS_DIR,
  hasFixturesContent,
  inspectFixturesLayout,
  isMeaningfulValue,
  parseEnv,
  parseEnvExample,
  readFileIfExists,
  resolveFixturesRoot,
  tenantDir,
  type FixturesLayout,
} from "./lib/tenant-template.ts";

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
  console.error(`[migrate:doctor] ${msg}`);
  process.exit(2);
}

function checkPackageJson(dir: string, fix: boolean, slug: string): void {
  const templatePkgPath = join(TEMPLATE_DIR, "package.json");
  const tenantPkgPath = join(dir, "package.json");
  if (!existsSync(tenantPkgPath)) {
    record("error", "structure", "package.json is missing");
    return;
  }
  if (COMMITTED_TENANTS.has(slug)) {
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

function checkTemplateFiles(dir: string, slug: string): void {
  if (COMMITTED_TENANTS.has(slug)) {
    record("info", "template-file", "committed tenant — template file drift not checked");
    return;
  }
  for (const name of TEMPLATE_FILES) {
    const templatePath = join(TEMPLATE_DIR, name);
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
    record(
      "error",
      "fixtures",
      `fixtures missing /content/ .infinity.json trees${hint}`,
    );
  }
  if (!hasComponents) {
    record(
      "error",
      "fixtures",
      `fixtures missing /apps/ .infinity.json trees${hint}`,
    );
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

function checkEnv(dir: string, slug: string): void {
  const envExamplePath = join(dir, ".env.example");
  const envPath = join(dir, ".env");
  const envExampleContent = readFileIfExists(envExamplePath);
  if (envExampleContent === null) {
    record("error", "env", ".env.example missing");
    return;
  }

  const declared = parseEnvExample(envExampleContent);
  const isCommittedDemo = slug === "demo" && COMMITTED_TENANTS.has(slug);

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
    validateTenantEnvRequired(declared, tenantEnv, AEM_CONNECTIVITY_KEYS);

    const fixturesDirRaw = tenantEnv.get("AEM_FIXTURES_DIR");
    if (!isMeaningfulValue(fixturesDirRaw)) {
      record(
        "warn",
        "env",
        "AEM_FIXTURES_DIR unset in .env — offline replay requires ./fixtures/aem",
      );
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
      tenantEnv.get("MIGRATION_ASSETS_DOWNLOAD_ONLY") !== "true"
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

  validateTenantEnvRequired(
    declared,
    tenantEnv,
    fixtureMode ? AEM_CONNECTIVITY_KEYS : new Set(),
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
    tenantEnv.get("MIGRATION_ASSETS_DOWNLOAD_ONLY") !== "true"
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

function render(slug: string): number {
  const groups: Record<Severity, Finding[]> = { error: [], warn: [], info: [] };
  for (const f of findings) groups[f.severity].push(f);

  const banner = `[migrate:doctor] tenants/${slug}/`;
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

function listTenants(): string[] {
  if (!existsSync(TENANTS_DIR)) return [];
  return readdirSync(TENANTS_DIR).filter((name) => {
    if (name === "template") return false;
    const path = join(TENANTS_DIR, name);
    if (!statSync(path).isDirectory()) return false;
    return existsSync(join(path, "package.json"));
  });
}

function main(): void {
  const args = process.argv.slice(2);
  const fix = args.includes("--fix");
  const all = args.includes("--all");
  const positional = args.filter((a) => !a.startsWith("--"));
  const slugs = all ? listTenants() : positional;

  if (slugs.length === 0) {
    fail(
      "usage: pnpm migrate:doctor <slug> [--fix]   or   pnpm migrate:doctor --all [--fix]",
    );
  }

  let exitCode = 0;
  for (let i = 0; i < slugs.length; i++) {
    if (i > 0) console.log("");
    const slug = slugs[i];
    findings.length = 0;
    const dir = tenantDir(slug);
    if (!existsSync(dir)) {
      console.error(`[migrate:doctor] tenants/${slug}/ does not exist`);
      exitCode = Math.max(exitCode, 2);
      continue;
    }
    checkPackageJson(dir, fix, slug);
    checkTemplateFiles(dir, slug);
    ensureNotIgnoringOperatorFiles(dir);
    checkEnv(dir, slug);
    exitCode = Math.max(exitCode, render(slug));
  }
  process.exit(exitCode);
}

main();
