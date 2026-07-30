import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DialogNode } from "aem-to-sanity-core";
import { migrateSchemas } from "../src/api.ts";

/**
 * End-to-end layout behavior through `migrateSchemas`: `schemaLayout:
 * "kind"` groups files under documents/ and objects/, a `folder` override
 * from aem-component-names.json wins, the barrel stays at the root — and
 * switching back to flat prunes every subfolder copy (layouts are not
 * set-once knobs).
 */

const NAVBAR = "/apps/site/components/navbar";
const HERO = "/apps/site/components/hero";

function componentNode(title: string): DialogNode {
  return {
    "jcr:title": title,
    "cq:dialog": {
      "sling:resourceType": "cq/gui/components/authoring/dialog",
      items: {
        text: {
          "jcr:primaryType": "nt:unstructured",
          name: "./text",
          "sling:resourceType":
            "granite/ui/components/coral/foundation/form/textfield",
        },
      },
    },
  } as unknown as DialogNode;
}

const fetcher = async (path: string): Promise<DialogNode> => {
  if (path === NAVBAR) return componentNode("Nav Bar");
  if (path === HERO) return componentNode("Hero");
  throw new Error(`unexpected fetch: ${path}`);
};

async function run(
  outputDir: string,
  layout: "flat" | "kind",
  componentNames?: Map<string, { folder?: string }>,
) {
  return migrateSchemas({
    componentPaths: [NAVBAR, HERO],
    fetcher,
    outputDir,
    schemasDir: join(outputDir, "schemas"),
    schemaLayout: layout,
    componentNames,
    writeAemSnapshot: false,
    runAudit: false,
    emitContentRegistry: false,
  });
}

describe("migrateSchemas layout end-to-end", () => {
  const outputDir = mkdtempSync(join(tmpdir(), "schema-layout-e2e-"));
  const schemasDir = join(outputDir, "schemas");

  after(async () => {
    await rm(outputDir, { recursive: true, force: true });
  });

  it("kind layout + folder override places every generated file", async () => {
    const result = await run(
      outputDir,
      "kind",
      new Map([["site/components/navbar", { folder: "navigationObjects" }]]),
    );
    assert.equal(result.report.summary().successes, 2);

    // Override beats the kind folder; everything else groups by kind.
    assert.ok(existsSync(join(schemasDir, "navigationObjects", "navbar.ts")));
    assert.ok(existsSync(join(schemasDir, "objects", "hero.ts")));
    assert.ok(existsSync(join(schemasDir, "objects", "pageBuilder.ts")));
    assert.ok(existsSync(join(schemasDir, "objects", "table.ts")));
    assert.ok(existsSync(join(schemasDir, "objects", "contentFragmentRef.ts")));
    assert.ok(existsSync(join(schemasDir, "documents", "page.ts")));
    assert.ok(existsSync(join(schemasDir, "documents", "contentFragment.ts")));

    // Barrel stays at the root and imports through the subfolders.
    const barrel = await readFile(join(schemasDir, "index.ts"), "utf8");
    assert.match(
      barrel,
      /import \{ navbar \} from "\.\/navigationObjects\/navbar\.ts";/,
    );
    assert.match(barrel, /import \{ hero \} from "\.\/objects\/hero\.ts";/);
    assert.match(barrel, /import \{ page \} from "\.\/documents\/page\.ts";/);
    assert.match(barrel, /export const allSchemaTypes = \[/);
    assert.ok(!barrel.includes("\\"));
  });

  it("switching back to flat moves files to the root and prunes the folders", async () => {
    const result = await run(outputDir, "flat");
    assert.equal(result.report.summary().successes, 2);

    assert.ok(existsSync(join(schemasDir, "navbar.ts")));
    assert.ok(existsSync(join(schemasDir, "hero.ts")));
    assert.ok(existsSync(join(schemasDir, "page.ts")));

    // No orphan copies, and the emptied subfolders are removed.
    assert.ok(!existsSync(join(schemasDir, "navigationObjects")));
    assert.ok(!existsSync(join(schemasDir, "objects")));
    assert.ok(!existsSync(join(schemasDir, "documents")));

    const barrel = await readFile(join(schemasDir, "index.ts"), "utf8");
    assert.match(barrel, /import \{ hero \} from "\.\/hero\.ts";/);
  });
});
