# aem-to-sanity-cli

Operator CLI for [AEM → Sanity migration](https://github.com/demo-repositories/aem-to-sanity) projects, plus the project template `create-aem-to-sanity` scaffolds from. Installed as a devDependency of every scaffolded project; also used inside the toolkit monorepo itself.

```bash
npx aem-to-sanity <command>
```

## Commands

| Command | What it does |
|---|---|
| `doctor [--fix]` | Checks the project against the reference template: missing/placeholder env vars (from `.env.example`; `SANITY_MEDIA_LIBRARY_ID` is exempt when `MIGRATION_ASSETS_DOWNLOAD_ONLY=true`, since download-only asset runs never touch the Media Library), AEM auth configured (one of service credentials / dev token / basic auth), package.json scripts drift (`--fix` repairs), missing config files, fixtures layout when `AEM_FIXTURES_DIR` is set. Exit 1 on errors. |
| `studio-sync [--fix]` | Copies *new* template Studio files into your `studio/` and adds missing deps (`--fix`); reports — never overwrites — files you've customized. |
| `run "<command>"` | Runs a shell command with output mirrored to `output/execution-<timestamp>.log`. Wired into the template's `migrate` scripts. |
| `wipe-media-library [--confirm-delete]` | Deletes ALL Sanity Media Library assets (test environments only). Dry-run by default. |

## Workspace modes

Every command detects its surroundings:

- **Standalone** (a project from `npm create @shehjad/aem-to-sanity`): the project root is the tenant. `aem-to-sanity doctor` takes no arguments; the reference template ships inside this package (`template/`, embedded at build time, versioned with the toolkit).
- **Monorepo** (the toolkit repo or a `--clone` scaffold): tenants live under `tenants/<slug>/`. `doctor <slug>`, `doctor --all`, and slug inference from cwd all work; the reference template is `tenants/template/`.

## Library exports

The template helpers (env parsing, template file classification, fixtures inspection, `copyTree`/`renameWorkspace`) are exported from the package root for the monorepo's init scripts — see the toolkit repo's `scripts/`.
