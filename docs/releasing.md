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

### npm auth for CI

Publishing needs an **`NPM_TOKEN`** repository secret — an npm *automation* token (bypasses 2FA for CI) from an account with publish access to the `aem-to-sanity-*` packages and the `@shehjad` scope. Create one at npmjs.com → Access Tokens → Generate New Token → Automation, then add it under the repo's Settings → Secrets and variables → Actions.

### Running the version / publish steps locally

```bash
GITHUB_TOKEN=$(gh auth token) pnpm run version   # changelog generator resolves PR/author links via the GitHub API
pnpm run release                                 # build + changeset publish (needs npm login; 2FA prompt per package)
```

The first-ever publish of a package must be done by a logged-in user (or a token with publish rights); after that the CI automation token takes over.
