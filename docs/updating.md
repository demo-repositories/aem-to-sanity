# Updating a scaffolded project

The walkthrough for pulling a newer toolkit into a project created with `npm create @shehjad/aem-to-sanity`. Run it whenever a new toolkit release ships (watch the [GitHub Releases](https://github.com/demo-repositories/aem-to-sanity/releases)) or whenever you were told a fix landed on `main`.

For *starting* a project, see the [scaffolder README](../packages/create-aem-to-sanity/README.md); for running the pipeline, see [`running-the-migration.md`](running-the-migration.md).

## What you're updating

A scaffold tracks two versions, both recorded in the `aemToSanity` stamp in the root `package.json`:

- **Toolkit version** — the ref of this repo your project was cloned from (`ref` + `commit` in the stamp). This is what `toolkit:update` moves.
- **Scaffolder version** — which release of `@shehjad/create-aem-to-sanity` created the project (`scaffolder` in the stamp). Only matters at create time; you never update it in place.

Your scaffold keeps the toolkit's git history under an **`upstream`** remote, which is what makes in-place updates possible. (Scaffolds created with `--detach`, or with scaffolder 0.1.0, have no shared history and can't update — re-scaffold and move your gitignored `tenants/<slug>/` folder over; it survives untouched.)

## The update sequence

```bash
# 0. Clean tree — toolkit:update refuses to run over uncommitted changes
git status
git add -A && git commit -m "wip"        # or git stash

# 1. Merge the new toolkit (pick one)
pnpm -w toolkit:update                            # latest upstream/main
pnpm -w toolkit:update aem-to-sanity-core@1.10.0  # or pin a release tag

# 2. Commit the result (the merge + refreshed stamp)
git add -A && git commit -m "chore: update aem-to-sanity toolkit"

# 3. Sync tenant surface with the updated template
pnpm -w migrate:doctor --all --fix       # package.json scripts, env vars, drift report
pnpm -w studio:sync --all --fix          # new Studio template files + missing deps
pnpm install                             # link anything studio:sync added

# 4. Regenerate what the toolkit generates
cd tenants/<your-tenant>
pnpm migrate:schema                      # re-emit schemas + registry with the new emitter

# 5. Verify
pnpm -r typecheck
pnpm -F tenant-<your-tenant>-studio dev  # eyeball the Studio
```

Step 1 does the heavy lifting: it fetches `upstream` (un-shallowing the clone on first run), merges the ref into your branch, runs `pnpm install && pnpm build`, and refreshes the stamp. Migration-critical Studio code (the `category` type, the `aemSource` aspect, AEM widget inputs) ships in the `aem-to-sanity-studio` package, so it's already current after this step — steps 3's `studio:sync` only covers the thin copied file shell (config, re-exports, scripts), and it never overwrites files you've customized (those are reported as drift for you to diff by hand).

Steps 4–5 matter when the release changed the schema emitter or transform: re-emitting keeps your generated schemas, registry, and Studio in agreement. If you re-import content afterwards, remember `--discard-drafts` (see [`running-the-migration.md`](running-the-migration.md) § "Drafts").

## When the merge conflicts

Your local commits can conflict with upstream changes — most likely in files you've customized at the repo root. `toolkit:update` stops and leaves the merge in progress:

```bash
# resolve the conflicted files, then
git add -A && git merge --continue
pnpm install && pnpm build
```

Your `tenants/<slug>/` folder is gitignored, so tenant config, credentials, and pipeline output are never part of the merge.

## Seeing what changed

- [GitHub Releases](https://github.com/demo-repositories/aem-to-sanity/releases) — release notes per package, per version.
- `packages/*/CHANGELOG.md` — the same notes, in-repo, after updating.
- `git fetch upstream && git log HEAD..upstream/main --oneline` — before updating, preview exactly which commits you'd pull.
