import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mapDialog } from "../src/mapper.ts";
import type { DialogNode } from "aem-to-sanity-core";

const noFetch = async () => {
  throw new Error("unexpected fetcher call");
};

function dialogWith(key: string, child: DialogNode): DialogNode {
  return {
    "sling:resourceType": "cq/gui/components/authoring/dialog",
    items: {
      [key]: child,
    },
  } as unknown as DialogNode;
}

describe("mapDialog: multifield", () => {
  it("maps a composite multifield to array-of-object with the inner fields", async () => {
    const dialog = dialogWith("links", {
      "sling:resourceType":
        "granite/ui/components/coral/foundation/form/multifield",
      composite: true,
      fieldLabel: "Links",
      field: {
        name: "./links",
        "sling:resourceType":
          "granite/ui/components/coral/foundation/container",
        items: {
          label: {
            name: "./label",
            fieldLabel: "Label",
            "sling:resourceType":
              "granite/ui/components/coral/foundation/form/textfield",
          },
        },
      },
    } as unknown as DialogNode);
    const { fields } = await mapDialog(dialog, noFetch);
    assert.equal(fields.length, 1);
    assert.equal(fields[0].type, "array-of-object");
    const items = (fields[0] as { itemFields: Array<{ name: string }> })
      .itemFields;
    assert.deepEqual(
      items.map((f) => f.name),
      ["label"],
    );
  });

  it("falls back to array-of-string when the inner field yields no mappable children", async () => {
    // Real-world shape: core accordion's `expandedItems` — a non-composite
    // multifield whose only inner field is a hidden input written by a
    // dialog edit hook. JCR persists a multi-value string property, and an
    // empty object array would be invalid Sanity schema.
    const dialog = dialogWith("expandedItems", {
      "sling:resourceType":
        "granite/ui/components/coral/foundation/form/multifield",
      composite: false,
      field: {
        name: "./expandedItems",
        "sling:resourceType":
          "granite/ui/components/coral/foundation/container",
        items: {
          expandedItems: {
            name: "./expandedItems",
            disabled: true,
            "sling:resourceType":
              "granite/ui/components/coral/foundation/form/hidden",
          },
        },
      },
    } as unknown as DialogNode);
    const { fields } = await mapDialog(dialog, noFetch);
    assert.equal(fields.length, 1);
    assert.equal(fields[0].name, "expandedItems");
    assert.equal(fields[0].type, "array-of-string");
  });
});
