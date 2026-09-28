import type { PlacedSection } from '../../contract/records/scene.js';
import { box, point } from '../../contract/records/camera.js';
import { parse, reject } from '../validation/outcomes.js';
type Sequence = PlacedSection['sequence'];
/** Rendering a sequence participant reference requires a visible node in the same section. */
function participant(
  section: PlacedSection,
  id: string,
): void {
  if (!section.nodes.some((node) => node.id === id))
    reject('invalid-scene', id, 'Unknown sequence participant');
}
/** Message geometry is bounded and resolves both participants before it reaches the renderer. */
function message(
  section: PlacedSection,
  event: Sequence['events'][number],
): void {
  participant(section, event.source);
  participant(section, event.target);
  parse(box, event.labelBox);
  if (event.points.length < 2 || event.points.length > 10000)
    reject('invalid-scene', event.id, 'Message needs2..10000points');
  event.points.forEach((value) => parse(point, value));
}
/** Fragment/branch rectangles are renderable finite bounds, even when there are no events in an alternative. */
function fragment(frame: Sequence['fragments'][number]): void {
  parse(box, frame.box);
  parse(box, frame.labelBox);
  frame.branches.forEach((branch) => {
    parse(box, branch.box);
    parse(box, branch.labelBox);
  });
}
/** Activation endpoint references cannot silently point at a missing message. */
function activation(
  section: PlacedSection,
  item: Sequence['activations'][number],
): void {
  participant(section, item.participant);
  parse(box, item.box);
  const ids = new Set(section.sequence.events.map((event) => event.id));
  if (!ids.has(item.fromEvent)) reject('invalid-scene', item.fromEvent, 'Unknown activation start');
  validateActivationEnd(ids, item.toEvent);
}
/** Open activation is represented explicitly by null; otherwise the end must be an admitted message. */
function validateActivationEnd(
  ids: ReadonlySet<string>,
  end: string | null,
): void {
  if (end === null) return;
  if (!ids.has(end)) reject('invalid-scene', end, 'Unknown activation end');
}
/** Sequence annotations receive the same finite-geometry protections as ordinary nodes and wires. */
export function validateSequence(section: PlacedSection): void {
  const sequence = section.sequence;
  if (sequence.source.length > 10000)
    reject('invalid-scene', section.id, 'At most10000sequence items are supported');
  sequence.events.forEach((event) => message(section, event));
  sequence.fragments.forEach(fragment);
  sequence.activations.forEach((item) => activation(section, item));
  sequence.lifelines.forEach((line) => {
    participant(section, line.participant);
    parse(point, line.from);
    parse(point, line.to);
  });
}
