---
"aem-to-sanity-core": minor
"aem-to-sanity-schema": minor
"aem-to-sanity-content": minor
"aem-to-sanity-studio": minor
---

Dependency majors: `zod` 4.4.3 in core (config error output unchanged; `z.string().url()` → `z.url()`) and `dotenv` 17.4.2 in the schema/content CLIs — v17's startup log line is silenced via a `load-env` module with `quiet: true`, so CLI stdout stays script-consumable. TypeScript is pinned to 5.9 with a workspace `pnpm.overrides` entry: TypeScript 7 (the native port) doesn't expose the compiler API tsup's declaration bundler needs, and without the pin sanity's optional `typescript` peer resolves to 7.x inside tenant workspaces. Remove the override when the toolchain supports TS 7.
