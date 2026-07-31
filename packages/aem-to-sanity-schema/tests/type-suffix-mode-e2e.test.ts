import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DialogNode } from "aem-to-sanity-core";
import { migrateSchemas } from "../src/api.ts";

/**
 * End-to-end `typeSuffixMode` behavior through `migrateSchemas`.
 *
 * `"file"` mode decorates only the generated file basename and its
 * `export const` (`accordionType.ts` exporting `accordionType`) while
 * `defineType({ name })`, `pageBuilder.of[]`, and the content registry keep
 * the bare type name — so ingested `_type` values never move and the knob is
 * safe to flip between runs (the pruner cleans up the old basenames).
 */

const ACCORDION = "/apps/site/components/accordion";
const HERO = "/apps/site/components/hero";

function componentNode(title: string): DialogNode {
  return {
    "jcr:title": title,
    "cq:dialog": {
      "sling:resourceType": "cq/gui/components/authoring/dialog",
      items: {
        text: {
          "jcr:primaryType": "nt:unstructured",
          name: "./text",
          "sling:resourceType":
            "granite/ui/components/coral/foundation/form/textfield",
        },
      },
    },
  } as unknown as DialogNode;
}

const fetcher = async (path: string): Promise<DialogNode> => {
  if (path === ACCORDION) return componentNode("Accordion");
  if (path === HERO) return componentNode("Hero");
  throw new Error(`unexpected fetch: ${path}`);
};

async function run(
  outputDir: string,
  opts: {
    typeSuffix?: string;
    typeSuffixMode?: "type" | "file";
    componentNames?: Map<string, { name?: string; file?: string }>;
  } = {},
) {
  return migrateSchemas({
    componentPaths: [ACCORDION, HERO],
    fetcher,
    outputDir,
    schemasDir: join(outputDir, "schemas"),
    writeAemSnapshot: false,
    runAudit: false,
    ...opts,
  });
}

describe("migrateSchemas typeSuffixMode end-to-end", () => {
  const outputDir = mkdtempSync(join(tmpdir(), "type-suffix-mode-e2e-"));
  const schemasDir = join(outputDir, "schemas");

  after(async () => {
    await rm(outputDir, { recursive: true, force: true });
  });

  it("file mode suffixes file names and export consts but not type names", async () => {
    const result = await run(outputDir, {
      typeSuffix: "Type",
      typeSuffixMode: "file",
      componentNames: new Map([["site/components/hero", { name: "customHero" }]]),
    });
    assert.equal(result.report.summary().successes, 2);

    // File basename carries the suffix; the defineType name does not.
    const accordionFile = join(schemasDir, "accordionType.ts");
    assert.ok(existsSync(accordionFile));
    assert.ok(!existsSync(join(schemasDir, "accordion.ts")));
    const accordion = await readFile(accordionFile, "utf8");
    assert.match(accordion, /export const accordionType = defineType\(\{/);
    assert.match(accordion, /name: "accordion",/);

    // Explicit name overrides keep their bare type name too, with the file
    // convention still applied on disk.
    const heroFile = join(schemasDir, "customHeroType.ts");
    assert.ok(existsSync(heroFile));
    const hero = await readFile(heroFile, "utf8");
    assert.match(hero, /export const customHeroType = defineType\(\{/);
    assert.match(hero, /name: "customHero",/);

    // Toolkit-owned files keep their bare names.
    assert.ok(existsSync(join(schemasDir, "page.ts")));
    assert.ok(existsSync(join(schemasDir, "pageBuilder.ts")));

    // The barrel imports the suffixed export from the suffixed file.
    const barrel = await readFile(join(schemasDir, "index.ts"), "utf8");
    assert.match(
      barrel,
      /import \{ accordionType \} from "\.\/accordionType\.ts";/,
    );
    assert.ok(!barrel.includes("import { accordion }"));

    // pageBuilder.of[] registers the bare type names.
    const pageBuilder = await readFile(join(schemasDir, "pageBuilder.ts"), "utf8");
    assert.match(pageBuilder, /type: "accordion"/);
    assert.match(pageBuilder, /type: "customHero"/);
    assert.ok(!pageBuilder.includes('"accordionType"'));

    // The content registry maps to the bare type names.
    const registry = JSON.parse(
      await readFile(
        join(outputDir, "cache", "content-type-registry.json"),
        "utf8",
      ),
    );
    const types = registry.entries.map((e: { sanityType: string }) => e.sanityType);
    assert.ok(types.includes("accordion"));
    assert.ok(types.includes("customHero"));
    assert.ok(!types.includes("accordionType"));
  });

  it("dropping the suffix prunes the decorated files (not a set-once knob)", async () => {
    const result = await run(outputDir);
    assert.equal(result.report.summary().successes, 2);

    assert.ok(existsSync(join(schemasDir, "accordion.ts")));
    assert.ok(!existsSync(join(schemasDir, "accordionType.ts")));
    assert.ok(!existsSync(join(schemasDir, "customHeroType.ts")));

    const barrel = await readFile(join(schemasDir, "index.ts"), "utf8");
    assert.match(barrel, /import \{ accordion \} from "\.\/accordion\.ts";/);
  });

  it("type mode still bakes the suffix into the type name itself", async () => {
    const result = await run(outputDir, { typeSuffix: "Type" });
    assert.equal(result.report.summary().successes, 2);

    const accordion = await readFile(
      join(schemasDir, "accordionType.ts"),
      "utf8",
    );
    assert.match(accordion, /export const accordionType = defineType\(\{/);
    assert.match(accordion, /name: "accordionType",/);
  });

  it("an explicit file override wins over the global suffix decoration", async () => {
    const result = await run(outputDir, {
      typeSuffix: "Type",
      typeSuffixMode: "file",
      componentNames: new Map([
        ["site/components/accordion", { file: "accordionSchema" }],
      ]),
    });
    assert.equal(result.report.summary().successes, 2);

    // Pinned basename exactly as written — no suffix appended on top.
    const file = join(schemasDir, "accordionSchema.ts");
    assert.ok(existsSync(file));
    assert.ok(!existsSync(join(schemasDir, "accordionType.ts")));
    const accordion = await readFile(file, "utf8");
    assert.match(accordion, /export const accordionSchema = defineType\(\{/);
    assert.match(accordion, /name: "accordion",/);

    // Components without a file override still get the suffix convention.
    assert.ok(existsSync(join(schemasDir, "heroType.ts")));

    const barrel = await readFile(join(schemasDir, "index.ts"), "utf8");
    assert.match(
      barrel,
      /import \{ accordionSchema \} from "\.\/accordionSchema\.ts";/,
    );
  });

  it("a file override works standalone, without any global suffix", async () => {
    const result = await run(outputDir, {
      componentNames: new Map([
        ["site/components/accordion", { file: "accordionSchema" }],
      ]),
    });
    assert.equal(result.report.summary().successes, 2);

    const accordion = await readFile(
      join(schemasDir, "accordionSchema.ts"),
      "utf8",
    );
    assert.match(accordion, /export const accordionSchema = defineType\(\{/);
    assert.match(accordion, /name: "accordion",/);
    assert.ok(existsSync(join(schemasDir, "hero.ts")));
  });

  it("throws when a file override collides with another component's basename", async () => {
    await assert.rejects(
      run(outputDir, {
        componentNames: new Map([
          ["site/components/accordion", { file: "hero" }],
        ]),
      }),
      /basename "hero\.ts" is claimed by both/,
    );
  });
});
