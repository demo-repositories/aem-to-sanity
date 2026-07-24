import { defineField, defineType } from "sanity";

/**
 * Parent-child taxonomy document — implements the pattern from
 * https://www.sanity.io/docs/developer-guides/parent-child-taxonomy.
 *
 * Populated by `aem-tags` (one `category` doc per `cq:Tag` node under a
 * tag root listed in `aem-tag-roots`). Referenced from any schema field
 * that the AEM dialog maps as a `tagfield` — those become
 * `array of reference-to-category`.
 *
 * Hand-authored, not generated. Lives outside `schemas/generated/` so the
 * schema migrator never overwrites it.
 */
export const category = defineType({
  name: "category",
  title: "Category",
  type: "document",
  fields: [
    defineField({
      name: "title",
      type: "string",
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: "slug",
      type: "slug",
      options: { source: "title", maxLength: 96 },
    }),
    defineField({
      name: "parent",
      type: "reference",
      to: [{ type: "category" }],
      description:
        "Parent category in the taxonomy. Empty on top-level (AEM namespace) categories.",
    }),
    defineField({
      name: "tagId",
      title: "AEM tag ID",
      type: "string",
      readOnly: true,
      description:
        "Canonical AEM tag ID (`namespace:parent/child`, or `parent/child` for default-namespace tags). Preserved from migration so authors can trace a category back to its AEM origin.",
    }),
    defineField({
      name: "description",
      type: "text",
      rows: 2,
    }),
  ],
  preview: {
    select: {
      title: "title",
      tagId: "tagId",
      parentTitle: "parent.title",
    },
    prepare({ title, tagId, parentTitle }) {
      const subtitleParts: string[] = [];
      if (typeof parentTitle === "string" && parentTitle.trim()) {
        subtitleParts.push(parentTitle.trim());
      }
      if (typeof tagId === "string" && tagId.trim()) {
        subtitleParts.push(tagId.trim());
      }
      return {
        title:
          typeof title === "string" && title.trim() ? title.trim() : "Untitled category",
        subtitle: subtitleParts.length > 0 ? subtitleParts.join(" — ") : undefined,
      };
    },
  },
});
