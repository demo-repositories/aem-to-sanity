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
2. Keeps the toolkit's git history under an **`upstream`** remote (so `origin` stays free for your own repository) and pins a local `main` branch — this is what makes `pnpm -w toolkit:update` work later. Pass `--detach` to drop the history instead (clean slate, but no update path).
3. Stamps provenance into the scaffold's root `package.json` under an `aemToSanity` key — scaffolder version, source repo, ref, resolved commit, timestamp.
4. Runs `pnpm install` + `pnpm build` so the workspace CLI bins are runnable out of the box (skip both with `--no-install`).
5. With `--tenant <slug>`: runs `pnpm migrate:init <slug>` to scaffold `tenants/<slug>/` (env files, content-roots lists, per-tenant Studio) from the committed template, then re-installs to link the new workspaces.
6. Commits the result (`chore: aem-to-sanity scaffold`) so the tree is clean and `toolkit:update` can run later without ceremony. Tenant folders are gitignored — credentials never enter history.
7. Prints the next steps: fill in `.env` credentials, `pnpm -w migrate:doctor <slug>`, `pnpm -F tenant-<slug> migrate`.

## Flags

| Flag | Default | Meaning |
|---|---|---|
| `[target-dir]` | prompted | Directory to create (must be empty or absent) |
| `-t, --tenant <slug>` | prompted (blank = skip) | First tenant to scaffold via `migrate:init` |
| `-r, --ref <git-ref>` | `main` | Branch or tag of the toolkit to clone (e.g. `aem-to-sanity-core@1.9.0`) |
| `--repo <url>` | the upstream GitHub URL | Clone from a fork or local checkout instead |
| `--no-install` | install | Skip `pnpm install` + `pnpm build` (incompatible with `--tenant`) |
| `--detach` | keep history | Drop the toolkit git history — disables `pnpm -w toolkit:update` |
| `-v, --version` | — | Print the scaffolder version and exit |

When run without arguments in a terminal, the CLI prompts for the target directory and tenant slug; in non-interactive contexts (CI) the target directory is required.

## Requirements

- Node ≥ 22.12 and pnpm ≥ 9 to *run* the scaffolded toolkit (the CLI itself only needs Node ≥ 20)
- `git` on the PATH

## Versioning & updates

Two versions are in play, pinned independently:

- **Scaffolder version** — which release of this CLI runs. `npm create @shehjad/aem-to-sanity@latest …` forces the newest (plain `npm create` may reuse an older cached copy); `@0.2.0` pins exactly. `npm create @shehjad/aem-to-sanity -- --version` prints it, and every run logs it as its first line.
- **Toolkit version** — which ref of the toolkit repo gets cloned. Defaults to `main`; pin a release with `--ref aem-to-sanity-core@1.9.0`.

Both are recorded in the scaffold's root `package.json`:

```jsonc
"aemToSanity": {
  "scaffolder": "@shehjad/create-aem-to-sanity@0.2.0",
  "repo": "https://github.com/demo-repositories/aem-to-sanity.git",
  "ref": "main",
  "commit": "<sha the clone resolved to>",
  "createdAt": "…"
}
```

**Updating later:** from anywhere in the scaffold, run

```bash
pnpm -w toolkit:update                          # merge latest upstream/main
pnpm -w toolkit:update aem-to-sanity-core@2.0.0 # or pin a release tag
```

It fetches the `upstream` remote (un-shallowing the clone on first run), merges the ref into your branch, runs `pnpm install && pnpm build`, and refreshes the `aemToSanity` stamp (`ref`, `commit`, `updatedAt`). Your tenant folders are gitignored, so the merge never touches them; commit the result, then `pnpm -w migrate:doctor --all --fix` syncs tenants with any template changes. The script refuses to run on a dirty working tree, and scaffolds created with `--detach` can't update (no shared history) — re-scaffold instead.

## After scaffolding

The scaffolded project is self-documenting — start with its `README.md` and `docs/running-the-migration.md` (the full operator runbook: every env var, every flag, troubleshooting). The short version:

```bash
cd my-migration
$EDITOR tenants/acme/.env            # AEM source + Sanity destination credentials
$EDITOR tenants/acme/studio/.env     # Studio project id + dataset
pnpm -w migrate:doctor acme          # verify wiring before running
pnpm -F tenant-acme migrate          # dry-run the full pipeline
```
