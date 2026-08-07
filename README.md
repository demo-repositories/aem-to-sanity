# aem-to-sanity

**An end-to-end toolkit for migrating Adobe Experience Manager (AEM) content into Sanity** — reads AEM component dialogs and authored pages over HTTP, emits a real Sanity Studio schema, transforms content into Sanity-shaped documents (with Portable Text, image refs, taxonomy references), and writes everything via `@sanity/client`. Deterministic, resumable, dry-run by default.

> 🎞️ **Start here:** open [`docs/aem-to-sanity-standalone.html`](docs/aem-to-sanity-standalone.html) in a browser. Seven slides that walk through the pipeline, asset flow, operating modes, commands, run output, implementation, and architecture. Best for reviewers, stakeholders, and new operators getting oriented in 10 minutes.

---

## What this is

AEM exposes two things over HTTP as JSON:

- `{host}{componentPath}/_cq_dialog.infinity.json` — the Granite UI form that defines a component's fields.
- `{host}{contentPath}.infinity.json` — the authored content tree under `/content/...`, truncated at depth ~5.

Sanity expects TypeScript `defineType` / `defineField` schemas and JSON documents with `_type`, `_id`, `_key`, references, Portable Text, and asset refs.

**This repo is the bridge.** Two stages plus a content pipeline:

```
 AEM author/publish               aem-to-sanity                       Sanity                Frontend (separate repo)
┌──────────────────┐          ┌────────────────────┐          ┌────────────────┐         ┌────────────────────────┐
│ _cq_dialog       │── (1) ──▶│ migrate:schema     │── emits ▶│ Studio schemas │         │ aem-to-sanity-demo-web │
│ .infinity.json   │          │  + typegen         │          │ + sanity.types │         │                        │
├──────────────────┤          ├────────────────────┤          ├────────────────┤───────▶ │ apps/web (Vite)        │
│ /content/...     │── (2) ──▶│ extract → tags     │── writes▶│ documents      │  GROQ   │ apps/storefront        │
│ .infinity.json   │          │  → transform       │          │ in dataset     │         │  (Hydrogen)            │
│ /content/dam/... │          │  → assets → import │── uploads▶ Media Library  │         │                        │
└──────────────────┘          └────────────────────┘          └────────────────┘         └────────────────────────┘
                                                                                          (downstream consumer —
                                                                                           out of scope here, but
                                                                                           part of the migration story)
```

The frontend that renders migrated content lives in a separate repo, [`aem-to-sanity-demo-web`](https://github.com/demo-repositories/aem-to-sanity-demo-web). This repo is the **migration toolkit**; that one is the **demo storefront** that consumes its output.

Every artifact has a content-derived identity (JCR path → `_id`, JCR UUID → `_key`, DAM path → manifest key), so **re-runs converge instead of duplicating**.

---

## How it works (5-minute version)

| Stage | CLI | What it does |
|---|---|---|
| **Schemas** | `migrate:schema` | Fetches each `_cq_dialog.infinity.json`, walks the Granite UI tree (supertype chain included), auto-discovers named-slot children and container drop-zones, emits one Sanity object type per AEM component plus a `pageBuilder` array and per-template page document types. |
| **Types** | `typegen` | Generates `sanity.types.ts` from the emitted schemas via `@sanity/schema` (in-process — no network call, no Studio required). |
| **Extract** | `aem-extract` | Walks `{root}.infinity.json` for each content root, transparently following depth-5 truncation markers. Writes `output/cache/aem/content/.../*.json`. |
| **Tags** | `aem-tags` | Walks `/content/cq:tags/...` and emits one Sanity `category` doc per `cq:Tag` (parent-child taxonomy). Optional; skip for migrations without AEM tags. |
| **Transform** | `aem-transform` | Maps `sling:resourceType` → Sanity types via the generated registry. Coerces AEM's JSON strings into proper types: HTML → Portable Text, `"true"` → `boolean`, `"10"` → `number`, tag refs → resolved Sanity references, recursively through nested multifields. Writes `output/cache/clean/*.json`. |
| **Assets** | `aem-assets` | Five phases — ML dedup, AEM download, Media Library upload, dataset link, in-place rewrite of clean docs. Resumable via `output/cache/assets/manifest.json`. Work-stealing pool sized by `ASSET_CONCURRENCY`. |
| **Import** | `aem-import` | Commits docs via `@sanity/client` `transaction().createOrReplace().commit()`. Categories first, pages second. Optional `--discard-drafts` for re-imports. |

**Dry-run by default.** Real writes are an explicit opt-in via `MIGRATION_DRY_RUN=false`.

For the full operator's runbook (every env var, every flag, troubleshooting), see [`docs/running-the-migration.md`](docs/running-the-migration.md).

---

## Quickstart

Starting a fresh project? The scaffolder emits a small standalone project — your config + Studio, with the toolkit installed **from npm** — and updating later is a plain `npm install`:

```bash
npm create @shehjad/aem-to-sanity my-migration
```

See [`packages/create-aem-to-sanity`](packages/create-aem-to-sanity/README.md) for flags (including `--clone` for a full monorepo checkout with git-merge updates). Working from a clone of this repo instead:

```bash
# 0. Install + build (pnpm ≥ 9, Node ≥ 22.12)
pnpm install
pnpm build

# 1. Scaffold a tenant folder from the committed template
pnpm migrate:init acme
pnpm install

# 2. Fill in credentials
$EDITOR tenants/acme/.env       # AEM source + Sanity destination
$EDITOR apps/studio/.env              # Sanity Studio project id

# 3. Verify the tenant is wired up correctly
pnpm migrate:doctor acme

# 4. Dry-run the whole pipeline
pnpm --filter tenant-acme migrate

# 5. Real write to Sanity
MIGRATION_DRY_RUN=false pnpm --filter tenant-acme migrate

# 6. Open the Studio to verify
pnpm --filter studio dev              # http://localhost:3333
```

Need `AEM_*` and `SANITY_*` credentials before step 4 — see [`docs/running-the-migration.md` § 1a](docs/running-the-migration.md) for the full env table, including the **AEMaaCS Service Credentials** flow (recommended over basic auth / dev tokens).

### Demo without AEM

The committed [`tenants/demo/`](tenants/demo/) tenant replays scrubbed AEM REST fixtures offline — no live AEM instance required. Copy `.env.example` → `.env`, fill in your Sanity project vars, then:

```bash
pnpm --filter tenant-demo migrate:demo
```

See [`docs/running-the-migration.md` § 1-pre-bis](docs/running-the-migration.md) for maintainer fixture regeneration (`pnpm build:demo-fixtures`).

---

## Where everything lives

```
aem-to-sanity/
├── packages/                          npm-publishable runtime packages
│   ├── aem-to-sanity-core/            Shared AEM fetcher, auth, config, logger, depth-handling
│   ├── aem-to-sanity-schema/          Dialog → Sanity object types + TypeGen + pageBuilder synthesizer
│   ├── aem-to-sanity-content/         extract → tags → transform → assets → import CLIs
│   ├── aem-to-sanity-studio/          Studio primitives: category type, AEM widget inputs, ML aspect
│   ├── aem-to-sanity-cli/             `aem-to-sanity` operator CLI (doctor, studio-sync, run) + project template
│   └── create-aem-to-sanity/          `npm create` scaffolder — standalone npm-dep project (or --clone)
│
├── apps/                              Local apps consuming the pipeline output
│   └── studio/                        Sanity Studio — loads emitted schemas; visual verification
│                                      (Frontend apps moved to aem-to-sanity-demo-web — separate repo)
│
├── tenants/                          Per-tenant working folders
│   ├── template/                      Committed template (copy this to start a new migration)
│   ├── demo/                          Committed offline demo (scrubbed AEM fixtures, no live AEM)
│   ├── davids-bridal/                 (gitignored) operator working copy
│   └── t-mobile/                      (gitignored) operator working copy
│
├── functions/                         Sanity Functions (event-driven content automation)
│   └── auto-colorize/
│
├── scripts/                           Repo-wide tooling
│   ├── migrate-init.ts                Scaffold a new tenant from tenants/template/
│   ├── toolkit-update.ts              Pull toolkit updates into a clone-mode scaffold (merge upstream ref)
│   ├── aem-probe.ts                   Resolve a single AEM dialog (supertype chain + dialog overrides) without running the full migrator
│   └── ensure-studio-stub.ts          Writes a minimal schemas/generated stub so Studio boots on bare clone
│
├── docs/
│   ├── aem-to-sanity-standalone.html  📊 Slide deck — pipeline / assets / commands / architecture
│   ├── overview.md                    Architecture + repo layout (single page)
│   ├── running-the-migration.md       Canonical operator's runbook
│   ├── updating.md                    Pull a newer toolkit into a scaffolded project (toolkit:update walkthrough)
│   ├── aem-to-sanity-mapping.md       (auto-generated) AEM ↔ Sanity field-level mapping
│   └── …                              (refactor plans, mapping reviews — historical context)
│
├── CLAUDE.md                          Project-level guidance for AI assistants
├── turbo.json                         Turbo task graph
├── pnpm-workspace.yaml                Workspace globs
└── tsconfig.base.json                 Strict, NodeNext, noUncheckedIndexedAccess
```

### Tenant folders

Every migration runs from `tenants/<your-tenant>/`. Only `tenants/template/` (the template) is committed; operator copies are gitignored so credentials, customer-specific component lists, and run output stay local. Inside a tenant folder:

| File | Role |
|---|---|
| `.env` | AEM creds + Sanity destination |
| `aem-component-paths` | JCR paths of components to migrate, one per line |
| `aem-content-roots` | Content paths to walk during extract, with `@base` sections |
| `aem-tag-roots` | AEM tag namespaces to migrate (optional) |
| `aem-component-exceptions` | `sling:resourceType` values to skip |
| `aem-component-containers.json` | Components with drop-zone children (`cq:isContainer=true`) |
| `aem-component-hints.json` | Components opting into AEM authoring hints (`cq:panelTitle` etc.) |
| `aem-component-names.json` | Explicit Sanity type name / title / folder / file / icon overrides per component |
| `aem-component-slots.json` | Visibility rules for auto-discovered named slots (mirror AEM enable-toggles) |
| `aem-dialog-overrides.json` | Dialog overrides: splice Sling-Resource-Merger-inherited tabs, or point at static local dialog files (generate them with `pnpm eject-dialogs`) |
| `aem-page-components.json` | Page-shell components + their `cq:template` paths; optional per-template `components` map restricting components to specific templates' page builders |
| `output/cache/…` | Per-stage artifacts — gitignored caches, regenerable. See `docs/running-the-migration.md` § 1e for the full tree (`aem/content/`, `aem/apps/`, `clean/`, `categories/`, `assets/`, reports). |

---

## Packages

Five packages, all published to npm, designed so external teams can consume only what they need — plus the `npm create` scaffolder.

### `aem-to-sanity-core`
Shared primitives — AEM client (basic auth / bearer / Service Credentials via Adobe IMS), config loader, logger, depth-truncation handler. No business logic. → [README](packages/aem-to-sanity-core/README.md)

### `aem-to-sanity-schema`
Dialog walker → mapper → emitter → registry → pageBuilder synthesizer → TypeGen. Resolves `sling:resourceSuperType` chains automatically. Emits deterministic prettier-formatted output. → [README](packages/aem-to-sanity-schema/README.md)

### `aem-to-sanity-content`
Five CLIs (`aem-extract`, `aem-tags`, `aem-transform`, `aem-assets`, `aem-import`) chained through on-disk artifacts. Type-aware coercion via the registry. Resumable per-stage. → [README](packages/aem-to-sanity-content/README.md)

### `aem-to-sanity-studio`
Studio-side primitives tenant studios import instead of copying: the `category` taxonomy type (populated by `aem-tags`), `aemFormComponents` input routing for migrated AEM widgets, and the `aemSource` Media Library aspect (`aem-assets` dedup). Because they're imported, toolkit updates deliver Studio changes without touching operator studios. → [README](packages/aem-to-sanity-studio/README.md)

### `aem-to-sanity-cli`
The `aem-to-sanity` operator bin — `doctor` (env/config drift checks), `studio-sync` (template file sync, never overwrites), `run` (logged pipeline runs), `wipe-media-library`. Workspace-mode aware: works in standalone scaffolds and in this monorepo (the root `pnpm -w migrate:doctor` / `studio:sync` scripts wrap it). Also ships the project template that `create-aem-to-sanity` scaffolds from, embedded at build time. → [README](packages/aem-to-sanity-cli/README.md)

### `@shehjad/create-aem-to-sanity`
The `npm create` scaffolder. Default: a thin standalone project (config + Studio at the root) with the toolkit installed from npm — updates are a plain `npm install`. `--clone` gives the old full-monorepo checkout with git-merge updates for teams hacking on toolkit source. → [README](packages/create-aem-to-sanity/README.md)

---

## Apps

| App | Purpose |
|---|---|
| [`apps/studio`](apps/studio/) | Sanity Studio that loads the migrated schemas from `apps/studio/schemas/generated/`. Used for visual verification and content editing post-migration. |
| **Frontend (separate repo)** | Demo storefronts that consume migrated content live in [`aem-to-sanity-demo-web`](https://github.com/demo-repositories/aem-to-sanity-demo-web) — a Vite + React 19 preview and a Hydrogen (Shopify + Remix) skeleton. Out of scope here, but part of the broader migration story. |

---

## Documentation map

| Doc | When to read |
|---|---|
| 📊 [`docs/aem-to-sanity-standalone.html`](docs/aem-to-sanity-standalone.html) | First — 10-minute walkthrough of the whole system. |
| [`docs/overview.md`](docs/overview.md) | Architecture, design principles, minimum commands — one page. |
| [`docs/running-the-migration.md`](docs/running-the-migration.md) | Operator's runbook — every env var, every flag, per-stage outputs, troubleshooting. |
| [`docs/aem-to-sanity-mapping.md`](docs/aem-to-sanity-mapping.md) | Auto-generated field-level mapping (AEM Granite UI ↔ Sanity types). |
| [`docs/releasing.md`](docs/releasing.md) | Versioning & releases — how to pin a release, how to ship one. |
| [`docs/developer-onboarding.md`](docs/developer-onboarding.md) | Maintainer onboarding — repo mental model + the AEM domain knowledge encoded in the code. |
| Per-package READMEs | API contracts, flag tables, output shapes for each runtime package. |
| [`CLAUDE.md`](CLAUDE.md) | Project conventions for AI assistants (and a useful map for new contributors). |

---

## Common workflows

```bash
# Re-run a single stage without redoing the others
pnpm --filter tenant-<tenant> extract
pnpm --filter tenant-<tenant> transform

# Re-link assets without re-uploading (e.g. ML already has the binaries)
pnpm --filter tenant-<tenant> assets -- --link-only

# Discard shadowing drafts in the Studio after re-import
pnpm --filter tenant-<tenant> import -- --discard-drafts

# Probe a single AEM dialog (resolve the supertype chain + dialog overrides without running the migrator)
pnpm exec tsx scripts/aem-probe.ts /apps/<site>/components/proxy/foo

# Eject effective dialogs into static hand-editable files (dialog-overrides/)
pnpm --filter tenant-<tenant> eject-dialogs -- --all

# Validate emitted schemas
pnpm --filter studio exec sanity schema validate

# Audit every tenant under tenants/ for template drift
pnpm migrate:doctor --all
```

---

## Design principles

- **Deterministic output.** Same input → byte-identical files. `git diff` shows only real changes.
- **Dry-run by default.** Anything that writes to Sanity is opt-in via `MIGRATION_DRY_RUN=false`.
- **Upserts, not duplicates.** Content-derived `_id`s mean re-runs converge.
- **Unknown shapes are findings, not failures.** The pipeline keeps going; the audit reports tell you what to fix next.
- **Soft on content drift, loud on misconfig.** Malformed config / missing env / schema validation errors fail fast. Unmapped resource types become action items in the report.
- **Separation of concerns.** Core owns fetching + auth + config; schema and content packages own their transforms. External projects depend on only what they need.

---

## Stack

**pnpm workspaces + Turborepo** · TypeScript strict / NodeNext · `tsup` for ESM+CJS+`.d.ts` · `zod` for runtime validation of AEM payloads · `@portabletext/block-tools` + `jsdom` for HTML → Portable Text · `@sanity/client` for ingest · `changesets` for releases.

---

## Versioning & releases

The five toolkit packages share one version line, managed with [Changesets](https://github.com/changesets/changesets). Every release is published to npm and ships git tags + [GitHub Releases](https://github.com/demo-repositories/aem-to-sanity/releases) with release notes, so you decide when to move:

```bash
git fetch --tags
git checkout aem-to-sanity-core@1.0.0   # pin to a release; read its notes first
```

User-facing PRs must include a changeset (`pnpm changeset`); merging the auto-opened "chore: version packages" PR cuts the release. Full guide: [`docs/releasing.md`](docs/releasing.md).

---

## Status & contributing

The three runtime packages and the Studio app are production-shaped — `tenants/davids-bridal/` and `tenants/t-mobile/` are the integration suites. Releases are automated via Changesets + GitHub Actions (see [`docs/releasing.md`](docs/releasing.md)). See [`CLAUDE.md`](CLAUDE.md) for contribution conventions (doc-refresh rules, commit discipline, regeneration recipes).

```bash
pnpm -r typecheck
pnpm -r test
```

are the gates every change goes through.

---

## License

[MIT](LICENSE) © 2026 Sanity.io
