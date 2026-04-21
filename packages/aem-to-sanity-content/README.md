# aem-to-sanity-content

Second phase of the AEM → Sanity migration: fetches AEM content via `.infinity.json`, walks the JCR tree (handling depth-5 truncation transparently), transforms nodes into Sanity documents, and writes them via `@sanity/client`.

Produces two things:

1. Sanity documents created (or, in `dryRun` mode, NDJSON printed to stdout).
2. A drift audit (`output/audit/content-audit.json`) listing AEM fields found in real content that the generated schema doesn't cover — actionable input for extending the mapping table.

Usage (programmatic):

```ts
import { migrateContent } from "aem-to-sanity-content";
```

Usage (CLI):

```sh
aem-to-sanity-content --root /content/site/us/en --out ./output
```

> Status: scaffold. Safe default: `dryRun: true` — opt in to writes with `--confirm-write`.
