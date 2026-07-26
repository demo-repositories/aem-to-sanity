import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { htmlStringToPortableText } from "../src/portable-text.ts";

/**
 * `<table>` elements inside AEM richtext HTML convert to Sanity's canonical
 * Portable Text table block (Studio ≥ 6.6): `table → rows[] → cells[] →
 * value (block array)`. Everything else about the conversion — decorators,
 * links, lists, deterministic `_key`s — must keep working around and inside
 * tables.
 */

interface Cell {
  _type: string;
  _key: string;
  value: Block[];
}
interface Row {
  _type: string;
  _key: string;
  cells: Cell[];
}
interface Block {
  _type: string;
  _key: string;
  headerRows?: number;
  rows?: Row[];
  children?: Array<{ _type: string; _key: string; text?: string; marks?: string[] }>;
  markDefs?: Array<{ _type: string; _key: string; href?: string }>;
}

function convert(html: string, seed = "test-seed"): Block[] {
  const blocks = htmlStringToPortableText(html, seed);
  assert.ok(blocks, "conversion must not fail");
  return blocks as Block[];
}

function blockText(block: Block): string {
  return (block.children ?? []).map((c) => c.text ?? "").join("");
}

function cellText(cell: Cell): string {
  return cell.value.map(blockText).join("\n");
}

describe("richtext tables: canonical shape", () => {
  it("converts a thead table to a table block with headerRows 1", () => {
    const blocks = convert(
      "<table><thead><tr><th>Name</th><th>Age</th></tr></thead>" +
        "<tbody><tr><td>Ada</td><td>36</td></tr></tbody></table>",
    );
    assert.equal(blocks.length, 1);
    const table = blocks[0]!;
    assert.equal(table._type, "table");
    assert.equal(table.headerRows, 1);
    assert.ok(table._key, "table block carries a _key");
    assert.equal(table.rows?.length, 2);
    for (const row of table.rows!) {
      assert.equal(row._type, "row");
      assert.ok(row._key);
      assert.equal(row.cells.length, 2);
      for (const cell of row.cells) {
        assert.equal(cell._type, "cell");
        assert.ok(cell._key);
      }
    }
    assert.equal(cellText(table.rows![0]!.cells[0]!), "Name");
    assert.equal(cellText(table.rows![1]!.cells[1]!), "36");
  });

  it("counts leading all-<th> rows as headerRows when there is no thead", () => {
    const blocks = convert(
      "<table>" +
        "<tr><th>A</th><th>B</th></tr>" +
        "<tr><th>C</th><th>D</th></tr>" +
        "<tr><td>1</td><td>2</td></tr>" +
        "</table>",
    );
    assert.equal(blocks[0]!.headerRows, 2);
    assert.equal(blocks[0]!.rows?.length, 3);
  });

  it("emits headerRows 0 for a plain td-only table", () => {
    const blocks = convert("<table><tr><td>only</td></tr></table>");
    assert.equal(blocks[0]!._type, "table");
    assert.equal(blocks[0]!.headerRows, 0);
  });

  it("preserves surrounding blocks and document order", () => {
    const blocks = convert(
      "<p>before</p><table><tr><td>mid</td></tr></table><p>after</p>",
    );
    assert.deepEqual(
      blocks.map((b) => b._type),
      ["block", "table", "block"],
    );
    assert.equal(blockText(blocks[0]!), "before");
    assert.equal(blockText(blocks[2]!), "after");
  });
});

describe("richtext tables: cell content", () => {
  it("keeps decorators and link annotations inside cells", () => {
    const blocks = convert(
      '<table><tr><td><strong>bold</strong></td>' +
        '<td><a href="https://example.com">link</a></td></tr></table>',
    );
    const cells = blocks[0]!.rows![0]!.cells;
    const boldSpan = cells[0]!.value[0]!.children![0]!;
    assert.deepEqual(boldSpan.marks, ["strong"]);

    const linkBlock = cells[1]!.value[0]!;
    assert.equal(linkBlock.markDefs?.length, 1);
    assert.equal(linkBlock.markDefs![0]!._type, "link");
    assert.equal(linkBlock.markDefs![0]!.href, "https://example.com");
    assert.deepEqual(linkBlock.children![0]!.marks, [
      linkBlock.markDefs![0]!._key,
    ]);
  });

  it("pads ragged rows (colspan) with empty cells so the grid stays rectangular", () => {
    const blocks = convert(
      "<table><tr><td>a</td><td>b</td></tr>" +
        '<tr><td colspan="2">wide</td></tr></table>',
    );
    const rows = blocks[0]!.rows!;
    assert.equal(rows[0]!.cells.length, 2);
    assert.equal(rows[1]!.cells.length, 2);
    assert.equal(cellText(rows[1]!.cells[0]!), "wide");
    assert.deepEqual(rows[1]!.cells[1]!.value, []);
  });

  it("flattens nested tables to plain blocks inside the parent cell", () => {
    const blocks = convert(
      "<table><tr><td>outer <table><tr><td>inner</td></tr></table></td></tr></table>",
    );
    assert.equal(blocks.length, 1);
    const outer = blocks[0]!;
    assert.equal(outer.rows?.length, 1, "nested rows don't leak into the outer table");
    const cell = outer.rows![0]!.cells[0]!;
    const text = cellText(cell);
    assert.match(text, /outer/);
    assert.match(text, /inner/);
    assert.ok(
      cell.value.every((b) => b._type !== "table"),
      "no table blocks inside cells",
    );
  });
});

describe("richtext tables: resilience", () => {
  it("skips degenerate tables without dropping surrounding text", () => {
    const blocks = convert("<p>x</p><table></table><p>y</p>");
    assert.deepEqual(
      blocks.map((b) => b._type),
      ["block", "block"],
    );
  });

  it("is deterministic for identical input and seed", () => {
    const html =
      "<p>t</p><table><thead><tr><th>h</th></tr></thead><tbody><tr><td><em>v</em></td></tr></tbody></table>";
    const a = convert(html, "seed-a");
    const b = convert(html, "seed-a");
    assert.deepEqual(a, b);
  });

  it("derives different keys from different seeds", () => {
    const html = "<table><tr><td>v</td></tr></table>";
    const a = convert(html, "seed-a");
    const b = convert(html, "seed-b");
    assert.notEqual(a[0]!._key, b[0]!._key);
    assert.notEqual(
      a[0]!.rows![0]!._key,
      b[0]!.rows![0]!._key,
    );
  });
});
