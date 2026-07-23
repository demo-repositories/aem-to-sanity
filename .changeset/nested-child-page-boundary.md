---
"aem-to-sanity-content": patch
---

`aem-transform` no longer inlines nested child pages' content into the parent page's pageBuilder. A roots entry migrates only that page's own body: when a roots-file entry points at a section root (non-leaf page), each nested `cq:Page` subtree is now skipped instead of being flattened into the parent doc. Skipped pages are counted in the run summary and listed in full under `transform-report.json → skippedChildPages` — add each one as its own line in `aem-content-roots`, then re-run `extract` → `transform` → `import` to migrate it as its own document.

Operators who previously ran a non-leaf roots entry should re-run `transform` + `import` after upgrading: the parent doc sheds the duplicated child content, and the child pages import as separate docs once listed in the roots file.
