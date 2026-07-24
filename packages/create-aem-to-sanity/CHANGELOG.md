# @shehjad/create-aem-to-sanity

## 0.2.0

### Minor Changes

- [#58](https://github.com/demo-repositories/aem-to-sanity/pull/58) [`5119220`](https://github.com/demo-repositories/aem-to-sanity/commit/5119220526c7bf5f9726ee8c9b9b473ad5d1848b) Thanks [@shehjad-noqtaai](https://github.com/shehjad-noqtaai)! - Version visibility and an update path for scaffolds. The CLI now prints its version as the first line of every run and supports `-v`/`--version`. Scaffolds keep the toolkit git history under an `upstream` remote by default (pass `--detach` for the old clean-slate behavior) and get an `aemToSanity` provenance stamp in the root package.json (scaffolder version, repo, ref, commit). Together with the toolkit's new `pnpm -w toolkit:update [ref]` script, existing scaffolds can merge newer toolkit releases in place instead of re-scaffolding.

## 0.1.0

### Minor Changes

- Initial release of the project scaffolder. `npm create @shehjad/aem-to-sanity <dir>` clones the toolkit (pin a release with `--ref`), detaches it from upstream git history, installs dependencies, and with `--tenant <slug>` scaffolds the first tenant folder via `migrate:init` in the same run.
