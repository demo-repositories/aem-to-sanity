import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveSlotVisibilityCondition } from "../src/slots.ts";
import { emitSchemaFile } from "../src/emitter.ts";
import type { SanityField } from "../src/mapper.ts";

/**
 * Config-declared slot visibility (`aem-component-slots.json` →
 * `visibleWhen`) — the promocard case: `buttonPrimary` / `buttonSecondary` /
 * `image` child slots folding behind the component's own
 * `enablePrimaryButton` / `enableSecondaryButton` / `enableForegroundImage`
 * toggles, rendered through the same ShowHideCondition machinery the dialog
 * show/hide mapper uses.
 */

function promocardFields(): SanityField[] {
  return [
    { name: "title", type: "string" },
    { name: "enablePrimaryButton", type: "boolean" },
    { name: "enableEyebrowGraphic", type: "boolean", initialValue: true },
    { name: "cardStyle", type: "string", initialValue: "flood" },
  ];
}

describe("slot visibility: resolveSlotVisibilityCondition", () => {
  it("maps the boolean shorthand to a visible-when-checked condition", () => {
    const cond = resolveSlotVisibilityCondition(
      { field: "enablePrimaryButton" },
      promocardFields(),
      () => assert.fail("should not warn"),
    );
    assert.deepEqual(cond, {
      controllerField: "enablePrimaryButton",
      kind: "checkbox",
      visibleWhenChecked: true,
    });
  });

  it("carries a default-checked controller through, so unset stays visible", () => {
    const cond = resolveSlotVisibilityCondition(
      { field: "enableEyebrowGraphic" },
      promocardFields(),
      () => assert.fail("should not warn"),
    );
    assert.deepEqual(cond, {
      controllerField: "enableEyebrowGraphic",
      kind: "checkbox",
      visibleWhenChecked: true,
      controllerDefaultChecked: true,
    });
  });

  it("maps the equals form to a dropdown condition with the controller default", () => {
    const cond = resolveSlotVisibilityCondition(
      { field: "cardStyle", equals: ["flood", "split"] },
      promocardFields(),
      () => assert.fail("should not warn"),
    );
    assert.deepEqual(cond, {
      controllerField: "cardStyle",
      kind: "dropdown",
      values: ["flood", "split"],
      controllerDefault: "flood",
    });
  });

  it("warns and skips when the controller field does not exist", () => {
    const warnings: string[] = [];
    const cond = resolveSlotVisibilityCondition(
      { field: "enableTypo" },
      promocardFields(),
      (m) => warnings.push(m),
    );
    assert.equal(cond, undefined);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0]!, /"enableTypo" is not a field/);
  });

  it("warns and skips when the shorthand points at a non-boolean field", () => {
    const warnings: string[] = [];
    const cond = resolveSlotVisibilityCondition(
      { field: "cardStyle" },
      promocardFields(),
      (m) => warnings.push(m),
    );
    assert.equal(cond, undefined);
    assert.match(warnings[0]!, /needs a boolean field/);
  });

  it("warns and skips when the equals form points at a non-string field", () => {
    const warnings: string[] = [];
    const cond = resolveSlotVisibilityCondition(
      { field: "enablePrimaryButton", equals: ["true"] },
      promocardFields(),
      (m) => warnings.push(m),
    );
    assert.equal(cond, undefined);
    assert.match(warnings[0]!, /needs a string field/);
  });
});

describe("slot visibility: emitted schema", () => {
  it("renders a hidden callback on a slot-reference field", async () => {
    const fields: SanityField[] = [
      { name: "enablePrimaryButton", type: "boolean" },
      {
        name: "buttonPrimary",
        title: "buttonPrimary",
        type: "slot-reference",
        slotTypeName: "button",
        hiddenConditions: [
          {
            controllerField: "enablePrimaryButton",
            kind: "checkbox",
            visibleWhenChecked: true,
          },
        ],
      },
    ];
    const src = await emitSchemaFile({
      typeName: "promoCard",
      sourcePath: "/apps/uxp/components/proxy/content/promocard",
      groups: [],
      fields,
    });
    assert.match(
      src,
      /name: "buttonPrimary"[\s\S]*?hidden: \(\{ parent \}\) => parent\?\.enablePrimaryButton !== true/,
    );
  });

  it("renders slot-reference fields collapsed, as a click-to-open row", async () => {
    const fields: SanityField[] = [
      {
        name: "buttonPrimary",
        title: "buttonPrimary",
        type: "slot-reference",
        slotTypeName: "button",
      },
    ];
    const src = await emitSchemaFile({
      typeName: "promoCard",
      sourcePath: "/apps/uxp/components/proxy/content/promocard",
      groups: [],
      fields,
    });
    assert.match(
      src,
      /name: "buttonPrimary"[\s\S]*?options: \{ collapsible: true, collapsed: true \}/,
    );
    // The alias type name defeats defineField's strict narrowing, so the
    // options pair needs the strict opt-out to typecheck in tenant studios.
    assert.match(src, /name: "buttonPrimary"[\s\S]*?\{ strict: false \}/);
  });

  it("renders a hidden callback on a slot-array field", async () => {
    const fields: SanityField[] = [
      { name: "cardStyle", type: "string" },
      {
        name: "content",
        title: "content",
        type: "slot-array",
        slotTypeName: "contentBlock",
        hiddenConditions: [
          {
            controllerField: "cardStyle",
            kind: "dropdown",
            values: ["flood"],
          },
        ],
      },
    ];
    const src = await emitSchemaFile({
      typeName: "promoCard",
      sourcePath: "/apps/uxp/components/proxy/content/promocard",
      groups: [],
      fields,
    });
    assert.match(
      src,
      /name: "content"[\s\S]*?hidden: \(\{ parent \}\) => parent\?\.cardStyle !== "flood"/,
    );
  });
});
