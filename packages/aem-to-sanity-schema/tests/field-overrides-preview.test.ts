import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DialogNode, DialogOverrideEntry } from "aem-to-sanity-core";
import { migrateSchemas } from "../src/api.ts";

/**
 * `fieldOverrides` from aem-dialog-overrides.json (incl. the "*" wildcard)
 * and `preview` overrides from aem-component-names.json, end-to-end through
 * `migrateSchemas`: readOnly + uuid initialValue land on the mapped field,
 * literal initialValues pass through, and the emitted preview block carries
 * the configured select paths + item-count prepare.
 */

const ACCORDION = "/apps/site/components/accordion";
const HERO = "/apps/site/components/hero";

function componentNode(title: string, fields: Record<string, unknown>): DialogNode {
  return {
    "jcr:title": title,
    "cq:dialog": {
      "sling:resourceType": "cq/gui/components/authoring/dialog",
      items: fields,
    },
  } as unknown as DialogNode;
}

function textfield(name: string): Record<string, unknown> {
  return {
    "jcr:primaryType": "nt:unstructured",
    name: `./${name}`,
    "sling:resourceType": "granite/ui/components/coral/foundation/form/textfield",
  };
}

const fetcher = async (path: string): Promise<DialogNode> => {
  if (path === ACCORDION)
    return componentNode("Accordion", {
      heading: textfield("heading"),
      componentId: textfield("componentId"),
      headingElement: textfield("headingElement"),
    });
  if (path === HERO)
    return componentNode("Hero", {
      componentId: textfield("componentId"),
    });
  throw new Error(`unexpected fetch: ${path}`);
};

describe("fieldOverrides + preview overrides", () => {
  const outputDir = mkdtempSync(join(tmpdir(), "field-overrides-preview-"));
  const schemasDir = join(outputDir, "schemas");

  after(async () => {
    await rm(outputDir, { recursive: true, force: true });
  });

  it("applies wildcard + per-component fieldOverrides and preview config", async () => {
    const dialogOverrides = new Map<string, DialogOverrideEntry>([
      [
        "*",
        { fieldOverrides: { componentId: { readOnly: true, initialValue: "uuid" } } },
      ],
      [
        "site/components/accordion",
        { fieldOverrides: { headingElement: { initialValue: "h3" } } },
      ],
    ]);
    const result = await migrateSchemas({
      componentPaths: [ACCORDION, HERO],
      fetcher,
      outputDir,
      schemasDir,
      dialogOverrides,
      containers: new Map([
        ["site/components/accordion", { childrenField: "items" }],
      ]),
      componentNames: new Map([
        [
          "site/components/accordion",
          {
            preview: { title: "heading", subtitle: "items.0.title", count: "items" },
          },
        ],
      ]),
      writeAemSnapshot: false,
      runAudit: false,
      emitContentRegistry: false,
    });
    assert.equal(result.report.summary().successes, 2);

    const accordion = await readFile(join(schemasDir, "accordion.ts"), "utf8");
    const hero = await readFile(join(schemasDir, "hero.ts"), "utf8");

    // Wildcard fieldOverrides reach every component.
    for (const src of [accordion, hero]) {
      assert.match(src, /name: "componentId",[\s\S]*?readOnly: true/);
      assert.match(src, /initialValue: \(\) => crypto\.randomUUID\(\)/);
    }
    // Per-component literal initialValue.
    assert.match(accordion, /name: "headingElement",[\s\S]*?initialValue: "h3"/);
    assert.doesNotMatch(hero, /headingElement/);

    // Preview override: select paths + count-based prepare.
    assert.match(accordion, /prTitle: "heading"/);
    assert.match(accordion, /prSubtitle: "items\.0\.title"/);
    assert.match(accordion, /prCount: "items"/);
    assert.match(accordion, /Array\.isArray\(prCount\) \? prCount\.length : 0/);
    assert.match(accordion, /item\$\{prCountN === 1 \? "" : "s"\}/);
    // Hero keeps the default static preview.
    assert.match(hero, /title: "Hero"/);
  });
});
