# Versioning & releases

The toolkit is versioned with [Changesets](https://github.com/changesets/changesets). The five toolkit packages — `aem-to-sanity-core`, `aem-to-sanity-schema`, `aem-to-sanity-content`, `aem-to-sanity-studio`, `aem-to-sanity-cli` — move in **lockstep** (a `fixed` group in `.changeset/config.json`), so there is a single toolkit version. The scaffolder, `@shehjad/create-aem-to-sanity`, versions independently.

**Every release is published to npm** (plus git tags and GitHub Releases with notes). Client projects consume the packages as regular dependencies; see [`updating.md`](updating.md) for the consumer flow.

## For consumers: pinning and updating

```bash
# What's out there
npm view aem-to-sanity-core versions

# Update a standalone project (all five share one version — update together)
npm install aem-to-sanity-core@latest aem-to-sanity-schema@latest \
  aem-to-sanity-content@latest aem-to-sanity-studio@latest aem-to-sanity-cli@latest
```

Release notes live in three places, all generated from the same source:

- GitHub Releases (https://github.com/demo-repositories/aem-to-sanity/releases)
- `CHANGELOG.md` in each published package (visible in `node_modules/` after install)
- The merged "chore: version packages" PRs, which show exactly what each version rolled up

Semver intent: **major** = breaking change to CLI flags, env vars, output artifact shapes, or generated schema/document shapes (anything that could orphan or reshape already-migrated content — e.g. `_id` generation changes); **minor** = new flags, env vars, mappings, or pipeline capabilities; **patch** = bug fixes with no surface change.

Clone-mode projects (full monorepo checkouts) can still pin git tags: `git fetch --tags && git checkout aem-to-sanity-core@<version>`.

## For maintainers: shipping a change

1. Land your change as usual, and **include a changeset in the same PR** when the change is user-facing:

   ```bash
   pnpm changeset
   ```

   Pick the bump type (the five toolkit packages bump together because of the fixed group — selecting one is enough) and write the summary **as release notes for an operator**: what changed observable from the CLI, what they must do (new env var, re-run a stage, etc.). The summary lands verbatim in the changelog and the GitHub Release.

   Internal-only changes (refactors, CI, docs-only) don't need a changeset.

2. Merge to `main`. The `Release` workflow (`.github/workflows/release.yml`) sees the pending changesets and opens/updates a **"chore: version packages"** PR that bumps versions and rolls the summaries into each `CHANGELOG.md`. Multiple merged changesets accumulate into that one PR.

3. When you're ready to cut the release, merge the version PR. The workflow builds everything and runs `changeset publish`: every public package goes to npm, `<pkg>@<version>` tags are pushed, and GitHub Releases are created automatically.

### npm auth for CI — trusted publishing (OIDC)

CI publishes via [npm **trusted publishing**](https://docs.npmjs.com/trusted-publishers/) — the workflow proves its identity to npm with a short-lived OIDC token, so there is **no `NPM_TOKEN` secret to create, store, or rotate**. (npm is deprecating long-lived tokens for publishing: 2FA-bypass granular tokens lose direct publish rights around January 2027 — see the [GitHub changelog](https://github.blog/changelog/2026-07-08-npm-install-time-security-and-gat-bypass2fa-deprecation/).)

**One-time setup, per package** (logged in to npmjs.com as an account with maintainer access — this is a sensitive operation, expect a 2FA prompt). For each of `aem-to-sanity-core`, `-schema`, `-content`, `-studio`, `-cli`, and `@shehjad/create-aem-to-sanity`:

1. Open `https://www.npmjs.com/package/<name>/access` → **Trusted Publisher** → *GitHub Actions*.
2. Fill in: organization/user **`demo-repositories`**, repository **`aem-to-sanity`**, workflow filename **`release.yml`** (filename only, not the path). Leave *environment* blank (the workflow doesn't use one).

A package must already exist on npm before a trusted publisher can be attached — the **first-ever publish** of a brand-new package is still done by a logged-in human (`npm publish` locally, 2FA prompt).

**Workflow side** (already wired in `release.yml`): `permissions: id-token: write`, plus an `npm install -g npm@latest` step — trusted publishing needs npm CLI ≥ 11.5.1 and Node 22 bundles npm 10.x. `changeset publish` shells out to `npm publish`, which detects the OIDC environment automatically and also generates provenance attestations. Don't hardcode `publishConfig.provenance: true` in package.jsons — provenance generation only works in CI, and it would break the local-publish fallback below. The trusted-publisher config must keep matching the workflow filename: renaming `release.yml` means updating all six packages on npmjs.com.

Anything not covered by trusted publishing (yanking a version, changing package access) is done locally with your 2FA, not from CI.

## Verifying a release end-to-end (client smoke test)

After a release lands on npm, verify it **the way a client consumes it** — from the public registry, in an empty directory, with no monorepo on the path. The offline leg needs no AEM or Sanity credentials.

```bash
# 0. What's actually on the registry (all five toolkit packages move together;
#    the scaffolder versions independently — make sure it moved too if its code changed)
npm view aem-to-sanity-core version
npm view @shehjad/create-aem-to-sanity version

# 1. Scaffold from the live registry in a scratch dir
cd "$(mktemp -d)"
npm create @shehjad/aem-to-sanity@latest smoke-test
cd smoke-test

# 2. The operator CLI resolves and runs
npx aem-to-sanity --version          # must print the released toolkit version
npx aem-to-sanity doctor             # must flag every placeholder .env value (that's a pass)

# 3. Full pipeline offline — replay the demo fixtures, no credentials needed.
#    Copy them from a checkout of this repo (tenants/demo is committed):
cp -R <repo>/tenants/demo/fixtures .
cp <repo>/tenants/demo/aem-component-paths <repo>/tenants/demo/aem-content-roots \
   <repo>/tenants/demo/aem-tag-roots <repo>/tenants/demo/aem-component-containers.json \
   <repo>/tenants/demo/aem-component-exceptions <repo>/tenants/demo/aem-component-hints.json \
   <repo>/tenants/demo/aem-page-components.json .
#    In .env set: AEM_AUTHOR_URL=http://demo.local  AEM_TOKEN=offline-fixtures
#                 AEM_FIXTURES_DIR=./fixtures/aem   SANITY_PROJECT_ID=demo-project
#                 SANITY_TOKEN=demo-token           MIGRATION_DRY_RUN=true
#                 MIGRATION_DOC_ID_PREFIX_STRIP=/content/demo/site-a/us/en,/content/demo/site-b/us/en
npm run migrate                      # extract → tags → schema → transform → assets → import, all dry-run

# 4. What "pass" looks like
#    - `migrate` exits 0 and the import stage prints "Would commit: N page(s), M categories"
#    - studio/schemas/generated/index.ts is a real barrel (not the 4-line bootstrap stub)
#    - `cd studio && npx tsc --noEmit` is clean
```

With real credentials, continue as an actual migration would: fill `.env` / `studio/.env`, `npx aem-to-sanity doctor` until green, `npm run migrate`, then `MIGRATION_DRY_RUN=false npm run migrate` and open the Studio (`cd studio && npx sanity dev`).

Also verify the **update path** on an existing scaffold created from the *previous* release: `npm install` the five packages `@latest`, then `npx aem-to-sanity doctor --fix`, `npx aem-to-sanity studio-sync --fix`, `npm run migrate:schema` — the walkthrough in [`updating.md`](updating.md).

**Gotcha — `changeset publish` skips versions that already exist on npm.** If a package's code changed but its version was already published (e.g. it was seeded manually), the release silently ships *nothing* for it. This bit the scaffolder once: `@shehjad/create-aem-to-sanity@0.2.0` was published by hand before the standalone-scaffold rewrite landed, so the rewrite sat unpublished until its changeset bumped it past 0.2.0. Step 0 above catches this: confirm the registry version of every package whose code changed actually moved.

### Running the version / publish steps locally

```bash
GITHUB_TOKEN=$(gh auth token) pnpm run version   # changelog generator resolves PR/author links via the GitHub API
pnpm run release                                 # build + changeset publish (needs npm login; 2FA prompt per package)
```

The first-ever publish of a package must be done by a logged-in user (2FA prompt per package); after that, attach the Trusted Publisher on npmjs.com (see "npm auth for CI" above) and CI takes over.
