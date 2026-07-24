---
"@shehjad/create-aem-to-sanity": minor
---

Thin standalone scaffolds by default. `npm create @shehjad/aem-to-sanity <dir>` now emits a small single-tenant project — your config, content lists, and Studio at the root — with the toolkit installed from npm (`aem-to-sanity-core/schema/content/studio/cli` as regular dependencies). Updating the toolkit becomes `npm install <pkg>@latest`; no git merges. The previous monorepo-clone behavior is available behind `--clone` (with `--tenant`, `--ref`, `--repo`, `--detach` now clone-mode-only flags).
