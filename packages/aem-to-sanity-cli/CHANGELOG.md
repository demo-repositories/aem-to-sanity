# aem-to-sanity-cli

## 1.11.1

### Patch Changes

- [#71](https://github.com/demo-repositories/aem-to-sanity/pull/71) [`913e4b3`](https://github.com/demo-repositories/aem-to-sanity/commit/913e4b381d029b09eb32f12abf40c0217167ed13) Thanks [@shehjad-noqtaai](https://github.com/shehjad-noqtaai)! - Standalone scaffolds get their `.gitignore` back. npm strips `.gitignore` files from published tarballs, so the template's ignore file never reached scaffolded projects — the scaffolder's initial commit captured `node_modules/` and the seeded `.env`, and any later commit would have put real AEM/Sanity credentials into git history. The template now ships the file as `dot-gitignore` (which npm keeps) and the scaffolder renames it on copy; as a safety net the scaffolder also writes a default `.gitignore` before `git init` if none exists. **If you scaffolded with `create-aem-to-sanity` 0.3.0:** check `git ls-files` for `.env` — if present, add the `.gitignore` (`node_modules/`, `dist/`, `output/`, `.env`, `.turbo/`, `.DS_Store`), run `git rm -r --cached .` then `git add -A`, and rewrite/avoid pushing any history that contains credentials.

## 1.11.0

### Minor Changes

- [#67](https://github.com/demo-repositories/aem-to-sanity/pull/67) [`e559707`](https://github.com/demo-repositories/aem-to-sanity/commit/e559707d2e60d4c39e436525c14113dfc0037847) Thanks [@shehjad-noqtaai](https://github.com/shehjad-noqtaai)! - npm distribution. All toolkit packages are now published to npm on every release — client projects install them as regular dependencies and update with `npm install <pkg>@latest` instead of git merges. New `aem-to-sanity-cli` package carries the operator CLI (`aem-to-sanity doctor | studio-sync | run | wipe-media-library`, all workspace-mode aware: they work both in the monorepo and in standalone scaffolds) and embeds the project template that `create-aem-to-sanity` scaffolds from. The repo scripts `migrate-doctor`, `studio-sync`, `run-with-log`, and `wipe-media-library` moved into the package (root `pnpm -w migrate:doctor` / `studio:sync` are now thin wrappers over the `aem-to-sanity` bin).

### Patch Changes

- [#69](https://github.com/demo-repositories/aem-to-sanity/pull/69) [`e9f078f`](https://github.com/demo-repositories/aem-to-sanity/commit/e9f078f183c8b1f76e8e34c7226b559b7a42e51e) Thanks [@shehjad-noqtaai](https://github.com/shehjad-noqtaai)! - Standalone-scaffold fixes found by the post-release client smoke test. The embedded project template no longer ships Studio build output (`studio/dist/`, `studio/.sanity/` are skipped at embed and scaffold-copy time). The seeded `.env` now has `SCHEMAS_OUT_DIR=./studio/schemas/generated` active, so `migrate:schema` feeds the scaffold's own Studio out of the box instead of emitting to `output/schemas/` that the Studio never loads. The template Studio declares `@types/node`, so `tsc --noEmit` passes in a standalone scaffold (it previously resolved only via monorepo hoisting).
