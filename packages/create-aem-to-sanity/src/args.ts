import { parseArgs } from "node:util";

export const DEFAULT_REPO = "https://github.com/demo-repositories/aem-to-sanity.git";
export const DEFAULT_REF = "main";

/** Same slug rules as `pnpm migrate:init` — lowercase, digits, hyphens. */
export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

export interface CliConfig {
  targetDir: string | undefined;
  /** Clone-mode only: first tenant to scaffold via migrate:init. */
  tenant: string | undefined;
  repo: string;
  ref: string;
  install: boolean;
  /** Clone the toolkit monorepo instead of emitting a thin npm-dep project. */
  clone: boolean;
  detach: boolean;
  help: boolean;
  version: boolean;
}

export class CliError extends Error {}

export function validateSlug(slug: string): void {
  if (slug === "template") {
    throw new CliError("tenant slug 'template' is reserved for the migration template");
  }
  if (!SLUG_RE.test(slug)) {
    throw new CliError(
      `tenant slug "${slug}" is not valid — use lowercase letters, digits, and hyphens (e.g. davids-bridal)`,
    );
  }
}

export function parseCliArgs(argv: string[]): CliConfig {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      tenant: { type: "string", short: "t" },
      repo: { type: "string" },
      ref: { type: "string", short: "r" },
      clone: { type: "boolean" },
      "no-install": { type: "boolean" },
      detach: { type: "boolean" },
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
    },
  });

  if (positionals.length > 1) {
    throw new CliError(`unexpected extra arguments: ${positionals.slice(1).join(" ")}`);
  }

  const config: CliConfig = {
    targetDir: positionals[0],
    tenant: values.tenant,
    repo: values.repo ?? DEFAULT_REPO,
    ref: values.ref ?? DEFAULT_REF,
    install: !values["no-install"],
    clone: values.clone ?? false,
    detach: values.detach ?? false,
    help: values.help ?? false,
    version: values.version ?? false,
  };

  if (!config.clone) {
    for (const [flag, set] of [
      ["--tenant", values.tenant !== undefined],
      ["--ref", values.ref !== undefined],
      ["--repo", values.repo !== undefined],
      ["--detach", values.detach === true],
    ] as const) {
      if (set) {
        throw new CliError(
          `${flag} only applies to --clone mode — the default scaffold is a standalone project (its root IS the tenant; toolkit versions come from npm)`,
        );
      }
    }
  }

  if (config.tenant !== undefined) validateSlug(config.tenant);
  if (config.tenant !== undefined && !config.install) {
    throw new CliError("--tenant needs dependencies installed — drop --no-install");
  }

  return config;
}

export const USAGE = `Usage: create-aem-to-sanity [target-dir] [options]

Scaffolds a new AEM → Sanity migration project. By default this is a thin,
standalone project: your config + Studio at the root, with the toolkit
(aem-to-sanity-core/schema/content/studio/cli) installed from npm. Updating
the toolkit later is a plain npm install.

Options:
      --no-install      skip installing dependencies
      --clone           clone the full toolkit monorepo instead (git-merge updates)
  -h, --help            show this message
  -v, --version         print the scaffolder version

Clone-mode options:
  -t, --tenant <slug>   scaffold a tenant folder after install (runs pnpm migrate:init)
  -r, --ref <git-ref>   branch or tag of the toolkit to clone (default: ${DEFAULT_REF})
      --repo <url>      source repository (default: ${DEFAULT_REPO})
      --detach          drop the toolkit git history (disables \`pnpm -w toolkit:update\`)

Examples:
  npm create @shehjad/aem-to-sanity my-migration
  npm create @shehjad/aem-to-sanity my-migration -- --clone --tenant acme
`;
