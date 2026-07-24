#!/usr/bin/env node
/**
 * Pull toolkit updates into a scaffolded clone (created by
 * `npm create @shehjad/aem-to-sanity`).
 *
 *   pnpm -w toolkit:update [ref]
 *
 * `ref` defaults to `upstream/main`; pass a release tag to pin (e.g.
 * `aem-to-sanity-core@1.9.0`). Fetches the toolkit repo recorded in the
 * `aemToSanity` stamp in the root package.json (added by the scaffolder),
 * merges the ref into the current branch, reinstalls + rebuilds, and
 * refreshes the stamp. Tenant folders are gitignored, so operator working
 * copies are untouched by the merge.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const DEFAULT_REPO = "https://github.com/demo-repositories/aem-to-sanity.git";
const REMOTE = "upstream";

function fail(msg: string): never {
  console.error(`[toolkit:update] ${msg}`);
  process.exit(2);
}

function run(cmd: string, args: string[]): void {
  const result = spawnSync(cmd, args, { cwd: ROOT, stdio: "inherit" });
  if (result.error || result.status !== 0) {
    fail(`${cmd} ${args.join(" ")} failed${result.error ? ` (${result.error.message})` : ""}`);
  }
}

function capture(cmd: string, args: string[]): string | undefined {
  const result = spawnSync(cmd, args, { cwd: ROOT, encoding: "utf8" });
  if (result.error || result.status !== 0) return undefined;
  return result.stdout.trim();
}

function main(): void {
  const ref = process.argv[2] ?? `${REMOTE}/main`;

  const pkgPath = join(ROOT, "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  const stamp = pkg.aemToSanity;

  if (capture("git", ["rev-parse", "--git-dir"]) === undefined) {
    fail("not a git repository — was this scaffold created with --detach? Re-scaffold to get an updatable clone.");
  }

  const dirty = capture("git", ["status", "--porcelain"]);
  if (dirty === undefined) fail("git status failed");
  if (dirty !== "") {
    fail("working tree has uncommitted changes — commit or stash them, then rerun");
  }

  const repo = stamp?.repo ?? DEFAULT_REPO;
  if (capture("git", ["remote", "get-url", REMOTE]) === undefined) {
    console.log(`[toolkit:update] adding remote ${REMOTE} → ${repo}`);
    run("git", ["remote", "add", REMOTE, repo]);
  }

  // Scaffolds are single-branch clones (--depth 1 --branch <ref>), so the
  // remote's fetch refspec only covers the original ref — widen it or newer
  // branches/tags are invisible to merge.
  run("git", ["remote", "set-branches", REMOTE, "*"]);

  // Scaffolds are shallow clones (--depth 1); a merge needs full history.
  const fetchArgs =
    capture("git", ["rev-parse", "--is-shallow-repository"]) === "true"
      ? ["fetch", "--unshallow", "--tags", REMOTE]
      : ["fetch", "--tags", REMOTE];
  console.log(`[toolkit:update] fetching ${REMOTE}…`);
  run("git", fetchArgs);

  console.log(`[toolkit:update] merging ${ref}…`);
  const merge = spawnSync("git", ["merge", "--no-edit", ref], { cwd: ROOT, stdio: "inherit" });
  if (merge.status !== 0) {
    fail(
      `merge of ${ref} did not complete cleanly. Resolve conflicts, \`git merge --continue\`, then run \`pnpm install && pnpm build\` yourself. (A scaffold created with --detach has no shared history and cannot merge — re-scaffold instead.)`,
    );
  }

  run("pnpm", ["install"]);
  run("pnpm", ["build"]);

  // Refresh the stamp so the scaffold records what it now tracks. Re-read
  // package.json: the merge may have changed it.
  const merged = JSON.parse(readFileSync(pkgPath, "utf8"));
  merged.aemToSanity = {
    ...(merged.aemToSanity ?? stamp ?? {}),
    repo,
    ref,
    commit: capture("git", ["rev-parse", "HEAD"]) ?? "unknown",
    updatedAt: new Date().toISOString(),
  };
  writeFileSync(pkgPath, `${JSON.stringify(merged, null, 2)}\n`);

  console.log("");
  console.log(`[toolkit:update] done — now at ${ref}`);
  console.log("Commit the result:  git add -A && git commit -m 'chore: update aem-to-sanity toolkit'");
  console.log("Then re-run `pnpm -w migrate:doctor --all --fix` to sync tenants with any template changes.");
}

main();
