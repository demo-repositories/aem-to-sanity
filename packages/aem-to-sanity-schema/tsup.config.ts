import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    cli: "src/cli.ts",
    "typegen-cli": "src/typegen-cli.ts",
    "pagebuilder-cli": "src/pagebuilder-cli.ts",
    sanitize: "src/sanitize.ts",
  },
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  target: "node20",
  external: ["prettier", "sanity", "dotenv", "aem-to-sanity-core"],
});
