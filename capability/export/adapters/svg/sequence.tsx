/*
 * Sequence-diagram drawing for the SVG export. Layout owns all the geometry; this file only turns
 * it into static SVG elements.
 */
import type { ReactElement } from 'react';
import type {
  DrawingSlots,
  MarkerDrawing,
  SequenceGeometry,
  Paint,
} from '../../contract/render-types.js';

/** One message between participants. */
type Event = SequenceGeometry['events'][number];

/** One combined fragment (for example `alt` or `loop`) with its branches. */
type Frame = SequenceGeometry['fragments'][number];

/** The dash pattern for lifelines and `return` messages. */
const SEQUENCE_DASH = '6 4';

/**
 * Creates the sequence drawing slot. It draws, in this order (later elements on top):
 * - lifelines: dashed (`6 4`) lines, keyed by participant;
 * - activations: rectangles filled with the section fill;
 * - fragments: an unfilled frame, its label, and for each branch a line along the branch's top
 *   edge plus the branch label;
 * - messages: a line through the event points (dashed `6 4` for `return` messages), the label,
 *   and the target-end marker drawn in the text colour.
 *
 * Every label sits on a rectangle filled with the section fill, so lifelines do not run through
 * the text. Lines, frames and activations are stroked in the text colour; labels have no
 * stroke. Coordinates are section-local, the same frame as the participant nodes.
 *
 * @param label - The measured-label slot.
 * @param Marker - The wire-end marker component.
 * @returns The `sequence` slot.
 * @throws Never.
 */
export function createSequenceDrawing(
  label: DrawingSlots['label'],
  Marker: MarkerDrawing,
): (geometry: SequenceGeometry, paint: Paint) => ReactElement {
  /** Draws one section's sequence geometry; see {@link createSequenceDrawing}. */
  function sequence(
    geometry: SequenceGeometry,
    paint: Paint,
  ): ReactElement {
    return (
      <g stroke={paint.text} data-layer="sequence">
        {geometry.lifelines.map(
          /** Draws one dashed lifeline. */ (line) => (
            <line
              key={line.participant}
              x1={line.from.x}
              y1={line.from.y}
              x2={line.to.x}
              y2={line.to.y}
              strokeDasharray={SEQUENCE_DASH}
            />
          ),
        )}
        {geometry.activations.map(
          /** Draws one activation rectangle. */ (item) => (
            <rect key={`${item.participant}:${item.fromEvent}`} {...item.box} fill={paint.fill} />
          ),
        )}
        {geometry.fragments.map(/** Draws one fragment. */ (item) => frame(item, paint))}
        {geometry.events.map(/** Draws one message. */ (event) => message(event, paint))}
      </g>
    );
  }

  /**
   * Draws a fragment frame and its label, then each branch's separator line (the top edge of the
   * branch box Layout supplied) and label.
   */
  function frame(
    item: Frame,
    paint: Paint,
  ): ReactElement {
    return (
      <g key={item.id}>
        <rect {...item.box} fill="none" />
        {backedLabel(item.content, item.labelBox, paint)}
        {item.branches.map(
          /** Draws one branch separator and its label. */ (branch) => (
            <g key={branch.id}>
              <line
                x1={branch.box.x}
                y1={branch.box.y}
                x2={branch.box.x + branch.box.width}
                y2={branch.box.y}
              />
              {backedLabel(branch.content, branch.labelBox, paint)}
            </g>
          ),
        )}
      </g>
    );
  }

  /** Draws one message: its line (dashed for `return`), its label and its target marker. */
  function message(
    event: Event,
    paint: Paint,
  ): ReactElement {
    const dash = event.message === 'return' ? SEQUENCE_DASH : undefined;
    return (
      <g key={event.id} data-sequence-event={event.id}>
        <polyline
          points={event.points
            .map(/** One point as `x,y`. */ (point) => `${point.x},${point.y}`)
            .join(' ')}
          fill="none"
          strokeDasharray={dash}
        />
        {backedLabel(event.content, event.labelBox, paint)}
        <Marker
          kind={event.marker}
          points={event.points}
          at="target"
          paint={{ ...paint, stroke: paint.text }}
        />
      </g>
    );
  }

  /** Draws a measured label on a rectangle filled with the section fill, with no stroke. */
  function backedLabel(
    content: Frame['content'],
    box: Frame['labelBox'],
    paint: Paint,
  ): ReactElement {
    return (
      <g stroke="none">
        <rect {...box} fill={paint.fill} />
        {label(content, box)}
      </g>
    );
  }

  return sequence;
}
