---
"aem-to-sanity-cli": minor
"aem-to-sanity-core": minor
"aem-to-sanity-schema": minor
"aem-to-sanity-content": minor
"aem-to-sanity-studio": minor
---

npm distribution. All toolkit packages are now published to npm on every release — client projects install them as regular dependencies and update with `npm install <pkg>@latest` instead of git merges. New `aem-to-sanity-cli` package carries the operator CLI (`aem-to-sanity doctor | studio-sync | run | wipe-media-library`, all workspace-mode aware: they work both in the monorepo and in standalone scaffolds) and embeds the project template that `create-aem-to-sanity` scaffolds from. The repo scripts `migrate-doctor`, `studio-sync`, `run-with-log`, and `wipe-media-library` moved into the package (root `pnpm -w migrate:doctor` / `studio:sync` are now thin wrappers over the `aem-to-sanity` bin).
