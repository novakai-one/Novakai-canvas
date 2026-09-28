import type { ReactElement, ComponentType } from 'react';
import type {
  NodeContentProps,
  NodeSlots,
  MarkerProps,
  MeasuredContentProps,
  FontDefinitionsProps,
  NodeChrome,
  NodeChromeRegistry,
} from '../../contract/react-types.js';
import type { ChromeName } from '../../contract/records/chrome.js';
import type { FontSet } from '../../contract/records/style.js';
import type { VisualNode, Primitive } from '../../contract/records/visual.js';
import type { MarkerFactory } from '../../contract/records/marker.js';
/** Embedded font rules contain only validated digest/base64/MIME values, never authored CSS. */
function fontRules(fonts: FontSet): string {
  return fonts
    .map(
      (font) =>
        `@font-face{font-family:canvas-${font.digest};src:url(data:${font.mediaType};base64,${font.base64});font-weight:400;font-style:normal;}`,
    )
    .join('');
}
const LEFT_ALIGNED_SHAPES: readonly string[] = [
  'entity',
  'module',
  'interface',
  'function',
  'container',
];
const COMPARTMENT_KINDS: readonly string[] = ['entity', 'module', 'interface', 'function'];
interface HorizontalBounds {
  readonly left: number;
  readonly right: number;
}
/** Primitive coordinates already include frame padding and shape insets. */
function horizontalBounds(primitive: Primitive): HorizontalBounds {
  if (primitive.kind === 'rule')
    return {
      left: Math.min(primitive.x1, primitive.x2),
      right: Math.max(primitive.x1, primitive.x2),
    };
  return { left: primitive.x, right: primitive.x + primitive.width };
}
/** Center the painted content bounds, including only slack introduced outside measurement. */
function contentSlack(node: VisualNode): number {
  if (LEFT_ALIGNED_SHAPES.includes(node.shape)) return 0;
  const bounds = node.content.primitives.map(horizontalBounds);
  if (bounds.length === 0) return 0;
  const left = Math.min(...bounds.map((bound) => bound.left));
  const right = Math.max(...bounds.map((bound) => bound.right));
  return node.width / 2 - (left + right) / 2;
}
/** Compartment headings center against the final frame width; bodies stay left-aligned. */
function headingSlack(
  node: VisualNode,
  heading: readonly Primitive[],
): number {
  if (!COMPARTMENT_KINDS.includes(node.kind)) return 0;
  const bounds = heading.map(horizontalBounds);
  if (bounds.length === 0) return 0;
  const left = Math.min(...bounds.map((bound) => bound.left));
  const right = Math.max(...bounds.map((bound) => bound.right));
  return Math.max(0, node.width / 2 - (left + right) / 2);
}
/** Bind stable slots once; no component type is created during a React render. */
export function createContentRenderer(
  fonts: FontSet,
  slots: NodeSlots,
): ComponentType<NodeContentProps> {
  const css = fontRules(fonts);
  const Blocks = slots.ContentBlocks;
  /** Render validated measured node props; the host reports React failures and retains its current scene. */
  function NodeContent({
    node,
    embedFonts = true,
    surface = 'static',
    detail = 'full',
    emphasis = 'normal',
    hovered = false,
  }: NodeContentProps): ReactElement {
    const chrome = resolveChrome(slots.chromes, node.chromeStyle?.chrome ?? 'card');
    const Chrome = chrome.Component;
    const content = compartments(
      node,
      separatesHeading(node, chrome, slots.classes),
      surface,
      detail,
    );
    return (
      <svg
        className={slots.classes?.root}
        display="block"
        overflow="visible"
        xmlns="http://www.w3.org/2000/svg"
        width={node.width}
        height={node.height}
        viewBox={`0 0 ${node.width} ${node.height}`}
        role="img"
        aria-label={node.label}
        data-shape={node.shape}
        data-frame={node.frame}
        data-follows-interface-roles={node.followsInterfaceRoles}
        data-node-role={node.role}
        data-node-id={node.id}
        data-emphasis={emphasis}
        data-hovered={hovered}
      >
        <title>{node.label}</title>
        {embedFonts && <style>{css}</style>}
        <Chrome
          node={node}
          style={node.chromeStyle}
          classes={slots.classes}
          heading={
            <g
              className={slots.classes?.heading}
              transform={headingTransform(node, content.heading, detail)}
            >
              <Blocks primitives={content.heading} />
            </g>
          }
        />
        <g className={slots.classes?.body} transform={`translate(${contentSlack(node)} 0)`}>
          <Blocks primitives={content.body} />
        </g>
      </svg>
    );
  }
  return NodeContent;
}
/** Browser engineering cards expose heading/body paint roles; every other renderer keeps prior grouping. */
function separatesHeading(
  node: VisualNode,
  chrome: NodeChrome,
  classes: NodeSlots['classes'],
): boolean {
  if (chrome.separateHeading === true) return true;
  return classes !== undefined && COMPARTMENT_KINDS.includes(node.kind);
}
/** Only own registered names select a chrome; inherited and absent keys retain the card frame. */
function resolveChrome(
  chromes: NodeChromeRegistry,
  name: ChromeName | 'card',
): NodeChrome {
  if (!Object.hasOwn(chromes, name)) return chromes.card;
  return chromes[name] ?? chromes.card;
}
/** Marker geometry is injected from the owned notation policy; hosts only orient the returned local shape. */
export function createMarkerRenderer(draw: MarkerFactory): ComponentType<MarkerProps> {
  /** Render shared local notation; the host owns orientation and rendering-error recovery. */
  function Marker({ kind, paint }: MarkerProps): ReactElement {
    const drawing = draw(kind);
    const fill = drawing.filled ? paint.stroke : 'none';
    return (
      <svg
        overflow="visible"
        xmlns="http://www.w3.org/2000/svg"
        width="28"
        height="16"
        viewBox="-26 -8 28 16"
        role="img"
        aria-label={kind}
        data-marker={kind}
      >
        {drawing.paths.map((path, index) => (
          <path key={index} d={path} stroke={paint.stroke} fill={fill} />
        ))}
        {drawing.circles.map((circle, index) => (
          <circle
            key={index}
            cx={circle.x}
            cy={circle.y}
            r={circle.radius}
            fill={paint.fill}
            stroke={paint.stroke}
          />
        ))}
      </svg>
    );
  }
  return Marker;
}

/** Bind the existing primitive/font path for wire labels, titles and sequence annotations; host owns render recovery. */
export function createMeasuredRenderer(
  fonts: FontSet,
  slots: NodeSlots,
): ComponentType<MeasuredContentProps> {
  const css = fontRules(fonts);
  const Blocks = slots.ContentBlocks;
  /** Render admitted measured content at its exact bounds; no wrapping, frame or typography policy is introduced. */
  function MeasuredContent({ content, embedFonts = true }: MeasuredContentProps): ReactElement {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width={content.width}
        height={content.height}
        viewBox={`0 0 ${content.width} ${content.height}`}
        role="img"
        aria-label={content.outline.join('; ')}
      >
        {embedFonts && <style>{css}</style>}
        <Blocks primitives={content.primitives} />
      </svg>
    );
  }
  return MeasuredContent;
}

/** Export can embed the same owned font rules once per scene rather than once per node/label. */
export function createFontDefinitions(boundFonts: FontSet): ComponentType<FontDefinitionsProps> {
  /** Current document fonts replace installation defaults without rebinding any sibling renderer. */
  function FontDefinitions({ fonts = boundFonts }: FontDefinitionsProps): ReactElement {
    return <style>{fontRules(fonts)}</style>;
  }
  return FontDefinitions;
}

/** Chrome can position shared measured heading text; body primitives and ports never enter its slot. */
function compartments(
  node: VisualNode,
  separate: boolean | undefined,
  surface: NonNullable<NodeContentProps['surface']>,
  detail: NonNullable<NodeContentProps['detail']>,
): { readonly heading: readonly Primitive[]; readonly body: readonly Primitive[] } {
  const visible = node.content.primitives.filter((item) =>
    visibleAtDetail(node, item, surface, detail),
  );
  if (!separate) return { heading: [], body: visible };
  const heading = (item: Primitive): boolean => headingPrimitive(node, item);
  return {
    heading: visible.filter(heading),
    body: visible.filter((item) => !heading(item)),
  };
}

/** Explicit roles replace geometry classification only for the semantic LOD kinds introduced here. */
function headingPrimitive(
  node: VisualNode,
  primitive: Primitive,
): boolean {
  if (['module', 'entity', 'function', 'interface'].includes(node.kind))
    return primitive.lodRole === 'heading';
  return primitive.kind === 'text' && primitive.y <= node.headerHeight;
}

/** Overview enlarges the heading to fill its card, so a zoomed-out card still shows its name. */
const OVERVIEW_FILL = 0.9;
const OVERVIEW_MAX_SCALE = 3;
function headingTransform(
  node: VisualNode,
  heading: readonly Primitive[],
  detail: NonNullable<NodeContentProps['detail']>,
): string {
  const box = detail === 'overview' ? textBox(heading) : null;
  if (box === null) return `translate(${headingSlack(node, heading)} 0)`;
  const scale = Math.min(
    OVERVIEW_MAX_SCALE,
    (node.width * OVERVIEW_FILL) / box.width,
    (node.height * OVERVIEW_FILL) / box.height,
  );
  const x = node.width / 2 - (box.x + box.width / 2) * scale;
  const y = node.height / 2 - (box.y + box.height / 2) * scale;
  return `translate(${x} ${y}) scale(${scale})`;
}
/** Text y is the baseline; the box spans the font's ascent and descent. */
function textBox(
  primitives: readonly Primitive[],
): { x: number; y: number; width: number; height: number } | null {
  const texts = primitives.filter((item) => item.kind === 'text');
  if (texts.length === 0) return null;
  const left = Math.min(...texts.map((item) => item.x));
  const right = Math.max(...texts.map((item) => item.x + item.width));
  const top = Math.min(...texts.map((item) => item.y - item.size * 0.8));
  const bottom = Math.max(...texts.map((item) => item.y + item.size * 0.2));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** Canvas filters explicit semantics only; static output and unrelated notation retain admitted content. */
function visibleAtDetail(
  node: VisualNode,
  primitive: Primitive,
  surface: NonNullable<NodeContentProps['surface']>,
  detail: NonNullable<NodeContentProps['detail']>,
): boolean {
  if (surface === 'static') return true;
  if (primitive.lodRole === undefined) return true;
  return detailFilters[detail](node, primitive);
}

type DetailFilter = (node: VisualNode, primitive: Primitive) => boolean;
const detailFilters: Readonly<Record<NonNullable<NodeContentProps['detail']>, DetailFilter>> = {
  overview: (_node, primitive) => primitive.lodRole === 'heading',
  names: (_node, primitive) => primitive.lodRole === 'heading',
  members: () => true,
  full: () => true,
};
