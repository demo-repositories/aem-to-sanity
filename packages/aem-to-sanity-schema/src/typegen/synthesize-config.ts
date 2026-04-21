import { readdir, symlink, lstat, unlink, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { ensureDir, writeTextFile } from "aem-to-sanity-core";

export interface SynthesizeConfigOptions {
  /** Root output directory (where `schemas/*.ts` live). */
  outputDir: string;
  /** Placeholder project id used in the throwaway config. */
  projectId?: string;
  /** Placeholder dataset name. */
  dataset?: string;
  /** Workspace name for `sanity schema extract --workspace`. */
  workspaceName?: string;
  /**
   * Directory whose `node_modules/` should be linked into the generated
   * `.typegen/node_modules` so the throwaway config can resolve `sanity`.
   * If omitted, the caller is responsible for making `sanity` resolvable.
   */
  nodeModulesSource?: string;
}

export interface SynthesizedPaths {
  /** Absolute path to the generated `sanity.config.ts`. */
  configFile: string;
  /** Absolute path to the `.typegen` directory that should be the CLI cwd. */
  typegenDir: string;
  /** Absolute paths to the individual schema files discovered. */
  schemaFiles: string[];
  /** Name of the generated workspace. */
  workspaceName: string;
}

/**
 * Writes a throwaway `sanity.config.ts` into `{outputDir}/.typegen/` that
 * imports every emitted schema in `{outputDir}/schemas/` and registers them as
 * the workspace schema types. This config is only used so `sanity schemas
 * extract` has a Studio context to introspect — it is never booted as a real
 * Studio.
 */
export async function synthesizeSanityConfig(
  opts: SynthesizeConfigOptions,
): Promise<SynthesizedPaths> {
  const {
    outputDir,
    // Sanity requires project IDs to match [a-z0-9-] and be non-empty; the
    // "p" prefix makes it obvious this is a placeholder when it shows up in
    // logs, and keeps us under the 8-char typical length.
    projectId = "ptypegen",
    dataset = "production",
    workspaceName = "default",
  } = opts;

  const schemasDir = join(outputDir, "schemas");
  const schemaFiles = (await readdir(schemasDir))
    .filter((f) => f.endsWith(".ts"))
    .map((f) => join(schemasDir, f))
    .sort();

  const typegenDir = join(outputDir, ".typegen");
  const configFile = join(typegenDir, "sanity.config.ts");

  const importsAndList = schemaFiles.map((absFile) => {
    const name = absFile.split("/").pop()!.replace(/\.ts$/, "");
    const rel = toPosix(relative(typegenDir, absFile)).replace(/\.ts$/, "");
    const importPath = rel.startsWith(".") ? rel : `./${rel}`;
    return { name, importPath };
  });

  const imports = importsAndList
    .map((e) => `import { ${e.name} } from ${JSON.stringify(e.importPath)};`)
    .join("\n");
  const typesList = importsAndList.map((e) => e.name).join(", ");

  const src = `import { defineConfig, defineField, defineType } from "sanity";
${imports}

// Sanity built-in types that can't be used as user type names. Emitted
// components colliding with these (e.g. the AEM \`image\` component) are
// re-exported with an "Aem" prefix so TypeGen can ingest them.
const RESERVED = new Set([
  "image", "file", "geopoint", "reference", "slug", "url",
  "text", "string", "number", "boolean", "date", "datetime",
  "block", "object", "array", "email", "span",
]);

// Sanity rejects \`type: "object"\` with zero fields. Some AEM dialogs consist
// entirely of hidden/unmapped children and emit empty types. We inject a
// single placeholder field so TypeGen succeeds; the emitted schema on disk is
// untouched.
function sanitizeForTypegen<T>(types: T[]): T[] {
  return types.map((raw) => {
    const t = raw as any;
    const renamed = RESERVED.has(t.name) ? { ...t, name: "aem" + t.name.charAt(0).toUpperCase() + t.name.slice(1) } : t;
    const fields = (renamed.fields as any[]) ?? [];
    if (fields.length === 0) {
      return {
        ...renamed,
        fields: [
          defineField({
            name: "aemPlaceholder",
            type: "string",
            description: "TODO: AEM dialog had no mappable fields; this placeholder exists so the schema validates.",
            hidden: true,
          }),
        ],
      } as T;
    }
    return renamed as T;
  });
}

export default defineConfig({
  name: ${JSON.stringify(workspaceName)},
  title: "AEM → Sanity TypeGen (synthesized)",
  projectId: ${JSON.stringify(projectId)},
  dataset: ${JSON.stringify(dataset)},
  schema: {
    types: sanitizeForTypegen([${typesList}]),
  },
});
`;

  const cliFile = join(typegenDir, "sanity.cli.ts");
  const cliSrc = `import { defineCliConfig } from "sanity/cli";

export default defineCliConfig({
  api: {
    projectId: ${JSON.stringify(projectId)},
    dataset: ${JSON.stringify(dataset)},
  },
});
`;

  await writeTextFile(configFile, src);
  await writeTextFile(cliFile, cliSrc);

  if (opts.nodeModulesSource) {
    await linkNodeModules(typegenDir, opts.nodeModulesSource);
  }

  return { configFile, typegenDir, schemaFiles, workspaceName };
}

/**
 * The synthesized `sanity.config.ts` imports from `sanity`. That import must
 * resolve relative to the `.typegen` dir, so we drop a symlink to the source
 * package's `node_modules` alongside the generated config.
 */
async function linkNodeModules(
  typegenDir: string,
  sourceDir: string,
): Promise<void> {
  const target = await findNearestNodeModules(sourceDir);
  if (!target) {
    throw new Error(
      `Could not locate a node_modules directory starting from ${sourceDir}. ` +
        `Pass \`nodeModulesSource\` pointing to a dir whose tree contains \`sanity\`.`,
    );
  }
  const link = join(typegenDir, "node_modules");

  try {
    const existing = await lstat(link);
    if (existing.isSymbolicLink() || existing.isDirectory()) {
      await unlink(link);
    }
  } catch {
    // Not present — nothing to remove.
  }

  await ensureDir(typegenDir);
  await symlink(target, link, "dir");
}

async function findNearestNodeModules(
  startDir: string,
): Promise<string | undefined> {
  let dir = startDir;
  for (let depth = 0; depth < 20; depth++) {
    const candidate = join(dir, "node_modules");
    try {
      const s = await stat(candidate);
      if (s.isDirectory()) return candidate;
    } catch {
      // keep walking
    }
    const parent = join(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

function toPosix(p: string): string {
  return p.split(/[\\/]/).join("/");
}
