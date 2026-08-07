import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DialogNode } from "aem-to-sanity-core";
import { migrateSchemas } from "../src/api.ts";
import { scanSchemaTypeNames } from "../src/pagebuilder.ts";
import { writeTemplatePageArtifacts } from "../src/template-pages.ts";

/**
 * Template-restricted page-builder membership (the `components` map on
 * `aem-page-components.json` entries): restricted components leave the
 * shared `pageBuilder.of[]` and join a dedicated `{docType}Builder` array
 * on the per-template document types they're allowed on. No `components`
 * maps → single shared array, unchanged output.
 */

const SHELL_RT = "site/components/pageshell";
const NEWS_TEMPLATE = "/conf/site/settings/wcm/templates/news-article";
const HOME_TEMPLATE = "/conf/site/settings/wcm/templates/homepage";

const tmpDirs: string[] = [];
after(async () => {
  for (const dir of tmpDirs) await rm(dir, { recursive: true, force: true });
});

function tmpDirFor(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

const BASE_MEMBERS = [
  { name: "hero", title: "Hero" },
  { name: "navbar", title: "Nav Bar" },
];

describe("template-pages: per-template builder arrays", () => {
  it("emits a dedicated builder (base + extras, alphabetized) and points the doc at it", async () => {
    const dir = tmpDirFor("template-builder-");
    const result = await writeTemplatePageArtifacts({
      schemasDir: dir,
      pageComponentsConfig: new Map([
        [SHELL_RT, { templates: [NEWS_TEMPLATE, HOME_TEMPLATE] }],
      ]),
      typeNameByResourceType: new Map([[SHELL_RT, "pageshell"]]),
      baseMembers: BASE_MEMBERS,
      templateComponents: new Map([
        [NEWS_TEMPLATE, [{ name: "aemNewscard", title: "News Card" }]],
      ]),
    });

    assert.deepEqual(result.builderTypeNames, ["newsArticlePageBuilder"]);
    const builder = readFileSync(join(dir, "newsArticlePageBuilder.ts"), "utf8");
    assert.match(builder, /name: "newsArticlePageBuilder"/);
    // Base + extras, deduped and sorted by type name.
    const memberOrder = [...builder.matchAll(/type: "([A-Za-z0-9_]+)", title/g)].map(
      (m) => m[1],
    );
    assert.deepEqual(memberOrder, ["aemNewscard", "hero", "navbar"]);

    // The restricted template's doc references the dedicated array; the
    // FIELD keeps the shared name so aem-transform output is unchanged.
    const newsDoc = readFileSync(join(dir, "newsArticlePage.ts"), "utf8");
    assert.match(newsDoc, /name: "pageBuilder",\s*\n\s*type: "newsArticlePageBuilder"/);

    // The unrestricted template keeps the shared array.
    const homeDoc = readFileSync(join(dir, "homepagePage.ts"), "utf8");
    assert.match(homeDoc, /name: "pageBuilder",\s*\n\s*type: "pageBuilder"/);
    assert.ok(!existsSync(join(dir, "homepagePageBuilder.ts")));

    const byTemplate = new Map(
      result.manifest.entries.map((e) => [e.cqTemplate, e.pageBuilderType]),
    );
    assert.equal(byTemplate.get(NEWS_TEMPLATE), "newsArticlePageBuilder");
    assert.equal(byTemplate.get(HOME_TEMPLATE), "pageBuilder");
  });

  it("suffixes the builder name when it collides with an emitted type", async () => {
    const dir = tmpDirFor("template-builder-collision-");
    const result = await writeTemplatePageArtifacts({
      schemasDir: dir,
      pageComponentsConfig: new Map([[SHELL_RT, { templates: [NEWS_TEMPLATE] }]]),
      typeNameByResourceType: new Map([
        [SHELL_RT, "pageshell"],
        ["site/components/unlucky", "newsArticlePageBuilder"],
      ]),
      baseMembers: BASE_MEMBERS,
      templateComponents: new Map([
        [NEWS_TEMPLATE, [{ name: "aemNewscard", title: "News Card" }]],
      ]),
    });
    assert.deepEqual(result.builderTypeNames, ["newsArticlePageBuilder2"]);
    const doc = readFileSync(join(dir, "newsArticlePage.ts"), "utf8");
    assert.match(doc, /type: "newsArticlePageBuilder2"/);
  });
});

// --- end-to-end through migrateSchemas ------------------------------------

const SHELL = "/apps/site/components/pageshell";
const NEWSCARD = "/apps/site/components/newscard";
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
  if (path.startsWith(SHELL)) return componentNode("Page Shell");
  if (path.startsWith(NEWSCARD)) return componentNode("News Card");
  if (path.startsWith(HERO)) return componentNode("Hero");
  throw new Error(`unexpected fetch: ${path}`);
};

async function run(
  outputDir: string,
  components?: Record<string, string[]>,
) {
  return migrateSchemas({
    componentPaths: [SHELL, NEWSCARD, HERO],
    fetcher,
    outputDir,
    schemasDir: join(outputDir, "schemas"),
    writeAemSnapshot: false,
    runAudit: false,
    emitContentRegistry: false,
    pageComponents: new Map([
      [SHELL_RT, { templates: [NEWS_TEMPLATE], ...(components ? { components } : {}) }],
    ]),
  });
}

describe("migrateSchemas with component template restrictions", () => {
  it("removes restricted components from the shared array and re-adds them per template", async () => {
    const outputDir = tmpDirFor("restriction-e2e-");
    const schemasDir = join(outputDir, "schemas");
    const result = await run(outputDir, {
      [NEWS_TEMPLATE]: ["site/components/newscard"],
    });
    assert.equal(result.report.summary().successes, 3);

    const shared = readFileSync(join(schemasDir, "pageBuilder.ts"), "utf8");
    assert.match(shared, /type: "hero"/);
    assert.doesNotMatch(shared, /type: "newscard"/);

    const builder = readFileSync(
      join(schemasDir, "newsArticlePageBuilder.ts"),
      "utf8",
    );
    assert.match(builder, /type: "newscard", title: "News Card"/);
    assert.match(builder, /type: "hero"/);
    assert.match(builder, /type: "contentFragmentRef"/);

    const doc = readFileSync(join(schemasDir, "newsArticlePage.ts"), "utf8");
    assert.match(doc, /type: "newsArticlePageBuilder"/);

    // The dedicated builder survives the pruner and lands in the barrel.
    const barrel = readFileSync(join(schemasDir, "index.ts"), "utf8");
    assert.match(barrel, /newsArticlePageBuilder/);

    // The standalone pagebuilder CLI's scan must never fold template docs
    // or their builders back into pageBuilder.of[].
    const scanned = await scanSchemaTypeNames(schemasDir);
    assert.ok(!scanned.includes("newsArticlePage"));
    assert.ok(!scanned.includes("newsArticlePageBuilder"));
    assert.ok(scanned.includes("newscard"));
  });

  it("keeps a component in the shared array when its template was never discovered", async () => {
    const outputDir = tmpDirFor("restriction-unknown-");
    const schemasDir = join(outputDir, "schemas");
    await run(outputDir, {
      "/conf/site/settings/wcm/templates/nope": ["site/components/newscard"],
    });
    const shared = readFileSync(join(schemasDir, "pageBuilder.ts"), "utf8");
    assert.match(shared, /type: "newscard"/);
    assert.ok(!existsSync(join(schemasDir, "newsArticlePageBuilder.ts")));
  });

  it("no components map → single shared array, unchanged output", async () => {
    const outputDir = tmpDirFor("restriction-none-");
    const schemasDir = join(outputDir, "schemas");
    const result = await run(outputDir);
    const shared = readFileSync(join(schemasDir, "pageBuilder.ts"), "utf8");
    assert.match(shared, /type: "newscard"/);
    const doc = readFileSync(join(schemasDir, "newsArticlePage.ts"), "utf8");
    assert.match(doc, /type: "pageBuilder"/);
    assert.equal(
      result.report.summary().successes,
      3,
    );
  });
});
