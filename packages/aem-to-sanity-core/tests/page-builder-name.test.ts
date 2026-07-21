import { describe, expect, it } from "vitest";
import {
  DEFAULT_PAGE_BUILDER_NAME,
  resolvePageBuilderName,
} from "../src/config/page-builder-name.ts";

describe("resolvePageBuilderName", () => {
  it("defaults to pageBuilder when unset or blank", () => {
    expect(resolvePageBuilderName({})).toBe(DEFAULT_PAGE_BUILDER_NAME);
    expect(resolvePageBuilderName({ MIGRATION_PAGE_BUILDER_NAME: "" })).toBe(
      "pageBuilder",
    );
    expect(resolvePageBuilderName({ MIGRATION_PAGE_BUILDER_NAME: "   " })).toBe(
      "pageBuilder",
    );
  });

  it("returns a valid custom name, trimmed", () => {
    expect(
      resolvePageBuilderName({ MIGRATION_PAGE_BUILDER_NAME: "sections" }),
    ).toBe("sections");
    expect(
      resolvePageBuilderName({ MIGRATION_PAGE_BUILDER_NAME: " pageBlocks " }),
    ).toBe("pageBlocks");
    expect(
      resolvePageBuilderName({ MIGRATION_PAGE_BUILDER_NAME: "content_body2" }),
    ).toBe("content_body2");
  });

  it("rejects names that are not valid identifiers", () => {
    for (const bad of ["page-builder", "2sections", "page builder", "a.b", "ä"]) {
      expect(() =>
        resolvePageBuilderName({ MIGRATION_PAGE_BUILDER_NAME: bad }),
      ).toThrow(/not a valid Sanity type name/);
    }
  });

  it("rejects names that collide with other generated files", () => {
    for (const bad of ["page", "index"]) {
      expect(() =>
        resolvePageBuilderName({ MIGRATION_PAGE_BUILDER_NAME: bad }),
      ).toThrow(/collides with the generated/);
    }
  });
});
