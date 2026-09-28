import { memo, useSyncExternalStore } from 'react';
import { EdgeLabelRenderer } from '@xyflow/react';
import type { ComponentType, ReactElement } from 'react';
import type {
  SceneEdgeProps,
  RenderSlots,
  WireLabelProps,
  EdgeData,
} from '../../contract/react-types.js';
import type { DragPreview } from '../../contract/ports/session.js';
import type { ViewWire } from '../../contract/records/view.js';
import type { RoutedWire } from '../../contract/records/scene.js';
import type { Point, Box } from '../../contract/records/camera.js';
import styles from './SceneEdge.module.css';
/** Preview routes may be endpoint-stretched; admitted routes retain the native routing path exactly. */
function wirePath(points: readonly Point[]): string {
  return points.map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x} ${point.y}`).join(' ');
}
/** Marker local +x faces toward its endpoint; source and target have opposite route tangents. */
function endpointTransform(
  point: Point,
  neighbor: Point,
): string {
  const angle = (Math.atan2(point.y - neighbor.y, point.x - neighbor.x) * 180) / Math.PI;
  return `translate(${point.x} ${point.y}) rotate(${angle}) translate(-26 -8)`;
}
/** Dashed routes use the measured theme pattern; solid routes have no dash attribute. */
function wireDash(wire: RoutedWire): string | undefined {
  if (wire.style === 'dashed') return wire.appearance.dash.join(' ');
  return undefined;
}
/** Arc midpoint follows cumulative route length rather than the label's obsolete layout reservation. */
function pathMidpoint(points: readonly Point[]): Point {
  const lengths = points.slice(1).map((point, index) => {
    const prior = points[index] ?? point;
    return Math.hypot(point.x - prior.x, point.y - prior.y);
  });
  const halfway = lengths.reduce((total, length) => total + length, 0) / 2;
  let travelled = 0;
  const index = lengths.findIndex((length) => {
    travelled += length;
    return travelled >= halfway;
  });
  const end = points[index + 1];
  const start = points[index];
  if (!start || !end) return points[0] ?? { x: 0, y: 0 };
  const length = lengths[index] ?? 0;
  const ratio = (halfway - (travelled - length)) / Math.max(length, Number.EPSILON);
  return { x: start.x + (end.x - start.x) * ratio, y: start.y + (end.y - start.y) * ratio };
}
/** Selected and connected traces share endpoint halo eligibility. */
function highlighted(view: ViewWire): boolean {
  return ['primary', 'secondary'].includes(view.emphasis);
}
/** Motion belongs to an active admitted route, never a geometry draft. */
function pulseVisible(view: ViewWire): boolean {
  return !view.draft && (view.hovered === true || highlighted(view));
}
/** Coincident endpoints cannot define a gradient direction; keep their actual paint. */
function directedStroke(
  id: string,
  fallback: string,
  first: Point,
  last: Point,
): string {
  if (first.x === last.x && first.y === last.y) return fallback;
  return `url(#${id}) ${fallback}`;
}
/** Selection uses the accent gradient while supporting routes keep their neutral flow. */
function traceStroke(
  view: ViewWire,
  id: string,
  first: Point,
  last: Point,
): string {
  if (view.emphasis === 'primary')
    return directedStroke(`${id}-accent`, 'var(--nv-action-accent)', first, last);
  return directedStroke(id, view.wire.appearance.paint.stroke, first, last);
}
const idle = (): (() => void) => () => undefined;
/** The live drag offset, only while it moves one of this wire's ends; other wires never re-render. */
function useDragPreview(data: EdgeData | undefined): DragPreview | null {
  return useSyncExternalStore(data?.actions.subscribePreview ?? idle, () => {
    const preview = data?.actions.readPreview() ?? null;
    if (preview === null || data === undefined) return null;
    const touches = [data.view.sourceId, data.view.targetId].some((key) => preview.moved.has(key));
    return touches ? preview : null;
  });
}
function shift(
  point: Point,
  delta: Point,
  moves: boolean,
): Point {
  return moves ? { x: point.x + delta.x, y: point.y + delta.y } : point;
}
/** Every point follows when both ends move; otherwise only the moving end's point. */
function followsDrag(
  index: number,
  last: number,
  source: boolean,
  target: boolean,
): boolean {
  if (source && target) return true;
  return [source, target][[0, last].indexOf(index)] === true;
}
/** Same as the drop preview: both ends moving translates the route; one end moving stretches it. */
function draggedView(
  view: ViewWire,
  preview: DragPreview,
): ViewWire {
  const source = preview.moved.has(view.sourceId);
  const target = preview.moved.has(view.targetId);
  const wire = view.wire;
  const last = wire.points.length - 1;
  const points = wire.points.map((point, index) =>
    shift(point, preview.delta, followsDrag(index, last, source, target)),
  );
  const labelBox = { ...wire.labelBox, ...shift(wire.labelBox, preview.delta, source && target) };
  return { ...view, draft: true, wire: { ...wire, points, labelBox } };
}
/** Binding keeps measured labels/notation outside Canvas policy; host owns content admission and render recovery. */
export function createSceneEdge(
  slots: Pick<RenderSlots, 'MeasuredContent' | 'Marker'> & {
    readonly WireLabel: ComponentType<WireLabelProps>;
  },
): ComponentType<SceneEdgeProps> {
  const Marker = slots.Marker;
  const Content = slots.MeasuredContent;
  const Label = slots.WireLabel;
  /** All-labels mode: same pill as an always-shown label, in a layer above every wire and node. */
  function OverlayLabel({ view, box }: { readonly view: ViewWire; readonly box: Box }) {
    const { width, height } = view.wire.measuredLabel;
    const x = view.origin.x + box.x;
    const y = view.origin.y + box.y;
    return (
      <EdgeLabelRenderer>
        <svg
          className={styles.overlayLabel}
          width={width}
          height={height}
          style={{ transform: `translate(${x}px, ${y}px)` }}
        >
          <Content embedFonts={false} content={view.wire.measuredLabel} />
        </svg>
      </EdgeLabelRenderer>
    );
  }
  /** Render actual React Flow edge paths with independently positioned measured labels and complete crow's-foot notation. */
  function SceneEdge({ data }: SceneEdgeProps): ReactElement | null {
    const preview = useDragPreview(data);
    if (!data) return null;
    if (preview === null) return renderEdge(data);
    return renderEdge({ ...data, view: draggedView(data.view, preview) });
  }
  /** Admitted routes always have two points; missing geometry stays visibly absent rather than inventing a wire. */
  function renderEdge(data: NonNullable<SceneEdgeProps['data']>): ReactElement | null {
    const { view } = data;
    const wire = view.drawn;
    const paint = wire.appearance.paint;
    const first = wire.points[0];
    const second = wire.points[1];
    const last = wire.points.at(-1);
    const penultimate = wire.points.at(-2);
    if (!first || !second || !last || !penultimate) return null;
    const path = view.draft ? wirePath(wire.points) : wire.path;
    const labelAnchor = pathMidpoint(wire.points);
    /** Living traces: flow direction gradient spans the actual route endpoints; pulse rides active paths only. */
    const flowId = `nv-flow-${wire.id}`;
    const stroke = traceStroke(view, flowId, first, last);
    return (
      <g
        className={styles.edge}
        transform={`translate(${view.origin.x} ${view.origin.y})`}
        data-preview={view.draft}
        data-emphasis={view.emphasis}
        data-hovered={view.hovered}
      >
        <defs>
          <linearGradient
            id={flowId}
            gradientUnits="userSpaceOnUse"
            x1={first.x}
            y1={first.y}
            x2={last.x}
            y2={last.y}
          >
            <stop offset="0" style={{ stopColor: 'var(--nv-canvas-wire-flow-from)' }} />
            <stop offset="1" style={{ stopColor: 'var(--nv-canvas-wire-flow-to)' }} />
          </linearGradient>
          <linearGradient
            id={`${flowId}-accent`}
            gradientUnits="userSpaceOnUse"
            x1={first.x}
            y1={first.y}
            x2={last.x}
            y2={last.y}
          >
            <stop offset="0" style={{ stopColor: 'var(--nv-action-accent)', stopOpacity: 0.35 }} />
            <stop offset="1" style={{ stopColor: 'var(--nv-action-accent)', stopOpacity: 1 }} />
          </linearGradient>
        </defs>
        <path className={styles.hit} d={path} />
        <path className={styles.knockout} d={path} />
        <path
          className={styles.underlay}
          d={path}
          strokeDasharray={wireDash(wire)}
          data-emphasis={view.emphasis}
        />
        <path
          className={styles.wire}
          d={path}
          stroke={stroke}
          strokeWidth={wire.appearance.width}
          strokeDasharray={wireDash(wire)}
          data-emphasis={view.emphasis}
          data-style={wire.style}
        />
        {pulseVisible(view) && (
          <path className={styles.pulse} d={path} pathLength={100} pointerEvents="none" />
        )}
        {highlighted(view) && (
          <>
            <circle
              className={styles.halo}
              cx={first.x}
              cy={first.y}
              data-emphasis={view.emphasis}
              pointerEvents="none"
            />
            <circle
              className={styles.halo}
              cx={last.x}
              cy={last.y}
              data-emphasis={view.emphasis}
              pointerEvents="none"
            />
          </>
        )}
        {wire.labelVisible !== false && (
          <g
            className={styles.label}
            transform={`translate(${wire.labelBox.x} ${wire.labelBox.y})`}
          >
            <Content embedFonts={false} content={wire.measuredLabel} />
          </g>
        )}
        <g transform={endpointTransform(first, second)}>
          <g aria-hidden="true" className={styles.markerContrast} data-emphasis={view.emphasis}>
            <Marker kind={wire.sourceMarker} paint={paint} />
          </g>
          <g className={styles.marker} data-emphasis={view.emphasis}>
            <Marker kind={wire.sourceMarker} paint={paint} />
          </g>
        </g>
        <g transform={endpointTransform(last, penultimate)}>
          <g aria-hidden="true" className={styles.markerContrast} data-emphasis={view.emphasis}>
            <Marker kind={wire.targetMarker} paint={paint} />
          </g>
          <g className={styles.marker} data-emphasis={view.emphasis}>
            <Marker kind={wire.targetMarker} paint={paint} />
          </g>
        </g>
        {wire.labelVisible === false && view.showLabel && data.hiddenLabel === undefined && (
          <Label wire={wire} zoom={data.zoom} anchor={labelAnchor} />
        )}
        {wire.labelVisible === false && data.hiddenLabel !== undefined && (
          <OverlayLabel view={view} box={data.hiddenLabel} />
        )}
      </g>
    );
  }
  return memo(SceneEdge);
}
