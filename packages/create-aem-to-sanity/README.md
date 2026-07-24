# @shehjad/create-aem-to-sanity

Scaffolds a new [AEM → Sanity migration](https://github.com/demo-repositories/aem-to-sanity) project.

```bash
npm create @shehjad/aem-to-sanity my-migration
```

Equivalent with pnpm: `pnpm create @shehjad/aem-to-sanity my-migration`.

## What you get (standalone mode, the default)

A small project that is *yours* — config, content lists, and a Sanity Studio — with the migration toolkit installed from npm as regular dependencies:

```
my-migration/
├── package.json          aem-to-sanity-{core,schema,content,studio,cli} from npm
├── .env                  AEM + Sanity credentials (seeded from .env.example, gitignored)
├── aem-content-roots     pages to migrate
├── aem-component-paths   components to map
├── aem-component-*.json  container / hints / name-override configs
├── studio/               your Sanity Studio (schemas generated into studio/schemas/generated)
└── output/               pipeline caches + reports (gitignored)
```

The scaffolder copies the template (shipped inside [`aem-to-sanity-cli`](https://www.npmjs.com/package/aem-to-sanity-cli), versioned with the toolkit), seeds `.env` files, initializes git with an initial commit, and installs dependencies (pnpm if available, npm otherwise — both work).

```bash
cd my-migration
$EDITOR .env studio/.env aem-content-roots aem-component-paths
npx aem-to-sanity doctor     # verify wiring
npm run migrate              # dry-run the full pipeline
```

**Updating the toolkit** is a normal dependency update — no git merges:

```bash
npm install aem-to-sanity-core@latest aem-to-sanity-schema@latest \
  aem-to-sanity-content@latest aem-to-sanity-studio@latest aem-to-sanity-cli@latest
npx aem-to-sanity doctor --fix        # sync scripts/env surface with the new template
npx aem-to-sanity studio-sync --fix   # pick up new Studio template files (never overwrites yours)
npm run migrate:schema                # re-emit schemas with the new toolkit
```

## Flags

| Flag | Default | Meaning |
|---|---|---|
| `[target-dir]` | prompted | Directory to create (must be empty or absent) |
| `--no-install` | install | Skip dependency installation |
| `--clone` | off | Clone the full toolkit **monorepo** instead (see below) |
| `-v, --version` | — | Print the scaffolder version and exit |

Pin the scaffolder itself with `npm create @shehjad/aem-to-sanity@<version>`; the toolkit version comes from npm at install time (`^` ranges recorded in the scaffold's package.json).

## Clone mode (`--clone`)

The pre-npm distribution model, kept for teams who want to hack on the toolkit source directly: clones the whole monorepo, keeps its git history under an `upstream` remote, and updates via `pnpm -w toolkit:update` (git merge). Clone-mode-only flags: `--tenant <slug>` (scaffold the first tenant), `--ref <git-ref>` (pin a release tag), `--repo <url>` (fork), `--detach` (drop history). Requires pnpm.

## Requirements

- Node ≥ 20 for the CLI; Node ≥ 22.12 to run the toolkit
- `git` recommended (initial commit); required for `--clone`
