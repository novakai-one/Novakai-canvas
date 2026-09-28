import type { DiagramObject, ContentBlock, Appearance } from '../../contract/records/input.js';
import type { MeasuredContent, Anchor } from '../../contract/records/visual.js';
import type { ContentContext } from '../../contract/records/content-context.js';
import { labelContent } from './headings.js';
import { measureBlock } from './blocks.js';
import { fieldColumns } from './fields.js';
import { stack } from './text.js';
/** A typed port is an addressable local row, independent of the eventual routed side. */
function portContent(
  port: DiagramObject['ports'][number],
  context: ContentContext,
): MeasuredContent {
  const content = labelContent(`${port.label}: ${port.type} (${port.direction})`, context);
  return {
    ...content,
    anchors: [
      {
        member: port.id,
        x: 0,
        y: content.height / 2,
        direction: port.direction,
        collapsed: false,
        label: port.label,
      },
    ],
  };
}
export interface BodySelection {
  readonly content: readonly ContentBlock[];
  readonly ports: DiagramObject['ports'];
  readonly complete: boolean;
}
/** Measure selected rows against columns derived only from those visible rows. */
function measureBody(
  selection: BodySelection,
  context: ContentContext,
): MeasuredContent {
  const scoped = { ...context, fields: fieldColumns(selection.content, context) };
  const blocks = [
    ...selection.content.map((block) => measureBlock(block, scoped)),
    ...selection.ports.map((port) => portContent(port, context)),
  ];
  return stack(blocks, context.style.gap);
}
/** Hidden descendants attach at the body boundary and keep their own semantic label. */
function collapsed(anchor: Anchor): Anchor {
  return { ...anchor, x: 0, y: 0, collapsed: true };
}
/** Visible summary rows retain measured row anchors; only omitted descendants collapse. */
function visibleAnchor(
  anchor: Anchor,
  visible: MeasuredContent,
): Anchor {
  const found = visible.anchors.find((item) => item.member === anchor.member);
  if (found) return found;
  return collapsed(anchor);
}
/** Compact detail keeps canonical outline/anchors while visible geometry stays independently measured. */
function compact(
  visible: MeasuredContent,
  canonical: MeasuredContent,
): MeasuredContent {
  return {
    ...visible,
    anchors: canonical.anchors.map((anchor) => visibleAnchor(anchor, visible)),
    outline: canonical.outline,
  };
}
/** Measure visible body once; compact modes retain a separate canonical accessibility path. */
export function measureNodeBody(
  object: DiagramObject,
  selection: BodySelection,
  context: ContentContext,
): MeasuredContent {
  const visible = measureBody(selection, context);
  if (selection.complete) return visible;
  return compact(visible, measureBody(fullBody(object), context));
}
/** Derive one visible-body policy for sizing and final measurement. */
export function visibleBody(
  object: DiagramObject,
  mode: Appearance['detail'],
): BodySelection {
  if (mode === 'full') return fullBody(object);
  if (mode === 'label') return { content: [], ports: [], complete: false };
  return summaryBody(object);
}
/** Summary shows the first content block, or the first port when content is absent. */
function summaryBody(object: DiagramObject): BodySelection {
  const first = object.content.slice(0, 1);
  if (first.length > 0) return { content: first, ports: [], complete: false };
  return { content: [], ports: object.ports.slice(0, 1), complete: false };
}
/** Canonical body selection retains every outline and addressable row. */
function fullBody(object: DiagramObject): BodySelection {
  return { content: object.content, ports: object.ports, complete: true };
}
