import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: ["src/index.ts"],
    format: ["esm"],
    sourcemap: true,
    clean: true,
    target: "node20",
    banner: { js: "#!/usr/bin/env node" },
  },
  {
    // Library surface for the monorepo's own scripts (migrate-init,
    // studio-init, toolkit-update import the template helpers from here).
    entry: { lib: "src/lib/tenant-template.ts" },
    format: ["esm"],
    dts: true,
    sourcemap: true,
    target: "node20",
  },
]);
