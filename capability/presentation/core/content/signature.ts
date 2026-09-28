import type { ContentBlock } from '../../contract/records/input.js';
import type { ContentContext } from '../../contract/records/content-context.js';
import type { TypeUse } from '../../contract/records/input.js';
import type { MeasuredContent } from '../../contract/records/visual.js';
import { measureText, offset } from './text.js';
import { reject, requireValue } from '../validation/outcomes.js';
type Signature = Extract<ContentBlock, { kind: 'signature' }>;
type Member = Extract<ContentBlock, { kind: 'member' }>;
interface Lines {
  readonly complete: readonly string[];
  readonly current: string;
}
/** Exact atomic advances never split punctuation or identifiers; public projection owns provider failure. */
function width(
  text: string,
  context: ContentContext,
): number {
  const metric = context.style.typography.mono;
  const measured = requireValue(context.metrics.measure(text, metric.font, metric.size));
  if (![measured.width, measured.ascent, measured.descent].every(validDimension))
    return reject('provider-failed', 'metrics', 'Invalid font measurement');
  return measured.width;
}
/** Font-provider dimensions are finite nonnegative geometry or projection rejects them. */
function validDimension(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}
/** Commas bind to their preceding parameter and the result binds to the closing parameter. */
function groups(
  block: Signature,
  context: ContentContext,
): readonly string[] {
  const parameters = block.parameters.map(
    (parameter, index) => parameterText(parameter, context) + suffix(index, block, context),
  );
  if (parameters.length === 0)
    return [`${block.label}(): ${resolvedTypeText(block.returns, context)}`];
  const [first, ...rest] = parameters;
  return [`${block.label}(${first}`, ...rest];
}
/** Last parameter retains closing punctuation and result as one lexical unit. */
function suffix(
  index: number,
  block: Signature,
  context: ContentContext,
): string {
  if (index === block.parameters.length - 1)
    return `): ${resolvedTypeText(block.returns, context)}`;
  return ',';
}

function typeText(type: TypeUse): string {
  return typeof type === 'string' ? type : `@${type.id}`;
}

function resolvedTypeText(
  type: TypeUse,
  context: ContentContext,
): string {
  return context.resolveTypeUse?.(type) ?? typeText(type);
}

function parameterText(
  parameter: string | { readonly name: string; readonly type: TypeUse },
  context: ContentContext,
): string {
  return typeof parameter === 'string'
    ? parameter
    : `${parameter.name}: ${resolvedTypeText(parameter.type, context)}`;
}
/** Punctuation binds to the preceding lexical group so wrapping never creates a symbol-only row. */
function appendMemberUnit(
  groups: Lines,
  unit: string,
): Lines {
  if (/^[^\p{L}\p{N}_$]+$/u.test(unit)) return { ...groups, current: `${groups.current} ${unit}` };
  return { complete: [...groups.complete, groups.current], current: unit };
}
/** Member declarations wrap only at whitespace-delimited lexical groups; identifiers remain whole. */
function memberGroups(
  block: Member,
  context: ContentContext,
): readonly string[] {
  const heading = `${block.visibility} ${block.label}:`;
  const grouped = resolvedTypeText(block.type, context)
    .trim()
    .split(/\s+/u)
    .reduce<Lines>((result, unit) => appendMemberUnit(result, unit), {
      complete: [],
      current: heading,
    });
  return [...grouped.complete, grouped.current];
}
/** A full line moves intact on overflow; an oversized atomic group grows the measured node. */
function append(
  lines: Lines,
  group: string,
  context: ContentContext,
): Lines {
  if (lines.current === '') return { ...lines, current: group };
  return fit(lines, group, context);
}
/** Space-separated groups preserve canonical signature spelling across line boundaries. */
function fit(
  lines: Lines,
  group: string,
  context: ContentContext,
): Lines {
  const candidate = `${lines.current} ${group}`;
  if (width(candidate, context) <= context.width) return { ...lines, current: candidate };
  return { complete: [...lines.complete, lines.current], current: group };
}
/** Structured runs keep a stable address and canonical outline independent of visual wrapping. */
function measured(
  groups: readonly string[],
  label: string,
  id: string,
  context: ContentContext,
): MeasuredContent {
  const lines = groups.reduce<Lines>((state, group) => append(state, group, context), {
    complete: [],
    current: '',
  });
  const text = [...lines.complete, lines.current].join('\n');
  const available = Math.max(context.width, ...groups.map((group) => width(group, context)));
  const content = measureText(
    { text, width: available, ...context.style.typography.mono, fill: context.style.text },
    context.metrics,
  );
  const height =
    Math.max(context.style.contentSizing.rowMinimum, content.height) + context.style.gap * 2;
  return {
    ...offset(content, 0, context.style.gap),
    height,
    anchors: [{ member: id, x: 0, y: height / 2, direction: 'inout', collapsed: false, label }],
    outline: [label],
  };
}
/** Callable rows preserve lexical groups; public project owns rejection and retains the prior scene. */
export function measureSignature(
  block: Signature,
  context: ContentContext,
): MeasuredContent {
  const units = groups(block, context);
  return measured(units, units.join(' '), block.id, context);
}
/** Member rows preserve lexical groups; public project owns rejection and retains the prior scene. */
export function measureMember(
  block: Member,
  context: ContentContext,
): MeasuredContent {
  const label = `${block.visibility} ${block.label}: ${resolvedTypeText(block.type, context)}`;
  return measured(memberGroups(block, context), label, block.id, context);
}
