# AEM → Sanity migration project

Scaffolded by `npm create @shehjad/aem-to-sanity`. This project migrates AEM
content into Sanity using the [aem-to-sanity toolkit](https://github.com/demo-repositories/aem-to-sanity) —
the pipeline CLIs come from the `aem-to-sanity-*` npm packages in
`package.json`; this folder holds only *your* configuration, content lists,
and Studio.

## Setup

```bash
$EDITOR .env                 # AEM source + Sanity destination credentials
$EDITOR studio/.env          # SANITY_STUDIO_PROJECT_ID + dataset
$EDITOR aem-content-roots    # pages to migrate (see aem-content-roots.example)
$EDITOR aem-component-paths  # components to map, one JCR path per line
npx aem-to-sanity doctor     # verify wiring before running
```

## Run the migration

```bash
npm run migrate              # full pipeline, dry-run by default
                             # (extract → tags → schema → transform → assets → import)
MIGRATION_DRY_RUN=false npm run migrate    # real write to Sanity
npm run --workspace studio dev             # open your Studio on :3333
```

Every stage is also runnable on its own (`npm run extract`, `npm run
transform`, …) and is resumable — re-runs converge instead of duplicating.
Full runbook, every env var and flag: [running-the-migration.md](https://github.com/demo-repositories/aem-to-sanity/blob/main/docs/running-the-migration.md).

## Folder map

| File | Role |
|---|---|
| `.env` | AEM creds + Sanity destination (gitignored) |
| `aem-component-paths` | JCR paths of components to migrate, one per line |
| `aem-content-roots` | Content paths to walk during extract, with `@base` sections |
| `aem-tag-roots` | AEM tag namespaces to migrate (optional) |
| `aem-component-*.json` | Container/hints/name-override configs (see runbook § 1c) |
| `studio/` | Your Sanity Studio — `migrate:schema` emits generated schemas into `studio/schemas/generated/` (set `SCHEMAS_OUT_DIR=./studio/schemas/generated` in `.env`) |
| `output/` | Per-stage caches and reports — regenerable, gitignored |

## Updating the toolkit

```bash
npm install aem-to-sanity-core@latest aem-to-sanity-schema@latest \
  aem-to-sanity-content@latest aem-to-sanity-studio@latest aem-to-sanity-cli@latest
npx aem-to-sanity doctor --fix          # sync scripts/env surface with the new template
npx aem-to-sanity studio-sync --fix     # pick up new Studio template files (never overwrites yours)
npm run migrate:schema                  # re-emit schemas with the new toolkit
```

Release notes: [GitHub Releases](https://github.com/demo-repositories/aem-to-sanity/releases).
