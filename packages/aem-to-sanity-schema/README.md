# aem-to-sanity-schema

Reads AEM Granite UI component dialog definitions and emits:

- Sanity object schemas (`defineType` / `defineField` TypeScript files — one per AEM component)
- Matching TypeScript types via official Sanity TypeGen (`sanity schema extract` + `sanity typegen generate`)
- A migration report (`migration-report.json`) with per-component outcome and unmapped fields
- An audit artifact pointing at concrete JSON examples of unmapped AEM resource types — makes extending the mapping table straightforward

Usage (programmatic):

```ts
import { migrateSchemas } from "aem-to-sanity-schema";
```

Usage (CLI):

```sh
aem-to-sanity-schema --paths ./aem-component-paths --out ./output
```

> Status: scaffold. See repo root for the refactor plan.
