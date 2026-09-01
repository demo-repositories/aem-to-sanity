import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BYNDER_ASSET_TYPE_NAME, resolveAssetBackend } from "aem-to-sanity-core";
import { emitSchemaFile } from "../src/emitter.ts";
import type { SanityField } from "../src/mapper.ts";
import { writeTemplatePageArtifacts } from "../src/template-pages.ts";

/**
 * `MIGRATION_ASSET_BACKEND=bynder` — image/file fields emit as the
 * `bynder.asset` type registered by `sanity-plugin-bynder-input`, matching
 * the values `aem-assets` rewrites into clean docs. The registry keeps the
 * semantic image/file kind either way (transform behavior is unaffected).
 */

const tmpDirs: string[] = [];
after(() => {
  for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true });
});

const fields: SanityField[] = [
  { name: "title", title: "Title", type: "string" },
  { name: "fileReferenceAemPath", type: "string", readOnly: true },
  { name: "fileReference", type: "image" },
  { name: "attachment", type: "file" },
  {
    name: "slides",
    type: "array-of-object",
    itemFields: [{ name: "slideImage", type: "image" }],
  },
];

function emit(assetFieldType?: string): Promise<string> {
  return emitSchemaFile({
    typeName: "hero",
    sourcePath: "/apps/site/components/hero",
    fields,
    groups: [],
    assetFieldType,
  });
}

describe("resolveAssetBackend", () => {
  it("defaults to media-library", () => {
    assert.equal(resolveAssetBackend({} as NodeJS.ProcessEnv), "media-library");
    assert.equal(
      resolveAssetBackend({ MIGRATION_ASSET_BACKEND: "  " } as NodeJS.ProcessEnv),
      "media-library",
    );
  });

  it("accepts bynder and rejects anything else", () => {
    assert.equal(
      resolveAssetBackend({ MIGRATION_ASSET_BACKEND: "bynder" } as NodeJS.ProcessEnv),
      "bynder",
    );
    assert.throws(
      () => resolveAssetBackend({ MIGRATION_ASSET_BACKEND: "cloudinary" } as NodeJS.ProcessEnv),
      /MIGRATION_ASSET_BACKEND="cloudinary" is invalid/,
    );
  });
});

describe("emitter: bynder asset field type", () => {
  it("keeps native image/file types by default", async () => {
    const src = await emit();
    assert.match(src, /name: "fileReference",\s*type: "image"/);
    assert.match(src, /name: "attachment",\s*type: "file"/);
    // Media preview heuristic picks the first image field.
    assert.match(src, /prMedia: "fileReference"/);
  });

  it("substitutes bynder.asset for image and file fields, at any depth", async () => {
    const src = await emit(BYNDER_ASSET_TYPE_NAME);
    assert.match(src, /name: "fileReference",\s*type: "bynder\.asset"/);
    assert.match(src, /name: "attachment",\s*type: "bynder\.asset"/);
    assert.match(src, /name: "slideImage",\s*type: "bynder\.asset"/);
    assert.doesNotMatch(src, /type: "image"/);
    assert.doesNotMatch(src, /type: "file"/);
    // AemPath provenance stays a plain string; other scalars are untouched.
    assert.match(src, /name: "fileReferenceAemPath",\s*type: "string",\s*readOnly: true/);
    assert.match(src, /name: "title",\s*title: "Title",\s*type: "string"/);
  });

  it("skips the media-preview heuristic (bynder.asset isn't previewable media)", async () => {
    const src = await emit(BYNDER_ASSET_TYPE_NAME);
    assert.doesNotMatch(src, /prMedia/);
  });
});

describe("template pages: bynder featuredImage", () => {
  const RT = "site/components/structure/page";
  const TEMPLATE = "/conf/site/settings/wcm/templates/landing";

  async function render(assetFieldType?: string): Promise<string> {
    const dir = mkdtempSync(join(tmpdir(), "asset-backend-"));
    tmpDirs.push(dir);
    await writeTemplatePageArtifacts({
      schemasDir: dir,
      pageComponentsConfig: new Map([[RT, { templates: [TEMPLATE] }]]),
      typeNameByResourceType: new Map([[RT, "pageShell"]]),
      assetFieldType,
    });
    return readFileSync(join(dir, "landingPage.ts"), "utf8");
  }

  it("emits featuredImage as image by default", async () => {
    assert.match(await render(), /name: "featuredImage", type: "image"/);
  });

  it("emits featuredImage as bynder.asset for the bynder backend", async () => {
    assert.match(
      await render(BYNDER_ASSET_TYPE_NAME),
      /name: "featuredImage", type: "bynder\.asset"/,
    );
  });
});
