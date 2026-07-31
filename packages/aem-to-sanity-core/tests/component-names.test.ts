import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadComponentNameConfig } from "../src/config/component-names.ts";

let tmp: string | undefined;

function configFile(content: unknown): string {
  tmp = mkdtempSync(join(tmpdir(), "component-names-"));
  const file = join(tmp, "aem-component-names.json");
  writeFileSync(file, typeof content === "string" ? content : JSON.stringify(content));
  return file;
}

afterEach(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
  tmp = undefined;
});

describe("loadComponentNameConfig", () => {
  it("returns an empty map for a missing file", () => {
    expect(loadComponentNameConfig({ file: "/nonexistent/names.json" }).size).toBe(0);
  });

  it("accepts string shorthand and object form, normalizing /apps/ keys", () => {
    const config = loadComponentNameConfig({
      file: configFile({
        "/apps/uxp/components/proxy/content/lists": "lists",
        "uxp/components/proxy/content/list": { name: "list", title: "List" },
        "uxp/components/proxy/content/tabs": { title: "Tab Set" },
      }),
    });
    expect(config.get("uxp/components/proxy/content/lists")).toEqual({ name: "lists" });
    expect(config.get("uxp/components/proxy/content/list")).toEqual({
      name: "list",
      title: "List",
    });
    expect(config.get("uxp/components/proxy/content/tabs")).toEqual({ title: "Tab Set" });
  });

  it("rejects invalid type names", () => {
    expect(() =>
      loadComponentNameConfig({ file: configFile({ "a/b/c": "1bad name" }) }),
    ).toThrow(/not a valid Sanity type name/);
  });

  it("rejects duplicate names across entries", () => {
    expect(() =>
      loadComponentNameConfig({
        file: configFile({ "a/b/c": "list", "a/b/d": "list" }),
      }),
    ).toThrow(/must be unique/);
  });

  it("rejects empty entries", () => {
    expect(() =>
      loadComponentNameConfig({ file: configFile({ "a/b/c": {} }) }),
    ).toThrow(/needs "name", "title", "folder", and\/or "file"/);
  });

  it("accepts file overrides, including file-only entries", () => {
    const config = loadComponentNameConfig({
      file: configFile({
        "a/b/table": { name: "tableData", file: "tableDataSchema" },
        "a/b/hero": { file: "heroSchema" },
      }),
    });
    expect(config.get("a/b/table")).toEqual({
      name: "tableData",
      file: "tableDataSchema",
    });
    expect(config.get("a/b/hero")).toEqual({ file: "heroSchema" });
  });

  it("rejects invalid file basenames", () => {
    for (const bad of ["a/b", "hero.ts", "1hero", "-hero", "hero-schema"]) {
      expect(() =>
        loadComponentNameConfig({ file: configFile({ "a/b/c": { file: bad } }) }),
      ).toThrow(/not a valid file basename/);
    }
  });

  it("rejects duplicate file basenames across entries", () => {
    expect(() =>
      loadComponentNameConfig({
        file: configFile({
          "a/b/c": { file: "shared" },
          "a/b/d": { file: "shared" },
        }),
      }),
    ).toThrow(/file basenames must be unique/);
  });

  it("accepts folder overrides, including folder-only entries", () => {
    const config = loadComponentNameConfig({
      file: configFile({
        "a/b/nav": { folder: "navigationObjects" },
        "a/b/hero": { name: "hero", folder: "blocks" },
      }),
    });
    expect(config.get("a/b/nav")).toEqual({ folder: "navigationObjects" });
    expect(config.get("a/b/hero")).toEqual({ name: "hero", folder: "blocks" });
  });

  it("rejects folders with path separators, dots, or bad leading chars", () => {
    for (const bad of ["a/b", "../x", "objects.ts", "1x", "-nav", ".hidden"]) {
      expect(() =>
        loadComponentNameConfig({ file: configFile({ "a/b/c": { folder: bad } }) }),
      ).toThrow(/not a valid folder name/);
    }
  });

  it("rejects /apps/-vs-bare duplicate keys", () => {
    expect(() =>
      loadComponentNameConfig({
        file: configFile({ "/apps/a/b/c": "x", "a/b/c": "y" }),
      }),
    ).toThrow(/duplicates an earlier entry/);
  });
});
