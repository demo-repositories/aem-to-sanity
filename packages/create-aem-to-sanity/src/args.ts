import { parseArgs } from "node:util";

export const DEFAULT_REPO = "https://github.com/demo-repositories/aem-to-sanity.git";
export const DEFAULT_REF = "main";

/** Same slug rules as `pnpm migrate:init` — lowercase, digits, hyphens. */
export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

export interface CliConfig {
  targetDir: string | undefined;
  tenant: string | undefined;
  repo: string;
  ref: string;
  install: boolean;
  help: boolean;
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
      "no-install": { type: "boolean" },
      help: { type: "boolean", short: "h" },
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
    help: values.help ?? false,
  };

  if (config.tenant !== undefined) validateSlug(config.tenant);
  if (config.tenant !== undefined && !config.install) {
    throw new CliError("--tenant needs dependencies installed — drop --no-install");
  }

  return config;
}

export const USAGE = `Usage: create-aem-to-sanity [target-dir] [options]

Scaffolds a new AEM → Sanity migration project by cloning the aem-to-sanity
toolkit, then optionally installs dependencies and sets up your first tenant.

Options:
  -t, --tenant <slug>   scaffold a tenant folder after install (runs pnpm migrate:init)
  -r, --ref <git-ref>   branch or tag of the toolkit to clone (default: ${DEFAULT_REF})
      --repo <url>      source repository (default: ${DEFAULT_REPO})
      --no-install      skip pnpm install (incompatible with --tenant)
  -h, --help            show this message

Examples:
  npm create @shehjad/aem-to-sanity my-migration
  npm create @shehjad/aem-to-sanity my-migration -- --tenant acme
  npm create @shehjad/aem-to-sanity my-migration -- --ref aem-to-sanity-core@1.9.0
`;
