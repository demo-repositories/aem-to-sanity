---
"aem-to-sanity-content": patch
---

`aem-import` no longer aborts the whole run when one page's transaction fails (e.g. a document rejected by the API). Each page is already its own atomic transaction, so the importer now records the failure, keeps committing the remaining pages, prints a per-page `FAILED:` line plus an end-of-run summary of failed pages, and exits non-zero. Previously one bad document silently blocked every page after it.
