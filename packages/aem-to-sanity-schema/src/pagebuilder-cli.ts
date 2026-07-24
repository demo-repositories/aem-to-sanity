#!/usr/bin/env node
import "./load-env.ts";
import { join, resolve } from "node:path";
import { createLogger, resolvePageBuilderName } from "aem-to-sanity-core";
import {
  rewriteBarrelFromDisk,
  scanSchemaTypeNames,
  writePageBuilderArtifacts,
} from "./pagebuilder.ts";

interface Args {
  outputDir: string;
  schemasDir: string | undefined;
  exclude: string[];
  pageTypeName: string;
  pageBuilderTypeName: string;
}

function parseArgs(argv: string[]): Args {
  // pagebuilder-cli doesn't talk to AEM, so it shouldn't trigger the
  // IMS exchange in `resolveConfig`. Read OUTPUT_DIR directly.
  const envOutput = process.env.OUTPUT_DIR;
  const result: Args = {
    outputDir: envOutput ?? "./output",
    schemasDir: process.env.SCHEMAS_OUT_DIR,
    exclude: [],
    pageTypeName: "page",
    pageBuilderTypeName: resolvePageBuilderName(process.env),
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    switch (arg) {
      case "--output-dir": {
        const next = argv[++i];
        if (!next) throw new Error("--output-dir requires a value");
        result.outputDir = next;
        break;
      }
      case "--schemas-dir": {
        const next = argv[++i];
        if (!next) throw new Error("--schemas-dir requires a value");
        result.schemasDir = next;
        break;
      }
      case "--exclude": {
        const next = argv[++i];
        if (!next) throw new Error("--exclude requires a value");
        result.exclude.push(next);
        break;
      }
      case "--page-type": {
        const next = argv[++i];
        if (!next) throw new Error("--page-type requires a value");
        result.pageTypeName = next;
        break;
      }
      case "--pagebuilder-type": {
        const next = argv[++i];
        if (!next) throw new Error("--pagebuilder-type requires a value");
        result.pageBuilderTypeName = next;
        break;
      }
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return result;
}

function printHelp(): void {
  console.log(`aem-to-sanity-pagebuilder

Rebuild page.ts and pageBuilder.ts by scanning a schemas directory for
emitted component types. Safe to run between migrations when a schema file
has been hand-added. Preserves page.ts if you've hand-authored it (removes
the GENERATED marker comment).

Options:
  --output-dir <path>       Default: $OUTPUT_DIR or ./output
  --schemas-dir <path>      Schema output dir. Default: $SCHEMAS_OUT_DIR
                            or {outputDir}/schemas
  --exclude <typeName>      Exclude a type from pageBuilder.of[] (repeatable)
  --page-type <name>        Default: page
  --pagebuilder-type <name> Default: $MIGRATION_PAGE_BUILDER_NAME or pageBuilder
`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const logger = createLogger({ level: "info" });
  const outputDir = resolve(args.outputDir);
  const schemasDir = resolve(args.schemasDir ?? join(outputDir, "schemas"));

  const names = await scanSchemaTypeNames(schemasDir, [
    args.pageTypeName,
    args.pageBuilderTypeName,
  ]);
  if (names.length === 0) {
    logger.error(`No schema files found under ${schemasDir}`);
    process.exit(1);
  }

  const result = await writePageBuilderArtifacts({
    schemasDir,
    componentTypeNames: names,
    exclude: args.exclude,
    pageTypeName: args.pageTypeName,
    pageBuilderTypeName: args.pageBuilderTypeName,
    logger,
  });

  logger.info(
    `Registered ${result.registered.length} type(s) in ${args.pageBuilderTypeName}.of[].`,
  );
  logger.info(`Wrote ${result.pageBuilderFile}`);
  if (result.pageWritten) {
    logger.info(`Wrote ${result.pageFile}`);
  } else {
    logger.info(
      `Preserved hand-authored ${result.pageFile} (no GENERATED marker).`,
    );
  }

  const barrel = await rewriteBarrelFromDisk(
    schemasDir,
    args.pageTypeName,
    args.pageBuilderTypeName,
  );
  logger.info(`Refreshed ${barrel}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
