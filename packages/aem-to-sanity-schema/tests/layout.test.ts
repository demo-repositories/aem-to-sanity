import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FLAT_PLANNER,
  createSchemaPathPlanner,
  scanGeneratedSchemaFiles,
} from "../src/layout.ts";
import { rewriteBarrelFromDisk } from "../src/pagebuilder.ts";
import { synthesizeSanityConfig } from "../src/typegen/synthesize-config.ts";

const dirs: string[] = [];
async function tmpDir(prefix: string): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), prefix));
  dirs.push(d);
  return d;
}
after(async () => {
  for (const d of dirs) await rm(d, { recursive: true, force: true });
});

describe("createSchemaPathPlanner", () => {
  it("flat layout keeps files at the root", () => {
    assert.equal(FLAT_PLANNER.relPath("teaser", "object"), "teaser.ts");
    assert.equal(FLAT_PLANNER.relPath("page", "document"), "page.ts");
  });

  it("kind layout groups by documents/ and objects/", () => {
    const planner = createSchemaPathPlanner({ layout: "kind" });
    assert.equal(planner.relPath("teaser", "object"), "objects/teaser.ts");
    assert.equal(planner.relPath("page", "document"), "documents/page.ts");
  });

  it("folder overrides win in both layouts", () => {
    const folderByTypeName = new Map([["navBar", "navigationObjects"]]);
    const kind = createSchemaPathPlanner({ layout: "kind", folderByTypeName });
    const flat = createSchemaPathPlanner({ layout: "flat", folderByTypeName });
    assert.equal(kind.relPath("navBar", "object"), "navigationObjects/navBar.ts");
    assert.equal(flat.relPath("navBar", "object"), "navigationObjects/navBar.ts");
    // Non-overridden types still follow the layout.
    assert.equal(kind.relPath("teaser", "object"), "objects/teaser.ts");
    assert.equal(flat.relPath("teaser", "object"), "teaser.ts");
  });

  it("always emits POSIX separators", () => {
    const planner = createSchemaPathPlanner({ layout: "kind" });
    assert.ok(!planner.relPath("teaser", "object").includes("\\"));
  });
});

describe("scanGeneratedSchemaFiles", () => {
  it("recurses into subfolders and skips only the root index.ts", async () => {
    const dir = await tmpDir("layout-scan-");
    await mkdir(join(dir, "objects"), { recursive: true });
    await mkdir(join(dir, "documents"), { recursive: true });
    await writeFile(join(dir, "index.ts"), "// barrel");
    await writeFile(join(dir, "flatType.ts"), "export const flatType = 1;");
    await writeFile(join(dir, "objects", "hero.ts"), "export const hero = 1;");
    await writeFile(join(dir, "documents", "page.ts"), "export const page = 1;");
    await writeFile(join(dir, "objects", "notes.txt"), "ignored");

    const files = await scanGeneratedSchemaFiles(dir);
    assert.deepEqual(files, [
      { typeName: "flatType", relPath: "flatType.ts" },
      { typeName: "hero", relPath: "objects/hero.ts" },
      { typeName: "page", relPath: "documents/page.ts" },
    ]);
  });

  it("returns [] for a missing directory", async () => {
    assert.deepEqual(await scanGeneratedSchemaFiles("/nonexistent/schemas"), []);
  });

  it("throws on duplicate basenames, naming both paths", async () => {
    const dir = await tmpDir("layout-dup-");
    await mkdir(join(dir, "objects"), { recursive: true });
    await writeFile(join(dir, "hero.ts"), "export const hero = 1;");
    await writeFile(join(dir, "objects", "hero.ts"), "export const hero = 1;");
    await assert.rejects(
      () => scanGeneratedSchemaFiles(dir),
      /two files for type "hero".*hero\.ts.*objects\/hero\.ts/s,
    );
  });
});

describe("rewriteBarrelFromDisk with subfolders", () => {
  it("imports each type from its relative path; barrel stays at the root", async () => {
    const dir = await tmpDir("layout-barrel-");
    await mkdir(join(dir, "objects"), { recursive: true });
    await mkdir(join(dir, "documents"), { recursive: true });
    await mkdir(join(dir, "navigationObjects"), { recursive: true });
    await writeFile(join(dir, "objects", "hero.ts"), "export const hero = 1;");
    await writeFile(
      join(dir, "navigationObjects", "navBar.ts"),
      "export const navBar = 1;",
    );
    await writeFile(join(dir, "objects", "pageBuilder.ts"), "export const pageBuilder = 1;");
    await writeFile(join(dir, "documents", "page.ts"), "export const page = 1;");

    const barrel = await rewriteBarrelFromDisk(dir);
    assert.equal(barrel, join(dir, "index.ts"));
    const src = await readFile(barrel, "utf8");
    assert.match(src, /import \{ hero \} from "\.\/objects\/hero\.ts";/);
    assert.match(
      src,
      /import \{ navBar \} from "\.\/navigationObjects\/navBar\.ts";/,
    );
    assert.match(src, /import \{ page \} from "\.\/documents\/page\.ts";/);
    // pageBuilder and page come last in allSchemaTypes; no Windows seps ever.
    assert.match(src, /export const allSchemaTypes = \[hero, navBar, pageBuilder, page\];/);
    assert.ok(!src.includes("\\"));
  });
});

describe("typegen synthesized config with subfolders", () => {
  it("imports schemas recursively and excludes the barrel", async () => {
    const outputDir = await tmpDir("layout-typegen-");
    const schemasDir = join(outputDir, "schemas");
    await mkdir(join(schemasDir, "objects"), { recursive: true });
    await writeFile(join(schemasDir, "index.ts"), "// barrel");
    await writeFile(join(schemasDir, "objects", "hero.ts"), "export const hero = 1;");

    const { configFile, schemaFiles } = await synthesizeSanityConfig({
      outputDir,
      schemasDir,
    });
    assert.deepEqual(schemaFiles, [join(schemasDir, "objects", "hero.ts")]);
    const src = await readFile(configFile, "utf8");
    assert.match(src, /import \{ hero \} from "\.\.\/schemas\/objects\/hero"/);
    assert.ok(!src.includes("{ index }"));
  });
});
