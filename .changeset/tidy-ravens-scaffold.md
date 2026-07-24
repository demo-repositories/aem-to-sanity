---
"aem-to-sanity-cli": patch
"@shehjad/create-aem-to-sanity": patch
---

Standalone-scaffold fixes found by the post-release client smoke test. The embedded project template no longer ships Studio build output (`studio/dist/`, `studio/.sanity/` are skipped at embed and scaffold-copy time). The seeded `.env` now has `SCHEMAS_OUT_DIR=./studio/schemas/generated` active, so `migrate:schema` feeds the scaffold's own Studio out of the box instead of emitting to `output/schemas/` that the Studio never loads. The template Studio declares `@types/node`, so `tsc --noEmit` passes in a standalone scaffold (it previously resolved only via monorepo hoisting).
