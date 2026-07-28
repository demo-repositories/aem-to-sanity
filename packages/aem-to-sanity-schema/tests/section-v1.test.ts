import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mapDialog } from "../src/mapper.ts";
import type { DialogNode } from "aem-to-sanity-core";

// Fetcher used when no includes are expected. Throws loudly if called.
const noFetch = async () => {
  throw new Error("unexpected fetcher call");
};

/**
 * Granite UI v1 `granite/ui/components/foundation/section` — the pre-Coral
 * container still common in older dialogs (t-mobile's quicklinksv2
 * Accessibility tab is the motivating case). Two shapes:
 *
 *   1. A **titled** section directly under `tabs` acts as a tab → its title
 *      becomes a Studio group, its children map as fields in that group.
 *   2. An **untitled** section is a pure layout wrapper (column inside
 *      fixedcolumns) → flattened; children hoist up.
 *
 * Before the mapping-table entry, the section itself was emitted as one
 * placeholder string field and its children were never walked — authored
 * values (e.g. `ariaLabel*`) surfaced as "unknown field" drift.
 */
function textfield(name: string): DialogNode {
  return {
    "jcr:primaryType": "nt:unstructured",
    name: `./${name}`,
    fieldLabel: name,
    "sling:resourceType": "granite/ui/components/coral/foundation/form/textfield",
  } as unknown as DialogNode;
}

function quicklinksAccessibilityDialog(): DialogNode {
  return {
    "sling:resourceType": "cq/gui/components/authoring/dialog",
    content: {
      "jcr:primaryType": "nt:unstructured",
      "sling:resourceType": "granite/ui/components/coral/foundation/container",
      items: {
        tabs: {
          "jcr:primaryType": "nt:unstructured",
          "sling:resourceType": "granite/ui/components/coral/foundation/tabs",
          items: {
            accessibility: {
              "jcr:primaryType": "nt:unstructured",
              "jcr:title": "Accessibility",
              "sling:resourceType": "granite/ui/components/foundation/section",
              items: {
                columns: {
                  "jcr:primaryType": "nt:unstructured",
                  "sling:resourceType":
                    "granite/ui/components/coral/foundation/fixedcolumns",
                  items: {
                    column: {
                      "jcr:primaryType": "nt:unstructured",
                      "sling:resourceType": "granite/ui/components/foundation/section",
                      items: {
                        ariaLabelOpenButton: textfield("ariaLabelOpenButton"),
                        ariaLabelCloseButton: textfield("ariaLabelCloseButton"),
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  } as unknown as DialogNode;
}

describe("Granite UI v1 section", () => {
  it("titled section under tabs becomes a group; untitled sections flatten", async () => {
    const { fields, groups } = await mapDialog(quicklinksAccessibilityDialog(), noFetch);

    assert.deepEqual(
      groups.map((g) => g.title),
      ["Accessibility"],
    );

    const names = fields.map((f) => f.name);
    assert.deepEqual(names, ["ariaLabelOpenButton", "ariaLabelCloseButton"]);
    for (const f of fields) {
      assert.equal(f.type, "string");
      assert.equal(f.group, groups[0]!.name);
    }

    // The section nodes themselves must not surface as placeholder fields.
    assert.equal(
      fields.some((f) => (f.description ?? "").includes("no Sanity mapping")),
      false,
    );
  });
});
