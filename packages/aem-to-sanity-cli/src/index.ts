import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { runDoctor } from "./doctor.ts";
import { resolveContext } from "./paths.ts";
import { runWithLog } from "./run-with-log.ts";
import { runStudioSync } from "./studio-sync.ts";
import { wipeMediaLibrary } from "./wipe-media-library.ts";

const USAGE = `Usage: aem-to-sanity <command> [options]

Operator CLI for AEM → Sanity migration projects. Works both in a standalone
scaffold (npm create @shehjad/aem-to-sanity) and in the toolkit monorepo.

Commands:
  doctor [slug|--all] [--fix]        check env/config drift against the template
  studio-sync [slug|--all] [--fix]   copy new template Studio files in (never overwrites)
  run "<command>"                    run a command, mirroring output to output/execution-*.log
  wipe-media-library [--confirm-delete]
                                     delete ALL Media Library assets (test envs only; dry-run by default)

  -v, --version                      print the CLI version
  -h, --help                         show this message

In a standalone project the [slug] argument is omitted — the project root is
the tenant.
`;

function version(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const rel of ["../package.json", "../../package.json"]) {
    try {
      const pkg = JSON.parse(readFileSync(join(here, rel), "utf8"));
      if (pkg.name === "aem-to-sanity-cli") return pkg.version as string;
    } catch {
      /* try next */
    }
  }
  return "unknown";
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);

  if (!command || command === "--help" || command === "-h" || command === "help") {
    console.log(USAGE);
    process.exit(command ? 0 : 2);
  }
  if (command === "--version" || command === "-v") {
    console.log(version());
    return;
  }

  switch (command) {
    case "doctor":
      runDoctor(args, resolveContext());
      break;
    case "studio-sync":
      runStudioSync(args, resolveContext());
      break;
    case "run":
      runWithLog(args);
      break;
    case "wipe-media-library":
      await wipeMediaLibrary(args);
      break;
    default:
      console.error(`[aem-to-sanity] unknown command: ${command}\n\n${USAGE}`);
      process.exit(2);
  }
}

main().catch((err) => {
  console.error(`[aem-to-sanity] ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
