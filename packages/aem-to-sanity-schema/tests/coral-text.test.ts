import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mapDialog } from "../src/mapper.ts";
import { emitSchemaFile } from "../src/emitter.ts";
import { lookup } from "../src/mapping-table.ts";
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

// Real-world example from uxp promocard: an inline warning to authors about
// aspect-ratio behavior in split mode. No `name`, nothing persisted.
const WARNING_TEXT =
  "When the card is in split mode (tablet or greater), the aspect ratio is ignored and instead the image is 50% width and is the height of content or container.";

function coralTextNode(text?: string): DialogNode {
  return {
    "jcr:primaryType": "nt:unstructured",
    ...(text !== undefined ? { text } : {}),
    "sling:resourceType": "granite/ui/components/coral/foundation/text",
  } as unknown as DialogNode;
}

describe("mapping-table: coral text", () => {
  it("maps the Coral text resource type to the note kind", () => {
    const entry = lookup("granite/ui/components/coral/foundation/text");
    assert.equal(entry?.kind, "note");
  });
});

describe("mapDialog: coral text", () => {
  it("maps a text node to a display-only note field carrying the message", async () => {
    const dialog = dialogWith("warning", coralTextNode(WARNING_TEXT));
    const { fields, unmapped } = await mapDialog(dialog, noFetch);

    assert.equal(unmapped.length, 0);
    assert.equal(fields.length, 1);
    const note = fields[0];
    assert.equal(note.name, "warning");
    assert.equal(note.type, "note");
    assert.equal(
      (note as { noteText?: string }).noteText,
      WARNING_TEXT,
    );
  });

  it("keeps the surrounding group placement", async () => {
    const dialog = {
      "sling:resourceType": "cq/gui/components/authoring/dialog",
      items: {
        tabs: {
          "sling:resourceType": "granite/ui/components/coral/foundation/tabs",
          items: {
            settings: {
              "jcr:title": "Settings",
              "sling:resourceType":
                "granite/ui/components/coral/foundation/container",
              items: {
                warning: coralTextNode(WARNING_TEXT),
              },
            },
          },
        },
      },
    } as unknown as DialogNode;

    const { fields } = await mapDialog(dialog, noFetch);
    assert.equal(fields.length, 1);
    assert.equal(fields[0].group, "settings");
  });

  it("skips a text node without a `text` attribute", async () => {
    const dialog = dialogWith("empty", coralTextNode());
    const { fields, unmapped } = await mapDialog(dialog, noFetch);

    assert.equal(fields.length, 0);
    assert.equal(unmapped.length, 1);
    assert.equal(unmapped[0].reason, "hidden");
  });
});

describe("emitSchemaFile: coral text", () => {
  it("emits a read-only string with the aemWidget note marker and the message as description", async () => {
    const dialog = dialogWith("warning", coralTextNode(WARNING_TEXT));
    const { fields, groups } = await mapDialog(dialog, noFetch);
    const src = await emitSchemaFile({
      typeName: "testNote",
      sourcePath: "/apps/test/note",
      fields,
      groups,
    });

    assert.match(src, /name: "warning"/);
    assert.match(src, /readOnly: true/);
    assert.match(src, /aemWidget: "note"/);
    assert.match(src, /\{ strict: false \}/);
    assert.ok(src.includes(JSON.stringify(WARNING_TEXT)));
  });
});
