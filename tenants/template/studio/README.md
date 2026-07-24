# Tenant Studio

A per-tenant Sanity Studio that consumes the schemas `migrate:schema` emits
for this tenant. Scaffolded by `pnpm -w studio:init <slug>` (new tenants
created with `pnpm -w migrate:init` get it automatically).

## Wiring

1. Fill `studio/.env` (seeded from `.env.example`) with the tenant's
   `SANITY_STUDIO_PROJECT_ID` / `SANITY_STUDIO_DATASET`.
2. In the tenant's own `.env`, point schema emission here:
   `SCHEMAS_OUT_DIR=./studio/schemas/generated`.
3. `pnpm install` (root) → `pnpm migrate:schema` (tenant) → `pnpm dev` (here).

`schemas/generated/` ships as an empty stub so the Studio typechecks and
boots before the first schema run; `migrate:schema` overwrites it with the
real component barrel. **Commit the generated schemas** if you source-control
this folder — with one Studio per tenant there's no cross-tenant conflict.

## Source-controlling this folder outside the monorepo

The tenant folder (including this Studio) is gitignored by the parent repo,
so you can `git init` inside `tenants/<your-tenant>/` and own it in your own
repository. The monorepo ties are the `"aem-to-sanity-schema": "workspace:*"`
devDependency (used for `sanitizeSchemaTypes` at Studio load) and the
`"aem-to-sanity-studio": "workspace:*"` dependency (category taxonomy type,
AEM widget inputs, the `aemSource` ML aspect); when extracting the folder
standalone, replace both with pinned checkouts of the matching release tag.

## Staying current with the template

Migration-critical Studio code lives in the `aem-to-sanity-studio` package —
updating the toolkit updates it, nothing to copy. For the copied file shell
(this README, `sanity.config.ts`, the aspect re-export, scripts), run
`pnpm -w studio:sync <your-tenant>` after a toolkit update: it copies files
the template gained, adds missing dependencies with `--fix`, and reports —
but never overwrites — files you've customized.
