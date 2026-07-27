# @shehjad/create-aem-to-sanity

## 0.3.2

### Patch Changes

- Updated dependencies []:
  - aem-to-sanity-cli@2.0.0

## 0.3.1

### Patch Changes

- [#71](https://github.com/demo-repositories/aem-to-sanity/pull/71) [`913e4b3`](https://github.com/demo-repositories/aem-to-sanity/commit/913e4b381d029b09eb32f12abf40c0217167ed13) Thanks [@shehjad-noqtaai](https://github.com/shehjad-noqtaai)! - Standalone scaffolds get their `.gitignore` back. npm strips `.gitignore` files from published tarballs, so the template's ignore file never reached scaffolded projects — the scaffolder's initial commit captured `node_modules/` and the seeded `.env`, and any later commit would have put real AEM/Sanity credentials into git history. The template now ships the file as `dot-gitignore` (which npm keeps) and the scaffolder renames it on copy; as a safety net the scaffolder also writes a default `.gitignore` before `git init` if none exists. **If you scaffolded with `create-aem-to-sanity` 0.3.0:** check `git ls-files` for `.env` — if present, add the `.gitignore` (`node_modules/`, `dist/`, `output/`, `.env`, `.turbo/`, `.DS_Store`), run `git rm -r --cached .` then `git add -A`, and rewrite/avoid pushing any history that contains credentials.

- Updated dependencies [[`913e4b3`](https://github.com/demo-repositories/aem-to-sanity/commit/913e4b381d029b09eb32f12abf40c0217167ed13)]:
  - aem-to-sanity-cli@1.11.1

## 0.3.0

### Minor Changes

- [#67](https://github.com/demo-repositories/aem-to-sanity/pull/67) [`e559707`](https://github.com/demo-repositories/aem-to-sanity/commit/e559707d2e60d4c39e436525c14113dfc0037847) Thanks [@shehjad-noqtaai](https://github.com/shehjad-noqtaai)! - Thin standalone scaffolds by default. `npm create @shehjad/aem-to-sanity <dir>` now emits a small single-tenant project — your config, content lists, and Studio at the root — with the toolkit installed from npm (`aem-to-sanity-core/schema/content/studio/cli` as regular dependencies). Updating the toolkit becomes `npm install <pkg>@latest`; no git merges. The previous monorepo-clone behavior is available behind `--clone` (with `--tenant`, `--ref`, `--repo`, `--detach` now clone-mode-only flags).

### Patch Changes

- [#69](https://github.com/demo-repositories/aem-to-sanity/pull/69) [`e9f078f`](https://github.com/demo-repositories/aem-to-sanity/commit/e9f078f183c8b1f76e8e34c7226b559b7a42e51e) Thanks [@shehjad-noqtaai](https://github.com/shehjad-noqtaai)! - Standalone-scaffold fixes found by the post-release client smoke test. The embedded project template no longer ships Studio build output (`studio/dist/`, `studio/.sanity/` are skipped at embed and scaffold-copy time). The seeded `.env` now has `SCHEMAS_OUT_DIR=./studio/schemas/generated` active, so `migrate:schema` feeds the scaffold's own Studio out of the box instead of emitting to `output/schemas/` that the Studio never loads. The template Studio declares `@types/node`, so `tsc --noEmit` passes in a standalone scaffold (it previously resolved only via monorepo hoisting).

- Updated dependencies [[`e559707`](https://github.com/demo-repositories/aem-to-sanity/commit/e559707d2e60d4c39e436525c14113dfc0037847), [`e9f078f`](https://github.com/demo-repositories/aem-to-sanity/commit/e9f078f183c8b1f76e8e34c7226b559b7a42e51e)]:
  - aem-to-sanity-cli@1.11.0

## 0.2.0

### Minor Changes

- [#58](https://github.com/demo-repositories/aem-to-sanity/pull/58) [`5119220`](https://github.com/demo-repositories/aem-to-sanity/commit/5119220526c7bf5f9726ee8c9b9b473ad5d1848b) Thanks [@shehjad-noqtaai](https://github.com/shehjad-noqtaai)! - Version visibility and an update path for scaffolds. The CLI now prints its version as the first line of every run and supports `-v`/`--version`. Scaffolds keep the toolkit git history under an `upstream` remote by default (pass `--detach` for the old clean-slate behavior) and get an `aemToSanity` provenance stamp in the root package.json (scaffolder version, repo, ref, commit). Together with the toolkit's new `pnpm -w toolkit:update [ref]` script, existing scaffolds can merge newer toolkit releases in place instead of re-scaffolding.

## 0.1.0

### Minor Changes

- Initial release of the project scaffolder. `npm create @shehjad/aem-to-sanity <dir>` clones the toolkit (pin a release with `--ref`), detaches it from upstream git history, installs dependencies, and with `--tenant <slug>` scaffolds the first tenant folder via `migrate:init` in the same run.
