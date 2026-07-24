import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/aspects/aemSource.ts"],
  format: ["esm"],
  // No shared chunks: the aspects/aemSource entry is loaded by the Sanity
  // CLI's aspect deployer and must stay free of the React component code.
  splitting: false,
  dts: true,
  sourcemap: true,
  clean: true,
  target: "es2022",
});
