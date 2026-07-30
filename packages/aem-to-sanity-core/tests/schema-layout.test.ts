import { describe, expect, it } from "vitest";
import {
  DEFAULT_SCHEMA_LAYOUT,
  resolveSchemaLayout,
} from "../src/config/schema-layout.ts";

describe("resolveSchemaLayout", () => {
  it("defaults to flat when unset or blank", () => {
    expect(resolveSchemaLayout({})).toBe(DEFAULT_SCHEMA_LAYOUT);
    expect(resolveSchemaLayout({ MIGRATION_SCHEMA_LAYOUT: "" })).toBe("flat");
    expect(resolveSchemaLayout({ MIGRATION_SCHEMA_LAYOUT: "   " })).toBe("flat");
  });

  it("returns valid layouts, trimmed", () => {
    expect(resolveSchemaLayout({ MIGRATION_SCHEMA_LAYOUT: "flat" })).toBe("flat");
    expect(resolveSchemaLayout({ MIGRATION_SCHEMA_LAYOUT: "kind" })).toBe("kind");
    expect(resolveSchemaLayout({ MIGRATION_SCHEMA_LAYOUT: " kind " })).toBe("kind");
  });

  it("rejects unknown values", () => {
    for (const bad of ["folders", "KIND", "documents", "true"]) {
      expect(() =>
        resolveSchemaLayout({ MIGRATION_SCHEMA_LAYOUT: bad }),
      ).toThrow(/not a valid layout/);
    }
  });
});
