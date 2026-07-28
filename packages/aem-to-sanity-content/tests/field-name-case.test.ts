import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Integration test: authored JCR keys that differ from the declared schema
 * field only by letter case must land in the declared field.
 *
 * The schema emitter camelCases dialog `name` values (`./linkURL` →
 * `linkUrl`, `./altValueFromDAM` → `altValueFromDam`) but JCR persists the
 * raw name — without canonicalization the value surfaces as an "unknown
 * field" in the Studio next to an empty declared field. Motivating case:
 * t-mobile's quicklinksv2 static link list.
 *
 * Covers top-level fields, nested array-of-object items (registry
 * `itemFields`), coercion applying AFTER the rename (boolean checkedValue),
 * and the drift report staying quiet about case-only mismatches.
 *
 * Runs the real CLI as a subprocess (transform.ts executes `main()` at
 * module top level), same harness as child-page-boundary.test.ts.
 */

const packageDir = fileURLToPath(new URL("..", import.meta.url));
const transformTs = fileURLToPath(new URL("../src/transform.ts", import.meta.url));

function rawPage(): unknown {
  return {
    jcrPath: "/content/site/case-page",
    slug: "case-page",
    relativePath: "case-page",
    fetchedAt: "2026-01-01T00:00:00.000Z",
    tree: {
      "jcr:primaryType": "cq:Page",
      "jcr:content": {
        "jcr:primaryType": "cq:PageContent",
        "sling:resourceType": "site/structure/page",
        "cq:template": "/conf/site/settings/wcm/templates/basic",
        "jcr:title": "Case Page",
        root: {
          "jcr:primaryType": "nt:unstructured",
          "sling:resourceType": "site/components/quicklinks",
          title: "More Resources",
          // Authored with trailing acronym casing; schema declares camelCase.
          altValueFromDAM: "false",
          staticList: {
            "jcr:primaryType": "nt:unstructured",
            item0: {
              "jcr:primaryType": "nt:unstructured",
              linkText: "How Mobile Works",
              linkURL: "https://example.com/",
              linkTarget: "_blank",
            },
          },
        },
      },
    },
  };
}

interface QuickLinksBlock {
  _type: string;
  title?: string;
  altValueFromDam?: boolean;
  altValueFromDAM?: unknown;
  staticList?: Array<{
    linkText?: string;
    linkUrl?: string;
    linkURL?: unknown;
    linkTarget?: boolean;
  }>;
}

describe("case-insensitive field name canonicalization", () => {
  let tmp: string;
  let outputDir: string;
  let block: QuickLinksBlock;

  before(() => {
    tmp = mkdtempSync(join(tmpdir(), "aem-transform-case-"));
    outputDir = join(tmp, "output");
    const contentDir = join(outputDir, "cache", "aem", "content", "content", "site");
    mkdirSync(contentDir, { recursive: true });
    writeFileSync(join(contentDir, "case-page.json"), JSON.stringify(rawPage(), null, 2));

    const registryFile = join(tmp, "content-type-registry.json");
    writeFileSync(
      registryFile,
      JSON.stringify({
        entries: [
          {
            resourceType: "site/components/quicklinks",
            sanityType: "quickLinks",
            fields: [
              { name: "title", type: "string" },
              { name: "altValueFromDam", type: "boolean" },
              {
                name: "staticList",
                type: "array-of-object",
                itemFields: [
                  { name: "linkText", type: "string" },
                  { name: "linkUrl", type: "string" },
                  {
                    name: "linkTarget",
                    type: "boolean",
                    checkedValue: "_blank",
                    uncheckedValue: "_self",
                  },
                ],
              },
            ],
          },
          { resourceType: "site/structure/page", sanityType: "sitePage", fields: [] },
        ],
      }),
    );

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

    const clean = JSON.parse(
      readFileSync(join(outputDir, "cache", "clean", "content", "site", "case-page.json"), "utf8"),
    ) as { docs: Array<{ pageBuilder: QuickLinksBlock[] }> };
    block = clean.docs[0]!.pageBuilder[0]!;
  });

  after(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("renames a case-mismatched top-level key onto the declared field, with coercion", () => {
    assert.equal(block.altValueFromDam, false);
    assert.equal(block.altValueFromDAM, undefined);
  });

  it("renames case-mismatched keys inside array-of-object items, with coercion", () => {
    const item = block.staticList![0]!;
    assert.equal(item.linkUrl, "https://example.com/");
    assert.equal(item.linkURL, undefined);
    assert.equal(item.linkTarget, true);
    assert.equal(item.linkText, "How Mobile Works");
  });

  it("does not report case-only mismatches as unknown-prop drift", () => {
    const report = JSON.parse(
      readFileSync(join(outputDir, "cache", "transform-report.json"), "utf8"),
    ) as { unknownPropsByComponent: Record<string, Array<{ prop: string }>> };
    assert.deepEqual(report.unknownPropsByComponent, {});
  });
});
