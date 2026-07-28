import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mapDialog } from "../src/mapper.ts";
import { emitSchemaFile } from "../src/emitter.ts";
import type { DialogNode } from "aem-to-sanity-core";

// Fetcher used when no includes are expected. Throws loudly if called.
const noFetch = async () => {
  throw new Error("unexpected fetcher call");
};

/**
 * AEM core-image alt pattern: the dialog marks `./alt` required, but AEM
 * only enforces it while none of the inherit/decorative toggles are on
 * (`altValueFromDAM` / `altValueFromPageImage` / `isDecorative`) — checking
 * one hides the field and stores no alt on the page node. Authored content
 * routinely relies on inheritance, so a hard `Rule.required()` fails
 * validation on every migrated image. The emitter must render a conditional
 * rule that passes when a toggle is on (tolerating both coerced booleans
 * and legacy uncoerced `"true"` strings).
 */
function checkbox(name: string, text: string): DialogNode {
  return {
    "jcr:primaryType": "nt:unstructured",
    name: `./${name}`,
    text,
    value: true,
    uncheckedValue: "false",
    "sling:resourceType": "granite/ui/components/coral/foundation/form/checkbox",
  } as unknown as DialogNode;
}

function imageAltDialog(): DialogNode {
  return {
    "sling:resourceType": "cq/gui/components/authoring/dialog",
    items: {
      alt: {
        "jcr:primaryType": "nt:unstructured",
        name: "./alt",
        required: true,
        fieldLabel: "Alternative text for accessibility",
        "granite:class": "cmp-image__editor-alt-text",
        "sling:resourceType": "granite/ui/components/coral/foundation/form/textfield",
      },
      altValueFromDAM: checkbox("altValueFromDAM", "Inherit from description of asset"),
      altValueFromPageImage: checkbox(
        "altValueFromPageImage",
        "Inherit alternative text from page",
      ),
      decorative: checkbox("isDecorative", "Don't provide an alternative text"),
      // A required field with no inheritance companions — must stay hard-required.
      linkText: {
        "jcr:primaryType": "nt:unstructured",
        name: "./linkText",
        required: true,
        fieldLabel: "Link text",
        "sling:resourceType": "granite/ui/components/coral/foundation/form/textfield",
      },
    },
  } as unknown as DialogNode;
}

describe("conditional alt required", () => {
  it("marks alt required-unless the inherit/decorative companions", async () => {
    const { fields } = await mapDialog(imageAltDialog(), noFetch);
    const alt = fields.find((f) => f.name === "alt");
    assert.ok(alt);
    assert.equal(alt.required, true);
    // Names post-camelCase: DAM → Dam.
    assert.deepEqual(alt.requiredUnless, [
      "altValueFromDam",
      "altValueFromPageImage",
      "isDecorative",
    ]);

    const linkText = fields.find((f) => f.name === "linkText");
    assert.ok(linkText);
    assert.equal(linkText.requiredUnless, undefined);
  });

  it("emits a conditional custom rule for alt and a plain required() otherwise", async () => {
    const { fields, groups, fieldsets } = await mapDialog(imageAltDialog(), noFetch);
    const contents = await emitSchemaFile({
      typeName: "aemImage",
      sourcePath: "/apps/site/components/image",
      schemaTitle: "Image",
      fields,
      groups,
      fieldsets,
    });

    // alt: conditional rule, tolerant of legacy string "true" values.
    assert.match(contents, /Rule\.custom\(\(value, context\)/);
    assert.match(contents, /inherited\(parent\?\.altValueFromDam\)/);
    assert.match(contents, /inherited\(parent\?\.altValueFromPageImage\)/);
    assert.match(contents, /inherited\(parent\?\.isDecorative\)/);
    assert.match(contents, /v === true \|\| v === "true"/);
    assert.match(
      contents,
      /Required unless the alternative text is inherited or the image is decorative/,
    );

    // linkText keeps the unconditional rule.
    assert.match(contents, /Rule\.required\(\)/);
  });
});
