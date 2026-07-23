import React from "react";
import type { FieldProps } from "sanity";
import { Card, Flex, Text } from "@sanity/ui";

/**
 * Display-only authoring note — the Studio-side rendering of AEM's Coral
 * `text` widget (`granite/ui/components/coral/foundation/text`), which AEM
 * dialogs use for inline instructions and warnings to authors.
 *
 * The schema emitter marks migrated text widgets with
 * `options.aemWidget: "note"` and carries the message in the field's
 * `description`. This component replaces the ENTIRE field (label, input,
 * description) with a caution-toned banner, so the message reads as a note
 * rather than an editable value. Nothing is persisted for these fields.
 *
 * Studios without this resolver fall back to an empty read-only string
 * input with the message as its description — ugly but harmless.
 */
export function NoteField(props: FieldProps) {
  const text = props.schemaType.description;
  if (!text) return null;
  return (
    <Card padding={3} radius={2} tone="caution" border>
      <Flex gap={3} align="flex-start">
        <Text size={1} aria-hidden>
          ⚠
        </Text>
        <Text size={1} muted>
          {text}
        </Text>
      </Flex>
    </Card>
  );
}

export function isNoteField(props: { schemaType: FieldProps["schemaType"] }): boolean {
  return (
    props.schemaType.jsonType === "string" &&
    (props.schemaType.options as { aemWidget?: string } | undefined)
      ?.aemWidget === "note"
  );
}
