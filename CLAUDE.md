# CLAUDE.md

Project-level guidance for AI assistants (Claude Code, and any compatible tool) working in this repo. Auto-loaded into context for every session.

## Keep docs refreshed as we go

Every user-facing change must update its documentation in the same commit. Drifting docs hide real changes from operators and break the "read the docs, run the pipeline" flow.

**Doc surface to scan on every user-facing change:**
- `README.md` (root) — high-level overview.
- `packages/*/README.md` — per-package surface (flags, env vars, phases, outputs).
- `docs/running-the-migration.md` — canonical operator's guide (env vars table, per-stage flag tables, troubleshooting).
- `docs/overview.md` — architecture + layout.
- `docs/aem-to-sanity-mapping.md` — **auto-generated** by `packages/aem-to-sanity-schema/src/docs.ts`. Do not edit by hand; regenerate.
- `tenants/template/.env.example` — must list every env var a CLI reads. `tenants/template/` is the **committed template**; operator working copies live at `tenants/<their-tenant>/` and are gitignored.

**Triggers:**
- **New CLI flag** → update the package README + the stage section in `docs/running-the-migration.md` + `.env.example` if there's a matching env var.
- **New env var** → update the env-vars table in `docs/running-the-migration.md` § 1a + `.env.example`.
- **Emitter / mapper behavior change** → update `packages/aem-to-sanity-schema/src/docs.ts` (prose that lands in the generated mapping doc) + regenerate `docs/aem-to-sanity-mapping.md`.
- **Pipeline phase / output shape change** → update the "Outputs" subsections in `docs/running-the-migration.md` § 2 and § 4.
- **Mapping table change** (`packages/aem-to-sanity-schema/src/mapping-table.ts`) → rerun `pnpm migrate:schema` so `docs/aem-to-sanity-mapping.md` regenerates from the source of truth. `writeMappingDocs` can also be called standalone from the schema package's `dist/index.js` (no AEM round-trip needed).
- **Container config shape change** (`packages/aem-to-sanity-core/src/config/containers.ts` or `aem-component-containers.json` fields) → update the "Container components" section in `packages/aem-to-sanity-schema/src/docs.ts`, regenerate `docs/aem-to-sanity-mapping.md`, and mirror in `docs/running-the-migration.md` § 1c-quater + content package README.
- **Slot discovery shape change** (`packages/aem-to-sanity-schema/src/slots.ts` behavior, `slot-reference` field emission rules) → update the "Named slots (auto-discovered)" section in `packages/aem-to-sanity-schema/src/docs.ts`, regenerate the mapping doc, and mirror in `docs/running-the-migration.md` § 2 + content package README.
- **Tenant template change** (anything under `tenants/template/`) → keep `scripts/lib/tenant-template.ts` + `scripts/migrate-doctor.ts` in sync so `pnpm -w migrate:doctor` doesn't silently miss the new surface. Details below.

**Tenant template ↔ doctor sync rules**

`pnpm -w migrate:init` and `pnpm -w migrate:doctor` treat `tenants/template/` as the source of truth, but the doctor classifies each file by hand. When the template grows, update the classification or the checks won't catch drift on the new surface.

- **New file added to `tenants/template/`** → add its basename to either `TEMPLATE_FILES` (template-owned content like `README.md`, `*.example`) or `OPERATOR_FILES` (operator-customized like `aem-*-roots`, `*.json`) in `scripts/lib/tenant-template.ts`. Files in neither set are silently ignored by doctor.
- **New required env var added to `.env.example`** → no code change needed. The doctor parses `.env.example` at runtime and treats every uncommented `KEY=value` line as required. The placeholder regex (`PLACEHOLDER_RE` in `scripts/lib/tenant-template.ts`) detects leftover values; add a pattern there if you introduce a new placeholder shape (e.g. `<your-thing>`, `xxxx`).
- **New optional env var added to `.env.example`** → no code change needed. Commented `# KEY=value` lines are picked up automatically and excluded from the "unknown var" warning.
- **New conditional env requirement** (e.g. "var X is required only when var Y has a particular value") → add a special-case block in `checkEnv` inside `scripts/migrate-doctor.ts`. The `MIGRATION_DRY_RUN=false` → `SANITY_MEDIA_LIBRARY_ID` check is the existing template.
- **New AEM authentication flow** → extend `AEM_AUTH_FLOWS` in `scripts/lib/tenant-template.ts` (name + keys + `any-of`/`all-of` mode). The doctor's "no AEM auth configured" error iterates that list.
- **New pipeline stage script** (e.g. another `aem-foo` between extract and import) → add it to the `scripts` block in `tenants/template/package.json` AND to the migrate chains (`migrate`, `migrate:content`). The doctor's `package.json` scripts-block check reads the template at runtime, so once the template is updated, `pnpm -w migrate:doctor --all --fix` propagates the new script to existing tenants.
- **New ignored directory** (build output, cache, etc. that init must skip on copy) → add to `IGNORED_NAMES` in `scripts/lib/tenant-template.ts`.

After any of the above, re-run `pnpm -w migrate:doctor --all` and confirm the report reflects the new expectation.

**Anti-patterns:**
- Don't duplicate content between the generated mapping doc and hand-authored docs. The generated file is the source of truth for field-level mapping; hand-authored docs describe architecture, phases, env vars, flags.
- Don't describe internals the operator can't touch — focus on observable behavior from the CLI.
- Don't add a changelog section to READMEs; use git history + Changesets.

## Regenerating artifacts

The pipeline emits many artifacts into `output/cache/` and `apps/studio/schemas/generated/`. These are regenerable; never hand-edit.

- `output/cache/content-type-registry.json` — written by `migrate:schema`. Shape: `entries: Array<{resourceType, sanityType, fields: Array<{name, type}>}>`. Legacy `fields: string[]` still loads but disables type-aware coercion (notably HTML → Portable Text).
- `apps/studio/schemas/generated/*.ts` — written by `migrate:schema`. Each file carries a `// Generated from AEM component: …` banner. **Gitignored** (see `.gitignore`); each operator regenerates locally. The Studio's `schemas/index.ts` imports `./generated/index.ts` statically, so the root `prepare` script (`scripts/ensure-studio-stub.ts`) writes a minimal empty barrel on `pnpm install` when the file is missing — bare clones still typecheck/boot, and a real generated barrel from `migrate:schema` is never overwritten by the stub script. Single-tenant projects that want the schemas source-controlled should comment out the `apps/studio/schemas/generated/` line in `.gitignore` and `git add` the regenerated files after `migrate:schema`.
- `output/cache/aem/content/**/*.json` — written by `aem-extract` and `aem-tags` (path-mirror under `/content/...`). Legacy flat `output/cache/raw/*.json` is still read.
- `output/cache/aem/apps/**/*.json` — schema dialog cache from `migrate:schema`. Legacy `output/cache/aem/components/apps/...` is still read.
- `output/cache/clean/*.json` — written by `aem-transform`, mutated in place by `aem-assets` phase 4 (DAM-path → asset ref rewrite).
- `output/cache/categories/*.json` + `manifest.json` — written by `aem-tags`. One Sanity `category` doc per AEM `cq:Tag` node (parent-child taxonomy), plus a manifest keyed by AEM tag id that `aem-transform` consults when resolving authored `cq:tags` references.
- `output/cache/assets/manifest.json` — per-DAM-path state; drives `aem-assets` resumability.

When you change how any artifact is generated, **re-run the relevant stage against whichever local tenant folder you have set up** — don't just typecheck. Operator tenant folders (`tenants/davids-bridal/`, `tenants/<your-tenant>/`, etc.) are gitignored, so on a fresh clone there's nothing to run against — copy `tenants/template/` first and fill in real credentials. Prefer `--link-only` on `aem-assets` for re-runs — it skips AEM downloads and ML uploads.

## Document ID generation

`pathToDocId` in `packages/aem-to-sanity-content/src/transform.ts` derives each Sanity doc `_id` from the JCR path. Two operator knobs:

- **`MIGRATION_DOC_ID_PREFIX_STRIP`** — comma-separated list of path prefixes to remove before generating the id. The intent is to drop the AEM site/locale rootpage (e.g. `/content/uxp/us/en`) so ids stay short and page-relative. Longest match wins when prefixes overlap. Unset → full path goes into the id.
- **Separator is `-`** (hyphen), not `.`. Sanity treats any `_id` containing `.` as a **private** doc — readable only with an auth token. Hyphenated ids work over the public CDN, which matters for read-only frontends that don't ship a token. Studio reads always carry auth, so dotted ids would work there too — but hyphens are the safe default.

Idempotency hazard: **changing `MIGRATION_DOC_ID_PREFIX_STRIP` between runs reshapes every id and orphans previously imported docs.** Set it once at the start of a migration and leave it alone. If you must change it on a live dataset, run an `unpublishDocuments` pass against the old id space first.

Long paths (>80 chars after sanitization) fall back to `{first-60-chars}-{sha1-10}` so ids stay under Sanity's 128-char limit without collisions.

## Type-name resolution (reserved names)

`/apps/.../image` would collide with Sanity's built-in `image` type. `resolveSanityTypeNames` (in `packages/aem-to-sanity-schema/src/naming.ts`) applies an `aem` prefix at emission time so the on-disk schema, the content registry, `pageBuilder.of[]`, and ingested document `_type` values all agree — no Studio-side rename, no orphaned content. Don't reintroduce per-import renames in `sanitize.ts`; it's a defense-in-depth pass for hand-authored schemas only.

Type names derive from the JCR path by default; `MIGRATION_TYPE_NAMING=title` switches to camelCased `jcr:title` (path fallback on missing titles, path-derived suffix on title collisions — `migrate:schema` pre-fetches component nodes to know titles before names resolve). Individual components can pin an explicit name and/or Studio title via the optional tenant file `aem-component-names.json` (keyed by resource type; explicit names claim first, derived collisions take the fallback; reserved built-ins and duplicates are hard errors). Strategy and overrides are set-once-before-first-import knobs: switching either (or renaming a `jcr:title` in AEM) renames emitted types and orphans ingested `_type` values.

## Dialog resolution via `sling:resourceSuperType`

`migrate:schema` walks the `sling:resourceSuperType` chain when a listed component has no `cq:dialog` of its own — same lookup AEM runs at request time. Logic lives in `packages/aem-to-sanity-core/src/aem/dialog-resolution.ts` (`resolveDialogViaSuperType`); the schema migrator (`api.ts:processOne`) and the audit step (`audit.ts`) both call it, and so does the standalone `scripts/aem-probe.ts` so what the probe shows is exactly what the migrator will see.

Chain: try `{path}/_cq_dialog` → on 404, read `sling:resourceSuperType` from the component, resolve `/apps/<rt>` then `/libs/<rt>` for relative supertypes (absolutes used as-is), recurse with cycle guard + 10-hop cap. Successful runs record the chain in `migration-report.json → results[].supertypeChain` (omitted for direct hits) and log an info line per inherited component. **The registry key remains the original proxy path's resource type** — authored content references the proxy at ingest time, not the supertype that supplied the dialog. Two proxies sharing one supertype produce two distinct Sanity types with identical fields; this is intentional, not a duplicate.

## Type-aware coercion at transform

AEM's JCR is schemaless on dialog inputs — `.infinity.json` serializes every authored value as a **JSON string** regardless of what the dialog widget was (numberfield → `"10"`, checkbox → `"true"` / `"false"`, richtext → HTML string). The emitted Sanity schemas declare proper types, so without coercion the Studio rejects every ingested value with "Expected type X, got String".

`content-type-registry.json` records each field's Sanity type as a **tree** (`fields: Array<{name, type, itemFields?}>`). `aem-transform` reads those types and coerces at every depth:

- **`array-of-blocks`** → Portable Text via `@portabletext/block-tools` + `jsdom`. Decorators / styles / lists / `link` annotations preserved. `_key`s SHA1-seeded for deterministic diffs.
- **`number`** → `Number(v)`; kept as-is on `NaN`.
- **`boolean`** → `"true"` / `"false"` literal strings only.
- **`array-of-object`** → recurses into each item using the field's `itemFields` subtree, so nested richtext / number / boolean (e.g. `variableColumn.columnContents[].columnText`) are coerced the same as top-level fields. If the AEM value is a plain object instead of an array (named-key multifield — e.g. `colorCarousel.colors: { weddingDresses: {...}, ... }`), `Object.values` materializes it in authored order before recursing. The same principle applies to `splitAemFileUploadDamPaths`: nested field names are collected from the registry tree so `{base}AemPath` moves work at any depth.

**Dialog-runtime metadata.** AEM writes bookkeeping sidecars next to authored fields (e.g. `textIsRich: "true"` beside richtext values). These have no Sanity counterpart and would surface as "Unknown field found" warnings if not dropped. Maintained as a narrow allowlist (`AEM_DIALOG_RUNTIME_KEYS` in `transform.ts`) — add new leaks there as they appear; never substitute a blanket heuristic.

**When adding a new coerced type:**
1. Extend `coerceScalarFields` (or `coerceRichTextFields` if shape-heavy) in `packages/aem-to-sanity-content/src/transform.ts`.
2. Keep the **keep-original-on-failure** contract. Unrecognized values should surface as Studio validation errors, not silent data loss.
3. Document it in the generated mapping doc — add prose under the "Type-aware coercion at transform" section in `packages/aem-to-sanity-schema/src/docs.ts`, then regenerate `docs/aem-to-sanity-mapping.md`.
4. Update the mirror blurbs in `packages/aem-to-sanity-content/README.md` and `docs/running-the-migration.md` § 4b.

If the issue is actually a wrong Sanity type (not a coercion gap), fix it at the schema emitter layer — check that the dialog's `sling:resourceType` is mapped correctly in `packages/aem-to-sanity-schema/src/mapping-table.ts`. Don't paper over schema-layer bugs with per-field coercion in the transform.

## aem-assets parallelism

Phases 0–3 of `aem-assets` run with a work-stealing pool sized by `ASSET_CONCURRENCY` (default `4`). Safety invariants — preserve these when touching that code:

1. **Phase 0 is the dedup gate.** It populates the manifest for every DAM path already in the ML before any other phase touches it. Phases 1–3 skip entries that phase 0 already resolved, so the same DAM path is never processed twice across workers.
2. **Each damPath is owned by exactly one worker at a time.** The pool hands each list index out once; there is no fan-out per item. So mutations to `manifest[damPath]` and `aspectStamped.add(damPath)` from different workers always target distinct keys — no lock needed.
3. **Manifest persistence stays synchronous.** `writeFileSync` + `JSON.stringify` are atomic relative to the single-threaded event loop. If this is ever moved to async `writeFile`, a serial lock (or in-memory batching with a single write at the end of the phase) becomes mandatory — otherwise interleaved writes will corrupt the file.
4. **Don't skip the dedup pass.** Running phases 1–3 in parallel without phase 0 would re-download / re-upload duplicate DAM paths and race on the same manifest keys. Phase 0 must stay enabled whenever concurrency > 1.
5. **Phase 0 also validates the manifest.** When the aspect lookup misses but the manifest claims an `mediaLibraryAssetId`, phase 0 verifies the doc still exists in the ML by id. If missing → clear the stale linkage (preserve local download cache) so phases 2-3 re-upload for real. Without this, a wiped ML leaves the manifest claiming uploads that were never redone; phases 2-3 short-circuit their "already uploaded / already linked" branches and the run reports success while writing nothing. Transport errors (`unknown`) are treated as "keep state" — the next healthy run re-verifies. Never trust just the local manifest; trust ML as source of truth and reconcile.

## Drafts shadow imports

The Studio edits `drafts.{id}` whenever one exists. `aem-import` by default only writes the published `{id}`, so a stale draft keeps shadowing fresh migration output — the operator sees old content after a "successful" re-import and gets confused. For migration re-runs, pass `--discard-drafts` (or set `MIGRATION_DISCARD_DRAFTS=true`). When diagnosing "I re-ran the import and nothing changed in the Studio", check for a shadowing draft first.

## Frontend lives in a separate repo

The Vite preview (`apps/web`) and Hydrogen storefront (`apps/storefront`) that render migrated content moved to [`aem-to-sanity-demo-web`](https://github.com/demo-repositories/aem-to-sanity-demo-web). When a schema change here adds a new block `_type`, the matching block primitive needs to land in that repo's `apps/web/src/blocks/` dispatcher — flag it in the PR description so the two repos stay in sync.

## Running verification

After code changes that affect the pipeline output:

```bash
# 1. Rebuild so dist/ reflects source changes (Node runs from dist/)
pnpm -r build

# 2. Full schema + content run against your local tenant folder
cd tenants/<your-tenant>             # e.g. tenants/davids-bridal, tenants/acme
pnpm migrate:schema
pnpm extract
pnpm transform
pnpm assets -- --link-only     # skip AEM + ML if assets already migrated
pnpm import

# 3. Inspect
pnpm --filter studio exec sanity schema validate   # catches schema drift
pnpm --filter studio dev                           # http://localhost:3333
```

Typecheck + tests also need to pass:

```bash
pnpm -r typecheck
pnpm -r test
```

## Versioning & releases

The three runtime packages are versioned in lockstep with Changesets (a `fixed` group in `.changeset/config.json`); releases are git tags + GitHub Releases with notes, cut by `.github/workflows/release.yml` when the auto-opened "chore: version packages" PR merges. Full flow in `docs/releasing.md`.

- **Every user-facing change needs a changeset in the same PR** — run `pnpm changeset`, pick the bump (major = breaking CLI/env/artifact/schema shape, minor = new capability, patch = fix), and write the summary as operator-facing release notes: what changed, what they must do. Internal-only changes (refactors, CI, docs-only) skip it.
- Don't hand-edit `packages/*/CHANGELOG.md` or bump versions in `package.json` — `changeset version` owns both.
- Private workspaces (studio, tenants) are excluded via `privatePackages` in the config, **not** the `ignore` list — tenant folders are gitignored, so naming them in `ignore` breaks every changeset command on a fresh clone.

## Commit discipline

- Small, focused commits. One logical change per commit.
- Commit messages follow the style in `git log` (conventional-ish: `feat(content):`, `fix(schema):`, `chore:`, etc.).
- Regenerated docs (`docs/aem-to-sanity-mapping.md`) can be committed alongside the source change that produced them — makes the diff reviewable end-to-end.
- Never commit `output/` artifacts (raw/, clean/, categories/, assets/) — these are local caches, gitignored by default.
- `apps/studio/schemas/generated/*` is **gitignored** — each operator regenerates from their own AEM via `pnpm migrate:schema`, so committing them creates merge conflicts between tenants and surfaces one customer's component vocabulary in another's repo. The root `prepare` script (`scripts/ensure-studio-stub.ts`) writes a minimal empty `generated/index.ts` on `pnpm install` when the file is missing, so the Studio still typechecks on a bare clone — `migrate:schema` overwrites it locally with the real barrel. Single-tenant repos that want the schemas under source control should comment out the `apps/studio/schemas/generated/` line in `.gitignore` and `git add` the regenerated files explicitly.
