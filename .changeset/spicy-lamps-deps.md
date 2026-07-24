---
"aem-to-sanity-core": patch
"aem-to-sanity-schema": patch
"aem-to-sanity-content": patch
"aem-to-sanity-studio": patch
---

Dependency refresh across the toolkit: Sanity Studio to 6.6.0 (`@sanity/ui` 3.4.3, `@sanity/schema` 6.6.0, `@sanity/client` 7.24.0), `zod` 4.4.3, `dotenv` 17.4.2 (with its new startup log line silenced — CLI stdout stays clean), `@portabletext/block-tools` 5.1.12, `@portabletext/schema` 2.2.3, `jsdom` 29.1.1, `prettier` 3.9.6, React 19.2.8, `styled-components` 6.4.4, plus dev tooling (tsx 4.23, turbo 2.10, vitest 4). TypeScript stays pinned to 5.9 via a workspace override — TypeScript 7 (the native port) doesn't expose the compiler API that tsup's declaration bundler needs; remove the override once the toolchain supports it. No CLI or output behavior changes.
