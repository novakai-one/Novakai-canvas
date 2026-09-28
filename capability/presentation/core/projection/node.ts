import type { Appearance, DiagramObject, Group, Section } from '../../contract/records/input.js';
import { chromeResolvedStyle } from '../../contract/records/style.js';
import type { Paint } from '../../contract/records/style.js';
import type { MeasuredContent, VisualNode } from '../../contract/records/visual.js';
import { sceneId } from '../../contract/brands.js';
import { visualNode } from '../../contract/records/visual.js';
import type { ContentContext } from '../content/blocks.js';
import { offset } from '../content/text.js';
import { labelContent } from '../content/headings.js';
import { visibleBody } from '../content/node-body.js';
import { composeNodeContent } from '../content/composition.js';
import { moduleChrome } from '../content/chrome.js';
import { nodeShape } from '../notation/nodes.js';
import { planContent } from '../content/sizing.js';
import { parse, reject } from '../validation/outcomes.js';
/** Build a section-scoped scene identity; public project owns rejection and retains the prior scene. */
export function identity(
  section: string,
  kind: 'object' | 'group',
  id: string,
): VisualNode['id'] {
  return parse(sceneId, `${section}:${kind}:${id}`);
}
/** Resolve canonical content once; a broken injected domain reader fails visibly. */
function object(
  id: string,
  context: ContentContext,
): DiagramObject {
  const found = context.collection.objects.find((item) => item.id === id);
  if (!found) return reject('invalid-input', id, 'Visible object is missing');
  return found;
}
/** Parent containers are addressed in the same section scope. */
function parent(
  section: string,
  id: string | undefined,
): VisualNode['parent'] {
  if (id === undefined) return null;
  return identity(section, 'group', id);
}
interface NodeFrame {
  readonly content: MeasuredContent;
  readonly width: number;
  readonly height: number;
}
/** Measured minimum grows for wide glyphs/tables and leaves diamond content in its inscribed rectangle. */
function frame(
  content: MeasuredContent,
  shape: VisualNode['shape'],
  context: ContentContext,
): NodeFrame {
  const scale = shape === 'diamond' ? 2 : 1;
  const width = (Math.max(context.width, content.width) + context.style.padding * 2) * scale;
  const height = (content.height + context.style.padding * 2) * scale;
  return {
    content: offset(
      content,
      context.style.padding + ((width / scale) * (scale - 1)) / 2,
      context.style.padding + ((height / scale) * (scale - 1)) / 2,
    ),
    width,
    height,
  };
}
/** Project one appearance without committing; public project reports failure and Authoring retains the prior scene. */
export function projectNode(
  view: Appearance,
  section: Section,
  context: ContentContext,
  compact = true,
): VisualNode {
  const source = object(view.object, context);
  const role = view.role ?? source.role;
  const size = view.size ?? source.size;
  const sequence = sequencePresentation(source, view, section);
  const shape = sequence.shape;
  const presentationSource = sequence.source;
  const appearance = appearanceContext(view, role, size, shape, { ...context, owner: source });
  const initial = contentForeground(view.frame ?? source.frame, view.group, section, appearance);
  const visible = visibleBody(source, view.detail);
  const scoped = plannedContext(
    { ...presentationSource, content: visible.content },
    initial,
    context.style.contentSizing.widths[size],
    view.placement?.width !== undefined,
  );
  const composed = composeNodeContent(
    presentationSource,
    visible,
    view.composition ?? source.composition,
    headingGap(shape, context),
    compositionContext(sequence.module, scoped),
  );
  const treeRow = compactTreeRow(section, view, source, context, compact);
  return parse(visualNode, {
    ...(context.style.followsInterfaceRoles === true
      ? { followsInterfaceRoles: true as const }
      : {}),
    ...chromeStyle(
      chromeSource(sequence.module, presentationSource),
      view.frame ?? source.frame,
      context,
    ),
    id: identity(section.id, 'object', source.id),
    objectId: source.id,
    groupId: null,
    sectionId: section.id,
    navigation: source.content
      .filter((block) => block.kind === 'link')
      .map((block) => ({ member: block.id, label: block.label, target: block.target })),
    kind: source.kind,
    label: source.label,
    role,
    size,
    shape,
    frame: view.frame ?? source.frame,
    paint: rolePaint(role, context),
    ...frame(composed.content, shape, scoped),
    headerHeight: composed.headerHeight + context.style.padding * 2,
    radius: context.style.radius,
    strokeWidth: context.style.stroke,
    placement: view.placement ?? null,
    parent: parent(section.id, view.group),
    ...(treeRow === undefined
      ? {}
      : {
          content: treeRow.content,
          width: treeRow.width,
          height: treeRow.height,
          headerHeight: treeRow.height,
          treeRow,
        }),
  });
}

function sequencePresentation(
  source: DiagramObject,
  view: Appearance,
  section: Section,
): {
  readonly shape: VisualNode['shape'];
  readonly source: DiagramObject;
  readonly module: boolean;
} {
  if (!isSequenceModuleParticipant(source, view, section))
    return {
      shape: appearanceShape(source.kind, view.frame ?? source.frame),
      source,
      module: false,
    };
  return { shape: 'participant', source, module: true };
}

function compositionContext(
  module: boolean,
  context: ContentContext,
): ContentContext {
  if (!module) return context;
  return { ...context, chromePolicies: {} };
}

function chromeSource(
  module: boolean,
  source: DiagramObject,
): DiagramObject {
  return module ? participantSource(source) : source;
}

function isSequenceModuleParticipant(
  source: DiagramObject,
  view: Appearance,
  section: Section,
): boolean {
  if (section.mode !== 'sequence') return false;
  if (!isDirectModuleAppearance(source, view)) return false;
  return section.sequence.some(
    (item) => item.kind === 'event' && (item.source === source.id || item.target === source.id),
  );
}

function isDirectModuleAppearance(
  source: DiagramObject,
  view: Appearance,
): boolean {
  return source.kind === 'module' && view.group === undefined;
}

function participantSource(source: DiagramObject): DiagramObject {
  return { ...source, kind: 'participant' };
}
function compactTreeRow(
  section: Section,
  view: Appearance,
  source: DiagramObject,
  context: ContentContext,
  enabled: boolean,
):
  | {
      readonly content: MeasuredContent;
      readonly width: number;
      readonly height: number;
      readonly gutter: number;
    }
  | undefined {
  if (
    ![
      enabled,
      section.mode === 'tree',
      treeParticipant(view, source),
      source.content.length === 0,
      source.ports.length === 0,
    ].every(Boolean)
  )
    return undefined;
  const label = labelContent(source.label, context, 'mono');
  const icon = context.style.contentSizing.iconBox.small;
  const padding = context.style.gap / 2;
  const gutter = icon + context.style.gap;
  const width = label.width + gutter + padding * 2;
  const height = Math.max(label.height, icon) + padding * 2;
  const taggedLabel = {
    ...label,
    primitives: label.primitives.map((primitive) => ({
      ...primitive,
      lodRole: 'heading' as const,
    })),
  };
  return {
    content: {
      ...offset(taggedLabel, padding + gutter, padding),
      width,
      height,
    },
    width,
    height,
    gutter,
  };
}
function treeParticipant(
  view: Appearance,
  source: DiagramObject,
): boolean {
  if (view.participation !== undefined) return view.participation === 'tree';
  return source.kind !== 'note';
}
/** Explicit chrome changes visual geometry only; the canonical kind and member anchors remain unchanged. */
function appearanceShape(
  kind: DiagramObject['kind'],
  frame: VisualNode['frame'],
): VisualNode['shape'] {
  if (frame === 'auto') return nodeShape(kind);
  if (frame === 'panel') return 'container';
  return 'card';
}
/** Engineering cards reserve a padded header compartment; body content starts below its separator. */
function headingGap(
  shape: VisualNode['shape'],
  context: ContentContext,
): number {
  if (['entity', 'module', 'interface', 'function'].includes(shape))
    return context.style.padding + context.style.gap;
  return context.style.gap;
}
/** Reserve represented content or an ordinary title; public project owns rejection and Authoring retains the prior scene. */
export function projectGroup(
  group: Group,
  section: Section,
  context: ContentContext,
): VisualNode {
  if (group.represents !== undefined) return represented(group, section, context);
  const appearance = scopedContext(group.placement, group.role, 'medium', 'container', context);
  const initial = contentForeground(group.frame, group.parent, section, appearance);
  const scoped = plannedContext(
    { label: group.title, content: [] },
    initial,
    context.style.contentSizing.widths.medium,
    group.placement?.width !== undefined,
  );
  const heading = labelContent(group.title, scoped, 'nodeHeading');
  return parse(visualNode, {
    ...(context.style.followsInterfaceRoles === true
      ? { followsInterfaceRoles: true as const }
      : {}),
    id: identity(section.id, 'group', group.id),
    objectId: null,
    groupId: group.id,
    sectionId: section.id,
    navigation: [],
    kind: 'group',
    label: group.title,
    role: group.role,
    size: 'medium',
    shape: 'container',
    frame: group.frame,
    paint: rolePaint(group.role, context),
    ...frame(heading, 'container', scoped),
    headerHeight: heading.height + context.style.padding * 2,
    radius: context.style.radius,
    strokeWidth: context.style.stroke,
    placement: group.placement ?? null,
    parent: parent(section.id, group.parent),
  });
}
/** Reuse object measurement while preserving the group's distinct identity and parent scope. */
function represented(
  group: Group,
  section: Section,
  context: ContentContext,
): VisualNode {
  const source = group.represents;
  if (source === undefined)
    return reject('invalid-input', group.id, 'Represented object is missing');
  const node = projectNode(
    {
      ...withinGroup(placedView(source, group.placement), group.parent),
      role: group.role,
      frame: group.frame,
    },
    section,
    context,
    false,
  );
  return {
    ...node,
    id: identity(section.id, 'group', group.id),
    groupId: group.id,
    shape: 'container',
    headerHeight: node.height,
    parent: parent(section.id, group.parent),
    placement: group.placement ?? null,
  };
}

/** Role paint supplies content foreground as well as frame colours; missing roles fail at the public boundary. */
function rolePaint(
  role: string,
  context: ContentContext,
): Paint {
  const paint = context.style.roles[role];
  if (!paint) return reject('missing-resource', role, 'Appearance role is unavailable');
  return paint;
}
/** View overrides use the same context policy as ordinary and represented groups. */
function appearanceContext(
  view: Appearance,
  role: string,
  size: VisualNode['size'],
  shape: VisualNode['shape'],
  context: ContentContext,
): ContentContext {
  return scopedContext(view.placement, role, size, shape, context);
}
/** UI width describes outer bounds; text uses the interior after frame padding and shape inset. */
function scopedContext(
  placement: Appearance['placement'],
  role: string,
  size: 'small' | 'medium' | 'large',
  shape: VisualNode['shape'],
  context: ContentContext,
): ContentContext {
  const paint = rolePaint(role, context);
  return {
    ...context,
    width: contentWidth(
      placement,
      context.style.contentSizing.widths[size].preferred,
      shape,
      context.style.padding,
    ),
    style: {
      ...context.style,
      text: paint.text,
      border: paint.stroke,
      secondary: paint.secondary ?? context.style.secondary,
    },
  };
}
/** Preferred token width is used only when there is no authored width override. */
function contentWidth(
  placement: Appearance['placement'],
  preferred: number,
  shape: VisualNode['shape'],
  padding: number,
): number {
  const width = placement?.width;
  if (width === undefined) return preferred;
  return insetWidth(width, shape, padding);
}
/** Inscribed diamond content has half the outer width; an impossibly small box retains a positive minimum. */
function insetWidth(
  width: number,
  shape: VisualNode['shape'],
  padding: number,
): number {
  const scale = shape === 'diamond' ? 2 : 1;
  return Math.max(1, width / scale - padding * 2);
}
/** Optional placement is copied explicitly so exact optional property semantics remain intact. */
function placedView(
  object: Appearance['object'],
  placement: Appearance['placement'],
): Appearance {
  const view: Appearance = { object, detail: 'full' };
  if (placement === undefined) return view;
  return { ...view, placement };
}

/** Shared intrinsic sizing replaces duplicate node/group planning policy. */
function plannedContext(
  source: Pick<DiagramObject, 'label' | 'content'>,
  context: ContentContext,
  band: { readonly preferred: number; readonly maximum: number },
  explicit: boolean,
): ContentContext {
  const plan = planContent(source, context, band, explicit);
  return { ...context, width: plan.width };
}

/** Frame-free text inherits its visible container foreground, avoiding white text on an absent role fill. */
function contentForeground(
  frame: VisualNode['frame'],
  group: Appearance['group'],
  section: Section,
  context: ContentContext,
): ContentContext {
  if (frame !== 'none') return context;
  const role = containerRole(group, section.groups);
  const paint = rolePaint(role, context);
  return { ...context, style: { ...context.style, text: paint.text } };
}
/** Model has already rejected containment cycles; transparent regions inherit from their nearest painted ancestor. */
function containerRole(
  id: Group['parent'],
  groups: readonly Group[],
): string {
  return paintedRole(
    groups.find((group) => group.id === id),
    groups,
  );
}
/** An absent parent is the section surface; its neutral role supplies the readable foreground. */
function paintedRole(
  group: Group | undefined,
  groups: readonly Group[],
): string {
  if (group === undefined) return 'neutral';
  if (group.frame !== 'none') return group.role;
  return containerRole(group.parent, groups);
}

/** Resolve parent context before measuring represented content; foreground depends on the visible ancestor. */
function withinGroup(
  view: Appearance,
  parent: Group['parent'],
): Appearance {
  if (parent === undefined) return view;
  return { ...view, group: parent };
}

/** Legacy nodes retain their exact transport shape; selected module chromes carry resolved tokens. */
function chromeStyle(
  object: DiagramObject,
  frame: VisualNode['frame'],
  context: ContentContext,
): Pick<VisualNode, 'chromeStyle'> {
  if (!['auto', 'card'].includes(frame)) return {};
  if (moduleChrome(object, context) === undefined) return {};
  return { chromeStyle: parse(chromeResolvedStyle, context.style) };
}
