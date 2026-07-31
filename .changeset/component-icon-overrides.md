---
"aem-to-sanity-core": minor
"aem-to-sanity-schema": minor
"aem-to-sanity-content": minor
"aem-to-sanity-studio": minor
"aem-to-sanity-cli": minor
---

Per-component Studio icons via `aem-component-names.json`. Entries can now carry an `icon` — a `@sanity/icons` icon component name (e.g. `"icon": "ControlsIcon"`). The generated schema imports it from the icon's subpath module (`import { ControlsIcon } from "@sanity/icons/Controls"` — the v5 layout; the root module no longer has per-icon exports) and declares `defineType({ icon })`, so the component shows that icon in the page-builder insert menu, array item previews, and structure lists. Icons are safe to add, change, or drop between runs — they never touch type names or ingested content. Malformed values (anything that isn't a PascalCase identifier ending in `Icon`) fail at config load.

Operators: the consuming Studio needs `@sanity/icons` in its dependencies. Newly scaffolded studios include it; existing tenant studios pick it up with `pnpm -w studio:sync <slug> --fix` (or add `"@sanity/icons": "^5.2.1"` by hand).
