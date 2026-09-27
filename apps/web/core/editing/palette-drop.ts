import type { AddObjectDraft } from '../../contract/records/creation.js';
import { diagnostic, type Diagnostic } from '../../contract/errors.js';

/** Object types the canvas palette offers. */
export const palette = [{ kind: 'module', label: 'Module' }] as const;

/** What a palette drop should do: add an object, refuse with a reason, or nothing. */
export type PaletteDrop =
  | { readonly kind: 'add'; readonly draft: AddObjectDraft }
  | { readonly kind: 'refuse'; readonly problem: Diagnostic }
  | { readonly kind: 'ignore' };

/** A palette drop creates a new object of that type in the group (or section) under the pointer. */
export function planPaletteDrop(
  sections: readonly { readonly id: string; readonly mode: string; readonly title: string }[],
  kind: string,
  target: { readonly section: string; readonly group: string | null },
): PaletteDrop {
  const item = palette.find((entry) => entry.kind === kind);
  if (item === undefined) return { kind: 'ignore' };
  // Tree sections are outlines built from parent links; the Add forms exclude them too.
  const section = sections.find((entry) => entry.id === target.section);
  if (section?.mode === 'tree')
    return { kind: 'refuse', problem: treeRefusal(item.label, section.title) };
  return {
    kind: 'add',
    draft: {
      section: target.section,
      group: target.group,
      kind: item.kind,
      label: `New ${item.label.toLowerCase()}`,
      reuseObject: null,
    },
  };
}

function treeRefusal(
  label: string,
  title: string,
): Diagnostic {
  return diagnostic(
    'tree-section-drop',
    `${label}s can't be dropped into a tree. Drop it into a diagram section instead.`,
    `"${title}" is a tree outline. Nothing was changed.`,
  );
}
