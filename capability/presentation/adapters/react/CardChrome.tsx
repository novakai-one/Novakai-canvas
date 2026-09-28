import type { ReactElement } from 'react';
import type { Primitive, VisualNode } from '../../contract/records/visual.js';
import type { NodeChromeProps, NodeRenderClasses } from '../../contract/react-types.js';
/** Rounded forms use token radii; pills use their geometric half-height. */
function radius(node: VisualNode): number {
  if (node.frame !== 'auto') return node.radius;
  if (node.shape === 'pill') return node.height / 2;
  return node.radius;
}
/** Media-led frame-free cards exhibit on an ambient halo plus floor shadow; static export stays flat. */
function haloEligible(
  node: VisualNode,
  classes?: NodeRenderClasses,
): boolean {
  return classes !== undefined && node.frame === 'none' && mediaBounds(node) !== undefined;
}
/** Per-node halo identity follows the established chrome paint-server pattern. */
function haloGradientId(node: VisualNode): string {
  return `node-halo-${node.id}`;
}
/** Union of the admitted media rectangles centers the exhibit light on the artwork, not the frame. */
function mediaBounds(
  node: VisualNode,
):
  | { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number }
  | undefined {
  const media = node.content.primitives.filter(
    (item): item is Extract<Primitive, { kind: 'media' }> => item.kind === 'media',
  );
  if (media.length === 0) return undefined;
  return {
    left: Math.min(...media.map((item) => item.x)),
    top: Math.min(...media.map((item) => item.y)),
    right: Math.max(...media.map((item) => item.x + item.width)),
    bottom: Math.max(...media.map((item) => item.y + item.height)),
  };
}
/** Soft radial token glow behind the media band and a squashed floor shadow at the node base. */
function halo(
  node: VisualNode,
  classes?: NodeRenderClasses,
): ReactElement | null {
  if (!haloEligible(node, classes)) return null;
  const bounds = mediaBounds(node);
  if (bounds === undefined) return null;
  const strength = 'var(--nv-canvas-figure-halo-opacity)';
  return (
    <>
      <defs>
        <radialGradient id={haloGradientId(node)}>
          <stop
            offset="0"
            style={{ stopColor: 'var(--nv-canvas-ambient-glow)', stopOpacity: strength }}
          />
          <stop
            offset="0.55"
            style={{
              stopColor: 'var(--nv-canvas-ambient-glow)',
              stopOpacity: `calc(${strength} * 0.45)`,
            }}
          />
          <stop offset="1" style={{ stopColor: 'var(--nv-canvas-ambient-glow)', stopOpacity: 0 }} />
        </radialGradient>
      </defs>
      <ellipse
        cx={(bounds.left + bounds.right) / 2}
        cy={(bounds.top + bounds.bottom) / 2}
        rx={((bounds.right - bounds.left) / 2) * 1.35}
        ry={((bounds.bottom - bounds.top) / 2) * 1.6}
        fill={`url(#${haloGradientId(node)})`}
      />
      <ellipse
        cx={node.width / 2}
        cy={node.height - 2}
        rx={node.width * 0.42}
        ry={9}
        style={{
          fill: 'var(--nv-canvas-node-shadow)',
          opacity: 'var(--nv-canvas-figure-shadow-opacity)',
        }}
      />
    </>
  );
}
/** Diamond bounds expand around the measured inscribed content rectangle. */
function frame(
  node: VisualNode,
  classes?: NodeRenderClasses,
): ReactElement | null {
  if (node.frame === 'none') return null;
  return visibleFrame(node, classes);
}
/** Neutral browser frames carry their own paint server: SVG fill cannot use CSS gradients, and static export keeps flat paint. */
function gradientEligible(
  node: VisualNode,
  classes?: NodeRenderClasses,
): boolean {
  return (
    classes !== undefined &&
    node.followsInterfaceRoles === true &&
    node.role === 'neutral' &&
    node.shape !== 'container'
  );
}
/** Per-node gradient identity follows the established chrome filter pattern. */
function surfaceGradientId(node: VisualNode): string {
  return `node-surface-${node.id}`;
}
/** Vertical edge light: the frame border catches the same top light as the fill gradient. */
function edgeGradientId(node: VisualNode): string {
  return `node-edge-${node.id}`;
}
/** Eligible frames paint the token gradient with the flat projection fill as fallback. */
function frameFill(
  node: VisualNode,
  classes?: NodeRenderClasses,
): string {
  return gradientEligible(node, classes)
    ? `url(#${surfaceGradientId(node)}) ${node.paint.fill}`
    : node.paint.fill;
}
/** Eligible frames stroke a top-to-bottom edge light with the flat projection stroke as fallback. */
function frameStroke(
  node: VisualNode,
  classes?: NodeRenderClasses,
): string {
  return gradientEligible(node, classes)
    ? `url(#${edgeGradientId(node)}) ${node.paint.stroke}`
    : node.paint.stroke;
}
/** Vertical top-to-bottom token gradient; stop colors resolve against the installed scope. */
function surfaceGradient(
  node: VisualNode,
  classes?: NodeRenderClasses,
): ReactElement | null {
  if (!gradientEligible(node, classes)) return null;
  return (
    <defs>
      <linearGradient id={surfaceGradientId(node)} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" style={{ stopColor: 'var(--nv-canvas-node-surface-top)' }} />
        <stop offset="1" style={{ stopColor: 'var(--nv-canvas-node-surface-bottom)' }} />
      </linearGradient>
      <linearGradient id={edgeGradientId(node)} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" style={{ stopColor: 'var(--nv-canvas-node-edge-top)' }} />
        <stop offset="1" style={{ stopColor: 'var(--nv-canvas-node-edge-bottom)' }} />
      </linearGradient>
    </defs>
  );
}
/** Explicit cards/panels use rounded regions; auto retains semantic shape notation. */
function visibleFrame(
  node: VisualNode,
  classes?: NodeRenderClasses,
): ReactElement {
  if (node.shape === 'diamond' && node.frame === 'auto')
    return (
      <polygon
        className={classes?.frame}
        vectorEffect="non-scaling-stroke"
        points={`${node.width / 2},0 ${node.width},${node.height / 2} ${node.width / 2},${node.height} 0,${node.height / 2}`}
        fill={frameFill(node, classes)}
        stroke={frameStroke(node, classes)}
        strokeWidth={node.strokeWidth}
      />
    );
  return (
    <rect
      className={classes?.frame}
      vectorEffect="non-scaling-stroke"
      width={node.width}
      height={node.height}
      rx={radius(node)}
      fill={frameFill(node, classes)}
      stroke={frameStroke(node, classes)}
      strokeWidth={node.strokeWidth}
    />
  );
}
/** Engineering notation has a distinct title compartment; ordinary process cards retain their simpler frame. */
function headerRule(
  node: VisualNode,
  classes?: NodeRenderClasses,
): ReactElement | null {
  if (node.frame !== 'auto') return null;
  return semanticHeaderRule(node, classes);
}
/** Compartment cards keep left-aligned compartments under a separator; panel containers keep left-aligned tab titles. */
const COMPARTMENT_SHAPES: readonly string[] = ['entity', 'module', 'interface', 'function'];
/** Only kind-appropriate auto frames receive a separator, after the measured heading region. */
function semanticHeaderRule(
  node: VisualNode,
  classes?: NodeRenderClasses,
): ReactElement | null {
  if (!COMPARTMENT_SHAPES.includes(node.shape)) return null;
  if (node.height <= node.headerHeight) return null;
  return (
    <line
      className={classes?.separator}
      x1={0}
      x2={node.width}
      y1={node.headerHeight}
      y2={node.headerHeight}
      stroke={node.paint.stroke}
      strokeWidth={node.strokeWidth}
      vectorEffect="non-scaling-stroke"
    />
  );
}
/** Browser-only header paint adds hierarchy without changing measured bounds or static output. */
function header(
  node: VisualNode,
  classes?: NodeRenderClasses,
): ReactElement | null {
  if (classes === undefined || node.frame !== 'auto') return null;
  if (!COMPARTMENT_SHAPES.includes(node.shape)) return null;
  const corner = Math.min(radius(node), node.headerHeight / 2);
  const path = `M${corner} 0 H${node.width - corner} Q${node.width} 0 ${node.width} ${corner} V${node.headerHeight} H0 V${corner} Q0 0 ${corner} 0 Z`;
  return <path className={classes.header} d={path} />;
}
/** The top-facing rim catches light without outlining the entire body a second time. */
function rim(
  node: VisualNode,
  classes?: NodeRenderClasses,
): ReactElement | null {
  if (classes === undefined || node.frame === 'none' || node.shape === 'diamond') return null;
  const inset = node.strokeWidth / 2;
  return (
    <path
      className={classes.rim}
      d={`M${inset} ${radius(node)} Q${inset} ${inset} ${radius(node)} ${inset} H${node.width - radius(node)} Q${node.width - inset} ${inset} ${node.width - inset} ${radius(node)}`}
      vectorEffect="non-scaling-stroke"
    />
  );
}
/** Comet ring: a normalized-perimeter outline the primary-selection CSS animates; hidden by default. */
function ring(
  node: VisualNode,
  classes?: NodeRenderClasses,
): ReactElement | null {
  if (classes === undefined || node.frame === 'none' || node.shape === 'diamond') return null;
  const r = radius(node);
  const w = node.width;
  const h = node.height;
  return (
    <path
      className={classes.ring}
      d={`M${r} 0 H${w - r} Q${w} 0 ${w} ${r} V${h - r} Q${w} ${h} ${w - r} ${h} H${r} Q0 ${h} 0 ${h - r} V${r} Q0 0 ${r} 0 Z`}
      pathLength={100}
      vectorEffect="non-scaling-stroke"
    />
  );
}
/** Shared browser roles skin the frame; absent roles preserve native/static markup and paint. */
export function CardChrome({ node, heading, classes }: NodeChromeProps): ReactElement {
  return (
    <>
      {halo(node, classes)}
      {surfaceGradient(node, classes)}
      {frame(node, classes)}
      {header(node, classes)}
      {rim(node, classes)}
      {ring(node, classes)}
      {headerRule(node, classes)}
      {heading}
    </>
  );
}
