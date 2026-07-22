#!/usr/bin/env node
import "dotenv/config";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  AEM_AUTHORING_HINTS,
  aemCacheContentRoot,
  createColors,
  listExtractedContentFiles,
  loadAuthoringHintConfig,
  loadContainerConfig,
  normalizeSlotBase,
  resolvePageBuilderName,
  startTimer,
  type AuthoringHintConfig,
  type ContainerConfig,
} from "aem-to-sanity-core";
import { htmlToBlocks } from "@portabletext/block-tools";
import { compileSchema, defineSchema, type Schema } from "@portabletext/schema";
import { JSDOM } from "jsdom";
import type { Manifest as CategoryManifest, ManifestEntry as CategoryManifestEntry } from "./tags.ts";

interface AemNode {
  [key: string]: unknown;
  "sling:resourceType"?: string;
  "jcr:uuid"?: string;
}
interface RegistryFieldWire {
  name: string;
  type?: string;
  itemFields?: RegistryFieldWire[];
  checkedValue?: string;
  uncheckedValue?: string;
  valueFormat?: string;
}
/**
 * Registry entry as written on disk. Supports three shapes for back-compat:
 *   - Legacy: `fields: string[]` — names only, no coercion downstream.
 *   - Flat typed: `fields: Array<{name, type}>` — top-level coercion only.
 *   - Tree typed (current): `fields: Array<{name, type, itemFields?}>` —
 *     nested array-of-object members carry their own field types, so
 *     coercion walks into multifield items (variableColumn > columnContents
 *     > columnText richtext etc.).
 * Entries are normalized into {@link NormalizedRegistryEntry} at load.
 */
interface RegistryEntry {
  resourceType: string;
  sanityType: string;
  fields?: Array<string | RegistryFieldWire>;
}
interface FieldTypeNode {
  type: string;
  itemFields?: Map<string, FieldTypeNode>;
  /**
   * Boolean fields only: custom constants the AEM checkbox persists when
   * checked / unchecked (e.g. `"_blank"` / `"_self"` on a link-target
   * checkbox with `value` / `uncheckedValue` attrs). Coerced to `true` /
   * `false` alongside the `"true"` / `"false"` literals.
   */
  checkedValue?: string;
  uncheckedValue?: string;
  /**
   * Date / datetime fields only: the AEM datepicker's `valueFormat` — the
   * moment-style pattern of the string persisted to JCR (e.g. `"MMM DD,
   * yyyy"` → `"May 23, 2024"`). Used to parse authored values back into
   * Sanity's `YYYY-MM-DD` / UTC-ISO shapes; absent when the dialog stores
   * the standard ISO-8601 JCR date.
   */
  valueFormat?: string;
}
interface NormalizedRegistryEntry {
  resourceType: string;
  sanityType: string;
  fieldNames: string[];
  /** `name → type (+ nested itemFields)`. Empty for legacy string[] entries. */
  fieldTypes: Map<string, FieldTypeNode>;
}
interface RawFile {
  jcrPath: string;
  slug?: string;
  /**
   * Path relative to the roots-file `@base`, exactly as authored in
   * `aem-content-roots` (e.g. `us/en/company-culture/belonging`). Written by
   * `aem-extract`; absent on caches extracted before it existed and on
   * absolute roots entries outside any `@base`. Used as `slug.current` when
   * `MIGRATION_SLUG_STRATEGY=path`.
   */
  relativePath?: string;
  fetchedAt: string;
  tree: AemNode;
}
interface PageBuilderItem {
  _type: string;
  _key: string;
  [key: string]: unknown;
}
interface PageDoc {
  _id: string;
  /**
   * Always `"page"` for the generic fallback document type. Per-template
   * docs (driven by `aem-page-components.json` + the page-templates
   * manifest) use their own `_type` derived from the `cq:template` slug —
   * see {@link TemplatePageDoc}.
   */
  _type: string;
  title: string;
  slug: { _type: "slug"; current: string };
  /**
   * Page-builder blocks land under the configured field name
   * (`MIGRATION_PAGE_BUILDER_NAME`, default `pageBuilder`) — the same name
   * `migrate:schema` used for the array type and the page-doc field, so
   * the two stages must run with the same env value.
   */
  [pageBuilderField: string]: unknown;
  /**
   * AEM page-level `cq:tags` (on the `jcr:content` node) lifted into a
   * Sanity reference array. Only present when at least one tag resolved
   * through the categories manifest produced by `aem-tags` — fully empty
   * `cq:tags` arrays drop entirely so the Studio doesn't show an empty
   * field on every page.
   */
  tags?: Array<{ _type: "reference"; _key: string; _ref: string }>;
  /**
   * Page-shell dialog values lifted from `jcr:content` (e.g.
   * `pwaOrientation`, `disableCache`, `pinPage`). Only set when the page
   * matched a declared page-component / `cq:template` pair.
   */
  pageProperties?: Record<string, unknown>;
  /**
   * Sanity image lifted from `jcr:content/cq:featuredimage`. The DAM
   * reference is rewritten to a Sanity asset by `aem-assets`. Only set
   * when the page matched a declared page-component and a feature image
   * was present.
   */
  featuredImage?: Record<string, unknown>;
  /**
   * Raw `cq:template` path retained for traceability — lets scripts /
   * GROQ queries filter pages by template post-migration. Hidden in the
   * Studio by default.
   */
  cqTemplate?: string;
}

interface PageTemplateManifestEntry {
  pageComponentResourceType: string;
  pageComponentSanityType: string;
  cqTemplate: string;
  sanityType: string;
  sanityTitle: string;
}

const JCR_METADATA = new Set<string>([
  "jcr:primaryType",
  "jcr:mixinTypes",
  "jcr:uuid",
  "jcr:created",
  "jcr:createdBy",
  "jcr:lastModified",
  "jcr:lastModifiedBy",
  "cq:lastModified",
  "cq:lastModifiedBy",
  "cq:lastReplicated",
  "cq:lastReplicatedBy",
  "cq:lastReplicationAction",
  "sling:resourceType",
  "sling:resourceSuperType",
]);

/**
 * AEM bookkeeping keys that appear specifically on the page's `jcr:content`
 * (`cq:PageContent`) node but never belong on the Sanity page document.
 * Versioning, replication-per-agent, ContextHub plumbing, and a handful of
 * `_publish` / `_scene7` suffix variants AEM writes per replication agent.
 *
 * Why an explicit allowlist instead of "anything not in the dialog": the
 * page-shell dialog declares the *authored* fields (`pwaOrientation`,
 * `disableCache`, etc.). Everything else on `jcr:content` is either
 * bookkeeping (this set), child content (the `root` body — handled by
 * `collectPageBuilder`), or a known carve-out (`cq:tags`, `cq:template`,
 * `cq:featuredimage`). Listing the bookkeeping keys here lets us still
 * surface *genuinely* unknown / drifted properties via `diffProps`.
 */
const JCR_CONTENT_BOOKKEEPING_KEYS = new Set<string>([
  "jcr:versionHistory",
  "jcr:baseVersion",
  "jcr:predecessors",
  "jcr:isCheckedOut",
  "cq:isDelivered",
  "cq:contextHubSegmentsPath",
  "cq:contextHubPath",
  "cq:lastReplicatedBy_publish",
  "cq:lastReplicationAction_publish",
  "cq:lastReplicated_publish",
  "cq:lastReplicatedBy_scene7",
  "cq:lastReplicationAction_scene7",
  "cq:lastReplicated_scene7",
]);

/**
 * Dialog-runtime metadata that AEM writes alongside authored values but
 * that have no Sanity schema counterpart. Dropped during `transformInline`
 * the same way JCR metadata is.
 *
 * - `textIsRich`: a hint AEM adds next to richtext fields so the runtime
 *   knows to render them as rich HTML. We already convert those fields to
 *   Portable Text via `coerceFieldTypes`; the flag is noise that would
 *   otherwise surface in the Studio as "Unknown field found".
 */
const AEM_DIALOG_RUNTIME_KEYS = new Set<string>(["textIsRich"]);

/**
 * AEM-authored property keys that bear a `:` and would normally fail
 * `isValidSanityAttributeKey` (which forbids `:`). For each key listed here,
 * `transformInline` camelCases the JCR property name so the value lands on
 * the corresponding Sanity field — same rule the schema mapper applies to
 * `node.name` (`./cq:tags` → `cqTags`). Today this is just `cq:tags`; add
 * more if dialog widgets that store authored content under colon-bearing
 * JCR properties surface in the migration report.
 *
 * Why not a blanket "camelCase every colon-bearing key" rule: AEM also
 * writes replication-status bookkeeping (`cq:lastReplicated`,
 * `cq:isDelivered`, `cq:lastReplicatedBy_publish`, etc.) onto pages that we
 * already correctly drop. A blanket rule would start surfacing those as
 * dialog fields. Allowlist keeps the behavior precise.
 */
const AEM_AUTHORED_COLON_KEYS = new Set<string>(["cq:tags"]);

/**
 * AEM structural wrappers we always recurse through — the page root and the
 * responsive-grid container. These never become Sanity blocks on their own;
 * the transform walker descends into their children. Listing them here lets
 * the CLI hide them from the "unmapped components" callout so every row there
 * is an actionable missing schema, not known passthrough noise. The JSON
 * report still records them for completeness.
 */
const AEM_STRUCTURAL_PASSTHROUGH_TYPES = new Set<string>([
  "aem-integration/components/page",
  "wcm/foundation/components/responsivegrid",
]);

const MAX_DEPTH = 512;

/**
 * Read-only DAM path fields from fileupload mapping (`{name}AemPath`).
 * Must match `AEM_FILE_UPLOAD_PATH_FIELD_SUFFIX` in `aem-to-sanity-schema` mapper.
 */
const AEM_FILE_UPLOAD_PATH_FIELD_SUFFIX = "AemPath";

/** Sanity document / object attribute names; AEM often emits `cq:*` on nodes. */
const SANITY_ATTRIBUTE_KEY = /^\$?[a-zA-Z0-9_-]+$/;

function isValidSanityAttributeKey(key: string): boolean {
  return SANITY_ATTRIBUTE_KEY.test(key);
}

/**
 * Same camelCase rules as schema generation (`aem-to-sanity-schema` naming) so
 * `./lineOneTextFontFamily` → `lineOneTextFontFamily`, not `lineonetextfontfamily`.
 */
function toCamelCase(input: string): string {
  const spaced = input
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .trim();
  const words = spaced.split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";
  return words
    .map((w, i) => {
      const lower = w.toLowerCase();
      return i === 0 ? lower : lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join("");
}

/**
 * Granite dialog nodes declare the persisted property as `name` (often
 * `./contentPosition`). Page `.infinity.json` usually already uses that final
 * key, but when the JCR sibling key differs (e.g. `align` vs `./textAlign`),
 * use `name` so migrated documents match emitted Sanity schemas.
 */
function sanityPropertyKeyFromAemChild(
  child: AemNode,
  jcrSiblingKey: string,
): string {
  const raw = asString(child.name);
  if (!raw) return jcrSiblingKey;
  const stripped = raw.replace(/^\.\//, "").replace(/\//g, "_");
  if (!stripped) return jcrSiblingKey;
  return toCamelCase(stripped);
}

function loadRegistry(path: string): Map<string, NormalizedRegistryEntry> {
  const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
  const entries = Array.isArray(raw)
    ? (raw as RegistryEntry[])
    : raw && typeof raw === "object" && Array.isArray((raw as { entries?: unknown }).entries)
      ? ((raw as { entries: RegistryEntry[] }).entries)
      : null;
  if (!entries) {
    throw new Error(`${path}: expected RegistryEntry[] or { entries: RegistryEntry[] }`);
  }
  const map = new Map<string, NormalizedRegistryEntry>();
  for (const e of entries) map.set(e.resourceType, normalizeRegistryEntry(e));
  return map;
}

function normalizeRegistryEntry(e: RegistryEntry): NormalizedRegistryEntry {
  const fieldNames: string[] = [];
  const fieldTypes = buildFieldTypeTree(e.fields, fieldNames);
  return {
    resourceType: e.resourceType,
    sanityType: e.sanityType,
    fieldNames,
    fieldTypes,
  };
}

function buildFieldTypeTree(
  fields: RegistryEntry["fields"],
  collectNames?: string[],
): Map<string, FieldTypeNode> {
  const out = new Map<string, FieldTypeNode>();
  for (const f of fields ?? []) {
    if (typeof f === "string") {
      collectNames?.push(f);
      continue;
    }
    collectNames?.push(f.name);
    if (!f.type) continue;
    const node: FieldTypeNode = { type: f.type };
    if (f.itemFields?.length) {
      // Recurse with the same collector so nested member names (e.g.
      // `fileReference` / `fileReferenceAemPath` inside a multifield item)
      // also land in the flat `fieldNames` list. `splitAemFileUploadDamPaths`
      // uses that list to find `*AemPath` pairs at any depth during its
      // recursive walk; without nested names the split never moves the
      // DAM string off the asset field and the downstream link rewrite
      // has nothing to fill in.
      node.itemFields = buildFieldTypeTree(f.itemFields, collectNames);
    }
    if (f.checkedValue !== undefined) node.checkedValue = f.checkedValue;
    if (f.uncheckedValue !== undefined) node.uncheckedValue = f.uncheckedValue;
    if (f.valueFormat !== undefined) node.valueFormat = f.valueFormat;
    out.set(f.name, node);
  }
  return out;
}

function normalizeExceptionKey(v: string): string {
  const trimmed = v.trim().replace(/^\/+/, "");
  if (trimmed.startsWith("apps/")) return trimmed.slice("apps/".length);
  return trimmed;
}

function readExceptionResourceTypes(file: string): Set<string> {
  try {
    const raw = readFileSync(file, "utf8");
    return new Set(
      raw
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith("#"))
        .map(normalizeExceptionKey),
    );
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return new Set();
    throw err;
  }
}

/**
 * Derive a Sanity document `_id` from an AEM JCR path.
 *
 * Two operator knobs control the output:
 *
 *   - `MIGRATION_DOC_ID_PREFIX_STRIP` (env, optional) — a leading path
 *     fragment to remove before generating the id. Typical value is the
 *     `@base` from `aem-content-roots` (e.g. `/content/uxp/us/en`), so the
 *     resulting id is page-relative (`customer-support-plans-...`) instead
 *     of carrying the unchanging site/locale prefix on every doc. Multiple
 *     prefixes can be passed comma-separated; the longest matching one wins.
 *
 *   - Path separator is `-` (hyphen). The previous implementation used `.`
 *     for separators, but Sanity treats any `_id` containing `.` as a
 *     **private** doc — readable only with an auth token. Hyphenated ids
 *     are public-CDN-readable, which matters for read-only frontends that
 *     don't ship a token. Studio reads always carry auth, so dotted ids
 *     would also work there — but defaulting to hyphens means operators
 *     don't have to debug the auth-only behavior later.
 *
 * Long paths (>80 chars after sanitization) fall back to
 * `{first-60-chars}-{sha1-10}` so ids stay collision-free + within Sanity's
 * 128-char id limit even for deep JCR trees.
 *
 * Idempotency note: changing `MIGRATION_DOC_ID_PREFIX_STRIP` between runs
 * changes every doc's id. The previous docs aren't deleted — they get
 * orphaned. Operators repointing the prefix on a live dataset should either
 * start from a fresh dataset or run an `unpublishDocuments` pass on the
 * previous id space.
 */
function pathToDocId(jcrPath: string): string {
  const stripped = stripPrefix(jcrPath, getStripPrefixes());
  const normalized = stripped.replace(/^\/+/, "");
  const slug = normalized
    .replace(/\//g, "-")
    .replace(/[^A-Za-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (slug.length === 0) {
    // Stripping removed every meaningful character. Hash the original path
    // so the id is at least deterministic + collision-free.
    return createHash("sha1").update(jcrPath).digest("hex").slice(0, 16);
  }
  if (slug.length <= 80) return slug;
  const hash = createHash("sha1").update(jcrPath).digest("hex").slice(0, 10);
  return `${slug.slice(0, 60).replace(/-+$/, "")}-${hash}`;
}

/**
 * Cached list of prefixes to strip, parsed from
 * `MIGRATION_DOC_ID_PREFIX_STRIP`. Sorted longest-first so that overlapping
 * configurations (e.g. `/content/uxp,/content`) match the most specific
 * prefix.
 */
let cachedStripPrefixes: string[] | undefined;
function getStripPrefixes(): string[] {
  if (cachedStripPrefixes !== undefined) return cachedStripPrefixes;
  const raw = process.env.MIGRATION_DOC_ID_PREFIX_STRIP ?? "";
  cachedStripPrefixes = raw
    .split(",")
    .map((s) => s.trim().replace(/\/+$/, ""))
    .filter((s) => s.length > 0 && s.startsWith("/"))
    .sort((a, b) => b.length - a.length);
  return cachedStripPrefixes;
}

/**
 * How each page doc's `slug.current` is derived, from
 * `MIGRATION_SLUG_STRATEGY`:
 *
 *   - `segment` (default) — last segment of the JCR path (`chapters`),
 *     matching AEM's own page-slug semantics.
 *   - `path` — the path relative to the roots-file `@base`, exactly as
 *     authored in `aem-content-roots` (`us/en/company-culture/belonging/
 *     chapters`). Falls back to `segment` for raw files without a
 *     `relativePath` (pre-capture caches, absolute entries outside any
 *     `@base`) — re-run `aem-extract --overwrite` to capture it.
 *
 * Like `MIGRATION_DOC_ID_PREFIX_STRIP`, this is a set-once knob: switching
 * strategy between runs rewrites `slug.current` on every page doc. Doc
 * `_id`s are unaffected, so re-imports overwrite in place rather than
 * orphaning — but any frontend routing keyed on slugs must move in the same
 * deploy.
 */
type SlugStrategy = "segment" | "path";
function resolveSlugStrategy(env: NodeJS.ProcessEnv): SlugStrategy {
  const raw = (env.MIGRATION_SLUG_STRATEGY ?? "segment").trim();
  if (raw === "segment" || raw === "path") return raw;
  console.error(
    `MIGRATION_SLUG_STRATEGY must be "segment" or "path", got ${JSON.stringify(raw)}`,
  );
  process.exit(2);
}

function stripPrefix(jcrPath: string, prefixes: string[]): string {
  for (const p of prefixes) {
    if (jcrPath === p) return "";
    if (jcrPath.startsWith(p + "/")) return jcrPath.slice(p.length);
  }
  return jcrPath;
}

function stableKey(jcrUuid: string | undefined, jcrPath: string): string {
  if (jcrUuid && jcrUuid.length > 0) return jcrUuid.replace(/-/g, "").slice(0, 16);
  return createHash("sha1").update(jcrPath).digest("hex").slice(0, 16);
}

/**
 * For a container node, the list of direct child keys whose subtree contains
 * AEM component instances (anything with `sling:resourceType`, at any depth).
 * The caller strips these keys from `transformInline` so their data doesn't
 * end up in the dialog-field area — `collectContainerItems` then re-walks
 * the same subtree to emit the components as pageBuilder blocks under
 * `childrenField`.
 *
 * Transitive (not just direct) because AEM's **responsive grid** wraps every
 * authored drop-zone in intermediate `nt:unstructured` nodes that hold layout
 * config and nothing else (`container_64909622` → `layout: ...` + a nested
 * `container_64909` → ... → eventually `container` with `sling:resourceType`).
 * Treating only the deep `container` as a child would leave the wrappers in
 * place as undeclared fields on the parent; treating only the topmost wrapper
 * as a child would lose the resourceType-bearing leaves. Stripping the whole
 * subtree gets it right.
 */
function collectContainerChildKeys(node: AemNode): string[] {
  const out: string[] = [];
  for (const [key, value] of Object.entries(node)) {
    if (!isChildNode(value)) continue;
    if (subtreeHasResourceType(value as AemNode)) out.push(key);
  }
  return out;
}

function subtreeHasResourceType(node: AemNode): boolean {
  if (asString(node["sling:resourceType"])) return true;
  for (const value of Object.values(node)) {
    if (isChildNode(value) && subtreeHasResourceType(value as AemNode)) return true;
  }
  return false;
}

/**
 * Walk a container's subtree and produce the flat ordered list of AEM
 * component nodes to emit as pageBuilder items. Layout-only wrapper nodes
 * (no `sling:resourceType`) are descended through transparently — their
 * authored `layout` config has no Sanity counterpart and is dropped.
 *
 * Returns `{ jcrPath, node }` pairs so the caller's recursive
 * `collectPageBuilder` can hand each item its correct JCR path (used for
 * stable key generation + audit messages). Paths are joined with `/` from
 * the supplied `basePath`.
 */
interface ContainerItem {
  jcrPath: string;
  node: AemNode;
}

function collectContainerItems(node: AemNode, basePath: string): ContainerItem[] {
  const out: ContainerItem[] = [];
  walkForContainerItems(node, basePath, out);
  return out;
}

function walkForContainerItems(node: AemNode, currentPath: string, out: ContainerItem[]): void {
  for (const [key, value] of Object.entries(node)) {
    if (!isChildNode(value)) continue;
    const childNode = value as AemNode;
    const childPath = `${currentPath}/${key}`;
    if (asString(childNode["sling:resourceType"])) {
      out.push({ jcrPath: childPath, node: childNode });
    } else {
      walkForContainerItems(childNode, childPath, out);
    }
  }
}

/**
 * Named-slot keys for the current node: direct children that are themselves
 * AEM component instances (carry `sling:resourceType`) under a JCR key
 * that isn't already claimed by container logic. Each hit becomes one
 * nested block under that key at transform time — the schema side
 * discovers the same shape offline by scanning extracted content
 * (`packages/aem-to-sanity-schema/src/slots.ts`) and appends a matching
 * typed `slot-reference` field so the Studio shows the slot as
 * first-class content.
 *
 * Intentionally NOT filtering by dialog-declared field names: once
 * schema-side slot discovery runs, the registry's `fieldNames` includes
 * the slot key (as a `slot-reference` type). If we excluded declared
 * field names here, the nested block would round-trip through
 * `transformInline` as raw inline data and lose its `_type` + richtext
 * coercion. Having `sling:resourceType` on the child is the reliable
 * signal that it's a component instance, not dialog data — dialog
 * multifield rows are plain `nt:unstructured` nodes without
 * sling:resourceType, so they're never mistaken for slots.
 */
function collectSlotKeys(
  node: AemNode,
  containerChildKeys: string[] | null,
): string[] {
  const containerClaim = new Set(containerChildKeys ?? []);
  const out: string[] = [];
  for (const [key, value] of Object.entries(node)) {
    if (containerClaim.has(key)) continue;
    if (!isChildNode(value)) continue;
    const childType = asString((value as AemNode)["sling:resourceType"]);
    if (!childType) continue;
    out.push(key);
  }
  return out;
}

function stripKeys(node: AemNode, keys: string[]): AemNode {
  if (keys.length === 0) return node;
  const skip = new Set(keys);
  const out: AemNode = {};
  for (const [k, v] of Object.entries(node)) {
    if (skip.has(k)) continue;
    out[k] = v;
  }
  return out;
}

function isChildNode(value: unknown): value is AemNode {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    !(value as { __truncated?: unknown }).__truncated
  );
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

interface TransformContext {
  visited: WeakSet<object>;
  depth: number;
  registry: Map<string, NormalizedRegistryEntry>;
  audit: Audit;
  /** Resource types whose drop-zone children should be emitted under `childrenField`. */
  containers: ContainerConfig;
  /**
   * Per-resource-type opt-ins for AEM authoring hints (e.g. `cq:panelTitle`).
   * Listed components have those keys lifted to the corresponding Sanity
   * field name (via `AEM_AUTHORING_HINTS`). Non-listed components see no
   * hint behavior — colon-bearing keys still drop as before.
   */
  authoringHints: AuthoringHintConfig;
  /**
   * AEM tag id → Sanity category info. Populated from
   * `output/cache/categories/manifest.json` produced by `aem-tags`. Used by
   * `coerceFieldTypes` to rewrite authored tag id strings (e.g.
   * `promotion:payout/recurring-device-credits`) into Sanity reference
   * objects pointing at the matching `category` doc. Empty when the
   * operator hasn't run `aem-tags` yet — content with `cq:tags` will then
   * surface as unresolved findings in the transform report, which is the
   * correct signal.
   */
  categoryManifest: CategoryManifest;
  /**
   * AEM resource types declared as page-shell components in
   * `aem-page-components.json`. When the pageBuilder walker encounters a
   * node with one of these resource types (the `jcr:content` node of an
   * authored page), it descends into the children but does NOT emit a
   * block for the node itself — the shell's dialog values are already
   * lifted onto the document as `pageProperties` by `derivePageProperties`.
   * Without this skip the shell would surface as a stray `structurePage`
   * (or similar) block in `pageBuilder.of[]`, which the Studio rejects
   * because the schema correctly excludes shells from the allowed types.
   */
  pageShellResourceTypes: ReadonlySet<string>;
}

/**
 * AEM composite multifield (`granite/.../form/multifield` + `composite: true`):
 * authored data lives under the inner `field.name` property (see schema
 * `multifieldArrayPropertyName`); each row is `item0`, `item1`, … (or `0`, `1`)
 * until we coerce to a JSON array below.
 */
const AEM_MULTIFIELD_ITEM_KEY = /^item\d+$/i;
const AEM_MULTIFIELD_NUMERIC_KEY = /^\d+$/;

function isAemMultifieldItemKey(k: string): boolean {
  return AEM_MULTIFIELD_ITEM_KEY.test(k) || AEM_MULTIFIELD_NUMERIC_KEY.test(k);
}

function multifieldItemOrder(a: string, b: string): number {
  const mA = a.match(/^item(\d+)$/i);
  const mB = b.match(/^item(\d+)$/i);
  const na = mA ? parseInt(mA[1]!, 10) : parseInt(a, 10);
  const nb = mB ? parseInt(mB[1]!, 10) : parseInt(b, 10);
  return (Number.isFinite(na) ? na : 0) - (Number.isFinite(nb) ? nb : 0);
}

function isAemMultifieldItemMap(o: Record<string, unknown>): boolean {
  const keys = Object.keys(o);
  if (keys.length === 0) return false;
  const itemLike = keys.filter((k) => k !== "_key");
  if (itemLike.length === 0) return false;
  return itemLike.every((k) => isAemMultifieldItemKey(k));
}

/**
 * Move migrated DAM strings from `{base}` → `{base}AemPath` so asset fields
 * stay empty until `aem-assets` fills Sanity refs (see fileupload schema pair).
 */
function splitAemFileUploadDamPaths(
  value: unknown,
  fieldNames: string[] | undefined,
): void {
  if (!fieldNames?.length) return;
  const fieldSet = new Set(fieldNames);
  function walk(o: unknown): void {
    if (Array.isArray(o)) {
      for (const x of o) walk(x);
      return;
    }
    if (!o || typeof o !== "object") return;
    if ((o as { __truncated?: unknown }).__truncated) return;
    const rec = o as Record<string, unknown>;
    for (const f of fieldSet) {
      if (!f.endsWith(AEM_FILE_UPLOAD_PATH_FIELD_SUFFIX)) continue;
      const base = f.slice(0, -AEM_FILE_UPLOAD_PATH_FIELD_SUFFIX.length);
      if (!base) continue;
      const v = rec[base];
      if (typeof v === "string" && v.startsWith("/content/dam/")) {
        if (rec[f] === undefined) rec[f] = v;
        delete rec[base];
      }
    }
    for (const v of Object.values(rec)) walk(v);
  }
  walk(value);
}

/**
 * Default Portable Text schema used to compile AEM richtext HTML into Sanity
 * blocks. Matches the shape our emitter produces for `array-of-blocks` fields
 * (`{ type: "array", of: [{ type: "block" }] }`): Sanity's default decorators
 * + styles + lists + a `link` annotation. Kept module-level so every call
 * reuses the same compiled schema — the compile pass is not free.
 */
const PORTABLE_TEXT_SCHEMA: Schema = compileSchema(
  defineSchema({
    decorators: [
      { name: "strong" },
      { name: "em" },
      { name: "underline" },
      { name: "strike-through" },
      { name: "code" },
    ],
    styles: [
      { name: "normal" },
      { name: "h1" },
      { name: "h2" },
      { name: "h3" },
      { name: "h4" },
      { name: "blockquote" },
    ],
    lists: [{ name: "bullet" }, { name: "number" }],
    annotations: [
      { name: "link", fields: [{ name: "href", type: "string" }] },
    ],
  }),
);

const parseHtml = (html: string): Document =>
  new JSDOM(html, { contentType: "text/html" }).window.document;

/**
 * Deterministic `_key` generator for a single htmlToBlocks call. Seeds a
 * SHA1 stream with `{seed}:{counter}` so re-running the transform on
 * byte-identical input produces byte-identical Portable Text — preserving
 * the "re-runs produce clean git diffs" invariant that makes this pipeline
 * usable in CI.
 */
function deterministicKeyGen(seed: string): () => string {
  let counter = 0;
  return () =>
    createHash("sha1")
      .update(`${seed}:${counter++}`)
      .digest("hex")
      .slice(0, 12);
}

/**
 * Convert an AEM richtext HTML string into Portable Text blocks. Returns
 * `null` on parser failure so the caller can keep the original string and
 * surface the failure via the audit — never drops content silently.
 */
function htmlStringToPortableText(
  html: string,
  seed: string,
): unknown[] | null {
  try {
    return htmlToBlocks(html, PORTABLE_TEXT_SCHEMA, {
      parseHtml,
      keyGenerator: deterministicKeyGen(seed),
    }) as unknown[];
  } catch {
    return null;
  }
}

const MONTH_INDEX: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

interface DateParts {
  y: number;
  mo: number;
  d: number;
  h: number;
  mi: number;
  s: number;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Parse an authored JCR date string against the datepicker's moment-style
 * `valueFormat` pattern (recorded in the registry by `migrate:schema`).
 * Supports the token vocabulary AEM dialogs actually use — year (`YYYY` /
 * `yyyy`), month (`MMMM` / `MMM` names, `MM` / `M` digits), day (`DD` /
 * `dd` / `D`), time (`HH`, `mm`, `ss`) — everything else in the pattern is
 * matched literally. Returns `null` on any mismatch so the caller keeps the
 * original value. Month names resolve via English abbreviations (JCR
 * persists whatever locale the author instance ran; non-English values
 * fall through to keep-original and surface in Studio validation).
 */
function parseWithValueFormat(value: string, fmt: string): DateParts | null {
  const TOKENS = /YYYY|yyyy|MMMM|MMM|MM|DD|dd|HH|mm|ss|M|D/g;
  let pattern = "^";
  const keys: string[] = [];
  let last = 0;
  for (const m of fmt.matchAll(TOKENS)) {
    pattern += escapeRegExp(fmt.slice(last, m.index));
    const t = m[0];
    if (t === "YYYY" || t === "yyyy") {
      pattern += "(\\d{4})";
      keys.push("y");
    } else if (t === "MMMM" || t === "MMM") {
      pattern += "([A-Za-z.]+)";
      keys.push("monthName");
    } else if (t === "MM" || t === "M") {
      pattern += "(\\d{1,2})";
      keys.push("mo");
    } else if (t === "DD" || t === "dd" || t === "D") {
      pattern += "(\\d{1,2})";
      keys.push("d");
    } else if (t === "HH") {
      pattern += "(\\d{1,2})";
      keys.push("h");
    } else if (t === "mm") {
      pattern += "(\\d{2})";
      keys.push("mi");
    } else {
      pattern += "(\\d{2})";
      keys.push("s");
    }
    last = m.index + t.length;
  }
  pattern += escapeRegExp(fmt.slice(last)) + "$";
  const match = value.trim().match(new RegExp(pattern));
  if (!match) return null;
  const parts: DateParts = { y: NaN, mo: NaN, d: NaN, h: 0, mi: 0, s: 0 };
  keys.forEach((k, i) => {
    const raw = match[i + 1]!;
    if (k === "monthName") {
      parts.mo = MONTH_INDEX[raw.toLowerCase().replace(/\./g, "").slice(0, 3)] ?? NaN;
      return;
    }
    const n = Number(raw);
    if (k === "y") parts.y = n;
    else if (k === "mo") parts.mo = n;
    else if (k === "d") parts.d = n;
    else if (k === "h") parts.h = n;
    else if (k === "mi") parts.mi = n;
    else parts.s = n;
  });
  if (
    !Number.isFinite(parts.y) ||
    !(parts.mo >= 1 && parts.mo <= 12) ||
    !(parts.d >= 1 && parts.d <= 31)
  ) {
    return null;
  }
  return parts;
}

const pad2 = (n: number): string => String(n).padStart(2, "0");

/**
 * Coerce an authored JCR date string into the shape Sanity's `date` /
 * `datetime` types validate:
 *
 *   - `date` → `YYYY-MM-DD`. For ISO-with-time inputs the **literal** date
 *     part is kept (no timezone conversion — the authored calendar date is
 *     the intent, and shifting it across the UTC boundary would move e.g.
 *     a midnight-EST date to the previous day).
 *   - `datetime` → UTC ISO via `Date.toISOString()` for fully-ISO inputs;
 *     format-parsed values are assembled as UTC (JCR strings persisted via
 *     a custom `valueFormat` carry no offset to convert from).
 *
 * Resolution order: ISO / ISO-prefixed (the JCR standard when no
 * `valueFormat` is set — also covers legacy registries), then the field's
 * recorded `valueFormat`, then a `MMM DD, YYYY` month-name fallback for
 * old registries that predate `valueFormat` capture. Returns `null` when
 * nothing matches so the caller keeps the original value per the
 * keep-original-on-failure contract.
 */
function coerceDateString(
  value: string,
  target: "date" | "datetime",
  valueFormat: string | undefined,
): string | null {
  const v = value.trim();
  const iso = v.match(/^(\d{4})-(\d{2})-(\d{2})(T\S+)?$/);
  if (iso) {
    if (target === "date") return `${iso[1]}-${iso[2]}-${iso[3]}`;
    if (iso[4]) {
      const parsed = new Date(v);
      return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
    }
    return `${iso[1]}-${iso[2]}-${iso[3]}T00:00:00.000Z`;
  }
  let parts = valueFormat ? parseWithValueFormat(v, valueFormat) : null;
  if (!parts) parts = parseWithValueFormat(v, "MMM DD, YYYY");
  if (!parts) return null;
  const date = `${String(parts.y).padStart(4, "0")}-${pad2(parts.mo)}-${pad2(parts.d)}`;
  if (target === "date") return date;
  return `${date}T${pad2(parts.h)}:${pad2(parts.mi)}:${pad2(parts.s)}.000Z`;
}

/**
 * In-place coercion: for every field the registry declares a type on,
 * coerce the ingested AEM value to match that type. Walks nested
 * array-of-object members using the registry's `itemFields` tree so
 * multifield items (e.g. `variableColumn.columnContents[].columnText`)
 * get the same treatment as top-level fields.
 *
 * AEM's JCR is schemaless on dialog inputs — `.infinity.json` serializes
 * every authored value as a JSON string regardless of widget type:
 *   - richtext → HTML string   → Portable Text blocks (`array-of-blocks`)
 *   - numberfield → `"10"`     → `number`
 *   - checkbox  → `"true"`     → `boolean`
 *
 * Keep-original contract: if parsing fails (NaN number, unrecognized
 * boolean literal, HTML parser error), leave the original value in place
 * so the mismatch surfaces as a Studio validation error rather than
 * being silently overwritten with a fake value.
 */
function coerceFieldTypes(
  inline: Record<string, unknown>,
  fieldTypes: Map<string, FieldTypeNode>,
  jcrPath: string,
  ctx: TransformContext,
): void {
  if (fieldTypes.size === 0) return;
  for (const [name, node] of fieldTypes) {
    const v = inline[name];
    if (node.type === "array-of-blocks") {
      if (typeof v !== "string") continue;
      const blocks = htmlStringToPortableText(v, `${jcrPath}::${name}`);
      if (blocks !== null) inline[name] = blocks;
      continue;
    }
    if (node.type === "number") {
      if (typeof v !== "string") continue;
      const n = Number(v);
      if (Number.isFinite(n)) inline[name] = n;
      continue;
    }
    if (node.type === "boolean") {
      if (typeof v !== "string") continue;
      // Custom checkbox constants first (registry `checkedValue` /
      // `uncheckedValue`, e.g. a link-target checkbox persisting
      // `"_blank"` / `"_self"`), then the standard literals. Anything else
      // keeps the original value per the keep-original contract.
      if (node.checkedValue !== undefined && v === node.checkedValue) inline[name] = true;
      else if (node.uncheckedValue !== undefined && v === node.uncheckedValue) inline[name] = false;
      else if (v === "true") inline[name] = true;
      else if (v === "false") inline[name] = false;
      continue;
    }
    if (node.type === "date" || node.type === "datetime") {
      // AEM datepickers persist whatever their `valueFormat` says — the
      // standard ISO-8601-with-offset JCR date when unset, a display-style
      // string like "May 23, 2024" when set. Sanity's date/datetime types
      // validate strict shapes, so parse and re-emit; unparseable values
      // keep the original per the keep-original contract.
      if (typeof v !== "string") continue;
      const coerced = coerceDateString(v, node.type, node.valueFormat);
      if (coerced !== null) inline[name] = coerced;
      continue;
    }
    if (node.type === "array-of-string") {
      // Multi-select buttongroup: JCR stores a multi-value string property,
      // which `.infinity.json` serializes as a JSON array when the author
      // picked several values but as a bare string when they picked exactly
      // one. Wrap the single-string case; any other shape keeps the
      // original value so Studio validation surfaces the mismatch.
      if (typeof v === "string") inline[name] = [v];
      continue;
    }
    if (node.type === "array-of-reference") {
      // AEM tagfield: authored as an array of tag id strings
      // (`namespace:parent/child` or `parent/child` for default namespace).
      // Resolve each through the category manifest produced by `aem-tags`.
      // A missing entry means either the operator hasn't included the tag's
      // namespace in `aem-tag-roots` or AEM has stale references to a
      // deleted tag — drop the reference and surface in the audit.
      const refs = resolveTagReferences(
        v,
        ctx.categoryManifest,
        `${jcrPath}::${name}`,
        ctx.audit,
      );
      if (refs !== null) inline[name] = refs;
      continue;
    }
    if (node.type === "array-of-object" && node.itemFields) {
      // Materialize keyed-map variants before recursing. AEM's `itemN` /
      // numeric-index multifield shape is coerced earlier by
      // `deepCoerceAemMultifieldMapsToArrays`, but some AEM widgets (e.g.
      // the color-carousel's `colors`) store each row under a meaningful
      // named key (`weddingDresses`, `bridesmaidDresses`, …) instead. The
      // registry says the target is `array-of-object`; honor that by
      // flattening the keyed map's values into an array in JSON iteration
      // order (which mirrors the authored order in AEM). Truncation
      // sentinels are skipped — they stay opaque for downstream audit.
      let items: unknown[] | null = null;
      if (Array.isArray(v)) {
        items = v;
      } else if (
        v !== null &&
        typeof v === "object" &&
        !(v as { __truncated?: unknown }).__truncated
      ) {
        items = Object.values(v as Record<string, unknown>).filter(
          (item) => item !== null && typeof item === "object" && !Array.isArray(item),
        );
        inline[name] = items;
      }
      if (!items) continue;
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item && typeof item === "object" && !Array.isArray(item)) {
          coerceFieldTypes(
            item as Record<string, unknown>,
            node.itemFields,
            `${jcrPath}::${name}[${i}]`,
            ctx,
          );
        }
      }
    }
  }
}

/**
 * Resolve an AEM `cq:tags` value (string array of tag ids) into a Sanity
 * array of `_type:"reference"` objects pointing at `category` docs. Returns:
 *
 *   - The resolved array on success (possibly partial — entries that didn't
 *     resolve are dropped and audited individually).
 *   - `[]` when the input was an empty array.
 *   - `null` when the input wasn't an array of strings at all (keep the
 *     original value so Studio validation surfaces the shape mismatch).
 *
 * Alias chains (`cq:movedTo`) are followed transitively with a cycle guard
 * — in practice AEM doesn't create alias loops, but a misbehaving manifest
 * shouldn't be able to hang transform.
 */
function resolveTagReferences(
  value: unknown,
  manifest: CategoryManifest,
  refPath: string,
  audit: Audit,
): Array<{ _type: "reference"; _key: string; _ref: string }> | null {
  if (!Array.isArray(value)) {
    // Single-string variants of `cq:tags` are rare but legal in JCR (a
    // mv-string property with one value). Coerce to a single-item array
    // so it round-trips into the array reference shape.
    if (typeof value === "string") {
      return resolveTagReferences([value], manifest, refPath, audit);
    }
    return null;
  }
  const out: Array<{ _type: "reference"; _key: string; _ref: string }> = [];
  for (const raw of value) {
    if (typeof raw !== "string" || raw.length === 0) continue;
    const resolved = followTagAlias(raw, manifest);
    if (!resolved) {
      audit.unresolvedTagRef(raw, refPath);
      continue;
    }
    out.push({
      _type: "reference",
      _key: createHash("sha1").update(`${refPath}::${raw}`).digest("hex").slice(0, 12),
      _ref: resolved.sanityCategoryId,
    });
  }
  return out;
}

/**
 * Walk `cq:movedTo` aliases until we land on a non-tombstone entry. Returns
 * `undefined` when the chain ends at an entry the operator didn't migrate
 * (or breaks because a moved-to target isn't in the manifest either).
 */
function followTagAlias(
  tagId: string,
  manifest: CategoryManifest,
): CategoryManifestEntry | undefined {
  const seen = new Set<string>();
  let cursor: string | undefined = tagId;
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    const entry: CategoryManifestEntry | undefined = manifest[cursor];
    if (!entry) return undefined;
    if (!entry.movedTo) return entry;
    cursor = entry.movedTo;
  }
  return undefined;
}

function deepCoerceAemMultifieldMapsToArrays(val: unknown): unknown {
  if (val === null || typeof val !== "object") return val;
  if (Array.isArray(val)) {
    return val.map((x) => deepCoerceAemMultifieldMapsToArrays(x));
  }
  const o = val as Record<string, unknown>;
  if (isAemMultifieldItemMap(o)) {
    const keys = Object.keys(o).filter((k) => k !== "_key");
    keys.sort(multifieldItemOrder);
    return keys.map((ik) => deepCoerceAemMultifieldMapsToArrays(o[ik]));
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    out[k] = deepCoerceAemMultifieldMapsToArrays(v) as unknown;
  }
  return out;
}

// Transform a mapped component into an inline object. Children are recursively
// inlined (each with a stable _key). Used for pageBuilder items and nested refs.
function transformInline(node: AemNode, jcrPath: string, ctx: TransformContext): Record<string, unknown> {
  const nodeResourceType = typeof node["sling:resourceType"] === "string"
    ? (node["sling:resourceType"] as string)
    : undefined;
  const optedInHintKeys = nodeResourceType
    ? ctx.authoringHints.get(nodeResourceType)
    : undefined;
  const out: Record<string, unknown> = {};

  if (ctx.visited.has(node)) {
    ctx.audit.bail(jcrPath, "cycle", ctx.depth);
    return { __truncated: "cycle", jcrPath };
  }
  ctx.visited.add(node);

  for (const [key, value] of Object.entries(node)) {
    if (JCR_METADATA.has(key) || AEM_DIALOG_RUNTIME_KEYS.has(key)) continue;
    if (isChildNode(value)) {
      const outKey = sanityPropertyKeyFromAemChild(value, key);
      if (!isValidSanityAttributeKey(outKey)) continue;
      if (out[outKey] !== undefined) continue;
      const childPath = `${jcrPath}/${key}`;
      if (ctx.depth + 1 > MAX_DEPTH) {
        ctx.audit.bail(childPath, "maxDepth", ctx.depth + 1);
        out[outKey] = { __truncated: "maxDepth", jcrPath: childPath };
        continue;
      }
      const inline = transformInline(value, childPath, { ...ctx, depth: ctx.depth + 1 });
      out[outKey] = {
        ...inline,
        _key: stableKey(asString(value["jcr:uuid"]), childPath),
      };
    } else {
      // AEM authoring hints (e.g. `cq:panelTitle` on accordion children)
      // carry meaningful content but live outside the dialog. Lift them
      // only for components opted in via `aem-component-hints.json` so
      // the schema's declared field set stays tight — colon-bearing keys
      // on non-opted components fall through to `isValidSanityAttributeKey`
      // and get dropped as before.
      if (optedInHintKeys?.has(key)) {
        const hintKey = AEM_AUTHORING_HINTS.get(key);
        if (hintKey && out[hintKey] === undefined) {
          out[hintKey] = value;
        }
        continue;
      }
      // Allowlisted AEM-authored colon-bearing properties (today: `cq:tags`)
      // get camelCased to match the Sanity field name the schema mapper
      // produced from the dialog's `name="./cq:tags"`. Without this they'd
      // fall through to `isValidSanityAttributeKey` and silently drop.
      if (AEM_AUTHORED_COLON_KEYS.has(key)) {
        const renamed = toCamelCase(key);
        if (renamed && out[renamed] === undefined) {
          out[renamed] = value;
        }
        continue;
      }
      if (!isValidSanityAttributeKey(key)) continue;
      if (out[key] !== undefined) continue;
      out[key] = value;
    }
  }

  return deepCoerceAemMultifieldMapsToArrays(out) as Record<string, unknown>;
}

// Walk the tree, collect every node whose sling:resourceType maps to a
// sanityType. Stops descending once a mapped node is found — its children are
// inlined by transformInline. Unmapped containers (page, responsivegrid, etc.)
// are transparently descended through.
function collectPageBuilder(
  root: AemNode,
  rootPath: string,
  ctx: TransformContext,
  filter: Set<string> | undefined,
  exceptions: Set<string>,
): PageBuilderItem[] {
  const out: PageBuilderItem[] = [];
  const stack: Array<{ node: AemNode; jcrPath: string }> = [{ node: root, jcrPath: rootPath }];
  const seen = new Set<string>();

  while (stack.length > 0) {
    const frame = stack.pop()!;
    if (seen.has(frame.jcrPath)) continue;
    seen.add(frame.jcrPath);

    const resourceType = asString(frame.node["sling:resourceType"]);
    if (resourceType && exceptions.has(resourceType)) {
      // Explicitly ignored resource type: skip this node and its subtree.
      continue;
    }
    if (resourceType && ctx.pageShellResourceTypes.has(resourceType)) {
      // Declared page-shell (the `jcr:content` node of an authored page).
      // The shell's dialog values are already lifted to the document's
      // `pageProperties` field by `derivePageProperties`, and the schema
      // excludes the shell type from `pageBuilder.of[]`. Walk through
      // transparently so `jcr:content/root/...` body components still get
      // collected as blocks.
      const entries = Object.entries(frame.node);
      for (let i = entries.length - 1; i >= 0; i--) {
        const [key, value] = entries[i]!;
        if (isChildNode(value)) {
          stack.push({ node: value, jcrPath: `${frame.jcrPath}/${key}` });
        }
      }
      continue;
    }
    const entry = resourceType ? ctx.registry.get(resourceType) : undefined;

    if (entry?.sanityType && (!filter || filter.has(resourceType!))) {
      const inlineCtx: TransformContext = {
        ...ctx,
        depth: 0,
        visited: new WeakSet(),
      };
      const containerEntry = resourceType ? ctx.containers.get(resourceType) : undefined;

      // Container components carry two shapes in the same JCR node: dialog
      // fields (handled by transformInline) AND drop-zone child components
      // (each itself an AEM component with its own sling:resourceType).
      // Strip those child keys out before transformInline so they don't
      // pollute the dialog-field area; we re-collect them below as
      // pageBuilder-style blocks under `childrenField`.
      const containerChildKeys = containerEntry
        ? collectContainerChildKeys(frame.node)
        : null;

      // Named-slot children: direct child nodes that carry their own
      // sling:resourceType under a JCR key that isn't a declared dialog
      // field and isn't already claimed by container logic. e.g.
      // `media-paragraph` has a `content` child that's itself a full
      // `aem-integration/components/content` component. We emit these as
      // single nested blocks under the same JCR key so the Studio shows
      // them as typed subfields rather than raw "Unknown field" blobs.
      // Dialog-field collisions leave the dialog field in place (dialog
      // wins).
      const slotKeys = collectSlotKeys(frame.node, containerChildKeys);
      const stripAll = [
        ...(containerChildKeys ?? []),
        ...slotKeys,
      ];
      const nodeForInline = stripAll.length > 0
        ? stripKeys(frame.node, stripAll)
        : frame.node;

      const inline = transformInline(nodeForInline, frame.jcrPath, inlineCtx);
      splitAemFileUploadDamPaths(inline, entry.fieldNames);
      coerceFieldTypes(inline, entry.fieldTypes, frame.jcrPath, ctx);

      // Group sibling slot keys by their logical base. AEM auto-names
      // repeated authored instances of the same child (`content`,
      // `content1732069919C`, `content…CopyCopy`), so a single logical slot
      // appears under many JCR keys. Schema-side discovery collapses these to
      // ONE field (`slot-array` when authored repeatedly, else
      // `slot-reference`); mirror that here so the migrated data matches the
      // emitted schema and the attribute count stays flat. Field names are
      // restricted (/^[A-Za-z]+[0-9A-Za-z_]*$/), so camelCase the base the
      // same way the emitter does.
      const slotGroups = new Map<string, string[]>();
      for (const slotKey of slotKeys) {
        const outKey = toCamelCase(normalizeSlotBase(slotKey)) || slotKey;
        const keys = slotGroups.get(outKey);
        if (keys) keys.push(slotKey);
        else slotGroups.set(outKey, [slotKey]);
      }
      for (const [outKey, groupKeys] of slotGroups) {
        const childItems: PageBuilderItem[] = [];
        for (const slotKey of groupKeys) {
          const child = frame.node[slotKey] as AemNode;
          childItems.push(
            ...collectPageBuilder(
              child,
              `${frame.jcrPath}/${slotKey}`,
              ctx,
              filter,
              exceptions,
            ),
          );
        }
        // The schema decides array-vs-single (global view, recorded in the
        // registry); obey it. `slot-array` → always an array, even for a
        // single authored instance, so the shape is stable across pages with
        // different instance counts. A lone `slot-reference` carries one
        // inline block; if more than one surfaced (container-of-containers,
        // or instances the registry didn't model as an array) keep them as an
        // array rather than dropping data.
        const declaredType = entry.fieldTypes.get(outKey)?.type;
        if (declaredType === "slot-array") {
          inline[outKey] = childItems;
        } else if (childItems.length === 1) {
          inline[outKey] = childItems[0];
        } else if (childItems.length > 1) {
          inline[outKey] = childItems;
        }
      }

      if (containerEntry && containerChildKeys) {
        // Emit one nested pageBuilder block per AEM component found in the
        // container's subtree — descending through `nt:unstructured` layout
        // wrappers (the responsive-grid pattern) so the actual content
        // surfaces at the top level of `childrenField` rather than being
        // hidden inside an undeclared wrapper hierarchy.
        const items: PageBuilderItem[] = [];
        for (const containerItem of collectContainerItems(frame.node, frame.jcrPath)) {
          const childItems = collectPageBuilder(
            containerItem.node,
            containerItem.jcrPath,
            ctx,
            filter,
            exceptions,
          );
          items.push(...childItems);
        }
        if (containerEntry.flatten) {
          // Layout-only container — drop the wrapper and emit its items
          // directly in the parent's pageBuilder array. Without this, deeply
          // nested AEM responsive-grid layouts (container → container →
          // container → …) produce block-in-block trees that hit Sanity's
          // 20-level attribute-depth limit at import time.
          out.push(...items);
          ctx.audit.tick();
          continue;
        }
        inline[containerEntry.childrenField] = items;
      }

      out.push({
        _type: entry.sanityType,
        _key: stableKey(asString(frame.node["jcr:uuid"]), frame.jcrPath),
        ...inline,
      });
      ctx.audit.tick();
      const drift = diffProps(frame.node, entry, ctx.authoringHints);
      if (drift.length > 0) ctx.audit.unknownProps(entry.sanityType, frame.jcrPath, drift);
      continue;
    }

    if (resourceType && !entry?.sanityType) {
      ctx.audit.unknownType(resourceType, frame.jcrPath);
    }

    const entries = Object.entries(frame.node);
    for (let i = entries.length - 1; i >= 0; i--) {
      const [key, value] = entries[i]!;
      if (isChildNode(value)) {
        stack.push({ node: value, jcrPath: `${frame.jcrPath}/${key}` });
      }
    }
  }

  return out;
}

// Slim audit. Tracks: unknown resource types (with a few example paths),
// unknown props per mapped component, transform bails. One JSON file per run.
interface Audit {
  tick(): void;
  unknownType(resourceType: string, path: string): void;
  unknownProps(component: string, path: string, props: Array<{ prop: string; value: unknown }>): void;
  bail(path: string, reason: "maxDepth" | "cycle", depth: number): void;
  /**
   * An authored `cq:tags` value referenced an AEM tag id that isn't in the
   * category manifest. Either the operator hasn't added the relevant
   * namespace to `aem-tag-roots`, or the AEM tag was deleted after content
   * was authored. The reference is dropped and surfaced here so the
   * operator can decide which case applies.
   */
  unresolvedTagRef(tagId: string, path: string): void;
  /**
   * A page's `jcr:content` carries a `sling:resourceType` + `cq:template`
   * pair that doesn't appear in `aem-page-components.json` (or matches a
   * declared page-component but with an undeclared template). The doc
   * falls back to the generic `page` type — surface the pair so the
   * operator can add it to the config and re-run `migrate:schema`.
   */
  unknownPageTemplate(
    resourceType: string | undefined,
    cqTemplate: string | undefined,
    path: string,
  ): void;
  report(): unknown;
}

function createAudit(maxExamples = 3): Audit {
  let totalDocs = 0;
  let totalFindings = 0;
  const unknownTypes = new Map<string, { hits: number; examples: string[] }>();
  const unknownProps = new Map<string, Map<string, Array<{ path: string; value: unknown }>>>();
  const bails: Array<{ path: string; reason: string; depth: number }> = [];
  const unresolvedTags = new Map<string, string[]>();
  const unknownPageTemplates = new Map<
    string,
    { resourceType: string | undefined; cqTemplate: string | undefined; hits: number; examples: string[] }
  >();

  function bump<T>(list: T[], item: T): void {
    if (list.length < maxExamples) list.push(item);
  }

  return {
    tick: () => void totalDocs++,
    unknownType(resourceType, path) {
      totalFindings++;
      let entry = unknownTypes.get(resourceType);
      if (!entry) {
        entry = { hits: 0, examples: [] };
        unknownTypes.set(resourceType, entry);
      }
      entry.hits++;
      bump(entry.examples, path);
    },
    unknownProps(component, path, props) {
      totalFindings++;
      let comp = unknownProps.get(component);
      if (!comp) {
        comp = new Map();
        unknownProps.set(component, comp);
      }
      for (const { prop, value } of props) {
        let examples = comp.get(prop);
        if (!examples) {
          examples = [];
          comp.set(prop, examples);
        }
        bump(examples, { path, value });
      }
    },
    bail(path, reason, depth) {
      totalFindings++;
      bump(bails, { path, reason, depth });
    },
    unresolvedTagRef(tagId, path) {
      totalFindings++;
      let examples = unresolvedTags.get(tagId);
      if (!examples) {
        examples = [];
        unresolvedTags.set(tagId, examples);
      }
      bump(examples, path);
    },
    unknownPageTemplate(resourceType, cqTemplate, path) {
      totalFindings++;
      const key = `${resourceType ?? "<none>"}|${cqTemplate ?? "<none>"}`;
      let entry = unknownPageTemplates.get(key);
      if (!entry) {
        entry = { resourceType, cqTemplate, hits: 0, examples: [] };
        unknownPageTemplates.set(key, entry);
      }
      entry.hits++;
      bump(entry.examples, path);
    },
    report() {
      return {
        summary: {
          totalDocs,
          totalFindings,
          unknownTypes: unknownTypes.size,
          componentsWithUnknownProps: unknownProps.size,
          transformBails: bails.length,
          unresolvedTagRefs: unresolvedTags.size,
          unknownPageTemplates: unknownPageTemplates.size,
        },
        unknownResourceTypes: [...unknownTypes.entries()].map(([resourceType, { hits, examples }]) => ({
          resourceType,
          hits,
          examples,
        })),
        unknownPropsByComponent: Object.fromEntries(
          [...unknownProps.entries()].map(([component, props]) => [
            component,
            [...props.entries()].map(([prop, examples]) => ({ prop, examples })),
          ]),
        ),
        unresolvedTagRefs: [...unresolvedTags.entries()].map(([tagId, examples]) => ({
          tagId,
          examples,
        })),
        unknownPageTemplates: [...unknownPageTemplates.values()].map((e) => ({
          resourceType: e.resourceType,
          cqTemplate: e.cqTemplate,
          hits: e.hits,
          examples: e.examples,
        })),
        transformBails: bails,
      };
    },
  };
}

function diffProps(
  node: AemNode,
  entry: NormalizedRegistryEntry | undefined,
  authoringHints: AuthoringHintConfig,
): Array<{ prop: string; value: unknown }> {
  if (!entry?.fieldNames?.length) return [];
  const expected = new Set(entry.fieldNames);
  const nodeResourceType = typeof node["sling:resourceType"] === "string"
    ? (node["sling:resourceType"] as string)
    : undefined;
  const optedInHints = nodeResourceType ? authoringHints.get(nodeResourceType) : undefined;
  const out: Array<{ prop: string; value: unknown }> = [];
  for (const [key, value] of Object.entries(node)) {
    if (JCR_METADATA.has(key) || AEM_DIALOG_RUNTIME_KEYS.has(key)) continue;
    // Skip AEM keys this component opted into — they're lifted to the
    // declared Sanity field, not stray.
    if (optedInHints?.has(key)) continue;
    if (expected.has(key)) continue;
    if (typeof value === "object" && value !== null && !Array.isArray(value)) continue;
    out.push({ prop: key, value });
  }
  return out;
}

// Page title: prefer explicit AEM page properties, fall back to slug, then
// last path segment.
function derivePageTitle(tree: AemNode, slug: string | undefined, jcrPath: string): string {
  const content = isChildNode(tree["jcr:content"]) ? (tree["jcr:content"] as AemNode) : undefined;
  const candidates = [
    content ? asString(content["pageTitle"]) : undefined,
    content ? asString(content["jcr:title"]) : undefined,
    content ? asString(content["navTitle"]) : undefined,
    slug,
    jcrPath.split("/").filter(Boolean).pop(),
  ];
  for (const c of candidates) {
    if (c && c.trim().length > 0) return c.trim();
  }
  return jcrPath;
}

/**
 * Page-level `cq:tags` live on the `jcr:content` (cq:PageContent) node, not
 * on any content component. Lift them onto the page doc the same way we
 * lift the page title — resolved through the categories manifest produced
 * by `aem-tags`. Returns `undefined` when there are no tags or none
 * resolved, so the field can be omitted entirely on tag-less pages.
 */
function derivePageTags(
  tree: AemNode,
  ctx: TransformContext,
  jcrPath: string,
): Array<{ _type: "reference"; _key: string; _ref: string }> | undefined {
  const content = isChildNode(tree["jcr:content"]) ? (tree["jcr:content"] as AemNode) : undefined;
  if (!content) return undefined;
  const raw = content["cq:tags"];
  if (raw === undefined || raw === null) return undefined;
  const refs = resolveTagReferences(
    raw,
    ctx.categoryManifest,
    `${jcrPath}/jcr:content::cq:tags`,
    ctx.audit,
  );
  if (!refs || refs.length === 0) return undefined;
  return refs;
}

/**
 * Lift the page-shell dialog values from `jcr:content` into a single
 * `pageProperties` object. Mirrors `transformInline`'s rules in spirit
 * (drop JCR metadata, drop dialog-runtime bookkeeping, camelCase
 * colon-bearing keys) but skips child nodes — those are either the
 * `root` body (walked separately by `collectPageBuilder`), `cq:tags` /
 * `cq:featuredimage` (lifted explicitly), or genuine drift surfaced via
 * `diffProps`.
 *
 * The resulting object is type-coerced against the page-component's
 * registry entry so `"true"` / `"false"` strings become booleans, HTML
 * becomes Portable Text, etc. — same pipeline as every other component.
 */
function derivePageProperties(
  content: AemNode,
  pageComponentResourceType: string,
  ctx: TransformContext,
  jcrPath: string,
): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(content)) {
    if (JCR_METADATA.has(key) || AEM_DIALOG_RUNTIME_KEYS.has(key)) continue;
    if (JCR_CONTENT_BOOKKEEPING_KEYS.has(key)) continue;
    // Carve-outs: `root` is the page body (handled separately), and these
    // properties have dedicated fields on the doc.
    if (key === "root" || key === "cq:featuredimage" || key === "cq:tags" || key === "cq:template") continue;
    if (isChildNode(value)) continue;
    if (AEM_AUTHORED_COLON_KEYS.has(key)) {
      const renamed = toCamelCase(key);
      if (renamed && out[renamed] === undefined) out[renamed] = value;
      continue;
    }
    if (!isValidSanityAttributeKey(key)) continue;
    if (out[key] !== undefined) continue;
    out[key] = value;
  }

  const entry = ctx.registry.get(pageComponentResourceType);
  if (entry && entry.fieldTypes.size > 0) {
    coerceFieldTypes(out, entry.fieldTypes, `${jcrPath}/jcr:content`, ctx);
  }

  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Lift `jcr:content/cq:featuredimage` into a Sanity `image` field. The DAM
 * `fileReference` is moved to `fileReferenceAemPath` so `aem-assets` can
 * rewrite it to a real Sanity asset ref in its phase-4 pass — same shape
 * the fileupload widget produces via `splitAemFileUploadDamPaths`.
 *
 * Returns `undefined` when the node is missing or carries no DAM path
 * (so the field can be omitted entirely rather than emitting an empty
 * `{}` that would show up as a stray empty image in the Studio).
 */
function derivePageFeaturedImage(content: AemNode): Record<string, unknown> | undefined {
  const node = content["cq:featuredimage"];
  if (!isChildNode(node)) return undefined;
  const fileRef = asString((node as AemNode)["fileReference"]);
  if (!fileRef || !fileRef.startsWith("/content/dam/")) return undefined;
  // Hand the DAM path to aem-assets via the same `*AemPath` convention the
  // fileupload mapping uses. The base `fileReference` is intentionally
  // omitted — aem-assets fills it in with a Sanity asset ref later.
  return {
    [`fileReference${AEM_FILE_UPLOAD_PATH_FIELD_SUFFIX}`]: fileRef,
  };
}

/**
 * Load the page-templates manifest emitted by `migrate:schema`. Returns an
 * empty index when the file is absent — operators who haven't declared
 * any page components see today's behavior (one generic `page` doc type).
 */
function loadPageTemplatesManifest(
  file: string,
): Map<string, Map<string, PageTemplateManifestEntry>> {
  const out = new Map<string, Map<string, PageTemplateManifestEntry>>();
  if (!existsSync(file)) return out;
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (err) {
    console.error(
      `[transform] page-templates manifest at ${file} is unparseable; per-template doc types will not be applied. ${(err as Error).message}`,
    );
    return out;
  }
  const entries =
    raw && typeof raw === "object" && Array.isArray((raw as { entries?: unknown }).entries)
      ? (raw as { entries: PageTemplateManifestEntry[] }).entries
      : [];
  for (const e of entries) {
    if (!e || typeof e !== "object") continue;
    if (
      typeof e.pageComponentResourceType !== "string" ||
      typeof e.cqTemplate !== "string" ||
      typeof e.sanityType !== "string"
    ) {
      continue;
    }
    let inner = out.get(e.pageComponentResourceType);
    if (!inner) {
      inner = new Map();
      out.set(e.pageComponentResourceType, inner);
    }
    inner.set(e.cqTemplate, e);
  }
  return out;
}

function main(): void {
  const timer = startTimer();
  const c = createColors({ stream: process.stderr });
  const outputDir = resolve(process.env.OUTPUT_DIR ?? "./output");
  const registryFile = resolve(getFlag("--registry") ?? "./content-type-registry.json");
  const exceptionsFile = resolve(
    process.env.AEM_COMPONENT_EXCEPTIONS_FILE ?? "./aem-component-exceptions",
  );
  const exceptions = readExceptionResourceTypes(exceptionsFile);
  const include = getFlag("--include")?.split(",").filter(Boolean);
  const allowed = include ? new Set(include) : undefined;

  const containersFile = resolve(
    process.env.AEM_COMPONENT_CONTAINERS_FILE ?? "./aem-component-containers.json",
  );
  const containers = loadContainerConfig({ file: containersFile });

  const hintsFile = resolve(
    process.env.AEM_COMPONENT_HINTS_FILE ?? "./aem-component-hints.json",
  );
  const authoringHints = loadAuthoringHintConfig({ file: hintsFile });

  // Field name for page-builder blocks on emitted page docs. Must match the
  // array-type / field name `migrate:schema` generated — both CLIs read the
  // same env var, so a single tenant .env keeps them in sync.
  const pageBuilderFieldName = resolvePageBuilderName(process.env);
  if (pageBuilderFieldName !== "pageBuilder") {
    console.error(
      `[transform] page-builder field name: ${pageBuilderFieldName} (MIGRATION_PAGE_BUILDER_NAME)`,
    );
  }

  const slugStrategy = resolveSlugStrategy(process.env);
  if (slugStrategy !== "segment") {
    console.error(`[transform] slug strategy: ${slugStrategy} (MIGRATION_SLUG_STRATEGY)`);
  }

  const registry = loadRegistry(registryFile);
  const contentDir = aemCacheContentRoot(outputDir);
  const cleanDir = join(outputDir, "cache", "clean");
  mkdirSync(cleanDir, { recursive: true });

  // Categories manifest is optional — when missing, tagfield values surface
  // as unresolved-tag-ref findings in the audit. The full migration order
  // is: aem-extract → aem-tags → aem-transform, but `transform` should still
  // run usefully (just without tag resolution) when an operator hasn't yet
  // added a tag-roots file. Loading the manifest here means transform stays
  // a single non-AEM-touching pass.
  const categoriesManifestFile = join(outputDir, "cache", "categories", "manifest.json");
  let categoryManifest: CategoryManifest = {};
  if (existsSync(categoriesManifestFile)) {
    try {
      categoryManifest = JSON.parse(
        readFileSync(categoriesManifestFile, "utf8"),
      ) as CategoryManifest;
    } catch (err) {
      console.error(
        `[transform] categories manifest at ${categoriesManifestFile} is unparseable; tag references will be dropped. ${(err as Error).message}`,
      );
    }
  }
  const categoryCount = Object.values(categoryManifest).filter(
    (e) => !e.movedTo,
  ).length;
  if (categoryCount > 0) {
    console.error(
      `[transform] resolving cq:tags against ${categoryCount} categor${categoryCount === 1 ? "y" : "ies"} from ${categoriesManifestFile}`,
    );
  }

  const rawFiles = listExtractedContentFiles(outputDir);
  if (rawFiles.length === 0) {
    console.error(`No extract cache in ${contentDir}. Run \`aem-extract\` first.`);
    process.exit(2);
  }

  console.error(`[transform] ${rawFiles.length} extract file(s) → ${cleanDir}`);
  if (exceptions.size > 0) {
    console.error(
      `[transform] applying ${exceptions.size} exception(s) from ${exceptionsFile}`,
    );
  }
  if (containers.size > 0) {
    console.error(
      `[transform] container behavior for ${containers.size} resource type(s) from ${containersFile}`,
    );
  }
  if (authoringHints.size > 0) {
    console.error(
      `[transform] authoring-hint opt-ins for ${authoringHints.size} resource type(s) from ${hintsFile}`,
    );
  }

  // Per-template document manifest from migrate:schema. When absent or
  // empty, every page falls back to the generic `_type: "page"` doc, which
  // is today's behavior — purely additive for tenants not using page-shell
  // declarations.
  const pageTemplatesFile = join(outputDir, "cache", "page-templates.json");
  const pageTemplates = loadPageTemplatesManifest(pageTemplatesFile);
  const declaredPageComponentResourceTypes = new Set(pageTemplates.keys());
  if (pageTemplates.size > 0) {
    let templateCount = 0;
    for (const m of pageTemplates.values()) templateCount += m.size;
    console.error(
      `[transform] applying ${templateCount} per-template doc type${templateCount === 1 ? "" : "s"} from ${pageTemplatesFile}`,
    );
  }

  const audit = createAudit();
  let pagesWritten = 0;
  let blocksEmitted = 0;
  let missingRelativePath = 0;

  for (const { absPath, relPath } of rawFiles) {
    let raw: RawFile;
    try {
      raw = JSON.parse(readFileSync(absPath, "utf8")) as RawFile;
    } catch (err) {
      console.error(`[transform] skip ${relPath}: ${(err as Error).message}`);
      continue;
    }

    const { jcrPath, slug, tree } = raw;
    if (jcrPath.startsWith("/content/cq:tags")) {
      continue;
    }
    const segmentSlug = slug ?? jcrPath.split("/").filter(Boolean).pop() ?? jcrPath;
    let currentSlug = segmentSlug;
    if (slugStrategy === "path") {
      if (raw.relativePath) currentSlug = raw.relativePath;
      else missingRelativePath++;
    }

    const ctx: TransformContext = {
      visited: new WeakSet(),
      depth: 0,
      registry,
      containers,
      authoringHints,
      categoryManifest,
      audit,
      pageShellResourceTypes: declaredPageComponentResourceTypes,
    };

    let pageBuilder: PageBuilderItem[];
    try {
      pageBuilder = collectPageBuilder(tree, jcrPath, ctx, allowed, exceptions);
    } catch (err) {
      console.error(`[transform] ${jcrPath}: ${(err as Error).message}`);
      continue;
    }

    // Decide the document _type: per-template (when jcr:content's page
    // component + cq:template pair is declared) or the generic `page`
    // fallback. The decision is independent of `_id` derivation —
    // `pathToDocId` is `_type`-agnostic, so introducing per-template types
    // doesn't orphan previously imported docs.
    const contentNode = isChildNode(tree["jcr:content"])
      ? (tree["jcr:content"] as AemNode)
      : undefined;
    const pageRt = contentNode ? asString(contentNode["sling:resourceType"]) : undefined;
    const cqTemplate = contentNode ? asString(contentNode["cq:template"]) : undefined;
    const templateMatch =
      pageRt && cqTemplate
        ? pageTemplates.get(pageRt)?.get(cqTemplate)
        : undefined;

    // Surface mismatches as audit findings so the operator can extend
    // `aem-page-components.json` and re-run migrate:schema. We only flag
    // the case where the page-component IS declared (so we know the
    // operator considers it a page-shell) but the specific template
    // isn't listed — undeclared resource types are someone else's
    // problem (they'd already surface in `unknownResourceTypes` if their
    // content actually had a body).
    if (
      !templateMatch &&
      pageRt &&
      declaredPageComponentResourceTypes.has(pageRt)
    ) {
      audit.unknownPageTemplate(pageRt, cqTemplate, jcrPath);
    }

    const pageDoc: PageDoc = {
      _id: pathToDocId(jcrPath),
      _type: templateMatch ? templateMatch.sanityType : "page",
      title: derivePageTitle(tree, slug, jcrPath),
      slug: { _type: "slug", current: currentSlug },
      [pageBuilderFieldName]: pageBuilder,
    };
    const pageTags = derivePageTags(tree, ctx, jcrPath);
    if (pageTags) pageDoc.tags = pageTags;

    if (templateMatch && contentNode) {
      const pageProperties = derivePageProperties(
        contentNode,
        templateMatch.pageComponentResourceType,
        ctx,
        jcrPath,
      );
      if (pageProperties) pageDoc.pageProperties = pageProperties;
      const featuredImage = derivePageFeaturedImage(contentNode);
      if (featuredImage) pageDoc.featuredImage = featuredImage;
      pageDoc.cqTemplate = templateMatch.cqTemplate;
    }

    const outFile = join(cleanDir, relPath);
    mkdirSync(dirname(outFile), { recursive: true });
    writeFileSync(
      outFile,
      JSON.stringify({ jcrPath, slug: currentSlug, docs: [pageDoc] }, null, 2) + "\n",
      "utf8",
    );
    pagesWritten++;
    blocksEmitted += pageBuilder.length;
  }

  if (missingRelativePath > 0) {
    console.error(
      `[transform] ${missingRelativePath} page(s) had no relativePath in the raw cache — slug fell back to the last path segment. ` +
        `Raw files predate slug-path capture or came from absolute roots entries outside any @base; ` +
        `re-run aem-extract --overwrite to record base-relative paths.`,
    );
  }

  const report = audit.report() as {
    summary: { totalFindings: number };
    unknownResourceTypes: Array<{ resourceType: string; hits: number; examples: string[] }>;
    unknownPageTemplates: Array<{
      resourceType: string | undefined;
      cqTemplate: string | undefined;
      hits: number;
      examples: string[];
    }>;
  };
  const reportFile = join(outputDir, "cache", "transform-report.json");
  writeFileSync(reportFile, JSON.stringify(report, null, 2) + "\n", "utf8");

  console.error(c.dim("────────────────────────────────────────"));
  console.error(`Pages:     ${c.green(pagesWritten)}`);
  console.error(`Blocks:    ${c.green(blocksEmitted)}`);
  console.error(
    `Findings:  ${report.summary.totalFindings > 0 ? c.yellow(report.summary.totalFindings) : c.green(0)}  ${c.dim(`→ ${reportFile}`)}`,
  );
  console.error(`Elapsed:   ${c.dim(timer.elapsed())}`);

  const unmapped = report.unknownResourceTypes.filter(
    (u) => !AEM_STRUCTURAL_PASSTHROUGH_TYPES.has(u.resourceType),
  );
  if (unmapped.length > 0) {
    const typeWidth = Math.min(60, unmapped.reduce((w, u) => Math.max(w, u.resourceType.length), 0));
    console.error("");
    console.error(
      c.yellow(
        `${unmapped.length} unmapped AEM resource type(s) — content dropped. Add to aem-component-paths, then re-run migrate:schema + transform + import:`,
      ),
    );
    unmapped
      .sort((a, b) => b.hits - a.hits)
      .forEach((u, i) => {
        const n = c.dim(String(i + 1).padStart(2, " ") + ".");
        const rt = u.resourceType.padEnd(typeWidth, " ");
        const count = c.yellow(`${u.hits}×`.padStart(5, " "));
        const pathLine = `/apps/${u.resourceType}`;
        console.error(`  ${n} ${rt}  ${count}  ${c.dim(pathLine)}`);
        const firstExample = u.examples[0];
        if (firstExample) console.error(`      ${c.dim(`e.g. ${firstExample}`)}`);
      });
  }

  if (report.unknownPageTemplates && report.unknownPageTemplates.length > 0) {
    console.error("");
    console.error(
      c.yellow(
        `${report.unknownPageTemplates.length} undeclared page template${report.unknownPageTemplates.length === 1 ? "" : "s"} — falling back to generic "page" doc. Add to aem-page-components.json, then re-run migrate:schema + transform + import:`,
      ),
    );
    report.unknownPageTemplates
      .sort((a, b) => b.hits - a.hits)
      .forEach((u, i) => {
        const n = c.dim(String(i + 1).padStart(2, " ") + ".");
        const count = c.yellow(`${u.hits}×`.padStart(5, " "));
        console.error(
          `  ${n} ${u.resourceType ?? "<no sling:resourceType>"}  ${count}  ${c.dim(u.cqTemplate ?? "<no cq:template>")}`,
        );
        const firstExample = u.examples[0];
        if (firstExample) console.error(`      ${c.dim(`e.g. ${firstExample}`)}`);
      });
  }
}

function getFlag(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

try {
  main();
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
