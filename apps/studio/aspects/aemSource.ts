// Thin re-export: `sanity.cli.ts` points `mediaLibrary.aspectsPath` at this
// directory, but the aspect definition ships with the toolkit so
// `pnpm -w toolkit:update` delivers changes without touching this file.
export { default } from "aem-to-sanity-studio/aspects/aemSource";
