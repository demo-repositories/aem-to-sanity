---
"aem-to-sanity-core": minor
"aem-to-sanity-schema": minor
"aem-to-sanity-content": minor
"aem-to-sanity-studio": minor
"aem-to-sanity-cli": minor
---

New `aem-eject-dialogs` CLI (tenant script `pnpm eject-dialogs <paths…|--all> [--force] [--out-dir <dir>]`): materializes each component's **effective** dialog into a static, hand-editable file.

For every requested component it runs the exact resolution `migrate:schema` uses — embedded `cq:dialog`, the `sling:resourceSuperType` walk, and `aem-dialog-overrides.json` `supplementaryTabs` splicing — bakes resolvable datasource options in as literal `items` (ACS generic lists fetched from JCR, core policy datasources → their `h1`–`h6` defaults; unresolvable datasources keep their `datasource` node so the report still flags them), writes the result to `./dialog-overrides/<resourceType>.json`, and rewrites the component's `aem-dialog-overrides.json` entry to `{ "dialogFile": … }` (a baked `supplementaryTabs` entry is dropped to prevent double-splicing; unrelated entries pass through untouched).

The ejected file becomes the component's dialog source of truth: hand-add fields, prune tabs, pin select options, then re-run `migrate:schema` — no more thinking about resolution order, merger inheritance, or datasource servlets. Trade-off: ejected dialogs are frozen snapshots — AEM-side dialog changes stop flowing until re-ejected with `--force`, which overwrites the file and discards hand edits. Without `--force`, existing files are never touched.

Operators: opt-in only; nothing changes unless you run it. The tenant template gains the `eject-dialogs` script (`migrate:doctor --fix` propagates it to existing tenants).
