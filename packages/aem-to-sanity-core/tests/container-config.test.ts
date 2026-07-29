import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadContainerConfig } from "../src/config/containers.ts";

let tmp: string | undefined;

afterEach(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
  tmp = undefined;
});

function write(config: unknown): string {
  tmp = mkdtempSync(join(tmpdir(), "container-config-"));
  const file = join(tmp, "aem-component-containers.json");
  writeFileSync(file, typeof config === "string" ? config : JSON.stringify(config));
  return file;
}

describe("loadContainerConfig", () => {
  it("parses childrenField, flatten, and document", () => {
    const file = write({
      "site/components/page": { childrenField: "items" },
      "site/components/container": { childrenField: "items", flatten: true },
      "site/components/tabs": { childrenField: "items", document: true },
    });
    const config = loadContainerConfig({ file });
    expect(config.get("site/components/page")).toEqual({ childrenField: "items" });
    expect(config.get("site/components/container")).toEqual({
      childrenField: "items",
      flatten: true,
    });
    expect(config.get("site/components/tabs")).toEqual({
      childrenField: "items",
      document: true,
    });
  });

  it("treats non-true flags as unset (strict booleans)", () => {
    const file = write({
      "site/components/a": { childrenField: "items", flatten: "true", document: 1 },
    });
    expect(loadContainerConfig({ file }).get("site/components/a")).toEqual({
      childrenField: "items",
    });
  });

  it("rejects flatten + document on the same entry", () => {
    const file = write({
      "site/components/tabs": { childrenField: "items", flatten: true, document: true },
    });
    expect(() => loadContainerConfig({ file })).toThrow(/both "flatten" and "document"/);
  });

  it("rejects a missing or empty childrenField", () => {
    const file = write({ "site/components/tabs": { document: true } });
    expect(() => loadContainerConfig({ file })).toThrow(/childrenField/);
  });

  it("returns an empty config for a missing file and throws on malformed JSON", () => {
    expect(loadContainerConfig({ file: "/nonexistent/containers.json" }).size).toBe(0);
    const file = write("{not json");
    expect(() => loadContainerConfig({ file })).toThrow(/not valid JSON/);
  });
});
