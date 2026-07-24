import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { isMeaningfulValue, parseEnv, parseEnvExample } from "../src/lib/tenant-template.ts";
import { resolveContext } from "../src/paths.ts";

describe("parseEnv / parseEnvExample", () => {
  it("parses values, strips quotes, skips comments", () => {
    const env = parseEnv('A=1\n# comment\nB="two"\nC=\'three\'\n\nnoequals\n');
    expect(Object.fromEntries(env)).toEqual({ A: "1", B: "two", C: "three" });
  });

  it("marks uncommented keys required, commented ones optional", () => {
    const lines = parseEnvExample("A=your-value\n# B=optional\n## not-a-var\n");
    expect(lines).toEqual([
      { key: "A", value: "your-value", required: true, placeholder: "your-value" },
      { key: "B", value: "optional", required: false, placeholder: "optional" },
    ]);
  });
});

describe("isMeaningfulValue", () => {
  it("rejects placeholders, accepts real values", () => {
    for (const bad of [undefined, "", "your-project-id", "<slug>", "xxxx", "mlXXXXXX"]) {
      expect(isMeaningfulValue(bad), String(bad)).toBe(false);
    }
    for (const good of ["author", "production", "abc123", "https://example.com"]) {
      expect(isMeaningfulValue(good), good).toBe(true);
    }
  });
});

describe("resolveContext", () => {
  const scratch: string[] = [];
  afterEach(() => {
    for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function tmp(): string {
    const dir = mkdtempSync(join(tmpdir(), "ats-ctx-"));
    scratch.push(dir);
    return dir;
  }

  it("detects a monorepo root from anywhere inside it", () => {
    const root = tmp();
    mkdirSync(join(root, "tenants", "template"), { recursive: true });
    writeFileSync(join(root, "tenants", "template", "package.json"), "{}");
    const nested = join(root, "tenants", "acme", "output");
    mkdirSync(nested, { recursive: true });

    const ctx = resolveContext(nested);
    expect(ctx.mode).toBe("monorepo");
    expect(ctx.root).toBe(root);
    expect(ctx.tenantsDir).toBe(join(root, "tenants"));
  });

  it("monorepo wins over the standalone heuristic for tenant folders", () => {
    const root = tmp();
    mkdirSync(join(root, "tenants", "template"), { recursive: true });
    writeFileSync(join(root, "tenants", "template", "package.json"), "{}");
    const tenant = join(root, "tenants", "acme");
    mkdirSync(tenant, { recursive: true });
    // a tenant folder looks exactly like a standalone root…
    writeFileSync(join(tenant, ".env.example"), "");
    writeFileSync(join(tenant, "aem-component-paths"), "");

    expect(resolveContext(tenant).mode).toBe("monorepo");
  });

  it("detects a standalone project root", () => {
    const root = tmp();
    writeFileSync(join(root, ".env.example"), "");
    writeFileSync(join(root, "aem-component-paths"), "");
    const nested = join(root, "studio");
    mkdirSync(nested);

    const ctx = resolveContext(nested);
    expect(ctx.mode).toBe("standalone");
    expect(ctx.root).toBe(root);
    expect(ctx.tenantsDir).toBeUndefined();
  });

  it("throws outside any project", () => {
    expect(() => resolveContext(tmp())).toThrow(/not inside an aem-to-sanity project/);
  });
});
