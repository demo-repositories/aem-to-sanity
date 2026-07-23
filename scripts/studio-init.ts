#!/usr/bin/env node
/**
 * Scaffold a per-tenant Sanity Studio from tenants/template/studio/.
 *
 *   pnpm -w studio:init <slug>
 *
 * Mirrors migrate:init, but targets an EXISTING tenant: copies the studio
 * template into tenants/<slug>/studio/, renames the workspace, seeds an
 * editable `.env` from `.env.example`, and prints the wiring steps. New
 * tenants created with `pnpm -w migrate:init` get the studio automatically —
 * this command backfills tenants scaffolded before the studio template
 * existed (or after an operator deleted theirs).
 */
import { copyFileSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

import {
  STUDIO_TEMPLATE_DIR,
  copyTree,
  renameWorkspace,
  tenantDir,
} from "./lib/tenant-template.ts";

function fail(msg: string): never {
  console.error(`[studio:init] ${msg}`);
  process.exit(2);
}

function main(): void {
  const slug = process.argv[2];
  if (!slug) {
    fail("usage: pnpm -w studio:init <slug>   (e.g. pnpm -w studio:init acme)");
  }
  if (slug === "template") {
    fail("slug 'template' is reserved for the migration template");
  }

  const tenant = tenantDir(slug);
  if (!existsSync(tenant)) {
    fail(
      `tenants/${slug}/ does not exist — scaffold the tenant first: pnpm -w migrate:init ${slug}`,
    );
  }

  const dest = join(tenant, "studio");
  if (existsSync(dest)) {
    fail(`tenants/${slug}/studio/ already exists — refusing to overwrite`);
  }
  if (!existsSync(STUDIO_TEMPLATE_DIR)) {
    fail(`studio template not found at ${STUDIO_TEMPLATE_DIR}`);
  }

  copyTree(STUDIO_TEMPLATE_DIR, dest);
  renameWorkspace(join(dest, "package.json"), `tenant-${slug}-studio`);

  const envExample = join(dest, ".env.example");
  const envFile = join(dest, ".env");
  if (existsSync(envExample) && !existsSync(envFile)) {
    copyFileSync(envExample, envFile);
  }

  const rel = relative(process.cwd(), dest) || dest;
  console.log(`[studio:init] created ${rel}/`);
  console.log("");
  console.log("Next steps:");
  console.log("  1. pnpm install                                     # link the new workspace");
  console.log(`  2. $EDITOR ${rel}/.env                              # SANITY_STUDIO_PROJECT_ID + dataset`);
  console.log(`  3. Set SCHEMAS_OUT_DIR=./studio/schemas/generated in tenants/${slug}/.env`);
  console.log(`  4. pnpm -F tenant-${slug} migrate:schema            # emit schemas into the studio`);
  console.log(`  5. pnpm -F tenant-${slug}-studio dev                # http://localhost:3333`);
}

main();
