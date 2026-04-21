/**
 * Registry mapping AEM `sling:resourceType` → Sanity schema type name.
 *
 * In v1 this is built from the schema package's emitted `schema.json`
 * (produced by the typegen pipeline). Each top-level type's `name` becomes a
 * known Sanity type; the caller supplies the AEM resource-type mapping. Later
 * we may enrich this with expected field shapes for the audit step — hence
 * the opaque `TypeMeta` carrier rather than a bare `string`.
 */

export interface TypeMeta {
  /** Sanity schema type name, e.g. `promo`. */
  sanityType: string;
  /** Expected field names — populated when available, `undefined` otherwise. */
  fields?: string[];
}

export interface SchemaTypeRegistry {
  /** Look up the Sanity schema type for an AEM resource type. */
  lookup(resourceType: string): TypeMeta | undefined;
  /** Every registered Sanity type name. Useful for bulk filters. */
  knownTypes(): string[];
}

export interface RegistryEntry {
  resourceType: string;
  sanityType: string;
  fields?: string[];
}

/**
 * Build a registry from an explicit mapping list. The content package doesn't
 * try to reverse-engineer the mapping from `schema.json` — the schema package
 * already knows both sides (it derived `sanityType` from `resourceType` when
 * it emitted the schema), so callers should pass what it produced.
 */
export function createSchemaTypeRegistry(
  entries: RegistryEntry[],
): SchemaTypeRegistry {
  const byResourceType = new Map<string, TypeMeta>();
  for (const e of entries) {
    byResourceType.set(e.resourceType, {
      sanityType: e.sanityType,
      fields: e.fields,
    });
  }
  return {
    lookup(resourceType) {
      return byResourceType.get(resourceType);
    },
    knownTypes() {
      return [...new Set([...byResourceType.values()].map((m) => m.sanityType))];
    },
  };
}
