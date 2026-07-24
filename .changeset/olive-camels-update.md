---
"@shehjad/create-aem-to-sanity": minor
---

Version visibility and an update path for scaffolds. The CLI now prints its version as the first line of every run and supports `-v`/`--version`. Scaffolds keep the toolkit git history under an `upstream` remote by default (pass `--detach` for the old clean-slate behavior) and get an `aemToSanity` provenance stamp in the root package.json (scaffolder version, repo, ref, commit). Together with the toolkit's new `pnpm -w toolkit:update [ref]` script, existing scaffolds can merge newer toolkit releases in place instead of re-scaffolding.
