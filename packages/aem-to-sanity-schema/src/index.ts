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
  describeSchemaFields,
  AEM_FILE_UPLOAD_PATH_FIELD_SUFFIX,
} from "./mapper.ts";
export type {
  NodeFetcher,
  SanityField,
  SanityFieldset,
  SchemaFieldInfo,
  UnmappedField,
  RenamedField,
  CommonFieldProps,
} from "./mapper.ts";
export {
  RESERVED_SANITY_TYPE_NAMES,
  SANITY_BUILTIN_TYPE_NAMES,
  PORTABLE_TEXT_TABLE_TYPE_NAMES,
  VALID_TYPE_SUFFIX,
  componentPathToTypeName,
  displayTitleFromAemComponentJcrTitle,
  resolveSanityTypeNames,
  toCamelCase,
  toTitleCase,
} from "./naming.ts";
export type {
  ResolveSanityTypeNamesOptions,
  TypeNamingStrategy,
  TypeSuffixMode,
} from "./naming.ts";
export {
  FLAT_PLANNER,
  createSchemaPathPlanner,
  scanGeneratedSchemaFiles,
} from "./layout.ts";
export type {
  CreateSchemaPathPlannerOptions,
  EmittedKind,
  ScannedSchemaFile,
  SchemaPathPlanner,
} from "./layout.ts";
export { MAPPING, lookup } from "./mapping-table.ts";
export type { MappingEntry, SanityKind } from "./mapping-table.ts";
export { Report } from "./report.ts";
export type { Outcome, FailureKind, ReportSummary } from "./report.ts";
export { auditUnmappedTypes } from "./audit.ts";
export type { AuditOptions, AuditResult, AuditExample } from "./audit.ts";
export { writeMappingDocs } from "./docs.ts";
export {
  PT_TABLE_TYPE_NAMES,
  writePortableTextTableArtifacts,
} from "./pt-table.ts";
export { runTypegen } from "./typegen/index.ts";
export type { RunTypegenOptions, RunTypegenResult } from "./typegen/index.ts";
export { sanitizeSchemaTypes } from "./sanitize.ts";
export {
  writePageBuilderArtifacts,
  scanSchemaTypeNames,
  rewriteBarrelFromDisk,
} from "./pagebuilder.ts";
export {
  collectSlotOnlyResourceTypes,
  discoverSlotGraph,
  discoverSlots,
  scanSlotGraphFromExtractCache,
  scanSlotsFromExtractCache,
  scanSlotsFromRawDir,
} from "./slots.ts";
export type {
  DiscoveredSlots,
  ScanOptions as SlotScanOptions,
  SlotMapEntry,
  SlotScanResult,
} from "./slots.ts";
export { writeContentRegistry } from "./content-registry.ts";
export type {
  RegistryEntry as ContentRegistryEntry,
  RegistryField as ContentRegistryField,
  WriteContentRegistryOptions,
  WriteContentRegistryResult,
} from "./content-registry.ts";
export type {
  PageBuilderMember,
  WritePageBuilderArtifactsOptions,
  WritePageBuilderArtifactsResult,
} from "./pagebuilder.ts";
export {
  writeTemplatePageArtifacts,
  templatePathToTypeName,
  templatePathToTitle,
} from "./template-pages.ts";
export type {
  TemplatePageManifest,
  TemplatePageManifestEntry,
  WriteTemplatePageArtifactsOptions,
  WriteTemplatePageArtifactsResult,
} from "./template-pages.ts";
export {
  discoverTemplates,
  scanTemplatesFromExtractCache,
  scanTemplatesFromRawDir,
  mergeDiscoveredTemplates,
} from "./template-discovery.ts";
export type { DiscoveredTemplates } from "./template-discovery.ts";
export { ejectDialogs } from "./eject-dialogs.ts";
export type {
  EjectDialogsOptions,
  EjectDialogsResult,
  EjectedDialog,
  EjectSkip,
} from "./eject-dialogs.ts";
