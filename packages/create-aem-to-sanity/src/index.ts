import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join, relative, resolve } from "node:path";
import { createInterface } from "node:readline/promises";

import { name as PKG_NAME, version as PKG_VERSION } from "../package.json";
import { CliError, USAGE, parseCliArgs, validateSlug } from "./args.ts";

function fail(msg: string): never {
  console.error(`[create-aem-to-sanity] ${msg}`);
  process.exit(2);
}

function run(cmd: string, args: string[], cwd: string, optional = false): boolean {
  const result = spawnSync(cmd, args, {
    cwd,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.error || result.status !== 0) {
    const detail = result.error ? ` (${result.error.message})` : "";
    if (optional) {
      console.warn(`[create-aem-to-sanity] warning: ${cmd} ${args.join(" ")} failed${detail}`);
      return false;
    }
    fail(`${cmd} ${args.join(" ")} failed${detail}`);
  }
  return true;
}

function capture(cmd: string, args: string[], cwd: string): string | undefined {
  const result = spawnSync(cmd, args, {
    cwd,
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  if (result.error || result.status !== 0) return undefined;
  return result.stdout.trim();
}

function commandExists(cmd: string): boolean {
  const probe = spawnSync(cmd, ["--version"], {
    stdio: "ignore",
    shell: process.platform === "win32",
  });
  return !probe.error && probe.status === 0;
}

function readPkg(path: string): Record<string, any> {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writePkg(path: string, pkg: Record<string, any>): void {
  writeFileSync(path, `${JSON.stringify(pkg, null, 2)}\n`);
}

/* ------------------------------------------------------------------ */
/* Thin scaffold (default): template from aem-to-sanity-cli + npm deps */
/* ------------------------------------------------------------------ */

function templateDir(): string {
  const require = createRequire(import.meta.url);
  // aem-to-sanity-cli's main export is dist/lib.js; the embedded template
  // sits next to dist/ in the package root.
  const libEntry = require.resolve("aem-to-sanity-cli");
  const dir = join(dirname(libEntry), "..", "template");
  if (!existsSync(join(dir, "package.json"))) {
    fail(`bundled template not found at ${dir} — broken aem-to-sanity-cli install`);
  }
  return dir;
}

const COPY_SKIP = new Set(["node_modules", "output", ".turbo", ".DS_Store", ".env", "dist", ".sanity"]);

function copyTemplate(src: string, dest: string): void {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    if (COPY_SKIP.has(entry.name)) continue;
    const s = join(src, entry.name);
    // `dot-*` files ship under that name because npm pack strips `.gitignore`
    // (and similar dotfiles) from published tarballs; restore the real name here.
    const d = join(dest, entry.name.replace(/^dot-/, "."));
    if (entry.isDirectory()) {
      copyTemplate(s, d);
    } else {
      copyFileSync(s, d);
    }
  }
}

function scaffoldThin(dest: string, install: boolean): void {
  const name = basename(dest)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "aem-to-sanity-migration";

  console.log(`[create-aem-to-sanity] scaffolding standalone project → ${dest}`);
  copyTemplate(templateDir(), dest);

  // Rename the project + its Studio workspace.
  const pkgPath = join(dest, "package.json");
  const pkg = readPkg(pkgPath);
  pkg.name = name;
  pkg.aemToSanity = {
    scaffolder: `${PKG_NAME}@${PKG_VERSION}`,
    mode: "standalone",
    createdAt: new Date().toISOString(),
  };
  writePkg(pkgPath, pkg);
  const studioPkgPath = join(dest, "studio", "package.json");
  if (existsSync(studioPkgPath)) {
    const studioPkg = readPkg(studioPkgPath);
    studioPkg.name = `${name}-studio`;
    writePkg(studioPkgPath, studioPkg);
  }

  // Seed editable .env files from the examples.
  for (const dir of [dest, join(dest, "studio")]) {
    const example = join(dir, ".env.example");
    const env = join(dir, ".env");
    if (existsSync(example) && !existsSync(env)) copyFileSync(example, env);
  }

  // Never git-init without an ignore file: the initial commit lands after
  // `install`, and without one it would capture node_modules and the seeded
  // .env — a credentials leak the moment the operator fills it in and commits.
  const gitignore = join(dest, ".gitignore");
  if (!existsSync(gitignore)) {
    writeFileSync(gitignore, "node_modules/\ndist/\noutput/\n.env\n.turbo/\n.DS_Store\n");
  }

  if (commandExists("git")) {
    run("git", ["init", "-q", "-b", "main"], dest, true);
  }

  // Prefer pnpm when available (faster, and the template ships a
  // pnpm-workspace.yaml); fall back to npm workspaces.
  const pm = commandExists("pnpm") ? "pnpm" : "npm";
  if (install) {
    run(pm, ["install"], dest);
  }

  if (commandExists("git")) {
    run("git", ["add", "-A"], dest, true) &&
      run("git", ["commit", "-q", "-m", "chore: aem-to-sanity scaffold"], dest, true);
  }

  const rel = relative(process.cwd(), dest) || ".";
  console.log("");
  console.log(`[create-aem-to-sanity] done — ${name} is ready`);
  console.log("");
  console.log("Next steps:");
  let step = 1;
  console.log(`  ${step++}. cd ${rel}`);
  if (!install) console.log(`  ${step++}. ${pm} install`);
  console.log(`  ${step++}. $EDITOR .env                  # AEM + Sanity credentials`);
  console.log(`  ${step++}. $EDITOR studio/.env           # Studio project id + dataset`);
  console.log(`  ${step++}. $EDITOR aem-content-roots     # pages to migrate`);
  console.log(`  ${step++}. $EDITOR aem-component-paths   # components to map`);
  console.log(`  ${step++}. npx aem-to-sanity doctor      # verify before running`);
  console.log(`  ${step++}. ${pm} run migrate             # dry-run the pipeline`);
  console.log("");
  console.log("Update the toolkit later:");
  console.log(
    `  ${pm} install aem-to-sanity-core@latest aem-to-sanity-schema@latest aem-to-sanity-content@latest aem-to-sanity-studio@latest aem-to-sanity-cli@latest`,
  );
  console.log("");
  console.log("Docs: README.md in the project, plus the toolkit repo's docs/running-the-migration.md");
}

/* ------------------------------------------------------------- */
/* Clone scaffold (--clone): full monorepo with git-merge updates */
/* ------------------------------------------------------------- */

function stampClone(dest: string, repo: string, ref: string): void {
  const pkgPath = join(dest, "package.json");
  const pkg = readPkg(pkgPath);
  pkg.aemToSanity = {
    scaffolder: `${PKG_NAME}@${PKG_VERSION}`,
    mode: "clone",
    repo,
    ref,
    commit: capture("git", ["rev-parse", "HEAD"], dest) ?? "unknown",
    createdAt: new Date().toISOString(),
  };
  writePkg(pkgPath, pkg);
}

function scaffoldClone(
  dest: string,
  targetDir: string,
  opts: { repo: string; ref: string; install: boolean; detach: boolean; tenant: string | undefined },
): void {
  if (!commandExists("git")) {
    fail("git is required for --clone mode — install it and retry");
  }

  console.log(`[create-aem-to-sanity] cloning ${opts.repo} (${opts.ref}) → ${targetDir}`);
  run("git", ["clone", "--depth", "1", "--branch", opts.ref, opts.repo, dest], process.cwd());

  if (opts.detach) {
    // Clean slate: the scaffold carries no toolkit history and can't merge
    // upstream updates later — re-scaffolding is the only upgrade path.
    rmSync(join(dest, ".git"), { recursive: true, force: true });
    run("git", ["init", "-q", "-b", "main"], dest, true);
  } else {
    // Keep the toolkit history under an `upstream` remote so the scaffold can
    // pull future toolkit releases via `pnpm -w toolkit:update`. `origin`
    // stays free for the operator's own repository.
    run("git", ["remote", "rename", "origin", "upstream"], dest, true);
    // Cloning a tag leaves HEAD detached — pin a local main branch either way.
    run("git", ["checkout", "-q", "-B", "main"], dest, true);
  }

  stampClone(dest, opts.repo, opts.ref);

  const haspnpm = commandExists("pnpm");
  if (opts.install && haspnpm) {
    run("pnpm", ["install"], dest);
    // The workspace bins (aem-extract, aem-to-sanity-schema, …) point into
    // dist/ — build once so the scaffold is runnable out of the box.
    run("pnpm", ["build"], dest);
    if (opts.tenant) {
      run("pnpm", ["migrate:init", opts.tenant], dest);
      // Link the freshly scaffolded tenant + studio workspaces (and their
      // bins, which need the dist/ built above).
      run("pnpm", ["install"], dest);
    }
  } else if (opts.install && !haspnpm) {
    console.warn(
      "[create-aem-to-sanity] warning: pnpm not found — skipping install. Get it via `corepack enable` or https://pnpm.io/installation",
    );
  }

  // Commit the scaffold state (stamp + any install-time lockfile pruning —
  // the upstream lockfile carries importers for gitignored tenant folders
  // that don't exist in a fresh clone). A clean tree is what lets
  // `pnpm -w toolkit:update` run later without a manual commit first.
  // Tenant folders are gitignored, so credentials never enter history.
  run("git", ["add", "-A"], dest, true) &&
    run("git", ["commit", "-q", "-m", "chore: aem-to-sanity scaffold"], dest, true);

  const rel = relative(process.cwd(), dest) || ".";
  const name = basename(dest);
  console.log("");
  console.log(`[create-aem-to-sanity] done — ${name} is ready (clone mode)`);
  console.log("");
  console.log("Next steps:");
  let step = 1;
  console.log(`  ${step++}. cd ${rel}`);
  if (!opts.install || !haspnpm) {
    console.log(`  ${step++}. pnpm install && pnpm build`);
  }
  if (opts.tenant) {
    console.log(`  ${step++}. $EDITOR tenants/${opts.tenant}/.env          # AEM + Sanity credentials`);
    console.log(`  ${step++}. $EDITOR tenants/${opts.tenant}/studio/.env   # Studio project id + dataset`);
    console.log(`  ${step++}. pnpm -w migrate:doctor ${opts.tenant}        # verify before running`);
    console.log(`  ${step++}. pnpm -F tenant-${opts.tenant} migrate        # dry-run the pipeline`);
  } else {
    console.log(`  ${step++}. pnpm migrate:init <slug>          # scaffold your first tenant`);
  }
  if (!opts.detach) {
    console.log("");
    console.log("Later, pull toolkit updates with: pnpm -w toolkit:update [ref]");
  }
  console.log("");
  console.log("Full runbook: docs/running-the-migration.md");
}

/* --------------------------------------------------------------- */

async function promptMissing(targetDir: string | undefined, clone: boolean, tenant: string | undefined) {
  if (targetDir !== undefined && (!clone || tenant !== undefined)) return { targetDir, tenant };
  if (!process.stdin.isTTY) {
    if (targetDir === undefined) fail(`target directory required\n\n${USAGE}`);
    return { targetDir: targetDir as string, tenant };
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    while (!targetDir) {
      targetDir = (await rl.question("Directory for the new project: ")).trim();
    }
    if (clone && tenant === undefined) {
      const answer = (
        await rl.question("First tenant slug (e.g. acme — leave blank to skip): ")
      ).trim();
      if (answer) {
        validateSlug(answer);
        tenant = answer;
      }
    }
  } finally {
    rl.close();
  }
  return { targetDir, tenant };
}

async function main(): Promise<void> {
  let config;
  try {
    config = parseCliArgs(process.argv.slice(2));
  } catch (err) {
    if (err instanceof CliError || err instanceof TypeError) {
      fail(`${err.message}\n\n${USAGE}`);
    }
    throw err;
  }

  if (config.version) {
    console.log(PKG_VERSION);
    return;
  }
  if (config.help) {
    console.log(USAGE);
    return;
  }

  console.log(`[create-aem-to-sanity] v${PKG_VERSION}`);

  let targetDir: string;
  let tenant: string | undefined;
  try {
    ({ targetDir, tenant } = await promptMissing(config.targetDir, config.clone, config.tenant));
  } catch (err) {
    if (err instanceof CliError) fail(err.message);
    throw err;
  }
  if (tenant !== undefined && !config.install) {
    fail("--tenant needs dependencies installed — drop --no-install");
  }

  const dest = resolve(targetDir);
  if (existsSync(dest) && readdirSync(dest).length > 0) {
    fail(`${targetDir} already exists and is not empty — refusing to overwrite`);
  }

  if (config.clone) {
    scaffoldClone(dest, targetDir, {
      repo: config.repo,
      ref: config.ref,
      install: config.install,
      detach: config.detach,
      tenant,
    });
  } else {
    scaffoldThin(dest, config.install);
  }
}

main().catch((err) => {
  fail(err instanceof Error ? err.message : String(err));
});
