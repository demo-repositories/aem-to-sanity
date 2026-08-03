import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PageComponentConfig, PageComponentConfigEntry } from "aem-to-sanity-core";
import { writeTemplatePageArtifacts } from "../src/template-pages.ts";

/**
 * Per-template name/title overrides from `aem-page-components.json`
 * (`names`) — the universalPagePage case: a template path that already ends
 * in "-page" doubles up under the derived `templatePathToTypeName` rule, so
 * the operator pins `universalPage` explicitly.
 */

const RT = "uxp/components/structure/page";
const UNIVERSAL = "/conf/uxp/settings/wcm/templates/universal-page";
const NEWS = "/conf/uxp/settings/wcm/templates/news-article";

const tmpDirs: string[] = [];
after(() => {
  for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true });
});

function schemasDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "template-page-names-"));
  tmpDirs.push(dir);
  return dir;
}

function config(entry: PageComponentConfigEntry): PageComponentConfig {
  return new Map([[RT, entry]]);
}

function pageShellTypes(): Map<string, string> {
  return new Map([[RT, "page1"]]);
}

describe("template-pages: names overrides", () => {
  it("derives <template>Page without an override", async () => {
    const result = await writeTemplatePageArtifacts({
      schemasDir: schemasDir(),
      pageComponentsConfig: config({ templates: [UNIVERSAL] }),
      typeNameByResourceType: pageShellTypes(),
    });
    assert.equal(result.manifest.entries[0]?.sanityType, "universalPagePage");
    assert.equal(result.manifest.entries[0]?.sanityTitle, "Universal Page Page");
  });

  it("uses the explicit name and derived title", async () => {
    const dir = schemasDir();
    const result = await writeTemplatePageArtifacts({
      schemasDir: dir,
      pageComponentsConfig: config({
        templates: [UNIVERSAL],
        names: { [UNIVERSAL]: { name: "universalPage" } },
      }),
      typeNameByResourceType: pageShellTypes(),
    });
    const entry = result.manifest.entries[0];
    assert.equal(entry?.sanityType, "universalPage");
    assert.equal(entry?.sanityTitle, "Universal Page Page");
    const rendered = readFileSync(join(dir, "universalPage.ts"), "utf8");
    assert.match(rendered, /name: "universalPage"/);
  });

  it("applies a title override, with or without a name", async () => {
    const result = await writeTemplatePageArtifacts({
      schemasDir: schemasDir(),
      pageComponentsConfig: config({
        templates: [UNIVERSAL, NEWS],
        names: {
          [UNIVERSAL]: { name: "universalPage", title: "Universal Page" },
          [NEWS]: { title: "News" },
        },
      }),
      typeNameByResourceType: pageShellTypes(),
    });
    const byType = new Map(result.manifest.entries.map((e) => [e.sanityType, e]));
    assert.equal(byType.get("universalPage")?.sanityTitle, "Universal Page");
    // Title-only override keeps the derived type name.
    assert.equal(byType.get("newsArticlePage")?.sanityTitle, "News");
  });

  it("derived names fall back when an explicit name claims theirs first", async () => {
    const shorter = "/conf/uxp/settings/wcm/templates/universal";
    const result = await writeTemplatePageArtifacts({
      schemasDir: schemasDir(),
      pageComponentsConfig: config({
        templates: [UNIVERSAL, shorter],
        names: { [UNIVERSAL]: { name: "universalPage" } },
      }),
      typeNameByResourceType: pageShellTypes(),
    });
    const byTemplate = new Map(result.manifest.entries.map((e) => [e.cqTemplate, e]));
    assert.equal(byTemplate.get(UNIVERSAL)?.sanityType, "universalPage");
    // ".../universal" would derive "universalPage" too — explicit claim wins,
    // derived takes the aem-prefix fallback.
    assert.equal(byTemplate.get(shorter)?.sanityType, "aemUniversalPage");
  });

  it("rejects an explicit name that is a reserved Sanity type", async () => {
    await assert.rejects(
      writeTemplatePageArtifacts({
        schemasDir: schemasDir(),
        pageComponentsConfig: config({
          templates: [UNIVERSAL],
          names: { [UNIVERSAL]: { name: "image" } },
        }),
        typeNameByResourceType: pageShellTypes(),
      }),
      /reserved Sanity type name/,
    );
  });

  it("rejects an explicit name that collides with an emitted component type", async () => {
    await assert.rejects(
      writeTemplatePageArtifacts({
        schemasDir: schemasDir(),
        pageComponentsConfig: config({
          templates: [UNIVERSAL],
          names: { [UNIVERSAL]: { name: "page1" } },
        }),
        typeNameByResourceType: pageShellTypes(),
      }),
      /collides with an already-emitted type/,
    );
  });
});
