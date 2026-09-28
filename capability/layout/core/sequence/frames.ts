import type { VisualSequenceItem, MeasuredContent } from '../../contract/records/input.js';
import type { Box, FragmentFrame } from '../../contract/records/geometry.js';
import type { SequenceContext, Body, FragmentInput } from './records.js';
import { eventBody } from './events.js';
import { union, pointBounds } from '../geometry/bounds.js';
import { reject } from '../validation/outcomes.js';
/** Scoped items follow canonical local order; parent and branch jointly determine their body. */
function children(
  context: SequenceContext,
  parent: string | null,
  branch: string | null,
): readonly VisualSequenceItem[] {
  return context.section.sequence
    .filter(
      (input) => (input.item.parent ?? null) === parent && (input.item.branch ?? null) === branch,
    )
    .toSorted((a, b) => a.item.order - b.item.order);
}
/** Walk one ordered body; each complete event/frame advances the next item's vertical origin.
 * @throws LayoutFault with invalid-input when an alternative branch heading measurement is absent.
 * The public createLayout().arrange facade catches it through execute and returns a typed failure;
 * Authoring retains the committed scene while the caller corrects measurements and retries.
 */
export function body(
  context: SequenceContext,
  parent: string | null,
  branch: string | null,
  top: number,
): Body {
  const initial: Body = { bottom: top, events: [], fragments: [] };
  return children(context, parent, branch).reduce(
    (result, input) => append(result, itemBody(input, result.bottom, context)),
    initial,
  );
}
/** Combine immutable geometry while retaining source order and nested frame identities. */
function append(
  previous: Body,
  next: Body,
): Body {
  return {
    bottom: next.bottom,
    events: [...previous.events, ...next.events],
    fragments: [...previous.fragments, ...next.fragments],
  };
}
/** Only the canonical discriminant selects sequence policy; no label or ID string parsing is involved. */
function itemBody(
  input: VisualSequenceItem,
  top: number,
  context: SequenceContext,
): Body {
  if (input.item.kind === 'event') return eventBody({ ...input, item: input.item }, top, context);
  return fragmentBody({ ...input, item: input.item }, top, context);
}
/** A measured heading reserves full width and height before any contained event/branch. */
function heading(
  content: MeasuredContent,
  top: number,
  context: SequenceContext,
): Box {
  return {
    x: context.extent.x - context.options.padding,
    y: top,
    width: content.width,
    height: content.height,
  };
}
/** Frame bounds include the complete child geometry plus a padding border. */
function frameBox(
  header: Box,
  content: Body,
  context: SequenceContext,
  branches: FragmentFrame['branches'] = [],
): Box {
  const geometry = union([
    header,
    ...content.events.flatMap((event) => [event.labelBox, pointBounds(event.points)]),
    ...content.fragments.map((frame) => frame.box),
    ...branches.map((branch) => branch.box),
    {
      x: context.extent.x,
      y: header.y,
      width: context.extent.width,
      height: Math.max(1, content.bottom - header.y),
    },
  ]);
  return {
    x: geometry.x - context.options.padding,
    y: header.y - context.options.padding,
    width: geometry.width + context.options.padding * 2,
    height: geometry.height + context.options.padding * 2,
  };
}
interface BranchBody {
  readonly body: Body;
  readonly branches: FragmentFrame['branches'];
}
/** Branch labels come from required Presentation measurements, never guessed character widths. */
function branchHeading(
  fragment: string,
  branch: string,
  context: SequenceContext,
): MeasuredContent {
  const found = context.metrics.branchHeadings.find(
    (item) =>
      item.section === context.section.id && item.fragment === fragment && item.branch === branch,
  );
  if (!found) return reject('invalid-input', branch, 'Measured alternative heading is missing');
  return found.content;
}
/** Each alternative has a separate measured header and ordered nested body. */
function nextBranch(
  previous: BranchBody,
  branch: FragmentInput['item']['branches'][number],
  fragment: FragmentInput,
  context: SequenceContext,
): BranchBody {
  const content = branchHeading(fragment.item.id, branch.id, context);
  const labelBox = heading(content, previous.body.bottom, context);
  const nested = body(
    context,
    fragment.item.id,
    branch.id,
    labelBox.y + labelBox.height + context.options.sequenceGap,
  );
  const box = frameBox(labelBox, nested, context);
  return {
    body: append(previous.body, {
      ...nested,
      bottom: box.y + box.height + context.options.sequenceGap,
    }),
    branches: [...previous.branches, { id: branch.id, box, labelBox, content }],
  };
}
/** Unbranched opt/loop bodies and ordered alt branches share the same vertical cursor contract. */
function fragmentContents(
  input: FragmentInput,
  top: number,
  context: SequenceContext,
): BranchBody {
  if (input.item.branches.length === 0)
    return { body: body(context, input.item.id, null, top), branches: [] };
  const initial: BranchBody = { body: { bottom: top, events: [], fragments: [] }, branches: [] };
  return input.item.branches.reduce(
    (previous, branch) => nextBranch(previous, branch, input, context),
    initial,
  );
}
/** Nested frames reserve their own heading and border rather than obscuring child control flow. */
function fragmentBody(
  input: FragmentInput,
  top: number,
  context: SequenceContext,
): Body {
  const labelBox = heading(input.label, top + context.options.padding, context);
  const nested = fragmentContents(
    input,
    labelBox.y + labelBox.height + context.options.sequenceGap + context.options.padding,
    context,
  );
  const box = frameBox(labelBox, nested.body, context, nested.branches);
  const frame: FragmentFrame = {
    id: input.item.id,
    parent: input.item.parent ?? null,
    box,
    labelBox,
    content: input.label,
    branches: nested.branches,
  };
  return {
    bottom: box.y + box.height + context.options.sequenceGap,
    events: nested.body.events,
    fragments: [frame, ...nested.body.fragments],
  };
}
