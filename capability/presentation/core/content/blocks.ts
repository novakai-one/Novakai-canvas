import type { ContentBlock } from '../../contract/records/input.js';
import type { MeasuredContent } from '../../contract/records/visual.js';
import type { ContentContext } from '../../contract/records/content-context.js';
export type { ContentContext } from '../../contract/records/content-context.js';
import { measureField, fieldKey } from './fields.js';
import { measureText } from './text.js';
import { measureTable } from './table.js';
import { measureSignature, measureMember } from './signature.js';
import { measureMedia } from './media.js';
import { measureFigure } from './figures.js';
import { reject } from '../validation/outcomes.js';
/** Content processor chooses local presentation only; semantic validity remains in Model. */
type Processor = (block: ContentBlock, context: ContentContext) => MeasuredContent;
/** Prose and code select their pinned role metrics; structured addressable rows have dedicated processors. */
function text(
  text: string,
  context: ContentContext,
  mono = false,
): MeasuredContent {
  const metric = mono ? context.style.typography.mono : context.style.typography.body;
  return measureText(
    {
      text,
      width: context.width,
      ...metric,
      fill: context.style.text,
    },
    context.metrics,
  );
}
/** Dispatch tables keep adding content kinds outside projection/Authoring orchestration. */
const processors: Readonly<Record<ContentBlock['kind'], Processor>> = {
  text: (block, context): MeasuredContent => {
    if (block.kind !== 'text') return mismatch(block);
    return measureText(
      {
        text: block.text,
        width: context.width,
        ...context.style.typography[block.role],
        strong: context.style.strongFont,
        fill: block.role === 'caption' ? context.style.secondary : context.style.text,
      },
      context.metrics,
    );
  },
  code: (block, context): MeasuredContent => {
    if (block.kind !== 'code') return mismatch(block);
    return text(block.text, context, true);
  },
  list: (block, context): MeasuredContent => {
    if (block.kind !== 'list') return mismatch(block);
    return text(
      block.items
        .map((item, index): string => `${block.ordered ? String(index + 1) + '.' : '•'} ${item}`)
        .join('\n'),
      context,
    );
  },
  link: (block, context): MeasuredContent => {
    if (block.kind !== 'link') return mismatch(block);
    return text(block.label, context);
  },
  image: (block, context): MeasuredContent => image(block, context),
  icon: (block, context): MeasuredContent => image(block, context),
  figure: (block, context): MeasuredContent => figure(block, context),
  field: (block, context): MeasuredContent => {
    if (block.kind !== 'field') return mismatch(block);
    return measureField(block, context);
  },
  keygroup: (block, context): MeasuredContent => {
    if (block.kind !== 'keygroup') return mismatch(block);
    return text(
      `${fieldKey(block.key)} (${block.fields.map((id): string => fieldLabel(id, context)).join(', ')})`,
      context,
      true,
    );
  },
  member: (block, context): MeasuredContent => {
    if (block.kind !== 'member') return mismatch(block);
    return measureMember(block, context);
  },
  signature: (block, context): MeasuredContent => {
    if (block.kind !== 'signature') return mismatch(block);
    return measureSignature(block, context);
  },
  table: (block, context): MeasuredContent => {
    if (block.kind !== 'table') return mismatch(block);
    return measureTable(block, context.width, context.style, context.metrics);
  },
};
/** Exhaustive registry mismatches are provider errors, never a blank content fallback. */
function mismatch(block: ContentBlock): never {
  return reject('unknown-kind', block.id, 'Content registry mismatch');
}
/** Images/icons share the same bounded resolver and aspect-ratio policy. */
function image(
  block: ContentBlock,
  context: ContentContext,
): MeasuredContent {
  if (block.kind !== 'image' && block.kind !== 'icon') return mismatch(block);
  return measureMedia(block, context.collection, context.width, context.style, context.assets);
}
/** Figures draw from tokens without touching asset resources; measurement stays local and deterministic. */
function figure(
  block: ContentBlock,
  context: ContentContext,
): MeasuredContent {
  if (block.kind !== 'figure') return mismatch(block);
  return measureFigure(block, context.width, context.style);
}
/** Measure canonical content without mutation; createPresentation.project protects provider/structured failures.
 * Callers correct input/resources and retry; Authoring retains the committed scene. */
export function measureBlock(
  block: ContentBlock,
  context: ContentContext,
): MeasuredContent {
  return processors[block.kind](block, context);
}

/** Resolve local canonical membership without renaming IDs; project protection owns a broken owner/field rejection. */
function fieldLabel(
  id: string,
  context: ContentContext,
): string {
  const field = context.owner?.content.find((block): boolean => block.id === id);
  if (field?.kind !== 'field')
    return reject('invalid-input', id, 'Key group field is missing from its owning entity');
  return field.label;
}
