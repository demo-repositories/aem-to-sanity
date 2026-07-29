---
"aem-to-sanity-schema": patch
"aem-to-sanity-content": patch
---

Document how frontends query `contentFragmentRef` blocks: the generated mapping doc (and the operator guide) now include the GROQ dereference pattern (`fragment->{ _id, title, content }`), a note that refs appear at any page-builder depth (including container `items`), and two strategies for nested fragments — a depth-N inline join helper or lazy per-fragment fetching. No behavior change; docs only.
