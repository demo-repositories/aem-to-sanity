---
"aem-to-sanity-core": minor
"aem-to-sanity-content": minor
---

New container config option `document: true` (mutually exclusive with `flatten`): every instance of the component is extracted into its own `contentFragment` document with a `contentFragmentRef` block left in the parent array — by design, not depth pressure. Intended for recursive structural components (tabs, accordions): Sanity's attribute-depth limit is counted per document, so each extracted level resets the budget by construction; editors always see one click-through reference shape; frontends need exactly one join per configured type. Fragment ids derive from the page id + the block's stable `_key` (idempotent re-runs), titles come from the component's dialog with a nearest-panel-title fallback ("Get started — accordion"), and every extraction is listed in `transform-report.json → configExtractedFragments`. Note: a re-run that stops producing a fragment leaves the old document orphaned — reconcile against the report. The depth-triggered extraction remains as a safety net for unconfigured shapes.
