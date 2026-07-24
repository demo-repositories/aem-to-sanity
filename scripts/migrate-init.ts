#!/usr/bin/env node
/**
 * Scaffold a new tenant migration folder from tenants/template/.
 *
 *   pnpm migrate:init <slug>
 *
 * Copies the template, renames the workspace, seeds an editable `.env` from
 * `.env.example`, and prints the next steps. Refuses to overwrite an
 * existing folder.
 */
import { copyFileSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

import {
  TEMPLATE_DIR,
  copyTree,
  renameWorkspace,
  tenantDir,
} from "./lib/tenant-template.ts";

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

function fail(msg: string): never {
  console.error(`[migrate:init] ${msg}`);
  process.exit(2);
}

function main(): void {
  const slug = process.argv[2];
  if (!slug) {
    fail("usage: pnpm migrate:init <slug>   (e.g. pnpm migrate:init acme)");
  }
  if (slug === "template") {
    fail("slug 'template' is reserved for the migration template");
  }
  if (!SLUG_RE.test(slug)) {
    fail(
      `slug "${slug}" is not valid — use lowercase letters, digits, and hyphens (e.g. davids-bridal)`,
    );
  }

  const dest = tenantDir(slug);
  if (existsSync(dest)) {
    fail(`tenants/${slug}/ already exists — refusing to overwrite`);
  }

  if (!existsSync(TEMPLATE_DIR)) {
    fail(`template not found at ${TEMPLATE_DIR}`);
  }

  copyTree(TEMPLATE_DIR, dest);
  renameWorkspace(join(dest, "package.json"), `tenant-${slug}`);
  // The template ships a per-tenant Studio under studio/ — give the copy its
  // own workspace name so scaffolded tenants don't collide on the template's.
  const studioPkg = join(dest, "studio", "package.json");
  if (existsSync(studioPkg)) {
    renameWorkspace(studioPkg, `tenant-${slug}-studio`);
  }

  const envSeeds = [dest, join(dest, "studio")];
  for (const dir of envSeeds) {
    const envExample = join(dir, ".env.example");
    const envFile = join(dir, ".env");
    if (existsSync(envExample) && !existsSync(envFile)) {
      copyFileSync(envExample, envFile);
    }
  }

  const rel = relative(process.cwd(), dest) || dest;
  console.log(`[migrate:init] created ${rel}/ (incl. a per-tenant Studio under ${rel}/studio/)`);
  console.log("");
  console.log("Next steps (these work from any cwd in the repo — `-w` targets the root workspace):");
  console.log("  1. pnpm install                                     # link the new workspaces");
  console.log(`  2. $EDITOR ${rel}/.env                              # fill AEM + Sanity credentials`);
  console.log(`  3. $EDITOR ${rel}/studio/.env                       # SANITY_STUDIO_PROJECT_ID + dataset`);
  console.log(`  4. $EDITOR ${rel}/aem-content-roots                 # list pages to migrate`);
  console.log(`  5. $EDITOR ${rel}/aem-component-paths               # list components to map`);
  console.log(`  6. pnpm -w migrate:doctor ${slug}                   # verify before running`);
  console.log(`  7. pnpm -F tenant-${slug} migrate                   # run the full pipeline`);
  console.log(`  8. pnpm -F tenant-${slug}-studio dev                # open the tenant Studio`);
}

main();
