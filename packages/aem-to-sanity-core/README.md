# aem-to-sanity-core

Shared primitives for the AEM → Sanity migration toolkit:

- AEM client (authenticated fetch for `.model.json` / `.infinity.json`)
- `.infinity.json` depth-truncation walker (transparent follow-up fetching)
- Config schema + resolver (no dotenv side-effects — pass your own env)
- Logger
- Filesystem helpers (swappable output writers)

Depended on by `aem-to-sanity-schema` and `aem-to-sanity-content`.

> Status: scaffold. See repo root for the refactor plan.
