import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mapDialog } from "../src/mapper.ts";
import { lookup } from "../src/mapping-table.ts";
import type { DialogNode } from "aem-to-sanity-core";

// Fetcher used when no includes are expected. Throws loudly if called.
const noFetch = async () => {
  throw new Error("unexpected fetcher call");
};

/**
 * Build a minimal dialog root wrapping a single field node under
 * `root.items.<key>`. Mirrors the structure the mapper walks.
 */
function dialogWith(key: string, child: DialogNode): DialogNode {
  return {
    "sling:resourceType": "cq/gui/components/authoring/dialog",
    items: {
      [key]: child,
    },
  } as unknown as DialogNode;
}

/**
 * Real-world accordion from uxp promocard: a "Height" panel wrapping paired
 * numberfield + unit-select fields for three breakpoints.
 */
function accordionHeightNode(): DialogNode {
  const unitSelect = (name: string): Record<string, unknown> => ({
    "jcr:primaryType": "nt:unstructured",
    name: `./${name}`,
    fieldLabel: "Unit:",
    "sling:resourceType": "granite/ui/components/coral/foundation/form/select",
    fieldDescription: "Unit to be used for your height value.",
    items: {
      "jcr:primaryType": "nt:unstructured",
      pixels: {
        "jcr:primaryType": "nt:unstructured",
        text: "Pixels(px)",
        value: "px",
      },
      percent: {
        "jcr:primaryType": "nt:unstructured",
        text: "Percent(%)",
        value: "%",
      },
    },
  });
  const heightNumber = (name: string, label: string): Record<string, unknown> => ({
    "jcr:primaryType": "nt:unstructured",
    min: 0,
    name: `./${name}`,
    step: "0.01",
    fieldLabel: label,
    "sling:resourceType":
      "granite/ui/components/coral/foundation/form/numberfield",
  });
  return {
    "jcr:primaryType": "nt:unstructured",
    "sling:resourceType": "granite/ui/components/coral/foundation/accordion",
    items: {
      "jcr:primaryType": "nt:unstructured",
      columns: {
        "jcr:primaryType": "nt:unstructured",
        "jcr:title": "Height",
        "sling:resourceType": "granite/ui/components/coral/foundation/container",
        items: {
          "jcr:primaryType": "nt:unstructured",
          defaultHeight: heightNumber("defaultHeight", "Default height:"),
          defaultHeightUnit: unitSelect("defaultHeightUnit"),
          tabletHeight: heightNumber("tabletHeight", "Tablet height:"),
          tabletHeightUnit: unitSelect("tabletHeightUnit"),
          desktopHeight: heightNumber("desktopHeight", "Desktop height:"),
          desktopHeightUnit: unitSelect("desktopHeightUnit"),
        },
      },
    },
  } as unknown as DialogNode;
}

describe("mapping-table: accordion", () => {
  it("maps the Coral accordion resource type to the container kind", () => {
    const entry = lookup("granite/ui/components/coral/foundation/accordion");
    assert.equal(entry?.kind, "container");
  });
});

describe("mapDialog: accordion", () => {
  it("flattens panel fields into a collapsible fieldset named after the panel title", async () => {
    const dialog = dialogWith("accordionHeight", accordionHeightNode());
    const { fields, unmapped, groups, fieldsets } = await mapDialog(
      dialog,
      noFetch,
    );

    assert.equal(unmapped.length, 0);
    // Accordion panels are collapsible sections, not tabs — no group.
    assert.deepEqual(groups, []);
    assert.deepEqual(fieldsets, [
      { name: "height", title: "Height", collapsed: true, collapsible: true },
    ]);

    assert.deepEqual(
      fields.map((f) => f.name),
      [
        "defaultHeight",
        "defaultHeightUnit",
        "tabletHeight",
        "tabletHeightUnit",
        "desktopHeight",
        "desktopHeightUnit",
      ],
    );
    for (const f of fields) {
      assert.equal(f.group, undefined);
      assert.equal(f.fieldset, "height");
    }
    assert.equal(fields[0].type, "number");
    const unit = fields[1];
    assert.equal(unit.type, "string");
    assert.deepEqual((unit as { options?: { list?: unknown } }).options?.list, [
      { title: "Pixels(px)", value: "px" },
      { title: "Percent(%)", value: "%" },
    ]);
  });

  it("keeps the surrounding tab group when the accordion is nested inside a tab (uxp promocard shape)", async () => {
    const dialog = {
      "sling:resourceType": "cq/gui/components/authoring/dialog",
      items: {
        tabs: {
          "sling:resourceType": "granite/ui/components/coral/foundation/tabs",
          items: {
            display: {
              "jcr:title": "Display",
              "sling:resourceType":
                "granite/ui/components/coral/foundation/container",
              items: {
                accordionHeight: accordionHeightNode(),
              },
            },
          },
        },
      },
    } as unknown as DialogNode;

    const { fields, groups, fieldsets } = await mapDialog(dialog, noFetch);

    // The tab stays a group; the accordion panel does NOT become a second tab.
    assert.deepEqual(groups, [{ name: "display", title: "Display" }]);
    assert.deepEqual(fieldsets, [
      { name: "height", title: "Height", collapsed: true, collapsible: true },
    ]);
    for (const f of fields) {
      assert.equal(f.group, "display");
      assert.equal(f.fieldset, "height");
    }
  });

  it("emits an expanded fieldset when the panel carries a truthy `active` attribute", async () => {
    const node = accordionHeightNode() as unknown as {
      items: { columns: Record<string, unknown> };
    };
    node.items.columns.active = true;
    const dialog = dialogWith("accordionHeight", node as unknown as DialogNode);

    const { fieldsets } = await mapDialog(dialog, noFetch);
    assert.deepEqual(fieldsets, [
      { name: "height", title: "Height", collapsed: false, collapsible: true },
    ]);
  });
});
