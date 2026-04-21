/**
 * Shape of an AEM JCR content node returned by `.infinity.json`.
 *
 * Child nodes appear as nested objects; primitive JCR properties are scalars
 * (optionally prefixed with their Sling type, e.g. `jcr:primaryType`). At a
 * depth boundary AEM substitutes the deeper subtree with a string path marker
 * — Step 6 adds handling for that. For now we treat whatever the fetcher
 * returns as-is.
 */
export interface AemContentNode {
  "jcr:primaryType"?: string;
  "sling:resourceType"?: string;
  "jcr:uuid"?: string;
  [key: string]: unknown;
}

/**
 * One document produced by the extractor. `type` is the Sanity schema type
 * (derived from `sling:resourceType`), `jcrPath` is the absolute AEM path the
 * node came from, and `raw` is the untransformed node so downstream audit
 * steps can diff the mapped output against the original.
 */
export interface ExtractedDoc {
  type: string;
  jcrPath: string;
  raw: AemContentNode;
  doc: SanityDoc;
}

/**
 * Minimal Sanity document shape used at migration time. The exact field set
 * depends on the mapped schema; the only guaranteed properties are `_id`,
 * `_type`, and `_rev` (added by Sanity on write).
 */
export interface SanityDoc {
  _id: string;
  _type: string;
  [key: string]: unknown;
}
