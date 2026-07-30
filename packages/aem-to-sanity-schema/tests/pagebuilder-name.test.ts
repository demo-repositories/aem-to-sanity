import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emitSchemaFile } from "../src/emitter.ts";
import { writePageBuilderArtifacts } from "../src/pagebuilder.ts";
import { createSchemaPathPlanner } from "../src/layout.ts";

/**
 * The page-builder name is operator-configurable (MIGRATION_PAGE_BUILDER_NAME).
 * Every generated artifact that mentions the name must agree: the array type
 * file, the page document's field, and container drop-zone references.
 * Default stays `pageBuilder` for backward compatibility.
 */
describe("configurable page-builder name", () => {
  const dirs: string[] = [];
  after(async () => {
    for (const d of dirs) await rm(d, { recursive: true, force: true });
  });

  it("container-children fields reference the custom array type", async () => {
    const src = await emitSchemaFile({
      typeName: "expander",
      sourcePath: "/apps/site/components/expander",
      fields: [
        {
          name: "items",
          title: "Items",
          type: "container-children",
          pageBuilderTypeName: "sections",
        },
      ],
      groups: [],
    });
    assert.match(src, /type: "sections"/);
    assert.doesNotMatch(src, /"pageBuilder"/);
  });

  it("container-children fields default to pageBuilder", async () => {
    const src = await emitSchemaFile({
      typeName: "expander",
      sourcePath: "/apps/site/components/expander",
      fields: [{ name: "items", title: "Items", type: "container-children" }],
      groups: [],
    });
    assert.match(src, /type: "pageBuilder"/);
  });

  it("writes {name}.ts and a page.ts whose field uses the custom name", async () => {
    const schemasDir = await mkdtemp(join(tmpdir(), "pb-name-"));
    dirs.push(schemasDir);

    const result = await writePageBuilderArtifacts({
      schemasDir,
      componentMembers: [{ name: "promo", title: "Promo" }],
      pageBuilderTypeName: "sections",
    });

    assert.equal(result.pageBuilderFile, join(schemasDir, "sections.ts"));
    const pbSrc = await readFile(result.pageBuilderFile, "utf8");
    assert.match(pbSrc, /export const sections = defineType\(/);
    assert.match(pbSrc, /name: "sections"/);
    assert.match(pbSrc, /type: "promo"/);

    const pageSrc = await readFile(result.pageFile, "utf8");
    assert.match(pageSrc, /name: "sections", type: "sections"/);
    assert.doesNotMatch(pageSrc, /pageBuilder/);
  });

  it("kind layout: pageBuilder folders with objects, page with documents", async () => {
    const schemasDir = await mkdtemp(join(tmpdir(), "pb-layout-"));
    dirs.push(schemasDir);

    const result = await writePageBuilderArtifacts({
      schemasDir,
      componentMembers: [{ name: "promo", title: "Promo" }],
      planner: createSchemaPathPlanner({ layout: "kind" }),
    });

    assert.equal(
      result.pageBuilderFile,
      join(schemasDir, "objects", "pageBuilder.ts"),
    );
    assert.equal(result.pageFile, join(schemasDir, "documents", "page.ts"));
    assert.ok(result.pageWritten);
  });
});
