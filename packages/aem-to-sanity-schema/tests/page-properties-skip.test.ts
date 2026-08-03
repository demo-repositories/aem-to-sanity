import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DialogNode, PageComponentConfig } from "aem-to-sanity-core";
import { migrateSchemas } from "../src/api.ts";

/**
 * `aem-page-components.json` `skipProperties` end-to-end through
 * `migrateSchemas`: skipped page-shell dialog fields disappear from the
 * emitted object schema, and the raw property names ride the
 * page-templates manifest so `aem-transform` can drop the authored values.
 */

const PAGE_SHELL = "/apps/site/components/structure/page";
const PAGE_SHELL_RT = "site/components/structure/page";
const TEMPLATE = "/conf/site/settings/wcm/templates/basic";

function pageShellNode(): DialogNode {
  return {
    "jcr:title": "Page",
    "cq:dialog": {
      "sling:resourceType": "cq/gui/components/authoring/dialog",
      items: {
        pwaOrientation: {
          "jcr:primaryType": "nt:unstructured",
          name: "./pwaOrientation",
          "sling:resourceType":
            "granite/ui/components/coral/foundation/form/textfield",
        },
        disableCache: {
          "jcr:primaryType": "nt:unstructured",
          name: "./disableCache",
          "sling:resourceType":
            "granite/ui/components/coral/foundation/form/checkbox",
        },
      },
    },
  } as unknown as DialogNode;
}

const fetcher = async (path: string): Promise<DialogNode> => {
  if (path === PAGE_SHELL) return pageShellNode();
  throw new Error(`unexpected fetch: ${path}`);
};

describe("page-shell skipProperties", () => {
  const outputDir = mkdtempSync(join(tmpdir(), "page-props-skip-"));
  const schemasDir = join(outputDir, "schemas");

  after(async () => {
    await rm(outputDir, { recursive: true, force: true });
  });

  it("drops the field from the schema and records the skip in the manifest", async () => {
    const pageComponents: PageComponentConfig = new Map([
      [
        PAGE_SHELL_RT,
        { templates: [TEMPLATE], skipProperties: ["disableCache"] },
      ],
    ]);
    const result = await migrateSchemas({
      componentPaths: [PAGE_SHELL],
      fetcher,
      outputDir,
      schemasDir,
      pageComponents,
      writeAemSnapshot: false,
      runAudit: false,
      emitContentRegistry: false,
    });
    assert.equal(result.report.summary().successes, 1);

    const rendered = await readFile(
      join(schemasDir, "structurePage.ts"),
      "utf8",
    );
    assert.match(rendered, /pwaOrientation/);
    assert.doesNotMatch(rendered, /disableCache/);

    const manifest = JSON.parse(
      await readFile(join(outputDir, "cache", "page-templates.json"), "utf8"),
    ) as { entries: Array<{ cqTemplate: string; skipProperties?: string[] }> };
    assert.deepEqual(manifest.entries[0]?.skipProperties, ["disableCache"]);
  });
});
