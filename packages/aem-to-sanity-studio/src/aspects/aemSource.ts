import { defineAssetAspect, defineField } from "sanity";

// Stamped on every Media Library asset uploaded by `aem-assets`. `damPath` is
// the origin JCR path for cross-run dedup; `assetInstanceId` caches the
// current version ref so the dedup query returns both ids the link step needs
// without a second round-trip to resolve the parent's current version field.
export default defineAssetAspect({
  name: "aemSource",
  title: "AEM source",
  type: "object",
  public: true,
  fields: [
    defineField({ name: "damPath", title: "DAM path", type: "string" }),
    defineField({ name: "assetInstanceId", title: "Asset instance id", type: "string" }),
  ],
});
