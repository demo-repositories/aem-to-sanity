# Updating a scaffolded project

The walkthrough for pulling a newer toolkit into a project created with `npm create @shehjad/aem-to-sanity`. Run it whenever a new toolkit release ships — watch the [GitHub Releases](https://github.com/demo-repositories/aem-to-sanity/releases) or `npm outdated`.

For *starting* a project, see the [scaffolder README](../packages/create-aem-to-sanity/README.md); for running the pipeline, see [`running-the-migration.md`](running-the-migration.md).

## Standalone projects (the default scaffold)

The toolkit is a set of npm dependencies in your `package.json` (`aem-to-sanity-core`, `-schema`, `-content`, `-studio`, `-cli`), so updating is a normal dependency update:

```bash
# 1. Update the toolkit packages (they version in lockstep — update together)
npm install aem-to-sanity-core@latest aem-to-sanity-schema@latest \
  aem-to-sanity-content@latest aem-to-sanity-studio@latest aem-to-sanity-cli@latest

# 2. Sync your project's file surface with the new template
npx aem-to-sanity doctor --fix          # package.json scripts, env-var surface
npx aem-to-sanity studio-sync --fix     # new Studio template files + deps (never overwrites yours)

# 3. Regenerate what the toolkit generates
npm run migrate:schema                  # re-emit schemas + registry with the new emitter

# 4. Verify + commit
npx aem-to-sanity doctor
git add -A && git commit -m "chore: update aem-to-sanity toolkit"
```

Notes:

- **Pin instead of latest** by using an explicit version (`aem-to-sanity-core@1.11.0 …`). All five packages share one version line (a Changesets fixed group), so use the same version for each.
- Step 2's `--fix` commands only *add* — new scripts, new files, missing deps. Files you've customized are reported as drift and left alone; diff them by hand against the template shipped in `node_modules/aem-to-sanity-cli/template/`.
- Step 3 matters when the release changed the schema emitter or transform. If you re-import content afterwards, remember `--discard-drafts` (see [`running-the-migration.md`](running-the-migration.md) § "Drafts").
- What changed: [GitHub Releases](https://github.com/demo-repositories/aem-to-sanity/releases) or `node_modules/aem-to-sanity-*/CHANGELOG.md` after updating.

## Clone-mode projects (`--clone` scaffolds and older projects)

Projects that carry the full toolkit monorepo update by **git merge** instead. The scaffold keeps the toolkit history under an `upstream` remote; the stamp in the root `package.json` (`aemToSanity`) records the repo/ref/commit it tracks.

```bash
# 0. Clean tree — toolkit:update refuses to run over uncommitted changes
git status                                        # commit or stash anything pending

# 1. Merge the new toolkit (pick one)
pnpm -w toolkit:update                            # latest upstream/main
pnpm -w toolkit:update aem-to-sanity-core@1.11.0  # or pin a release tag

# 2. Commit the result (the merge + refreshed stamp)
git add -A && git commit -m "chore: update aem-to-sanity toolkit"

# 3. Sync tenant surface with the updated template
pnpm -w migrate:doctor --all --fix
pnpm -w studio:sync --all --fix
pnpm install

# 4. Regenerate + verify
cd tenants/<your-tenant> && pnpm migrate:schema
pnpm -r typecheck
```

If the merge conflicts (local commits touching toolkit files), resolve the conflicted files, then `git add -A && git merge --continue && pnpm install && pnpm build`. Your `tenants/<slug>/` folder is gitignored, so tenant config, credentials, and pipeline output are never part of the merge. Scaffolds created with `--detach` (or scaffolder 0.1.0) have no shared history and can't merge — re-scaffold and move the gitignored tenant folder over, or switch to a standalone scaffold.

Preview what a merge would pull: `git fetch upstream && git log HEAD..upstream/main --oneline`.
