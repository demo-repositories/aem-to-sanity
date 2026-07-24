import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
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

/**
 * Record how this scaffold was produced in the clone's root package.json.
 * `pnpm -w toolkit:update` reads it back to know which repo to fetch from,
 * and operators can always answer "which scaffolder / toolkit ref made this?".
 */
function stampScaffold(dest: string, repo: string, ref: string): void {
  const pkgPath = join(dest, "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  pkg.aemToSanity = {
    scaffolder: `${PKG_NAME}@${PKG_VERSION}`,
    repo,
    ref,
    commit: capture("git", ["rev-parse", "HEAD"], dest) ?? "unknown",
    createdAt: new Date().toISOString(),
  };
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
}

async function promptMissing(targetDir: string | undefined, tenant: string | undefined) {
  if (targetDir !== undefined && tenant !== undefined) return { targetDir, tenant };
  if (!process.stdin.isTTY) {
    if (targetDir === undefined) fail(`target directory required\n\n${USAGE}`);
    return { targetDir: targetDir as string, tenant };
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    while (!targetDir) {
      targetDir = (await rl.question("Directory for the new project: ")).trim();
    }
    if (tenant === undefined) {
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
    ({ targetDir, tenant } = await promptMissing(config.targetDir, config.tenant));
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
  if (!commandExists("git")) {
    fail("git is required — install it and retry");
  }

  console.log(`[create-aem-to-sanity] cloning ${config.repo} (${config.ref}) → ${targetDir}`);
  run("git", ["clone", "--depth", "1", "--branch", config.ref, config.repo, dest], process.cwd());

  if (config.detach) {
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

  stampScaffold(dest, config.repo, config.ref);

  const haspnpm = commandExists("pnpm");
  if (config.install && haspnpm) {
    run("pnpm", ["install"], dest);
    // The workspace bins (aem-extract, aem-to-sanity-schema, …) point into
    // dist/ — build once so the scaffold is runnable out of the box.
    run("pnpm", ["build"], dest);
    if (tenant) {
      run("pnpm", ["migrate:init", tenant], dest);
      // Link the freshly scaffolded tenant + studio workspaces (and their
      // bins, which need the dist/ built above).
      run("pnpm", ["install"], dest);
    }
  } else if (config.install && !haspnpm) {
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
  console.log(`[create-aem-to-sanity] done — ${name} is ready`);
  console.log("");
  console.log("Next steps:");
  let step = 1;
  console.log(`  ${step++}. cd ${rel}`);
  if (!config.install || !haspnpm) {
    console.log(`  ${step++}. pnpm install && pnpm build`);
  }
  if (tenant) {
    console.log(`  ${step++}. $EDITOR tenants/${tenant}/.env          # AEM + Sanity credentials`);
    console.log(`  ${step++}. $EDITOR tenants/${tenant}/studio/.env   # Studio project id + dataset`);
    console.log(`  ${step++}. pnpm -w migrate:doctor ${tenant}        # verify before running`);
    console.log(`  ${step++}. pnpm -F tenant-${tenant} migrate        # dry-run the pipeline`);
  } else {
    console.log(`  ${step++}. pnpm migrate:init <slug>          # scaffold your first tenant`);
  }
  if (!config.detach) {
    console.log("");
    console.log("Later, pull toolkit updates with: pnpm -w toolkit:update [ref]");
  }
  console.log("");
  console.log("Full runbook: docs/running-the-migration.md");
}

main().catch((err) => {
  fail(err instanceof Error ? err.message : String(err));
});
