# Versioning & releases

The toolkit is versioned with [Changesets](https://github.com/changesets/changesets). The three publishable packages — `aem-to-sanity-core`, `aem-to-sanity-schema`, `aem-to-sanity-content` — move in **lockstep** (a `fixed` group in `.changeset/config.json`), so there is a single toolkit version. The current version is whatever `packages/*/package.json` says; releases are cut as git tags plus GitHub Releases with notes. Nothing is published to npm.

## For consumers: pinning and updating

Every release produces annotated tags of the form `<package>@<version>` (e.g. `aem-to-sanity-core@1.0.0` — all three carry the same version) and a GitHub Release per package whose body is that version's changelog entry.

```bash
# See what's available
git fetch --tags
git tag --list 'aem-to-sanity-core@*'

# Pin your working copy to a release
git checkout aem-to-sanity-core@1.0.0
pnpm install && pnpm -r build

# Move to the latest release when you decide to
git fetch --tags
git checkout aem-to-sanity-core@1.1.0   # after reading its release notes
```

Release notes live in three places, all generated from the same source:

- GitHub Releases (https://github.com/demo-repositories/aem-to-sanity/releases)
- `packages/*/CHANGELOG.md` (committed, per-package)
- The merged "chore: version packages" PRs, which show exactly what each version rolled up

Semver intent: **major** = breaking change to CLI flags, env vars, output artifact shapes, or generated schema/document shapes (anything that could orphan or reshape already-migrated content — e.g. `_id` generation changes); **minor** = new flags, env vars, mappings, or pipeline capabilities; **patch** = bug fixes with no surface change.

## For maintainers: shipping a change

1. Land your change as usual, and **include a changeset in the same PR** when the change is user-facing:

   ```bash
   pnpm changeset
   ```

   Pick the bump type (all three packages bump together because of the fixed group — selecting one is enough) and write the summary **as release notes for an operator**: what changed observable from the CLI, what they must do (new env var, re-run a stage, etc.). The summary lands verbatim in the changelog and the GitHub Release.

   Internal-only changes (refactors, CI, docs-only) don't need a changeset.

2. Merge to `main`. The `Release` workflow (`.github/workflows/release.yml`) sees the pending changesets and opens/updates a **"chore: version packages"** PR that bumps versions and rolls the summaries into each `CHANGELOG.md`. Multiple merged changesets accumulate into that one PR.

3. When you're ready to cut the release, merge the version PR. The workflow then tags the release (`changeset tag`), pushes the tags, and publishes the GitHub Releases automatically.

### Running the version step locally

Normally the CI PR does this, but you can run it by hand:

```bash
GITHUB_TOKEN=$(gh auth token) pnpm run version   # changelog generator resolves PR/author links via the GitHub API
```

### Publishing to npm later

If the packages ever move to npm distribution, switch the root `release` script back to `changeset publish` (with a build first) and add an `NPM_TOKEN` to the workflow — the Changesets action handles the rest. `publishConfig.access: public` is already set on all three packages.
