import { dirname, join, relative, resolve } from "node:path";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import {
  resolveEffectiveDialog,
  writeJson,
  type DialogNode,
  type DialogOverrideConfig,
  type Logger,
} from "aem-to-sanity-core";
import { embeddedCqDialog } from "./api.ts";
import { extractSelectItems, type NodeFetcher } from "./mapper.ts";
import { lookup } from "./mapping-table.ts";
import {
  resolveDatasourceOptions,
  type DatasourceCache,
  type SelectOption,
} from "./datasources.ts";

/**
 * "Eject" a component's **effective** dialog into a static local file.
 *
 * The schema migrator assembles each dialog from several moving parts:
 * embedded `cq:dialog` or the `sling:resourceSuperType` walk, supplementary
 * tabs spliced in via `aem-dialog-overrides.json`, and datasource-driven
 * select options resolved at mapping time. Ejecting materializes all of
 * that into one plain JSON file under the operator's dialog-overrides
 * folder and rewrites the component's `aem-dialog-overrides.json` entry to
 * `{ "dialogFile": "…" }` — from then on the file is the single static
 * source of truth: hand-add fields, prune tabs, pin select options, and
 * re-run `migrate:schema` without thinking about resolution order.
 *
 * Two deliberate consequences:
 *
 * - **Datasource options are baked in as literal `items`** (resolvable
 *   ones — ACS generic lists, core policy defaults). Unresolvable
 *   datasources keep their `datasource` node so the miss stays visible in
 *   the report; hand-edit literal `items` into the file to fix those.
 * - **The dialog is frozen.** AEM-side dialog changes stop flowing for
 *   ejected components until re-ejected with `force` — which overwrites
 *   the file, discarding hand edits. Existing files are never touched
 *   without `force`.
 */

export interface EjectDialogsOptions {
  /** Full JCR component paths (e.g. `/apps/<site>/components/foo`). */
  componentPaths: string[];
  fetcher: NodeFetcher;
  /** Parsed `aem-dialog-overrides.json` (drives resolution, e.g. tabs to bake). */
  dialogOverrides: DialogOverrideConfig;
  /** Path of `aem-dialog-overrides.json` — rewritten with `dialogFile` entries. */
  overridesFile: string;
  /** Directory the ejected dialog files land in (created as needed). */
  outDir: string;
  /** Overwrite existing ejected files. Default: skip them (hand edits win). */
  force?: boolean;
  /** Stripped from component paths to derive resource-type keys. Default `/apps/`. */
  jcrPrefix?: string;
  logger?: Logger;
}

export interface EjectedDialog {
  componentPath: string;
  resourceType: string;
  /** Absolute path of the written file. */
  file: string;
  /** The `dialogFile` value written to the config (config-dir relative). */
  dialogFile: string;
  /** Count of datasource-driven widgets whose options were baked in as literal items. */
  materializedDatasources: number;
  /** Count of datasource-driven widgets left unresolved (kept their `datasource` node). */
  unresolvedDatasources: number;
  /** Supplementary tabs from the config that are now baked into the file. */
  bakedTabs: number;
}

export interface EjectSkip {
  componentPath: string;
  reason: string;
}

export interface EjectDialogsResult {
  ejected: EjectedDialog[];
  skipped: EjectSkip[];
  /** True when `aem-dialog-overrides.json` was (re)written. */
  configUpdated: boolean;
}

export async function ejectDialogs(
  opts: EjectDialogsOptions,
): Promise<EjectDialogsResult> {
  const {
    componentPaths,
    fetcher,
    dialogOverrides,
    overridesFile,
    outDir,
    force = false,
    jcrPrefix = "/apps/",
    logger,
  } = opts;

  const ejected: EjectedDialog[] = [];
  const skipped: EjectSkip[] = [];
  const datasourceCache: DatasourceCache = new Map();

  for (const componentPath of componentPaths) {
    const resourceType = componentPath.startsWith(jcrPrefix)
      ? componentPath.slice(jcrPrefix.length)
      : componentPath.replace(/^\/+/, "");
    const file = resolve(outDir, `${resourceType}.json`);

    if (existsSync(file) && !force) {
      skipped.push({
        componentPath,
        reason: `${file} already exists — re-run with --force to overwrite (discards hand edits)`,
      });
      continue;
    }

    const override = dialogOverrides.get(resourceType);
    let dialog: DialogNode;
    let bakedTabs = 0;
    try {
      // Mirror processOne: the embedded-dialog check needs the component
      // node, except when a dialogFile override already supplies the base.
      const embedded = override?.dialog
        ? undefined
        : embeddedCqDialog(await fetcher(componentPath));
      const resolved = await resolveEffectiveDialog(componentPath, fetcher, {
        override,
        embeddedDialog: embedded,
        warn: (m) => logger?.warn(`${componentPath}: ${m}`),
      });
      dialog = resolved.dialog;
      bakedTabs = resolved.appliedTabs?.length ?? 0;
    } catch (err) {
      skipped.push({ componentPath, reason: (err as Error).message });
      continue;
    }

    const { dialog: materialized, resolvedCount, unresolvedCount } =
      await materializeDatasourceItems(dialog, fetcher, datasourceCache, (m) =>
        logger?.warn(`${componentPath}: ${m}`),
      );

    const output: DialogNode = {
      "//":
        `Ejected from ${componentPath} by aem-eject-dialogs. This file is now the ` +
        `component's dialog source of truth — hand edits are preserved; re-eject ` +
        `with --force to refresh from AEM (discards hand edits). Field recipes: ` +
        `docs/authoring-dialog-files.md in the toolkit repo.`,
      ...materialized,
    } as DialogNode;

    await writeJson(file, output, { pretty: true });
    ejected.push({
      componentPath,
      resourceType,
      file,
      dialogFile: configRelativePath(overridesFile, file),
      materializedDatasources: resolvedCount,
      unresolvedDatasources: unresolvedCount,
      bakedTabs,
    });
    logger?.info(
      `${componentPath}: ejected → ${file}` +
        (bakedTabs > 0 ? ` (${bakedTabs} supplementary tab(s) baked in)` : "") +
        (resolvedCount > 0
          ? ` (${resolvedCount} datasource(s) materialized as literal items)`
          : ""),
    );
  }

  let configUpdated = false;
  if (ejected.length > 0) {
    await rewriteOverridesConfig(overridesFile, ejected);
    configUpdated = true;
    logger?.info(
      `${overridesFile}: ${ejected.length} entr${ejected.length === 1 ? "y" : "ies"} now point at ejected dialogFile(s)`,
    );
  }
  return { ejected, skipped, configUpdated };
}

/**
 * Walk the dialog and bake resolvable datasource options into literal
 * `items` children (`text` + `value`, matching hand-authored Granite
 * option nodes). The `datasource` node is removed once materialized so the
 * file reads as a plain static dialog; unresolvable datasources keep
 * theirs, so the mapper still reports `datasource-unresolved` for them.
 */
async function materializeDatasourceItems(
  dialog: DialogNode,
  fetcher: NodeFetcher,
  cache: DatasourceCache,
  warn: (msg: string) => void,
): Promise<{ dialog: DialogNode; resolvedCount: number; unresolvedCount: number }> {
  const out = structuredClone(dialog);
  let resolvedCount = 0;
  let unresolvedCount = 0;

  const visit = async (node: DialogNode): Promise<void> => {
    const rt = node["sling:resourceType"];
    const kind = typeof rt === "string" ? lookup(rt)?.kind : undefined;
    const isSelectionWidget =
      kind === "select" || kind === "radio" || kind === "buttongroup";
    if (
      isSelectionWidget &&
      extractSelectItems(node).length === 0 &&
      node["datasource"]
    ) {
      const resolution = await resolveDatasourceOptions(node, fetcher, cache);
      if (resolution.options) {
        (node as Record<string, unknown>)["items"] = optionsToItemsNode(
          resolution.options,
        );
        delete (node as Record<string, unknown>)["datasource"];
        resolvedCount++;
      } else if (resolution.unresolved) {
        unresolvedCount++;
        warn(
          `datasource kept on "${String(node["name"] ?? "?")}" — ${resolution.unresolved.detail}. ` +
            `Hand-edit literal \`items\` into the ejected file to pin its options.`,
        );
      }
    }
    for (const child of Object.values(node)) {
      if (child && typeof child === "object" && !Array.isArray(child)) {
        await visit(child as DialogNode);
      }
    }
  };
  await visit(out);
  return { dialog: out, resolvedCount, unresolvedCount };
}

function optionsToItemsNode(options: SelectOption[]): DialogNode {
  const items: Record<string, unknown> = {
    "jcr:primaryType": "nt:unstructured",
  };
  options.forEach((o, i) => {
    const key = o.value.replace(/[^A-Za-z0-9_]/g, "_") || `option${i}`;
    items[items[key] === undefined ? key : `${key}_${i}`] = {
      "jcr:primaryType": "nt:unstructured",
      text: o.title,
      value: o.value,
    };
  });
  return items as DialogNode;
}

/** `dialogFile` values resolve against the config file's directory. */
function configRelativePath(overridesFile: string, target: string): string {
  const rel = relative(dirname(resolve(overridesFile)), target);
  return rel.startsWith(".") ? rel : `./${rel}`;
}

/**
 * Rewrite `aem-dialog-overrides.json` so every ejected component points at
 * its file. Works on the raw JSON (not the parsed config) so unrelated
 * entries — and their key spelling — pass through untouched. An ejected
 * component's existing entry is replaced wholesale: its `supplementaryTabs`
 * are baked into the file now, so keeping them would double-splice (and
 * hard-error on the duplicate tab key) at the next schema run.
 */
async function rewriteOverridesConfig(
  overridesFile: string,
  ejected: EjectedDialog[],
): Promise<void> {
  let raw: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(await readFile(overridesFile, "utf8"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      raw = parsed as Record<string, unknown>;
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }

  const normalize = (key: string): string => {
    const trimmed = key.trim().replace(/^\/+/, "");
    return trimmed.startsWith("apps/") ? trimmed.slice("apps/".length) : trimmed;
  };

  for (const e of ejected) {
    const existingKey = Object.keys(raw).find(
      (k) => normalize(k) === e.resourceType,
    );
    raw[existingKey ?? e.resourceType] = { dialogFile: e.dialogFile };
  }
  await writeJson(overridesFile, raw, { pretty: true });
}

/** Small shared helper for the CLI: newline lists with `#` comments. */
export function parseLineList(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}
