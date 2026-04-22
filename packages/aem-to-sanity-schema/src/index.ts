export { migrateSchemas } from "./api.ts";
export type {
  MigrateSchemasOptions,
  MigrateSchemasResult,
} from "./api.ts";
export { emitSchemaFile } from "./emitter.ts";
export type { EmitInput } from "./emitter.ts";
export {
  mapDialog,
  flattenSchemaFieldNames,
  AEM_FILE_UPLOAD_PATH_FIELD_SUFFIX,
} from "./mapper.ts";
export type {
  NodeFetcher,
  SanityField,
  UnmappedField,
  RenamedField,
  CommonFieldProps,
} from "./mapper.ts";
export {
  componentPathToTypeName,
  displayTitleFromAemComponentJcrTitle,
  toCamelCase,
  toTitleCase,
} from "./naming.ts";
export { MAPPING, lookup } from "./mapping-table.ts";
export type { MappingEntry, SanityKind } from "./mapping-table.ts";
export { Report } from "./report.ts";
export type { Outcome, FailureKind, ReportSummary } from "./report.ts";
export { auditUnmappedTypes } from "./audit.ts";
export type { AuditOptions, AuditResult, AuditExample } from "./audit.ts";
export { writeMappingDocs } from "./docs.ts";
export { runTypegen } from "./typegen/index.ts";
export type { RunTypegenOptions, RunTypegenResult } from "./typegen/index.ts";
export { sanitizeSchemaTypes } from "./sanitize.ts";
export {
  writePageBuilderArtifacts,
  scanSchemaTypeNames,
  rewriteBarrelFromDisk,
} from "./pagebuilder.ts";
export { writeContentRegistry } from "./content-registry.ts";
export type {
  RegistryEntry as ContentRegistryEntry,
  WriteContentRegistryOptions,
  WriteContentRegistryResult,
} from "./content-registry.ts";
export type {
  WritePageBuilderArtifactsOptions,
  WritePageBuilderArtifactsResult,
} from "./pagebuilder.ts";
