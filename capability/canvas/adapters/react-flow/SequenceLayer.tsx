import type { ComponentType, ReactElement, KeyboardEvent } from 'react';
import { useState } from 'react';
import { ViewportPortal } from '@xyflow/react';
import type { SequenceProps, RenderSlots } from '../../contract/react-types.js';
import type { Scene } from '../../contract/records/scene.js';
import type { ViewNode, ViewSection } from '../../contract/records/view.js';
import styles from './SequenceLayer.module.css';
type SequenceEvent = Scene['sections'][number]['sequence']['events'][number];
type SequenceActivation = Scene['sections'][number]['sequence']['activations'][number];
type SequenceLifeline = Scene['sections'][number]['sequence']['lifelines'][number];
/** Hovered message projects its instant and endpoints; nothing outside the pair is implied. */
interface SequenceSpotlight {
  readonly section: string;
  readonly event: string;
  readonly source: string;
  readonly target: string;
  readonly y: number;
}
/** Participant lookup matches the supplied node by target within one section; missing nodes stay undecorated. */
function participantNode(
  props: SequenceProps,
  section: string,
  id: string,
): ViewNode | undefined {
  return props.nodes.find((node) => node.target.id === id && node.placed.sectionId === section);
}
/** Supplied participant visibility determines reading-mode sequence visibility; no aggregate message is invented. */
function visibleParticipant(
  props: SequenceProps,
  section: string,
  id: string,
): boolean {
  return participantNode(props, section, id)?.hidden === false;
}
/** Role stroke tints participant material; unresolved participants keep the shared neutral paint. */
function participantTint(
  props: SequenceProps,
  section: string,
  id: string,
): string {
  const node = participantNode(props, section, id);
  if (node === undefined) return props.paint.stroke;
  if (props.followsInterfaceRoles === true)
    return `var(--nv-role-${node.placed.measured.role}-stroke)`;
  return node.placed.measured.paint.stroke;
}
/** Reading collapse hides annotations incident to hidden participants, while canonical sequence data remains intact. */
function visibleEvent(
  props: SequenceProps,
  section: string,
  event: SequenceEvent,
): boolean {
  return [
    visibleParticipant(props, section, event.source),
    visibleParticipant(props, section, event.target),
  ].every(Boolean);
}
/** Gradient and fragment references stay valid SVG identifiers regardless of authored id punctuation. */
function elementId(...parts: readonly string[]): string {
  return parts.map((part) => part.replace(/[^A-Za-z0-9_-]/g, '-')).join('-');
}
/** Sequence annotations reuse Layout geometry and Presentation labels; Canvas adds selection and keyboard intent only. */
export function createSequenceLayer(
  slots: Pick<RenderSlots, 'MeasuredContent' | 'Marker'>,
): ComponentType<SequenceProps> {
  const Content = slots.MeasuredContent;
  const Marker = slots.Marker;
  /** Label chips paint only the measured label box over lifelines; the Layout-owned message route stays intact. */
  function backedLabel(
    content: SequenceEvent['content'],
    box: SequenceEvent['labelBox'],
    paint: SequenceProps['paint'],
    lit: boolean,
  ): ReactElement {
    return (
      <g stroke="none" transform={`translate(${box.x} ${box.y})`}>
        <rect
          className={styles.chip}
          data-lit={lit || undefined}
          width={box.width}
          height={box.height}
          fill={paint.fill}
          stroke={paint.text}
        />
        <Content embedFonts={false} content={content} />
      </g>
    );
  }
  /** Measured sequence message keeps its native arrow kind and call/return style. */
  function message(
    event: SequenceEvent,
    section: ViewSection,
    props: SequenceProps,
    spotlight: SequenceSpotlight | null,
    hover: (spotlight: SequenceSpotlight | null) => void,
  ): ReactElement {
    const target = { kind: 'sequence' as const, section: section.section.id, id: event.id };
    const first = event.points.at(-2);
    const last = event.points.at(-1);
    const angle = endpointAngle(first, last);
    const lit = spotlight?.section === section.section.id && spotlight.event === event.id;
    return (
      <g
        key={event.id}
        className={styles.event}
        role="button"
        tabIndex={0}
        aria-label={event.content.outline.join(' ')}
        data-lit={lit || undefined}
        onMouseEnter={() =>
          hover({
            section: section.section.id,
            event: event.id,
            source: event.source,
            target: event.target,
            y: event.points[0]?.y ?? 0,
          })
        }
        onMouseLeave={() => hover(null)}
        onClick={() =>
          props.actions.dispatch({ kind: 'select', targets: [target], mode: 'replace' })
        }
        onKeyDown={(key) => messageKey(key, target, props)}
      >
        <polyline
          className={styles.message}
          data-message={event.message}
          points={event.points.map((point) => `${point.x},${point.y}`).join(' ')}
          fill="none"
        />
        {backedLabel(event.content, event.labelBox, props.paint, lit)}
        {last && (
          <g
            className={styles.marker}
            transform={`translate(${last.x} ${last.y}) rotate(${angle}) translate(-26 -8)`}
          >
            <Marker kind={event.marker} paint={{ ...props.paint, stroke: props.paint.text }} />
          </g>
        )}
      </g>
    );
  }
  /** Only explicit Enter/Space selects or edits a focused sequence item; ordinary browser keys pass through. */
  function messageKey(
    event: KeyboardEvent<SVGGElement>,
    target: { kind: 'sequence'; section: string; id: string },
    props: SequenceProps,
  ): void {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    event.stopPropagation();
    props.actions.dispatch({ kind: 'inspect', target });
  }
  /** Each lifeline is a role-tinted beam that dissolves toward the future; a role halo anchors its origin. */
  function lifeline(
    line: SequenceLifeline,
    section: ViewSection,
    props: SequenceProps,
    spotlight: SequenceSpotlight | null,
  ): ReactElement {
    const tint = participantTint(props, section.section.id, line.participant);
    const lit =
      spotlight !== null &&
      spotlight.section === section.section.id &&
      (spotlight.source === line.participant || spotlight.target === line.participant);
    const gradient = elementId('nv-seqlife', section.section.id, line.participant);
    const halo = elementId('nv-seqhalo', section.section.id, line.participant);
    const width = participantNode(props, section.section.id, line.participant)?.placed.box.width;
    return (
      <g key={line.participant}>
        <defs>
          <linearGradient
            id={gradient}
            gradientUnits="userSpaceOnUse"
            x1={line.from.x}
            y1={line.from.y}
            x2={line.to.x}
            y2={line.to.y}
          >
            <stop
              offset="0"
              style={{
                stopColor: tint,
                stopOpacity: 'var(--nv-canvas-sequence-lifeline-head-opacity)',
              }}
            />
            <stop offset="1" style={{ stopColor: tint, stopOpacity: 0 }} />
          </linearGradient>
          <radialGradient id={halo}>
            <stop
              offset="0"
              style={{
                stopColor: tint,
                stopOpacity: 'var(--nv-canvas-sequence-halo-opacity)',
              }}
            />
            <stop offset="1" style={{ stopColor: tint, stopOpacity: 0 }} />
          </radialGradient>
        </defs>
        <ellipse
          className={styles.halo}
          data-lit={lit || undefined}
          cx={line.from.x}
          cy={line.from.y}
          rx={width === undefined ? 48 : width * 0.55 + 8}
          ry={14}
          fill={`url(#${halo})`}
          stroke="none"
        />
        <line
          className={styles.lifeline}
          x1={line.from.x}
          y1={line.from.y}
          x2={line.to.x}
          y2={line.to.y}
          stroke={`url(#${gradient})`}
        />
        {lit && (
          <line
            className={styles.lifelineLit}
            x1={line.from.x}
            y1={line.from.y}
            x2={line.to.x}
            y2={line.to.y}
            stroke={`url(#${gradient})`}
          />
        )}
      </g>
    );
  }
  /** Activations are machined slots: a top-lit role gradient, a hairline edge and a soft role glow. */
  function activation(
    item: SequenceActivation,
    section: ViewSection,
    props: SequenceProps,
  ): ReactElement {
    const tint = participantTint(props, section.section.id, item.participant);
    const gradient = elementId('nv-seqact', section.section.id, item.participant, item.fromEvent);
    const { x, y, width, height } = item.box;
    /** The top-lit bead is a fixed world-unit height, not a fraction, so tall spans stay quiet. */
    const bead = Math.min(0.3, 28 / height);
    return (
      <g key={`${item.participant}:${item.fromEvent}`}>
        <defs>
          <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
            <stop
              offset="0"
              style={{
                stopColor: tint,
                stopOpacity: 'var(--nv-canvas-sequence-activation-top-opacity)',
              }}
            />
            <stop
              offset={bead}
              style={{
                stopColor: tint,
                stopOpacity: 'var(--nv-canvas-sequence-activation-fill-opacity)',
              }}
            />
            <stop
              offset="1"
              style={{
                stopColor: tint,
                stopOpacity: 'calc(var(--nv-canvas-sequence-activation-fill-opacity) * 0.5)',
              }}
            />
          </linearGradient>
        </defs>
        <rect
          className={styles.activationGlow}
          x={x - 2}
          y={y - 1}
          width={width + 4}
          height={height + 2}
          fill={tint}
          stroke="none"
        />
        <rect
          className={styles.activation}
          x={x}
          y={y}
          width={width}
          height={height}
          fill={props.paint.fill}
          stroke="none"
        />
        <rect
          className={styles.activation}
          x={x}
          y={y}
          width={width}
          height={height}
          fill={`url(#${gradient})`}
          stroke={tint}
        />
      </g>
    );
  }
  /** Hovered messages reveal one present-instant hairline across the section, faded at both edges. */
  function instant(
    section: ViewSection,
    props: SequenceProps,
    spotlight: SequenceSpotlight,
  ): ReactElement {
    const box = section.section.box;
    const gradient = elementId('nv-seqinstant', section.section.id);
    return (
      <g pointerEvents="none">
        <defs>
          <linearGradient
            id={gradient}
            gradientUnits="userSpaceOnUse"
            x1={box.x}
            y1={0}
            x2={box.x + box.width}
            y2={0}
          >
            <stop offset="0" style={{ stopColor: props.paint.text, stopOpacity: 0 }} />
            <stop
              offset="0.5"
              style={{
                stopColor: props.paint.text,
                stopOpacity: 'var(--nv-canvas-sequence-instant-opacity)',
              }}
            />
            <stop offset="1" style={{ stopColor: props.paint.text, stopOpacity: 0 }} />
          </linearGradient>
        </defs>
        <line
          className={styles.instant}
          x1={box.x}
          y1={spotlight.y}
          x2={box.x + box.width}
          y2={spotlight.y}
          stroke={`url(#${gradient})`}
        />
      </g>
    );
  }
  /** World-space decoration surrounds real React Flow participant nodes; it never replaces the node canvas. */
  function section(
    view: ViewSection,
    props: SequenceProps,
    spotlight: SequenceSpotlight | null,
    hover: (spotlight: SequenceSpotlight | null) => void,
  ): ReactElement {
    const geometry = view.section.sequence;
    const active = spotlight?.section === view.section.id ? spotlight : null;
    return (
      <g
        key={view.id}
        transform={`translate(${view.position.x - view.section.box.x + view.section.origin.x} ${view.position.y - view.section.box.y + view.section.origin.y})`}
        stroke={props.paint.text}
      >
        {geometry.lifelines
          .filter((line) => visibleParticipant(props, view.section.id, line.participant))
          .map((line) => lifeline(line, view, props, spotlight))}
        {geometry.activations
          .filter((item) => visibleParticipant(props, view.section.id, item.participant))
          .map((item) => activation(item, view, props))}
        {geometry.fragments.map((frame) => (
          <g key={frame.id}>
            <rect {...frame.box} fill="none" />
            {backedLabel(frame.content, frame.labelBox, props.paint, false)}
            {frame.branches.map((branch) => (
              <g key={branch.id}>
                <line
                  x1={branch.box.x}
                  y1={branch.box.y}
                  x2={branch.box.x + branch.box.width}
                  y2={branch.box.y}
                />
                {backedLabel(branch.content, branch.labelBox, props.paint, false)}
              </g>
            ))}
          </g>
        ))}
        {active && instant(view, props, active)}
        {geometry.events
          .filter((event) => visibleEvent(props, view.section.id, event))
          .map((event) => message(event, view, props, spotlight, hover))}
      </g>
    );
  }
  /** Collapsed section annotations are omitted only from the reading projection; stored geometry is unchanged. */
  function SequenceLayer(props: SequenceProps): ReactElement {
    const [spotlight, setSpotlight] = useState<SequenceSpotlight | null>(null);
    const rendered = props.followsInterfaceRoles
      ? {
          ...props,
          paint: {
            fill: 'var(--nv-canvas-group-surface)',
            stroke: 'var(--nv-text-secondary)',
            text: 'var(--nv-text-secondary)',
          },
        }
      : props;
    return (
      <ViewportPortal>
        <svg
          className={styles.layer}
          data-follows-interface-roles={props.followsInterfaceRoles}
          width="1"
          height="1"
          aria-label="Sequence annotations"
        >
          {props.sections
            .filter((view) => !view.collapsed)
            .map((view) => section(view, rendered, spotlight, setSpotlight))}
        </svg>
      </ViewportPortal>
    );
  }
  return SequenceLayer;
}
/** Degenerate optional geometry cannot generate NaN transforms; admitted messages normally provide both tangent points. */
function endpointAngle(
  first: { x: number; y: number } | undefined,
  last: { x: number; y: number } | undefined,
): number {
  if (!first || !last) return 0;
  return (Math.atan2(last.y - first.y, last.x - first.x) * 180) / Math.PI;
}
