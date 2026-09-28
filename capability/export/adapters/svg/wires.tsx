/*
 * Wire drawing for the SVG export: the route Layout admitted, its label and its two end markers.
 * Export adds no hit targets, route corrections or wires of its own.
 */
import type { ReactElement } from 'react';
import type {
  DrawingSlots,
  MarkerDrawing,
  RoutedWire,
  Paint,
} from '../../contract/render-types.js';

/**
 * Creates the wire drawing slot. Each wire is drawn as its routed path in its own appearance
 * (stroke colour, width, and dash pattern when its style is `dashed`), then its measured label
 * unless `labelVisible` is `false`, then its source and target markers.
 *
 * The slot's `paint` argument is not used: every wire uses its own `appearance.paint`.
 *
 * @param label - The measured-label slot.
 * @param Marker - The wire-end marker component.
 * @returns The `wire` slot.
 * @throws Never.
 */
export function createWireDrawing(
  label: DrawingSlots['label'],
  Marker: MarkerDrawing,
): (wire: RoutedWire, paint: Paint) => ReactElement {
  /** Draws one wire; see {@link createWireDrawing}. */
  function wire(item: RoutedWire): ReactElement {
    const paint = item.appearance.paint;
    const dash = item.style === 'dashed' ? item.appearance.dash.join(' ') : undefined;
    return (
      <g key={item.id} data-wire={item.id}>
        <path
          d={item.path}
          fill="none"
          stroke={paint.stroke}
          strokeWidth={item.appearance.width}
          strokeDasharray={dash}
        />
        {item.labelVisible !== false && label(item.measuredLabel, item.labelBox)}
        <Marker kind={item.sourceMarker} points={item.points} at="source" paint={paint} />
        <Marker kind={item.targetMarker} points={item.points} at="target" paint={paint} />
      </g>
    );
  }
  return wire;
}
