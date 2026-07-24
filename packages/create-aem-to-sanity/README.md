# @shehjad/create-aem-to-sanity

Scaffolds a new [AEM → Sanity migration](https://github.com/demo-repositories/aem-to-sanity) project. One command gets you the full toolkit — schema migrator, content pipeline, per-tenant Studio template — plus (optionally) your first tenant folder, ready for credentials.

```bash
npm create @shehjad/aem-to-sanity my-migration
# or scaffold the first tenant in the same run:
npm create @shehjad/aem-to-sanity my-migration -- --tenant acme
```

Equivalent with pnpm: `pnpm create @shehjad/aem-to-sanity my-migration`.

## What it does

1. Shallow-clones the [`aem-to-sanity`](https://github.com/demo-repositories/aem-to-sanity) toolkit into the target directory (default ref: `main`; pin a release tag with `--ref`).
2. Detaches the clone from the toolkit's git history (`rm -rf .git && git init`) — the scaffold is *your* repo now.
3. Runs `pnpm install` + `pnpm build` so the workspace CLI bins are runnable out of the box (skip both with `--no-install`).
4. With `--tenant <slug>`: runs `pnpm migrate:init <slug>` to scaffold `tenants/<slug>/` (env files, content-roots lists, per-tenant Studio) from the committed template, then re-installs to link the new workspaces.
5. Prints the next steps: fill in `.env` credentials, `pnpm -w migrate:doctor <slug>`, `pnpm -F tenant-<slug> migrate`.

## Flags

| Flag | Default | Meaning |
|---|---|---|
| `[target-dir]` | prompted | Directory to create (must be empty or absent) |
| `-t, --tenant <slug>` | prompted (blank = skip) | First tenant to scaffold via `migrate:init` |
| `-r, --ref <git-ref>` | `main` | Branch or tag of the toolkit to clone (e.g. `aem-to-sanity-core@1.9.0`) |
| `--repo <url>` | the upstream GitHub URL | Clone from a fork or local checkout instead |
| `--no-install` | install | Skip `pnpm install` + `pnpm build` (incompatible with `--tenant`) |

When run without arguments in a terminal, the CLI prompts for the target directory and tenant slug; in non-interactive contexts (CI) the target directory is required.

## Requirements

- Node ≥ 22.12 and pnpm ≥ 9 to *run* the scaffolded toolkit (the CLI itself only needs Node ≥ 20)
- `git` on the PATH

## After scaffolding

The scaffolded project is self-documenting — start with its `README.md` and `docs/running-the-migration.md` (the full operator runbook: every env var, every flag, troubleshooting). The short version:

```bash
cd my-migration
$EDITOR tenants/acme/.env            # AEM source + Sanity destination credentials
$EDITOR tenants/acme/studio/.env     # Studio project id + dataset
pnpm -w migrate:doctor acme          # verify wiring before running
pnpm -F tenant-acme migrate          # dry-run the full pipeline
```
