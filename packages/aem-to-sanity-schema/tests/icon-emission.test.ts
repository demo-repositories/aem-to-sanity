import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { emitSchemaFile } from "../src/emitter.ts";
import type { SanityField } from "../src/mapper.ts";

const FIELDS: SanityField[] = [
  { name: "title", title: "Title", type: "string" },
];

describe("emitSchemaFile: icon override", () => {
  it("emits the @sanity/icons import and defineType({ icon })", async () => {
    const out = await emitSchemaFile({
      typeName: "tabs",
      sourcePath: "/apps/uxp/components/proxy/content/tabs",
      fields: FIELDS,
      groups: [],
      icon: "ControlsIcon",
    });
    // v5 subpath import — the root "@sanity/icons" module no longer
    // provides per-icon named exports.
    assert.match(out, /import \{ ControlsIcon \} from "@sanity\/icons\/Controls";/);
    assert.match(out, /icon: ControlsIcon,/);
    // The icon identifier must appear as a bare reference, never quoted —
    // defineType expects the component, not a string.
    assert.doesNotMatch(out, /icon: "ControlsIcon"/);
  });

  it("emits no icon property or import when unset", async () => {
    const out = await emitSchemaFile({
      typeName: "tabs",
      sourcePath: "/apps/uxp/components/proxy/content/tabs",
      fields: FIELDS,
      groups: [],
    });
    assert.doesNotMatch(out, /@sanity\/icons/);
    assert.doesNotMatch(out, /icon:/);
  });

  it("keeps the icon alongside groups, fieldsets, and a custom export name", async () => {
    const out = await emitSchemaFile({
      typeName: "tabs",
      exportName: "tabsType",
      sourcePath: "/apps/uxp/components/proxy/content/tabs",
      fields: FIELDS.map((f) => ({ ...f, group: "content" })),
      groups: [{ name: "content", title: "Content" }],
      icon: "BlockElementIcon",
    });
    assert.match(out, /import \{ BlockElementIcon \} from "@sanity\/icons\/BlockElement";/);
    assert.match(out, /export const tabsType = defineType\(/);
    assert.match(out, /icon: BlockElementIcon,/);
    assert.match(out, /groups: \[/);
  });
});
