import { createHash } from "node:crypto";

/**
 * Convert an AEM JCR path into a deterministic Sanity `_id`.
 *
 * Requirements we're optimizing for:
 *   - Stable across re-runs so `createOrReplace` updates the same doc.
 *   - Valid Sanity `_id` charset: `[A-Za-z0-9_.-]+`, no leading `_`/`.`.
 *   - Reasonably short for log/debug use.
 *
 * Strategy: slugify the path (replace `/` with `.`, drop leading `.`, replace
 * anything outside the Sanity charset with `-`). If the result exceeds 80
 * characters or gets mangled by substitutions, append a short SHA1 suffix so
 * two different paths that collapse to the same slug don't collide.
 */
export function pathToDocId(jcrPath: string): string {
  const normalized = jcrPath.replace(/^\/+/, "");
  const rawSlug = normalized.replace(/\//g, ".");
  const safeSlug = rawSlug.replace(/[^A-Za-z0-9_.-]/g, "-");

  const needsHash = safeSlug !== rawSlug || safeSlug.length > 80;
  if (!needsHash) return safeSlug;

  const hash = createHash("sha1").update(jcrPath).digest("hex").slice(0, 10);
  const truncated = safeSlug.slice(0, 60).replace(/[.-]+$/, "");
  return `${truncated}.${hash}`;
}
