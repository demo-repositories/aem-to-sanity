import React from "react";
import type { FieldProps, InputProps, StringInputProps } from "sanity";
import { set } from "sanity";
import { Button, Flex } from "@sanity/ui";
import styled from "styled-components";
import { NoteField, isNoteField } from "./NoteField.js";

/**
 * Toggle-button group input for string fields with an `options.list` — the
 * Studio-side rendering of AEM's Coral `buttongroup` widget (single
 * selection mode). Adapted from sanity-io/sanetti-3
 * (`packages/shared/studio/components/inputs/ToggleGroupInput/`).
 *
 * The schema emitter marks migrated buttongroup fields with
 * `options.aemWidget: "buttonGroup"`; {@link aemFormComponents} routes those
 * fields here while every other input renders the Studio default.
 */

const ToggleContainer = styled(Flex)`
  border-radius: 3px;
  overflow: hidden;
`;

const ToggleButton = styled(Button)`
  border-top: 0.5px solid var(--card-border-color) !important;
  border-bottom: 0.5px solid var(--card-border-color) !important;
  border-left: 0 !important;
  border-right: 0 !important;
  flex: 1;
  border-radius: 0 !important;
  padding: 0.25rem !important;

  &:first-child {
    border-top-left-radius: 3px !important;
    border-bottom-left-radius: 3px !important;
  }

  &:last-child {
    border-top-right-radius: 3px !important;
    border-bottom-right-radius: 3px !important;
  }
`;

export function StringToggleGroupInput(props: StringInputProps) {
  const { onChange, value, schemaType, readOnly } = props;
  const options = schemaType.options?.list || [];

  return (
    <ToggleContainer>
      {options.map((option) => {
        const optionValue = typeof option === "string" ? option : option.value;
        const optionTitle = typeof option === "string" ? option : option.title;
        const isSelected = value === optionValue;

        return (
          <ToggleButton
            key={optionValue}
            mode={isSelected ? "default" : "ghost"}
            tone={isSelected ? "primary" : "default"}
            text={optionTitle}
            disabled={readOnly}
            onClick={() => {
              // Only change on a different option — no deselect, matching
              // the AEM buttongroup's single-selection behavior.
              if (!isSelected && !readOnly) {
                onChange(set(optionValue));
              }
            }}
          />
        );
      })}
    </ToggleContainer>
  );
}

function isButtonGroupString(props: InputProps): props is StringInputProps {
  return (
    props.schemaType.jsonType === "string" &&
    (props.schemaType.options as { aemWidget?: string } | undefined)
      ?.aemWidget === "buttonGroup"
  );
}

/**
 * `form.components` for `defineConfig` — routes fields the schema emitter
 * marked with an `options.aemWidget` hint:
 *
 * - `"buttonGroup"` → toggle-button-group input (this file)
 * - `"note"` → display-only caution banner replacing the whole field
 *   (`NoteField.tsx`) — AEM Coral `text` authoring instructions
 */
export const aemFormComponents = {
  input: (props: InputProps) => {
    if (isButtonGroupString(props)) {
      return <StringToggleGroupInput {...props} />;
    }
    return props.renderDefault(props);
  },
  field: (props: FieldProps) => {
    if (isNoteField(props)) {
      return <NoteField {...props} />;
    }
    return props.renderDefault(props);
  },
};
