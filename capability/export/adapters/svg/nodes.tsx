/*
 * Node and label drawing for the SVG export. Presentation draws the content from its own
 * measurements; Export only moves each piece to its laid-out position.
 */
import type { ReactElement } from 'react';
import type {
  ReactBindings,
  PlacedNode,
  MeasuredContent,
  Point,
  DrawingSlots,
} from '../../contract/render-types.js';

/**
 * Creates the node and label drawing slots. Presentation's `NodeContent` and `MeasuredContent`
 * components are read once, here. Both draw with `embedFonts` off; the scene renderer adds the
 * font definitions once for the whole document.
 *
 * - `node` draws a node's measured content at its box position, with the width and height
 *   replaced by the laid-out box (a group frame can be larger than its measured content). The
 *   element's React key is the node ID.
 * - `label` draws measured text content at a section-local point.
 *
 * @param bindings - Presentation's `NodeContent` and `MeasuredContent` components.
 * Recovery: when reading a binding throws, the caller repairs the bindings and calls this
 * factory again. Failures while drawing later are handled by `createSceneRenderer`.
 *
 * @returns The `node` and `label` slots.
 * @throws Never for plain bindings; a throwing getter on `bindings` propagates.
 */
export function createNodeDrawing(
  bindings: Pick<ReactBindings, 'NodeContent' | 'MeasuredContent'>,
): Pick<DrawingSlots, 'node' | 'label'> {
  const Content = bindings.NodeContent;
  const Measured = bindings.MeasuredContent;
  /** Draws one node at its box position, sized to its laid-out box. */
  function node(placed: PlacedNode): ReactElement {
    const visual = { ...placed.measured, width: placed.box.width, height: placed.box.height };
    return (
      <g key={placed.id} transform={`translate(${placed.box.x} ${placed.box.y})`}>
        <Content node={visual} embedFonts={false} />
      </g>
    );
  }
  /** Draws measured content at a section-local point. */
  function label(
    content: MeasuredContent,
    point: Point,
  ): ReactElement {
    return (
      <g transform={`translate(${point.x} ${point.y})`}>
        <Measured content={content} embedFonts={false} />
      </g>
    );
  }
  return { node, label };
}
