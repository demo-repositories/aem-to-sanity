---
"aem-to-sanity-content": minor
---

Tabs and accordion panels survive migration. AEM's tab/accordion components drop the same container resource type into their panels that responsive grids use for pure layout — distinguished only by the `cq:panelTitle` stamped on the panel node. A `flatten: true` container carrying `cq:panelTitle` now keeps its block instead of dissolving into the parent (which merged all panels' contents into one flat list and dropped every panel title); title-less layout containers flatten exactly as before, including inside a kept panel, and nested tabs roundtrip recursively.

To adopt: register the tabs/accordion component as a plain (non-flatten) container in `aem-component-containers.json` and opt the panel container's resource type into the `cq:panelTitle` authoring hint in `aem-component-hints.json`, then re-run `migrate:schema` + `transform` + `import --discard-drafts`. Note: pages with deeply nested tabs-in-tabs and rich text at the bottom can exceed Sanity's 20-level attribute-depth limit and fail at import — the transform report and import error will name the offending pages.
