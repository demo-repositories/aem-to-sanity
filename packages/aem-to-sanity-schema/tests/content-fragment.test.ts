import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeContentFragmentArtifacts } from "../src/content-fragment.ts";
import { writePageBuilderArtifacts } from "../src/pagebuilder.ts";
import { RESERVED_SANITY_TYPE_NAMES } from "../src/naming.ts";

/**
 * The attribute-depth escape hatch: `contentFragment` (document holding a
 * page-builder `content` array) + `contentFragmentRef` (the block
 * aem-transform swaps in when it cuts a too-deep subtree). The ref block
 * must be a page-builder palette member so ingested refs validate; the
 * document type must NOT be droppable; both names are reserved so an AEM
 * component can't claim them.
 */
describe("contentFragment artifacts", () => {
  const tmp = mkdtempSync(join(tmpdir(), "content-fragment-"));

  after(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("emits both types, wiring content to the configured page-builder array", async () => {
    const { files } = await writeContentFragmentArtifacts({
      schemasDir: tmp,
      pageBuilderTypeName: "sections",
    });
    assert.equal(files.length, 2);
    const fragment = readFileSync(join(tmp, "contentFragment.ts"), "utf8");
    assert.match(fragment, /type: "document"/);
    assert.match(fragment, /name: "content",[\s\S]*?type: "sections"/);
    const ref = readFileSync(join(tmp, "contentFragmentRef.ts"), "utf8");
    assert.match(ref, /type: "reference"/);
    assert.match(ref, /to: \[\{ type: "contentFragment" \}\]/);
  });

  it("pageBuilder registers the ref block but never the document type", async () => {
    const { registered } = await writePageBuilderArtifacts({
      schemasDir: tmp,
      componentMembers: [
        { name: "text", title: "Text" },
        { name: "contentFragmentRef", title: "Content Fragment" },
        // Filename-scan path would offer the document type too — must drop it.
        { name: "contentFragment", title: "Content fragment" },
      ],
    });
    assert.ok(registered.includes("contentFragmentRef"));
    assert.ok(!registered.includes("contentFragment"));
  });

  it("reserves both names so AEM components can't claim them", () => {
    assert.ok(RESERVED_SANITY_TYPE_NAMES.has("contentFragment"));
    assert.ok(RESERVED_SANITY_TYPE_NAMES.has("contentFragmentRef"));
  });
});
