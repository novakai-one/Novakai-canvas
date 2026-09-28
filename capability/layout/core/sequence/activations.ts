import type { Activation, SequenceEvent, FragmentFrame } from '../../contract/records/geometry.js';
import type { SequenceContext } from './records.js';
import type { ScopePath, VerticalRange } from './scopes.js';
import {
  eventScope,
  covers,
  compatible,
  scopeRange,
  fullyClosed,
  subtractRanges,
} from './scopes.js';
import { visible } from '../routing/endpoints.js';
import { center } from '../geometry/bounds.js';
interface Open {
  readonly participant: string;
  readonly event: string;
  readonly top: number;
  readonly depth: number;
  readonly scope: ScopePath;
  readonly closed: readonly ScopePath[];
}
interface State {
  readonly open: readonly Open[];
  readonly finished: readonly Activation[];
}
interface Context {
  readonly source: SequenceContext;
  readonly frames: readonly FragmentFrame[];
  readonly bottom: number;
  readonly events: readonly SequenceEvent[];
}
/** Event points were created by the sequence geometry builder; the label's bottom is only its checked empty-path fallback. */
function ordinate(event: SequenceEvent): number {
  return event.points[0]?.y ?? event.labelBox.y + event.labelBox.height;
}
/** Closing or reentrant depth only considers activations compatible with the event's execution path. */
function active(
  open: Open,
  path: ScopePath,
): boolean {
  return compatible(open.scope, path) && !open.closed.some((closed) => covers(closed, path));
}
/** Canonical true starts at the receiver; false ends the sender; omitted metadata leaves activity unchanged. */
function step(
  state: State,
  event: SequenceEvent,
  context: Context,
): State {
  const item = context.source.section.sequence.find((item) => item.item.id === event.id)?.item;
  if (item?.kind !== 'event') return state;
  return change(state, event, item.activate, context);
}
/** Scope calculation is required for both starts and ends, including events nested in opt/loop bodies. */
function change(
  state: State,
  event: SequenceEvent,
  activation: boolean | undefined,
  context: Context,
): State {
  if (activation === undefined) return state;
  const scope = eventScope(event.id, context.source.section);
  if (activation) return start(state, event, scope);
  return end(state, event, scope, context);
}
/** Reentrant calls offset only the simultaneously active stack, never a sibling alternative's stack. */
function start(
  state: State,
  event: SequenceEvent,
  scope: ScopePath,
): State {
  const depth = state.open.filter(
    (item) => item.participant === event.target && active(item, scope),
  ).length;
  return {
    ...state,
    open: [
      ...state.open,
      {
        participant: event.target,
        event: event.id,
        top: ordinate(event),
        depth,
        scope,
        closed: [],
      },
    ],
  };
}
/** A sibling alternative cannot close this activation; unmatched deactivation draws no invented interval. */
function end(
  state: State,
  event: SequenceEvent,
  scope: ScopePath,
  context: Context,
): State {
  const current = state.open.findLast(
    (item) => item.participant === event.source && active(item, scope),
  );
  if (!current) return state;
  return close(state, current, event, scope, context);
}
/** A shared outer return closes the originating conditional path; a nested return closes only its own path. */
function closingScope(
  open: Open,
  event: ScopePath,
): ScopePath {
  if (covers(event, open.scope)) return open.scope;
  return event;
}
/** Conditional closures retain the parent stack until every alternative proves closure. */
function close(
  state: State,
  open: Open,
  event: SequenceEvent,
  eventPath: ScopePath,
  context: Context,
): State {
  const path = closingScope(open, eventPath);
  const closed = [...open.closed, path];
  const updated = { ...open, closed };
  const complete = fullyClosed(open.scope, closed, context.source.section);
  const emitted = closureIntervals(open, path, event, context);
  const remaining = remainingPrefix(updated, complete, ordinate(event), context);
  return {
    open: state.open.flatMap((item) => replacement(item, open, updated, complete)),
    finished: [...state.finished, ...emitted, ...remaining],
  };
}
/** Only the matched stack entry changes; unrelated participant/alternative entries remain immutable. */
function replacement(
  item: Open,
  current: Open,
  updated: Open,
  complete: boolean,
): readonly Open[] {
  if (item !== current) return [item];
  return complete ? [] : [updated];
}
/** Direct closes cover remaining activity; nested closes show only their own alternative band. */
function closureIntervals(
  open: Open,
  path: ScopePath,
  event: SequenceEvent,
  context: Context,
): readonly Activation[] {
  if (covers(path, open.scope)) return remaining(open, ordinate(event), event.id, context);
  const scope = scopeRange(path, context.frames, { top: open.top, bottom: ordinate(event) });
  return [
    interval(
      open,
      event.id,
      { top: Math.max(open.top, scope.top), bottom: ordinate(event) },
      context,
    ),
  ];
}
/** When all alternatives close, the still-unrendered prefix/gaps also need an explicit bounded interval. */
function remainingPrefix(
  open: Open,
  complete: boolean,
  bottom: number,
  context: Context,
): readonly Activation[] {
  if (!complete) return [];
  return remaining(open, bottom, null, context);
}
/** Closed branch bands are excluded from the parent's continuing activity rather than leaking across alternatives. */
function remaining(
  open: Open,
  bottom: number,
  toEvent: string | null,
  context: Context,
): readonly Activation[] {
  const range = { top: open.top, bottom };
  const excluded = open.closed.map((path) => scopeRange(path, context.frames, range));
  return subtractRanges(range, excluded).map((range) => interval(open, toEvent, range, context));
}
/** Width is token-derived; null end IDs denote scope/sequence boundaries, not fabricated return events. */
function interval(
  open: Open,
  toEvent: string | null,
  range: VerticalRange,
  context: Context,
): Activation {
  const node = visible(open.participant, context.source.nodes);
  const width = context.source.options.activationWidth;
  return {
    participant: open.participant,
    fromEvent: open.event,
    toEvent,
    box: {
      x: center(node.box).x - width / 2 + (open.depth * width) / 2,
      y: range.top,
      width,
      height: Math.max(1, range.bottom - range.top),
    },
  };
}
/** An unfinished activation ends half a gap past the participant's last event, never beyond its scope. */
function unfinished(
  open: Open,
  context: Context,
): readonly Activation[] {
  const range = scopeRange(open.scope, context.frames, { top: open.top, bottom: context.bottom });
  const bottom = Math.min(
    range.bottom,
    lastOrdinate(open.participant, context) + context.source.options.sequenceGap / 2,
  );
  return remaining(open, bottom, null, context);
}
/** The participant's final event ordinate bounds its bar; an eventless participant keeps the scope end. */
function lastOrdinate(
  participant: string,
  context: Context,
): number {
  const involved = context.events.filter(
    (event) => event.source === participant || event.target === participant,
  );
  const last = involved.map(ordinate).reduce((later, y) => Math.max(later, y), -Infinity);
  if (last === -Infinity) return context.bottom;
  return last;
}
/** Derive activation intervals without sharing mutable execution state between alternatives; Authoring retains the scene on a typed derivation fault. */
export function activations(
  events: readonly SequenceEvent[],
  bottom: number,
  frames: readonly FragmentFrame[],
  source: SequenceContext,
): readonly Activation[] {
  const context: Context = { source, frames, bottom, events };
  const initial: State = { open: [], finished: [] };
  const state = events.reduce((state, event) => step(state, event, context), initial);
  return [...state.finished, ...state.open.flatMap((open) => unfinished(open, context))];
}
