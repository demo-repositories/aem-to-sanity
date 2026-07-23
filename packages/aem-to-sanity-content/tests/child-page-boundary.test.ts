import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Integration test: `aem-transform` must never inline a nested child page's
 * content into the parent page's pageBuilder. A roots-file entry migrates
 * only that page's own body; nested `cq:Page` subtrees are skipped and
 * surfaced in `transform-report.json → skippedChildPages`.
 *
 * Runs the real CLI as a subprocess (transform.ts executes `main()` at module
 * top level, so it can't be imported directly). cwd is the package dir so the
 * `tsx` loader resolves; all inputs/outputs go through an absolute temp
 * OUTPUT_DIR and `--registry` path.
 */

const packageDir = fileURLToPath(new URL("..", import.meta.url));
const transformTs = fileURLToPath(new URL("../src/transform.ts", import.meta.url));

/** Raw extract-cache fixture: a parent page with one nested child page. */
function rawParentPage(): unknown {
  const textBlock = (text: string) => ({
    "jcr:primaryType": "nt:unstructured",
    "sling:resourceType": "site/components/text",
    text,
  });
  return {
    jcrPath: "/content/site/parent",
    slug: "parent",
    relativePath: "parent",
    fetchedAt: "2026-01-01T00:00:00.000Z",
    tree: {
      "jcr:primaryType": "cq:Page",
      "jcr:content": {
        "jcr:primaryType": "cq:PageContent",
        "sling:resourceType": "site/structure/page",
        "cq:template": "/conf/site/settings/wcm/templates/basic",
        "jcr:title": "Parent",
        root: textBlock("parent body"),
      },
      child: {
        "jcr:primaryType": "cq:Page",
        "jcr:content": {
          "jcr:primaryType": "cq:PageContent",
          "sling:resourceType": "site/structure/page",
          "cq:template": "/conf/site/settings/wcm/templates/basic",
          "jcr:title": "Child",
          root: textBlock("child body"),
        },
      },
    },
  };
}

describe("nested child pages stay out of the parent's pageBuilder", () => {
  let tmp: string;
  let outputDir: string;

  before(() => {
    tmp = mkdtempSync(join(tmpdir(), "aem-transform-child-page-"));
    outputDir = join(tmp, "output");
    const contentDir = join(outputDir, "cache", "aem", "content", "content", "site");
    mkdirSync(contentDir, { recursive: true });
    writeFileSync(join(contentDir, "parent.json"), JSON.stringify(rawParentPage(), null, 2));

    const registryFile = join(tmp, "content-type-registry.json");
    writeFileSync(
      registryFile,
      JSON.stringify({
        entries: [
          {
            resourceType: "site/components/text",
            sanityType: "text",
            fields: [{ name: "text", type: "string" }],
          },
          {
            resourceType: "site/structure/page",
            sanityType: "sitePage",
            fields: [],
          },
        ],
      }),
    );

    // Declare the page shell so the walker exercises the shell walk-through
    // branch (the same one that used to descend straight into child pages).
    writeFileSync(
      join(outputDir, "cache", "page-templates.json"),
      JSON.stringify({
        entries: [
          {
            pageComponentResourceType: "site/structure/page",
            pageComponentSanityType: "sitePage",
            cqTemplate: "/conf/site/settings/wcm/templates/basic",
            sanityType: "basicPage",
            sanityTitle: "Basic Page",
          },
        ],
      }),
    );

    const env = { ...process.env, OUTPUT_DIR: outputDir };
    for (const key of Object.keys(env)) {
      if (key.startsWith("MIGRATION_") || key.startsWith("AEM_")) delete env[key];
    }
    execFileSync(
      process.execPath,
      ["--import", "tsx", transformTs, "--registry", registryFile],
      { cwd: packageDir, env, stdio: "pipe" },
    );
  });

  after(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("emits only the parent page's own body blocks", () => {
    const clean = JSON.parse(
      readFileSync(join(outputDir, "cache", "clean", "content", "site", "parent.json"), "utf8"),
    ) as { docs: Array<{ _type: string; pageBuilder: Array<{ _type: string; text?: string }> }> };
    assert.equal(clean.docs.length, 1);
    const doc = clean.docs[0]!;
    assert.equal(doc._type, "basicPage");
    assert.deepEqual(
      doc.pageBuilder.map((b) => ({ _type: b._type, text: b.text })),
      [{ _type: "text", text: "parent body" }],
    );
  });

  it("surfaces the skipped child page in the transform report", () => {
    const report = JSON.parse(
      readFileSync(join(outputDir, "cache", "transform-report.json"), "utf8"),
    ) as { summary: { skippedChildPages: number }; skippedChildPages: string[] };
    assert.equal(report.summary.skippedChildPages, 1);
    assert.deepEqual(report.skippedChildPages, ["/content/site/parent/child"]);
  });
});
