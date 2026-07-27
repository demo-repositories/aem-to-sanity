import { createHash } from "node:crypto";
import {
  htmlToBlocks,
  type DeserializerRule,
  type TypedObject,
} from "@portabletext/block-tools";
import { compileSchema, defineSchema, type Schema } from "@portabletext/schema";
import { JSDOM } from "jsdom";

/**
 * AEM richtext HTML → Portable Text conversion. Extracted from `transform.ts`
 * (which runs `main()` at module top level and can't be imported) so the
 * conversion — in particular the `<table>` deserializer — is unit-testable.
 */

/**
 * Default Portable Text schema used to compile AEM richtext HTML into Sanity
 * blocks. Matches the shape our emitter produces for `array-of-blocks` fields
 * (`{ type: "array", of: [{ type: "block" }, { type: "table" }] }`): Sanity's
 * default decorators + styles + lists, a `link` annotation, and the canonical
 * `table` block object (Sanity ≥ 6.6 native Portable Text tables). Kept
 * module-level so every call reuses the same compiled schema — the compile
 * pass is not free.
 */
const PORTABLE_TEXT_SCHEMA: Schema = compileSchema(
  defineSchema({
    decorators: [
      { name: "strong" },
      { name: "em" },
      { name: "underline" },
      { name: "strike-through" },
      { name: "code" },
    ],
    styles: [
      { name: "normal" },
      { name: "h1" },
      { name: "h2" },
      { name: "h3" },
      { name: "h4" },
      { name: "blockquote" },
    ],
    lists: [{ name: "bullet" }, { name: "number" }],
    annotations: [
      { name: "link", fields: [{ name: "href", type: "string" }] },
    ],
    // Without this declaration block-tools normalization strips the
    // `_type: "table"` blocks the table rule produces.
    blockObjects: [
      {
        name: "table",
        fields: [
          { name: "headerRows", type: "number" },
          { name: "rows", type: "array" },
        ],
      },
    ],
  }),
);

const parseHtml = (html: string): Document =>
  new JSDOM(html, { contentType: "text/html" }).window.document;

/**
 * Deterministic `_key` generator for a single htmlToBlocks call. Seeds a
 * SHA1 stream with `{seed}:{counter}` so re-running the transform on
 * byte-identical input produces byte-identical Portable Text — preserving
 * the "re-runs produce clean git diffs" invariant that makes this pipeline
 * usable in CI.
 */
function deterministicKeyGen(seed: string): () => string {
  let counter = 0;
  return () =>
    createHash("sha1")
      .update(`${seed}:${counter++}`)
      .digest("hex")
      .slice(0, 12);
}

/**
 * Deserializer rule mapping `<table>` elements to Sanity's canonical
 * Portable Text table block (Studio ≥ 6.6):
 *
 *   { _type: "table", headerRows, rows: [{ _type: "row", _key,
 *     cells: [{ _type: "cell", _key, value: [ ...blocks ] }] }] }
 *
 * Behavior notes:
 * - `headerRows` = `<thead>` row count when present, else the number of
 *   leading rows whose cells are all `<th>`, else 0.
 * - Cell content is converted with a fresh `htmlToBlocks` pass on the cell's
 *   innerHTML (sharing this call's key generator) so `cell.value` is always a
 *   normalized block array — marks, links, and lists inside cells survive.
 * - colspan/rowspan are dropped (content is kept at its DOM position); short
 *   rows are padded with empty cells so the Studio plugin's rectangular grid
 *   model holds.
 * - `<caption>` content is preserved as regular text block(s) emitted
 *   immediately before the table block — the canonical table shape has no
 *   caption field, and dropping authored captions would violate the
 *   keep-original contract (AEM's RTE table plugin authors them).
 * - Nested tables are not converted: the cell pass carries no table rule, so
 *   inner tables flatten to plain blocks inside the parent cell (no data
 *   loss).
 * - Keep-original-on-failure: on any throw, or for degenerate tables (no
 *   cells at all), returns `undefined` so block-tools' default traversal
 *   flattens the table's text into normal blocks instead of dropping it.
 */
function createTableRule(keyGenerator: () => string): DeserializerRule {
  return {
    deserialize(node, _next, createBlock) {
      const tag = (node as Element).tagName?.toLowerCase();
      if (tag !== "table") return undefined;
      try {
        const el = node as HTMLTableElement;
        // Caption first (matches DOM order — `<caption>` is the table's
        // first child). Keys are drawn before the rows' so re-runs stay
        // byte-identical; caption-less tables draw nothing extra.
        const captionEl = el.caption;
        const captionBlocks =
          captionEl && captionEl.textContent?.trim()
            ? htmlToBlocks(captionEl.innerHTML, PORTABLE_TEXT_SCHEMA, {
                parseHtml,
                keyGenerator,
              })
            : [];
        // `.rows` walks thead → tbodies → tfoot in section order and skips
        // rows belonging to nested tables.
        const domRows = Array.from(el.rows);
        const headerRows = countHeaderRows(el, domRows);

        const rows = domRows
          .map((tr) => ({
            _type: "row",
            _key: keyGenerator(),
            cells: Array.from(tr.cells).map((cellEl) => ({
              _type: "cell",
              _key: keyGenerator(),
              value: htmlToBlocks(cellEl.innerHTML, PORTABLE_TEXT_SCHEMA, {
                parseHtml,
                keyGenerator,
              }),
            })),
          }))
          .filter((row) => row.cells.length > 0);
        if (rows.length === 0) return undefined;

        const width = Math.max(...rows.map((row) => row.cells.length));
        for (const row of rows) {
          while (row.cells.length < width) {
            row.cells.push({ _type: "cell", _key: keyGenerator(), value: [] });
          }
        }

        const tableBlock = createBlock({ _type: "table", headerRows, rows });
        return captionBlocks.length > 0
          ? ([...captionBlocks, tableBlock] as TypedObject[])
          : tableBlock;
      } catch {
        return undefined;
      }
    },
  };
}

function countHeaderRows(
  el: HTMLTableElement,
  domRows: HTMLTableRowElement[],
): number {
  if (el.tHead) return el.tHead.rows.length;
  let count = 0;
  for (const tr of domRows) {
    const cells = Array.from(tr.cells);
    if (cells.length === 0) break;
    if (!cells.every((c) => c.tagName.toLowerCase() === "th")) break;
    count++;
  }
  return count;
}

/**
 * Convert an AEM richtext HTML string into Portable Text blocks. Returns
 * `null` on parser failure so the caller can keep the original string and
 * surface the failure via the audit — never drops content silently.
 */
export function htmlStringToPortableText(
  html: string,
  seed: string,
): unknown[] | null {
  try {
    const keyGenerator = deterministicKeyGen(seed);
    return htmlToBlocks(html, PORTABLE_TEXT_SCHEMA, {
      parseHtml,
      keyGenerator,
      rules: [createTableRule(keyGenerator)],
    }) as unknown[];
  } catch {
    return null;
  }
}
