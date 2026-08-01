import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DialogNode, DialogOverrideEntry } from "aem-to-sanity-core";
import { loadDialogOverrideConfig } from "aem-to-sanity-core";
import { ejectDialogs } from "../src/eject-dialogs.ts";
import { mapDialog } from "../src/mapper.ts";

/**
 * eject-dialogs end-to-end: the effective dialog (embedded / supertype /
 * supplementary tabs) is written as a static file with datasource options
 * baked in as literal items, the overrides config is rewritten to
 * dialogFile entries (baked supplementaryTabs dropped, unrelated entries
 * preserved), existing files are only overwritten with force, and the
 * ejected file round-trips through the loader + mapper.
 */

const ACCORDION = "/apps/site/components/proxy/accordion";
const PROPERTIES_TAB =
  "/libs/core/accordion/cq:dialog/content/items/tabs/items/properties";
const FLEX_LIST = "/etc/acs-commons/lists/site/flex-align";

const CONTAINER_RT = "granite/ui/components/coral/foundation/container";

function tab(title: string, fields: Record<string, unknown>): DialogNode {
  return {
    "jcr:title": title,
    "sling:resourceType": CONTAINER_RT,
    items: fields,
  } as unknown as DialogNode;
}

function componentNode(): DialogNode {
  return {
    "jcr:title": "Accordion",
    "cq:dialog": {
      content: {
        items: {
          tabs: {
            "jcr:primaryType": "nt:unstructured",
            items: {
              content: tab("Content", {
                heading: {
                  "sling:resourceType":
                    "granite/ui/components/coral/foundation/form/textfield",
                  name: "./heading",
                  fieldLabel: "Heading",
                },
                align: {
                  "sling:resourceType":
                    "granite/ui/components/coral/foundation/form/select",
                  name: "./align",
                  fieldLabel: "Align",
                  datasource: {
                    "sling:resourceType":
                      "acs-commons/components/utilities/genericlist/datasource",
                    path: FLEX_LIST,
                  },
                },
                font: {
                  "sling:resourceType":
                    "granite/ui/components/coral/foundation/form/select",
                  name: "./font",
                  fieldLabel: "Font",
                  datasource: {
                    "sling:resourceType": "site/components/datasources/fonts",
                  },
                },
              }),
              theme: tab("Theme", {
                theme: {
                  "sling:resourceType":
                    "granite/ui/components/coral/foundation/form/textfield",
                  name: "./theme",
                  fieldLabel: "Theme",
                },
              }),
            },
          },
        },
      },
    },
  } as unknown as DialogNode;
}

const propertiesTab = tab("Properties", {
  headingElement: {
    "sling:resourceType": "granite/ui/components/coral/foundation/form/select",
    name: "./headingElement",
    fieldLabel: "Heading Element",
    datasource: {
      "sling:resourceType":
        "core/wcm/components/commons/datasources/allowedheadingelements/v1",
    },
  },
});

const flexListPage = {
  "jcr:content": {
    list: {
      s: { "jcr:title": "Start", value: "flex-start" },
      c: { "jcr:title": "Center", value: "center" },
    },
  },
} as unknown as DialogNode;

const fetcher = async (path: string): Promise<DialogNode> => {
  if (path === ACCORDION) return componentNode();
  if (path === PROPERTIES_TAB) return propertiesTab;
  if (path === FLEX_LIST) return flexListPage;
  throw new Error(`unexpected fetch: ${path}`);
};

describe("ejectDialogs", () => {
  const dir = mkdtempSync(join(tmpdir(), "eject-dialogs-"));
  const overridesFile = join(dir, "aem-dialog-overrides.json");
  const outDir = join(dir, "dialog-overrides");

  after(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("ejects the effective dialog with tabs baked and datasources materialized", async () => {
    // Existing config: supplementary tab for the accordion + an unrelated entry.
    await writeFile(
      overridesFile,
      JSON.stringify({
        "site/components/proxy/accordion": {
          supplementaryTabs: [
            { path: PROPERTIES_TAB, insertAfter: "theme" },
          ],
        },
        "/apps/site/components/other": {
          supplementaryTabs: [{ path: PROPERTIES_TAB }],
        },
      }),
    );
    const dialogOverrides = loadDialogOverrideConfig({ file: overridesFile });

    const result = await ejectDialogs({
      componentPaths: [ACCORDION],
      fetcher,
      dialogOverrides,
      overridesFile,
      outDir,
    });

    assert.equal(result.skipped.length, 0);
    assert.equal(result.ejected.length, 1);
    const e = result.ejected[0]!;
    assert.equal(e.bakedTabs, 1);
    assert.equal(e.materializedDatasources, 2); // generic list + core default
    assert.equal(e.unresolvedDatasources, 1); // custom fonts servlet
    assert.ok(existsSync(e.file));

    const written = JSON.parse(await readFile(e.file, "utf8"));
    // Spliced tab present after theme.
    const tabs = written.content.items.tabs.items;
    assert.deepEqual(Object.keys(tabs), ["content", "theme", "properties"]);
    // Generic list materialized as literal items; datasource removed.
    const align = tabs.content.items.align;
    assert.equal(align.datasource, undefined);
    assert.deepEqual(
      Object.values(align.items)
        .filter((v) => typeof v === "object")
        .map((v) => (v as { value: string }).value),
      ["flex-start", "center"],
    );
    // Core policy default materialized inside the baked tab.
    const heading = tabs.properties.items.headingElement;
    assert.equal(heading.datasource, undefined);
    assert.equal(
      Object.values(heading.items).filter((v) => typeof v === "object").length,
      6,
    );
    // Custom datasource kept for report visibility.
    assert.ok(tabs.content.items.font.datasource);

    // Config rewritten: accordion → dialogFile only; unrelated entry untouched.
    const config = JSON.parse(await readFile(overridesFile, "utf8"));
    assert.deepEqual(config["site/components/proxy/accordion"], {
      dialogFile: e.dialogFile,
    });
    assert.ok(config["/apps/site/components/other"].supplementaryTabs);
  });

  it("round-trips: the ejected file loads and maps with no double-splice", async () => {
    const dialogOverrides = loadDialogOverrideConfig({ file: overridesFile });
    const entry = dialogOverrides.get(
      "site/components/proxy/accordion",
    ) as DialogOverrideEntry;
    assert.ok(entry.dialog, "dialogFile should load eagerly");
    assert.equal(entry.supplementaryTabs, undefined);

    const { fields, groups, unmapped } = await mapDialog(
      entry.dialog!,
      async () => {
        throw new Error("no fetch expected — dialog is fully static");
      },
    );
    assert.deepEqual(
      groups.map((g) => g.name),
      ["content", "theme", "properties"],
    );
    const align = fields.find((f) => f.name === "align") as {
      options?: { list?: unknown[] };
    };
    assert.equal(align.options?.list?.length, 2);
    const headingElement = fields.find((f) => f.name === "headingElement") as {
      options?: { list?: unknown[] };
    };
    assert.equal(headingElement.options?.list?.length, 6);
    // Custom datasource still reports as unresolved — visible, not silent.
    assert.deepEqual(
      unmapped.map((u) => u.reason),
      ["datasource-unresolved"],
    );
  });

  it("skips existing files without force and overwrites with force", async () => {
    const dialogOverrides = loadDialogOverrideConfig({ file: overridesFile });
    const noForce = await ejectDialogs({
      componentPaths: [ACCORDION],
      fetcher,
      dialogOverrides,
      overridesFile,
      outDir,
    });
    assert.equal(noForce.ejected.length, 0);
    assert.equal(noForce.skipped.length, 1);
    assert.match(noForce.skipped[0]!.reason, /--force/);
    assert.equal(noForce.configUpdated, false);

    const forced = await ejectDialogs({
      componentPaths: [ACCORDION],
      fetcher,
      dialogOverrides,
      overridesFile,
      outDir,
      force: true,
    });
    assert.equal(forced.ejected.length, 1);
  });

  it("records a fetch failure as skipped without touching the config", async () => {
    const before = await readFile(overridesFile, "utf8");
    const result = await ejectDialogs({
      componentPaths: ["/apps/site/components/ghost"],
      fetcher,
      dialogOverrides: new Map(),
      overridesFile,
      outDir,
    });
    assert.equal(result.ejected.length, 0);
    assert.equal(result.skipped.length, 1);
    assert.equal(result.configUpdated, false);
    assert.equal(await readFile(overridesFile, "utf8"), before);
  });
});
