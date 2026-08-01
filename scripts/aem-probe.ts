#!/usr/bin/env node
/**
 * Quick connectivity check against the configured AEM source. Useful for
 * verifying AEM as a Cloud Service Service Credentials before kicking off a
 * full migration — surfaces IMS exchange failures, base-URL typos, and ACL
 * problems in seconds instead of after a long `aem-extract` run.
 *
 * Three modes (driven by the path arg):
 *
 *   1. No path → auth check only. Resolves config (which exchanges Service
 *      Credentials with Adobe IMS when AEM_SERVICE_CREDENTIALS_FILE /
 *      AEM_SERVICE_CREDENTIALS is set) and prints the resolved auth banner.
 *      Exits 0 if a usable bearer/basic auth came out of the resolver.
 *
 *   2. Content path (`/content/...`) → fetches the `.infinity.json` for that
 *      path and reports HTTP status, response size, top-level keys, and any
 *      depth-5 truncation markers detected. This is the same call
 *      `aem-extract` makes per page-root.
 *
 *   3. Component path (`/apps/...`) → fetches the component's
 *      `_cq_dialog.infinity.json` — i.e. its Granite UI dialog. Same call
 *      `aem-to-sanity-schema` makes per entry in `aem-component-paths`.
 *      Useful for verifying a dialog is readable + sanity-checking its
 *      `items` tree before kicking off `migrate:schema`.
 *
 *   Exits 0 on a successful fetch, non-zero on any error.
 *
 * Env: same as `aem-extract` — `dotenv/config` from the cwd. Use a tenant
 * folder so its `.env` is loaded:
 *
 *   cd tenants/<your-tenant>
 *   pnpm exec tsx ../../scripts/aem-probe.ts                                  # auth only
 *   pnpm exec tsx ../../scripts/aem-probe.ts /content/<site>/<locale>/home    # auth + fetch
 *   pnpm exec tsx ../../scripts/aem-probe.ts /content/... --save ./out.json   # also save the body
 *
 * `--save` (with or without a path arg) writes the raw `.infinity.json` body
 * to disk. With no path, defaults to `<cwd>/probe-<sanitized-jcrpath>.json`.
 */
import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import {
  AemFetchError,
  createLogger,
  fetchInfinityJson,
  loadDialogOverrideConfig,
  logStartupBanner,
  resolveConfig,
  resolveEffectiveDialog,
  type DialogNode,
} from "aem-to-sanity-core";

async function main(): Promise<void> {
  // Positional: first non-flag arg is the JCR path. Flags: --save [<path>],
  // --verbose. Kept simple — single positional, two flags — so callers don't
  // have to think about ordering.
  const argv = process.argv.slice(2);
  const verbose = argv.includes("--verbose") || argv.includes("-v");
  const saveIdx = argv.findIndex((a) => a === "--save");
  const saveRequested = saveIdx !== -1;
  const saveTarget =
    saveRequested && argv[saveIdx + 1] && !argv[saveIdx + 1]!.startsWith("--")
      ? argv[saveIdx + 1]
      : undefined;
  // The first positional arg (anything that isn't a flag) is the JCR path.
  // If `--save <path>` is present, exclude the consumed save-target arg.
  const skipIndex = saveRequested && saveTarget ? saveIdx + 1 : -2;
  const probePath = argv.find(
    (a, i) => !a.startsWith("--") && a !== "-v" && i !== skipIndex,
  );
  const logger = createLogger({ level: verbose ? "debug" : "info" });

  // Step 1 — resolve config. This is where the IMS exchange happens for
  // AEMaaCS Service Credentials. Failure here means credentials are wrong,
  // not that AEM is unreachable.
  let config: Awaited<ReturnType<typeof resolveConfig>>;
  try {
    config = await resolveConfig(process.env);
  } catch (err) {
    console.error("\n✗ Config resolution failed.");
    console.error("  " + (err as Error).message);
    console.error(
      "\n  Common causes: wrong CLIENT_ID/CLIENT_SECRET in the Service Credentials JSON, " +
        "expired technical-account credentials, or AEM_AUTHOR_URL unset.",
    );
    process.exit(2);
  }

  // Step 2 — print what we resolved. The banner masks tokens (length + 4-char
  // prefix only) and shows IMS expiry when applicable.
  logStartupBanner(logger, config, { command: "aem-probe" });
  console.error("");
  console.error("✓ Config resolved. Auth ready.");

  // Step 3 — if no path arg, we're done.
  if (!probePath) {
    console.error("");
    console.error(
      "(No path arg — auth check only. Pass a JCR path as the first arg to fetch " +
        "its .infinity.json and verify the AEM endpoint is reachable.)",
    );
    return;
  }

  if (!probePath.startsWith("/")) {
    console.error(`\n✗ Path arg must be absolute (start with /). Got: ${probePath}`);
    process.exit(2);
  }

  // Step 4 — sanitize the path. Forgiving for paths the operator pasted from
  // a browser URL — strip the Sling `.html` selector and any
  // `.infinity.json` / `.<n>.json` suffix. The fetcher adds its own
  // `.infinity.json` on the bare JCR path. Also strip a trailing
  // `/_cq_dialog` so `/apps/.../foo` and `/apps/.../foo/_cq_dialog` both work.
  const sanitized = probePath
    .replace(/\.infinity\.json$/i, "")
    .replace(/\.\d+\.json$/i, "")
    .replace(/\.json$/i, "")
    .replace(/\.html$/i, "")
    .replace(/\/_cq_dialog\/?$/i, "");

  // Auto-detect: /apps/... or /libs/... is a component dialog probe;
  // anything else (typically /content/...) is a content probe. AEM stores
  // components in both `/apps` (project + AMS overrides) and `/libs` (Adobe
  // defaults), and the `sling:resourceSuperType` chain walks freely across
  // both — so a probe against an `/apps/...` path may end up resolving the
  // dialog from a `/libs/...` ancestor.
  const isDialogProbe = sanitized.startsWith("/apps/") || sanitized.startsWith("/libs/");
  const start = Date.now();

  if (isDialogProbe) {
    await probeDialogWithChain(config, logger, sanitized, {
      start,
      save: saveRequested,
      saveTarget,
    });
    return;
  }

  // Content probe — straight fetch, no chain walk.
  const fetchPath = sanitized;
  console.error("");
  console.error(`── Fetching content tree: ${config.baseUrl}${fetchPath}.infinity.json ──`);

  try {
    const tree = (await fetchInfinityJson({ config, logger }, fetchPath)) as Record<string, unknown>;
    const elapsedMs = Date.now() - start;
    const serialized = JSON.stringify(tree, null, 2);
    console.error(`✓ HTTP 200 in ${elapsedMs}ms — ${formatBytes(serialized.length)}`);
    summarizeContent(tree);

    if (saveRequested) {
      const outFile = resolveSavePath(fetchPath, saveTarget);
      mkdirSync(dirname(outFile), { recursive: true });
      writeFileSync(outFile, serialized + "\n", "utf8");
      console.error(`  saved → ${outFile}`);
    }
  } catch (err) {
    const elapsedMs = Date.now() - start;
    console.error(`✗ Fetch failed after ${elapsedMs}ms`);
    if (err instanceof AemFetchError) {
      console.error(`  kind:   ${err.kind}`);
      console.error(`  status: ${err.details?.status ?? "n/a"}`);
      console.error(`  msg:    ${err.message}`);
      if (err.details?.bodyExcerpt) {
        console.error(`  body:   ${err.details.bodyExcerpt.slice(0, 200)}`);
      }
      if (err.kind === "auth") {
        console.error(
          "\n  Credentials reached AEM but were rejected. Check that the " +
            "technical account's product profile includes the right AEM " +
            "environment + the JCR path is readable in CRXDE.",
        );
      }
    } else {
      console.error(`  ${(err as Error).message}`);
    }
    process.exit(1);
  }
}

/**
 * Probe a component's dialog using the shared core resolver
 * (`resolveEffectiveDialog`): the `sling:resourceSuperType` chain is walked
 * across `/apps` + `/libs` until a dialog is found (or the chain ends), then
 * any `aem-dialog-overrides.json` entry for the component applies — a local
 * `dialogFile` replacement and/or supplementary tabs spliced in. This is the
 * exact same resolution `aem-to-sanity-schema` uses in `migrate:schema`, so
 * what the probe shows here is what the migrator will see at runtime.
 */
async function probeDialogWithChain(
  config: Awaited<ReturnType<typeof resolveConfig>>,
  logger: ReturnType<typeof createLogger>,
  componentPath: string,
  opts: { start: number; save: boolean; saveTarget?: string },
): Promise<void> {
  console.error("");
  console.error(
    `── Resolving dialog (with supertype chain): ${config.baseUrl}${componentPath} ──`,
  );

  // Same tenant config the schema CLI loads (the probe runs with the tenant
  // folder as cwd, so the relative default matches). Keyed by resource type
  // — the loader strips the `/apps/` prefix the same way.
  const dialogOverridesFile = resolve(
    process.env.AEM_DIALOG_OVERRIDES_FILE ?? "./aem-dialog-overrides.json",
  );
  const dialogOverrides = loadDialogOverrideConfig({ file: dialogOverridesFile });
  const resourceType = componentPath.replace(/^\/(apps\/)?/, "");
  const override = dialogOverrides.get(resourceType);
  if (override) {
    console.error(`  dialog override:   entry for "${resourceType}" in ${dialogOverridesFile}`);
  }

  // Adapter from the probe's transport (raw fetchInfinityJson) to the
  // (path) => Promise<DialogNode> shape the resolver expects.
  const fetcher = (jcrPath: string): Promise<DialogNode> =>
    fetchInfinityJson({ config, logger }, jcrPath) as Promise<DialogNode>;

  try {
    const { dialog, chain, dialogFileApplied, appliedTabs } =
      await resolveEffectiveDialog(componentPath, fetcher, {
        override,
        warn: (m) => console.error(`  ⚠ ${m}`),
      });
    const resolvedPath = chain?.at(-1) ?? componentPath;
    const elapsedMs = Date.now() - opts.start;
    const serialized = JSON.stringify(dialog, null, 2);
    console.error(`✓ Dialog resolved in ${elapsedMs}ms — ${formatBytes(serialized.length)}`);
    if (dialogFileApplied) {
      console.error(`  dialog file:       ${dialogFileApplied} (replaces AEM resolution)`);
    } else {
      console.error(`  resolved at:       ${resolvedPath}`);
    }
    if (chain && chain.length > 1) {
      console.error(`  supertype chain:   ${chain.join(" → ")}`);
      console.error(
        `  (this is how AEM's runtime resolves dialogs — the schema migrator does the same.)`,
      );
    }
    if (appliedTabs && appliedTabs.length > 0) {
      console.error(
        `  supplementary tabs: ${appliedTabs.map((t) => `${t.key} (${t.position})`).join(", ")}`,
      );
    }
    summarizeDialog(dialog as Record<string, unknown>);
    if (opts.save) {
      const outFile = resolveSavePath(`${resolvedPath}/_cq_dialog`, opts.saveTarget);
      mkdirSync(dirname(outFile), { recursive: true });
      writeFileSync(outFile, serialized + "\n", "utf8");
      console.error(`  saved →            ${outFile}`);
    }
  } catch (err) {
    const elapsedMs = Date.now() - opts.start;
    console.error(`✗ Dialog resolution failed after ${elapsedMs}ms`);
    if (err instanceof AemFetchError) {
      console.error(`  kind:   ${err.kind}`);
      console.error(`  status: ${err.details?.status ?? "n/a"}`);
      console.error(`  msg:    ${err.message}`);
      if (err.details?.bodyExcerpt) {
        console.error(`  body:   ${err.details.bodyExcerpt.slice(0, 200)}`);
      }
    } else {
      console.error(`  ${(err as Error).message}`);
    }
    process.exit(1);
  }
}

function summarizeContent(tree: Record<string, unknown>): void {
  const topKeys = Object.keys(tree).slice(0, 12);
  console.error(`  top-level keys (first ${topKeys.length}): ${topKeys.join(", ")}`);
  const resourceType = tree["sling:resourceType"];
  if (typeof resourceType === "string") {
    console.error(`  sling:resourceType = ${resourceType}`);
  }
  const title = tree["jcr:title"];
  if (typeof title === "string") {
    console.error(`  jcr:title          = ${title}`);
  }
  const truncationMarkers = countTruncationMarkers(tree);
  if (truncationMarkers > 0) {
    console.error(
      `  depth-5 truncation markers: ${truncationMarkers} (aem-extract resolves these via follow-up fetches)`,
    );
  }
}

function summarizeDialog(tree: Record<string, unknown>): void {
  // Dialogs are Granite UI configs — the relevant signals are the dialog
  // title, the root container's resourceType, and the count + names of
  // top-level form fields. Tab containers nest fields one level deeper
  // (items → tab → items → field) which the schema emitter handles.
  const title = tree["jcr:title"];
  const resourceType = tree["sling:resourceType"];
  if (typeof title === "string") {
    console.error(`  jcr:title          = ${title}`);
  }
  if (typeof resourceType === "string") {
    console.error(`  sling:resourceType = ${resourceType}`);
  }
  const fields = enumerateDialogFields(tree);
  if (fields.length === 0) {
    console.error("  no `items` tree found — is this really a dialog node?");
    return;
  }
  console.error(`  dialog fields (${fields.length}):`);
  for (const f of fields.slice(0, 30)) {
    const rt = f.resourceType ? ` [${f.resourceType.replace(/^granite\/ui\/components\/coral\/foundation\//, "")}]` : "";
    const name = f.name ?? "(no name attr)";
    console.error(`    - ${f.key.padEnd(28)} ${name}${rt}`);
  }
  if (fields.length > 30) {
    console.error(`    … ${fields.length - 30} more`);
  }
}

/**
 * Walk a Granite UI dialog and emit a flat list of leaf form fields.
 *
 * Touch UI dialogs are deeply nested. The root is typically a
 * `cq/gui/components/authoring/dialog` wrapper whose children live under
 * `content.items` (not `items` directly), then containers (tabs,
 * fixedcolumns, fieldsets) nest further `items` underneath. We identify
 * leaves by the presence of a `name` attribute — every Granite form widget
 * binds to a JCR property via `name`, while containers don't.
 */
interface DialogField {
  key: string;
  name?: string;
  resourceType?: string;
}

function enumerateDialogFields(tree: unknown): DialogField[] {
  const out: DialogField[] = [];
  walkDialog(tree, out);
  return out;
}

function walkDialog(node: unknown, out: DialogField[], key?: string): void {
  if (!node || typeof node !== "object") return;
  const rec = node as Record<string, unknown>;

  // Leaf — anything with a `name` attribute is a form field bound to a JCR
  // property. Stop recursing here so we don't double-count nested widgets.
  if (typeof rec.name === "string") {
    out.push({
      key: key ?? "?",
      name: rec.name,
      resourceType:
        typeof rec["sling:resourceType"] === "string" ? (rec["sling:resourceType"] as string) : undefined,
    });
    return;
  }

  // Container — children live under `items` directly (legacy) OR under
  // `content.items` (Touch UI dialog wrapper). Try both.
  const directItems = rec.items;
  const contentItems =
    rec.content && typeof rec.content === "object"
      ? (rec.content as Record<string, unknown>).items
      : undefined;
  const items = (directItems ?? contentItems) as Record<string, unknown> | undefined;
  if (!items || typeof items !== "object") return;
  for (const [k, child] of Object.entries(items)) {
    walkDialog(child, out, k);
  }
}

function resolveSavePath(jcrPath: string, target: string | undefined): string {
  if (target) {
    return isAbsolute(target) ? target : resolve(process.cwd(), target);
  }
  // Default: <cwd>/probe-<jcrpath-with-slashes-as-underscores>.json — same
  // naming idea as `aem-extract`'s output/cache/aem/content/* so the operator can
  // eyeball-correlate, but in cwd to avoid mixing with a real extract run.
  const sanitized = jcrPath.replace(/^\/+/, "").replace(/[^A-Za-z0-9_-]/g, "_");
  return join(process.cwd(), `probe-${sanitized}.json`);
}

function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(2)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}

/**
 * Count Sling depth-5 truncation markers in the response. AEM serializes
 * truncated subtrees as `"path": "path"` (string value === key). This is the
 * same heuristic `aem-extract` uses to drive follow-up fetches; we just
 * count, since the goal here is a fast connectivity check.
 */
function countTruncationMarkers(value: unknown, parentKey?: string): number {
  if (typeof value === "string") {
    return parentKey && value === parentKey ? 1 : 0;
  }
  if (!value || typeof value !== "object") return 0;
  let n = 0;
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    n += countTruncationMarkers(v, k);
  }
  return n;
}

main().catch((err) => {
  console.error("✗ Unexpected error:", err);
  process.exit(1);
});
