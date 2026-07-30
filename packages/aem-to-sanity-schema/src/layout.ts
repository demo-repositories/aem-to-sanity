import { readdir } from "node:fs/promises";
import type { SchemaLayout } from "aem-to-sanity-core";

/**
 * What the emitted file defines, for foldering purposes. The page-builder
 * array type counts as `object` — only true Sanity documents land in
 * `documents/`.
 */
export type EmittedKind = "document" | "object";

export interface SchemaPathPlanner {
  /**
   * POSIX-relative path under the schemas dir for a type's generated file,
   * e.g. `teaser.ts`, `objects/teaser.ts`, or `navigationObjects/navBar.ts`.
   */
  relPath(typeName: string, kind: EmittedKind): string;
}

export interface CreateSchemaPathPlannerOptions {
  layout: SchemaLayout;
  /**
   * Per-type folder overrides (from `aem-component-names.json` `folder`
   * entries), keyed by resolved Sanity type name. Overrides win in both
   * layouts.
   */
  folderByTypeName?: ReadonlyMap<string, string>;
}

const KIND_FOLDERS: Record<EmittedKind, string> = {
  document: "documents",
  object: "objects",
};

/**
 * Single source of truth mapping (typeName, kind) → relative file path.
 * Precedence: explicit folder override > kind folder (`kind` layout only) >
 * bare `{typeName}.ts`. Always returns POSIX separators so the result can be
 * reused verbatim as an import specifier; writers `join()` it onto the
 * schemas dir for the OS path.
 */
export function createSchemaPathPlanner(
  opts: CreateSchemaPathPlannerOptions,
): SchemaPathPlanner {
  const { layout, folderByTypeName } = opts;
  return {
    relPath(typeName, kind) {
      const override = folderByTypeName?.get(typeName);
      if (override) return `${override}/${typeName}.ts`;
      if (layout === "kind") return `${KIND_FOLDERS[kind]}/${typeName}.ts`;
      return `${typeName}.ts`;
    },
  };
}

/** Legacy layout: everything flat in the schemas dir. */
export const FLAT_PLANNER: SchemaPathPlanner = createSchemaPathPlanner({
  layout: "flat",
});

export interface ScannedSchemaFile {
  /** Exported type name, inferred from the basename (one type per file). */
  typeName: string;
  /** Path relative to the schemas dir, POSIX separators, `.ts` included. */
  relPath: string;
}

/**
 * Recursively scan a schemas directory for emitted type files. The root
 * `index.ts` (the barrel) is skipped; nested `index.ts` files are treated as
 * ordinary type files (the emitter never writes them, so one would be
 * hand-authored). Missing directory → empty list. Throws when two files
 * share a basename — type names are globally unique, so a duplicate means a
 * stale or hand-authored file is stranded at another location and would
 * silently shadow the real one in the barrel.
 */
export async function scanGeneratedSchemaFiles(
  schemasDir: string,
): Promise<ScannedSchemaFile[]> {
  const found = new Map<string, string>();

  async function walk(dir: string, relPrefix: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
      throw err;
    }
    for (const entry of entries) {
      const rel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(`${dir}/${entry.name}`, rel);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(".ts")) continue;
      if (rel === "index.ts") continue;
      const typeName = entry.name.slice(0, -3);
      const existing = found.get(typeName);
      if (existing) {
        throw new Error(
          `schemas dir has two files for type "${typeName}": ${existing} and ${rel} — remove or move the stale one (a hand-authored file left at a previous layout's location?)`,
        );
      }
      found.set(typeName, rel);
    }
  }

  await walk(schemasDir, "");
  return [...found.entries()]
    .map(([typeName, relPath]) => ({ typeName, relPath }))
    .sort((a, b) => a.typeName.localeCompare(b.typeName));
}
