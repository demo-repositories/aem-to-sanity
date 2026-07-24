---
"aem-to-sanity-cli": patch
"@shehjad/create-aem-to-sanity": patch
---

Standalone scaffolds get their `.gitignore` back. npm strips `.gitignore` files from published tarballs, so the template's ignore file never reached scaffolded projects — the scaffolder's initial commit captured `node_modules/` and the seeded `.env`, and any later commit would have put real AEM/Sanity credentials into git history. The template now ships the file as `dot-gitignore` (which npm keeps) and the scaffolder renames it on copy; as a safety net the scaffolder also writes a default `.gitignore` before `git init` if none exists. **If you scaffolded with `create-aem-to-sanity` 0.3.0:** check `git ls-files` for `.env` — if present, add the `.gitignore` (`node_modules/`, `dist/`, `output/`, `.env`, `.turbo/`, `.DS_Store`), run `git rm -r --cached .` then `git add -A`, and rewrite/avoid pushing any history that contains credentials.
