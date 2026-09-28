import type { ContentBlock, DiagramObject } from '../../contract/records/input.js';
import type { ContentContext } from '../../contract/records/content-context.js';
import type { SizeBand } from '../../contract/records/style.js';
import { measureBlock } from './blocks.js';
import { measureText } from './text.js';
import { fieldColumns } from './fields.js';
/** Only visible semantic content contributes to intrinsic node sizing. */
type ContentSource = Pick<DiagramObject, 'label' | 'content'>;
/** Final interior width is shared by text, aligned rows and centered media. */
export interface ContentMeasurePlan {
  readonly width: number;
}
/** Measure headings with the same checked pinned metrics used by the final text pass. */
function headingWidth(
  label: string,
  context: ContentContext,
  maximum: number,
): number {
  return measureText(
    {
      text: label,
      width: maximum,
      ...context.style.typography.nodeHeading,
      fill: context.style.text,
    },
    context.metrics,
  ).width;
}
/** A width override asks headings to wrap; natural headings expand only within their selected band. */
function preferred(
  source: ContentSource,
  context: ContentContext,
  band: SizeBand,
  explicit: boolean,
): number {
  if (explicit) return context.width;
  return Math.max(band.preferred, headingWidth(source.label, context, band.maximum));
}
/** Structured atoms may exceed explicit/band limits; public projection rejects invalid provider dimensions. */
export function planContent(
  source: ContentSource,
  context: ContentContext,
  band: SizeBand,
  explicit: boolean,
): ContentMeasurePlan {
  const width = preferred(source, context, band, explicit);
  const naturalWidth = explicit ? width : band.maximum;
  const scoped = { ...context, width: naturalWidth, fields: fieldColumns(source.content, context) };
  const blocks = source.content.filter(structured).map((block) => measureBlock(block, scoped));
  return { width: Math.max(width, ...blocks.map((block) => block.width)) };
}

/** Prose and media use the selected width; only structured content contributes an intrinsic minimum. */
function structured(block: ContentBlock): boolean {
  return ['field', 'member', 'signature', 'table'].includes(block.kind);
}
