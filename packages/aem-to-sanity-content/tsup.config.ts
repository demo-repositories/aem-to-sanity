import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    extract: "src/extract.ts",
    transform: "src/transform.ts",
    assets: "src/assets.ts",
    import: "src/import.ts",
  },
  format: ["esm"],
  sourcemap: true,
  clean: true,
  target: "node20",
  external: ["dotenv", "aem-to-sanity-core", "@sanity/client"],
});
