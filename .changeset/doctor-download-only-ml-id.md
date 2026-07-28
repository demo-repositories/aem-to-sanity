---
"aem-to-sanity-cli": patch
---

`aem-to-sanity doctor` no longer errors on a missing or placeholder `SANITY_MEDIA_LIBRARY_ID` when `MIGRATION_ASSETS_DOWNLOAD_ONLY=true`. Download-only asset runs stop after the AEM download phase and never read the Media Library id, so the doctor now reports an info line explaining the exemption instead of a hard error. No action needed: tenants that upload to the Media Library are checked exactly as before.
