import type { ReactElement } from 'react';
import type { ContentBlocksProps } from '../../contract/react-types.js';
import type { Primitive } from '../../contract/records/visual.js';
import { contextualAlternates } from '../../contract/records/style.js';
/** Measured text uses digest-derived family and exact advance; JSX escapes source text. */
function text(
  item: Extract<Primitive, { kind: 'text' }>,
  key: number,
): ReactElement {
  return (
    <text
      key={key}
      xmlSpace="preserve"
      style={{
        whiteSpace: 'pre',
        fontKerning: 'normal',
        fontFeatureSettings: `"calt" ${Number(contextualAlternates)}`,
      }}
      x={item.x}
      y={item.y}
      fill={item.fill}
      fontFamily={`canvas-${item.font.digest}`}
      fontSize={item.size}
      textLength={item.width}
      lengthAdjust="spacingAndGlyphs"
    >
      {item.text}
    </text>
  );
}
/** Safe admitted media retains the requested fit inside its explicit measured box. */
function media(
  item: Extract<Primitive, { kind: 'media' }>,
  key: number,
): ReactElement {
  const fit = { contain: 'xMidYMid meet', cover: 'xMidYMid slice' };
  return (
    <svg
      key={key}
      x={item.x}
      y={item.y}
      width={item.width}
      height={item.height}
      overflow="hidden"
      aria-label={item.alt}
    >
      <image
        pointerEvents="none"
        x={0}
        y={0}
        width={item.width}
        height={item.height}
        href={item.dataUri}
        preserveAspectRatio={fit[item.fit]}
      >
        <title>{item.alt}</title>
      </image>
    </svg>
  );
}
/** Rule geometry is already measured; the renderer never recalculates table rows. */
function rule(
  item: Extract<Primitive, { kind: 'rule' }>,
  key: number,
): ReactElement {
  return (
    <line
      key={key}
      vectorEffect="non-scaling-stroke"
      x1={item.x1}
      y1={item.y1}
      x2={item.x2}
      y2={item.y2}
      stroke={item.stroke}
      strokeWidth={item.width}
    />
  );
}
/** Narrowing selects only declarative primitive rendering, not semantic diagram policy. */
function primitive(
  item: Primitive,
  key: number,
): ReactElement {
  if (item.kind === 'text') return text(item, key);
  return nonText(item, key);
}
/** Image and line are the remaining closed primitive variants. */
function nonText(
  item: Exclude<Primitive, { kind: 'text' }>,
  key: number,
): ReactElement {
  if (item.kind === 'media') return media(item, key);
  return decoration(item, key);
}
/** Shared block renderer owns escaping and local primitives for both interactive nodes and static export. */
export function ContentBlocks({ primitives }: ContentBlocksProps): ReactElement {
  return <g>{primitives.map(primitive)}</g>;
}

/** Badge fill and line geometry were measured before routing; no renderer-owned dimensions. */
function decoration(
  item: Extract<Primitive, { kind: 'badge' | 'rule' }>,
  key: number,
): ReactElement {
  if (item.kind === 'rule') return rule(item, key);
  return (
    <rect
      key={key}
      data-badge="true"
      data-role={item.role}
      x={item.x}
      y={item.y}
      width={item.width}
      height={item.height}
      rx={item.radius}
      fill={item.fill}
      stroke={item.stroke}
      strokeWidth={item.strokeWidth}
    />
  );
}
