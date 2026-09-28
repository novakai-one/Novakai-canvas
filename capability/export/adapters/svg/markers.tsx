/*
 * Wire-end markers for the SVG export. The marker shapes (arrows, crow's feet and so on) are
 * Presentation's; Export only places and turns them to follow the wire's end segment.
 */
import type { ReactElement, ComponentType } from 'react';
import type { ReactBindings, MarkerPlacement, Point } from '../../contract/render-types.js';

/**
 * Creates the component that draws one wire-end marker. Presentation's `Marker` is read once,
 * here.
 *
 * The component turns the marker to the direction of the wire's end segment: the last segment
 * for a target marker, the first segment reversed for a source marker. It places the marker at
 * the wire's end point, rotates it, then offsets it by (−26, −8) in the rotated frame. A wire
 * with fewer than two points draws nothing.
 *
 * @param bindings - Presentation's `Marker` component.
 * Recovery: when reading `Marker` throws, the caller repairs the bindings and calls this
 * factory again. Failures while drawing later are handled by `createSceneRenderer`.
 *
 * @returns The marker component.
 * @throws Never for plain bindings; a throwing `Marker` getter propagates.
 */
export function createMarkerDrawing(
  bindings: Pick<ReactBindings, 'Marker'>,
): ComponentType<MarkerPlacement> {
  const Marker = bindings.Marker;
  /** Draws one marker at its wire end; `null` when there is no end segment. */
  function EndpointMarker(props: MarkerPlacement): ReactElement | null {
    const points = oriented(props);
    const endpoint = points.at(-1);
    const previous = points.at(-2);
    if (!endpoint || !previous) return null;
    const angle = (Math.atan2(endpoint.y - previous.y, endpoint.x - previous.x) * 180) / Math.PI;
    return (
      <g transform={`translate(${endpoint.x} ${endpoint.y}) rotate(${angle}) translate(-26 -8)`}>
        <Marker kind={props.kind} paint={props.paint} />
      </g>
    );
  }
  return EndpointMarker;
}

/**
 * The route points ordered so the marker's end comes last: reversed (as a copy) for a source
 * marker, unchanged for a target marker.
 */
function oriented(props: MarkerPlacement): readonly Point[] {
  if (props.at === 'source') return [...props.points].reverse();
  return props.points;
}
