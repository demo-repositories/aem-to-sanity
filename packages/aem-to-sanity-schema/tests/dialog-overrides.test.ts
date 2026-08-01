import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DialogNode, DialogOverrideEntry } from "aem-to-sanity-core";
import { migrateSchemas } from "../src/api.ts";

/**
 * End-to-end `aem-dialog-overrides.json` behavior through `migrateSchemas`:
 * a supplementary tab (the Sling-Resource-Merger-inherited "Properties" tab
 * of a proxy accordion — the motivating real case) is fetched, spliced
 * after `theme`, and lands in the emitted schema's groups in that order;
 * the report and the dialog snapshot record the merge; a `dialogFile`
 * entry replaces resolution entirely; an entry keyed to an unlisted
 * component only warns.
 */

const ACCORDION = "/apps/site/components/proxy/accordion";
const PROPERTIES_TAB_PATH =
  "/libs/core/wcm/components/accordion/v1/accordion/cq:dialog/content/items/tabs/items/properties";

const TEXTFIELD_RT = "granite/ui/components/coral/foundation/form/textfield";
const CONTAINER_RT = "granite/ui/components/coral/foundation/container";

function tab(title: string, fields: Record<string, DialogNode>): DialogNode {
  return {
    "jcr:primaryType": "nt:unstructured",
    "jcr:title": title,
    "sling:resourceType": CONTAINER_RT,
    items: fields,
  } as DialogNode;
}

function textfield(name: string, label: string): DialogNode {
  return {
    "sling:resourceType": TEXTFIELD_RT,
    name: `./${name}`,
    fieldLabel: label,
  } as DialogNode;
}

/**
 * Proxy accordion component node with an embedded dialog in the exact
 * t-mobile shape: the `tabs` node has no `sling:resourceType` and its
 * `items` mixes a scalar `jcr:primaryType` in with the tab children.
 */
function accordionComponentNode(): DialogNode {
  return {
    "jcr:title": "Accordion",
    "cq:dialog": {
      "sling:resourceType": "cq/gui/components/authoring/dialog",
      content: {
        items: {
          tabs: {
            "jcr:primaryType": "nt:unstructured",
            items: {
              "jcr:primaryType": "nt:unstructured",
              content: tab("Content", { heading: textfield("heading", "Heading") }),
              theme: tab("Theme", { theme: textfield("theme", "Theme") }),
            },
          },
        },
      },
    },
  } as unknown as DialogNode;
}

const propertiesTabNode = tab("Properties", {
  singleExpansion: textfield("singleExpansion", "Single item expansion"),
  headingElement: textfield("headingElement", "Heading Element"),
});

const fetcher = async (path: string): Promise<DialogNode> => {
  if (path === ACCORDION) return accordionComponentNode();
  if (path === PROPERTIES_TAB_PATH) return propertiesTabNode;
  throw new Error(`unexpected fetch: ${path}`);
};

type SuccessOutcome = Extract<
  ReturnType<typeof migrateSchemas> extends Promise<infer R>
    ? R["report"]["results"][number]
    : never,
  { status: "success" }
>;

describe("migrateSchemas: dialog overrides end-to-end", () => {
  const outputDir = mkdtempSync(join(tmpdir(), "dialog-overrides-e2e-"));

  after(async () => {
    await rm(outputDir, { recursive: true, force: true });
  });

  it("splices a supplementary tab after `theme` and records provenance", async () => {
    const warnings: string[] = [];
    const logger = {
      debug: () => {},
      info: () => {},
      warn: (msg: string) => warnings.push(msg),
      error: () => {},
    };
    const result = await migrateSchemas({
      componentPaths: [ACCORDION],
      fetcher,
      outputDir,
      schemasDir: join(outputDir, "schemas"),
      logger: logger as never,
      runAudit: false,
      emitContentRegistry: false,
      dialogOverrides: new Map<string, DialogOverrideEntry>([
        [
          "site/components/proxy/accordion",
          {
            supplementaryTabs: [
              { path: PROPERTIES_TAB_PATH, key: "properties", insertAfter: "theme" },
            ],
          },
        ],
        // Keyed to nothing in componentPaths — must warn, not fail.
        [
          "site/components/ghost",
          { supplementaryTabs: [{ path: PROPERTIES_TAB_PATH, key: "x" }] },
        ],
      ]),
    });

    assert.equal(result.report.summary().successes, 1);
    assert.equal(result.report.summary().failures, 0);

    // Unmatched entry warned and was ignored.
    assert.ok(
      warnings.some((w) => w.includes('dialog-overrides: "site/components/ghost"')),
      `expected an unmatched-entry warning, got: ${warnings.join(" | ")}`,
    );

    // Emitted schema: groups in tab order — content, theme, properties —
    // and the spliced tab's fields present and grouped.
    const success = result.report.results[0] as SuccessOutcome;
    const schema = await readFile(success.outputFile, "utf8");
    const contentIdx = schema.indexOf('name: "content"');
    const themeIdx = schema.indexOf('name: "theme", title: "Theme"');
    const propertiesIdx = schema.indexOf('name: "properties"');
    assert.ok(contentIdx > -1 && themeIdx > -1 && propertiesIdx > -1, schema);
    assert.ok(
      contentIdx < themeIdx && themeIdx < propertiesIdx,
      `group order should be content < theme < properties in:\n${schema}`,
    );
    assert.match(schema, /singleExpansion/);
    assert.match(schema, /headingElement/);

    // Report provenance.
    assert.deepEqual(success.supplementaryTabs, [
      { path: PROPERTIES_TAB_PATH, key: "properties", position: "after:theme" },
    ]);
    assert.equal(success.dialogOverride, undefined);

    // The dialog snapshot under cache/aem stores the MERGED dialog.
    const snapshotFile = join(outputDir, "cache", "aem", `${ACCORDION.slice(1)}.json`);
    assert.ok(existsSync(snapshotFile), `missing snapshot at ${snapshotFile}`);
    const snapshot = JSON.parse(await readFile(snapshotFile, "utf8"));
    const tabKeys = Object.keys(snapshot.content.items.tabs.items);
    assert.deepEqual(tabKeys, ["jcr:primaryType", "content", "theme", "properties"]);
  });

  it("dialogFile replaces resolution entirely and is recorded", async () => {
    const localDialog = {
      content: {
        items: {
          tabs: {
            "sling:resourceType": "granite/ui/components/coral/foundation/tabs",
            items: {
              custom: tab("Custom", { note: textfield("note", "Note") }),
            },
          },
        },
      },
    } as unknown as DialogNode;

    const result = await migrateSchemas({
      componentPaths: [ACCORDION],
      fetcher,
      outputDir,
      schemasDir: join(outputDir, "schemas"),
      runAudit: false,
      emitContentRegistry: false,
      writeAemSnapshot: false,
      dialogOverrides: new Map<string, DialogOverrideEntry>([
        [
          "site/components/proxy/accordion",
          { dialogFile: "./dialogs/accordion.json", dialog: localDialog },
        ],
      ]),
    });

    assert.equal(result.report.summary().successes, 1);
    const success = result.report.results[0] as SuccessOutcome;
    assert.deepEqual(success.dialogOverride, { file: "./dialogs/accordion.json" });
    assert.equal(success.supertypeChain, undefined);

    const schema = await readFile(success.outputFile, "utf8");
    // Only the local dialog's surface — the embedded dialog was never used.
    assert.match(schema, /note/);
    assert.doesNotMatch(schema, /heading/);
  });

  it("reports a splice failure as mappingError, not network", async () => {
    const result = await migrateSchemas({
      componentPaths: [ACCORDION],
      fetcher,
      outputDir,
      schemasDir: join(outputDir, "schemas"),
      runAudit: false,
      emitContentRegistry: false,
      writeAemSnapshot: false,
      dialogOverrides: new Map<string, DialogOverrideEntry>([
        [
          "site/components/proxy/accordion",
          {
            // Duplicate key: `theme` already exists in the embedded dialog.
            supplementaryTabs: [{ path: PROPERTIES_TAB_PATH, key: "theme" }],
          },
        ],
      ]),
    });

    assert.equal(result.report.summary().failures, 1);
    const failure = result.report.results[0];
    assert.equal(failure.status, "failure");
    if (failure.status === "failure") {
      assert.equal(failure.kind, "mappingError");
      assert.match(failure.message, /already exists/);
    }
  });
});
