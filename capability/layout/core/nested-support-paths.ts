import type {
  NestedSupportAdjustment,
  NestedSupportFootprint,
} from '../contract/records/nested-support.js';
import type { PrototypePoint } from '../contract/records/road-prototype.js';
import type { RoadPrototypeScene } from '../contract/records/road-scene.js';
import { readNestedProjectionSupports } from './nested-lane-projection.js';
import { axes, contains } from './prototype-road-geometry.js';
import { nestedLanePitch } from './prototype-nested-placement.js';
import type { retainSupportInput } from './nested-support-input.js';
import {
  anchor,
  reject,
  required,
  type Anchor,
  type SupportGraph,
} from './nested-support-graph.js';
import { directedRelation } from './nested-support-structure.js';

type Input = ReturnType<typeof retainSupportInput>;
type Emissions = ReadonlyMap<string, readonly string[]>;
type Supports = ReturnType<typeof readNestedProjectionSupports>[number];
type Join = Supports['joins'][number];
type Connection = Join['nominal'];
interface Reference {
  readonly anchor: Anchor;
  readonly offset: number;
}
const margin = nestedLanePitch / 4;
const dimensions = { x: 'width', y: 'height' } as const;

/** Derive support from the exact selected fan/turn algebra without emitting any wire. */
export function supportPaths(
  graph: SupportGraph,
  lines: ReadonlyMap<string, Anchor>,
  input: Input,
  scene: RoadPrototypeScene,
) {
  const supports =
    input.projectionSupports ??
    readNestedProjectionSupports(input.wires, input.allocation.byWire, input.final);
  const adjustments: NestedSupportAdjustment[] = [],
    footprints: NestedSupportFootprint[] = [];
  const emissions = emissionIndex(scene);
  supports.forEach((support) =>
    pathSupports(graph, lines, input, emissions, support, adjustments, footprints),
  );
  return { adjustments, footprints };
}
function pathSupports(
  graph: SupportGraph,
  lines: ReadonlyMap<string, Anchor>,
  input: Input,
  emissions: Emissions,
  support: Supports,
  adjustments: NestedSupportAdjustment[],
  footprints: NestedSupportFootprint[],
): void {
  const first = support.travels[0],
    last = support.travels.at(-1);
  if (first === undefined || last === undefined)
    return reject('unsupported-support', [support.wire.id]);
  const source = terminal(
    graph,
    input,
    support.wire.from,
    axes[first.road.axis].along,
    support.start.end,
  );
  const target = terminal(
    graph,
    input,
    support.wire.to,
    axes[last.road.axis].along,
    support.end.end,
  );
  footprints.push(fanFootprint(input, support, true), fanFootprint(input, support, false));
  let previous = source;
  support.joins.forEach((join) => {
    const references = joinReferences(graph, lines, input, support, join);
    const adjustment = classify(join, support.wire.id, emissions, input);
    adjustments.push(...adjustment);
    const from = admittedFrom(adjustment, previous, references.from, join.incoming.direction);
    separation(graph, previous, from, join.incoming.direction, margin, [
      support.wire.id,
      String(join.incoming.first),
    ]);
    turnSeparation(graph, lines, join, from, references.to, support.wire.id);
    previous = references.to;
    footprints.push({
      key: `${support.wire.id}:turn:${join.incoming.first}`,
      kind: 'turn',
      roadKeys: [
        required(input.keys, join.incoming.road.id),
        required(input.keys, join.outgoing.road.id),
      ],
      points: points(join.nominal),
    });
  });
  separation(graph, previous, target, last.direction, margin, [
    support.wire.id,
    String(last.first),
  ]);
}
function turnSeparation(
  graph: SupportGraph,
  lines: ReadonlyMap<string, Anchor>,
  join: Join,
  from: Reference,
  to: Reference,
  wireId: string,
): void {
  const incoming = required(lines, join.incoming.road.id),
    outgoing = required(lines, join.outgoing.road.id);
  const provenance = [wireId, String(join.incoming.first), 'turn'];
  if (join.incoming.road.axis !== join.outgoing.road.axis) {
    separation(
      graph,
      from,
      reference(outgoing, join.nominal.to),
      join.incoming.direction,
      0,
      provenance,
    );
    separation(
      graph,
      reference(incoming, join.nominal.from),
      to,
      join.outgoing.direction,
      0,
      provenance,
    );
    return;
  }
  bridgeSeparation(graph, join, incoming, outgoing, from, to, provenance);
}
function bridgeSeparation(
  graph: SupportGraph,
  join: Join,
  incoming: Anchor,
  outgoing: Anchor,
  from: Reference,
  to: Reference,
  provenance: readonly string[],
): void {
  const columns = join.nominal.via?.length === 2 ? margin : 0;
  separation(graph, from, to, join.incoming.direction, columns, provenance);
  const lateral = Math.sign(join.outgoing.at - join.incoming.at);
  if (lateral !== 0)
    separation(
      graph,
      reference(incoming, join.nominal.from),
      reference(outgoing, join.nominal.to),
      lateral,
      0,
      provenance,
    );
}
function terminal(
  graph: SupportGraph,
  input: Input,
  id: string,
  axis: Anchor['axis'],
  point: PrototypePoint,
): Reference {
  const node = input.nodes.get(id);
  if (node === undefined) return reject('missing-contact', [id]);
  const center = anchor(
    graph,
    `${id}:${axis}:center`,
    axis,
    node.bounds[axis] + node.bounds[dimensions[axis]] / 2,
  );
  return { anchor: center, offset: point[axis] - center.position };
}
function fanFootprint(
  input: Input,
  support: Supports,
  source: boolean,
): NestedSupportFootprint {
  const fan = source ? support.start : support.end;
  const travel = source ? support.travels[0] : support.travels.at(-1);
  return retainedFan(input, support.wire.id, fan, travel, source);
}
function retainedFan(
  input: Input,
  wireId: string,
  fan: Supports['start'],
  travel: Supports['travels'][number] | undefined,
  source: boolean,
): NestedSupportFootprint {
  if (travel === undefined) return reject('unsupported-support', [wireId]);
  const kind = source ? 'source-fan' : 'target-fan';
  return {
    key: `${wireId}:${kind}`,
    kind,
    roadKeys: [required(input.keys, travel.road.id)],
    points: [fan.pin, fan.bend, fan.end],
  };
}
function joinReferences(
  graph: SupportGraph,
  lines: ReadonlyMap<string, Anchor>,
  input: Input,
  support: Supports,
  join: Join,
) {
  if (join.incoming.road.axis !== join.outgoing.road.axis)
    return {
      from: reference(required(lines, join.outgoing.road.id), join.nominal.from),
      to: reference(required(lines, join.incoming.road.id), join.nominal.to),
    };
  const road = required(input.final, join.nominal.roadId);
  if (road.axis !== join.incoming.road.axis) {
    const line = required(lines, road.id);
    return { from: reference(line, join.nominal.from), to: reference(line, join.nominal.to) };
  }
  return gateReferences(graph, support, join, road);
}
function gateReferences(
  graph: SupportGraph,
  support: Supports,
  join: Join,
  road: Join['incoming']['road'],
) {
  const port = [join.incoming.road.access, join.outgoing.road.access].find((a) =>
    support.wire.gates.includes(a?.portId ?? ''),
  );
  if (port === undefined || port === null)
    return reject('unsupported-support', [support.wire.id, road.id]);
  const side = ['bottom', 'right'].includes(port.side) ? 'high' : 'low';
  const line = required(graph.anchors, `${port.nodeId}:${axes[road.axis].along}:${side}`);
  return { from: reference(line, join.nominal.from), to: reference(line, join.nominal.to) };
}
function reference(
  line: Anchor,
  point: PrototypePoint,
): Reference {
  return { anchor: line, offset: point[line.axis] - line.position };
}
function admittedFrom(
  adjustment: readonly NestedSupportAdjustment[],
  previous: Reference,
  nominal: Reference,
  direction: number,
): Reference {
  if (adjustment[0]?.resolutionTemplate !== 'supported-orthogonal-forward-stem') return nominal;
  return { anchor: previous.anchor, offset: previous.offset + direction * margin };
}
function separation(
  graph: SupportGraph,
  from: Reference,
  to: Reference,
  direction: number,
  gap: number,
  provenance: readonly string[],
): void {
  const distance = gap + direction * (from.offset - to.offset);
  directedRelation(graph, direction, from.anchor, to.anchor, distance, 'travel', provenance);
}
function points(c: Connection): readonly PrototypePoint[] {
  return [c.from, ...(c.via ?? []), c.to];
}
function pieces(c: Connection) {
  const path = points(c);
  return path
    .slice(1)
    .map((to, i) => ({ from: path[i] ?? to, to }))
    .filter(({ from, to }) => from.x !== to.x || from.y !== to.y);
}
function classify(
  join: Join,
  wireId: string,
  emissions: Emissions,
  input: Input,
): readonly NestedSupportAdjustment[] {
  if (join.adjusted === join.nominal) return [];
  const along = axes[join.incoming.road.axis].along;
  const nominalAnchor = join.nominal.from[along],
    requiredAnchor = join.previous.to[along] + join.incoming.direction * margin;
  const supported = supportedAdjustment(join, wireId, emissions, input);
  return [
    {
      wireId,
      first: join.incoming.first,
      nominalAnchor,
      requiredAnchor,
      deficit: join.incoming.direction * (requiredAnchor - nominalAnchor),
      ...classification(supported),
    },
  ];
}
function supportedAdjustment(
  join: Join,
  wireId: string,
  emissions: Emissions,
  input: Input,
): boolean {
  const along = axes[join.incoming.road.axis].along,
    across = axes[join.incoming.road.axis].across;
  const emitted = pieces(join.adjusted);
  return [
    join.nominal.via?.length === 1,
    join.incoming.direction * (join.adjusted.from[along] - join.previous.to[along]) >= margin,
    emitted.every(({ from, to }) => from.x === to.x || from.y === to.y),
    emitted.every(({ from, to }) => join.incoming.direction * (to[along] - from[along]) >= 0),
    emitted.every(({ from, to }) => join.outgoing.direction * (to[across] - from[across]) >= 0),
    emitted.every((piece) => exactEmission(piece, wireId, emissions, input)),
  ].every(Boolean);
}
function exactEmission(
  piece: { readonly from: PrototypePoint; readonly to: PrototypePoint },
  wireId: string,
  emissions: Emissions,
  input: Input,
): boolean {
  const matches = emissions.get(JSON.stringify([wireId, piece.from, piece.to])) ?? [];
  if (matches.length !== 1) return false;
  const road = input.final.get(matches[0] ?? '');
  return contained(road?.bounds, piece);
}
function emissionIndex(scene: RoadPrototypeScene): Emissions {
  if (!scene.wiring?.ok) return reject('unroutable-reservation', ['scene.wiring']);
  const index = new Map<string, string[]>();
  scene.wiring.value.forEach((wire) =>
    wire.segments.forEach((segment) => {
      const key = JSON.stringify([wire.id, segment.from, segment.to]);
      const group = index.get(key) ?? [];
      group.push(segment.corridorId);
      index.set(key, group);
    }),
  );
  return index;
}
function contained(
  bounds: Parameters<typeof contains>[0] | undefined,
  piece: { readonly from: PrototypePoint; readonly to: PrototypePoint },
): boolean {
  if (bounds === undefined) return false;
  return [piece.from, piece.to].every((p) => contains(bounds, p));
}

function classification(
  supported: boolean,
): Pick<NestedSupportAdjustment, 'resolutionTemplate' | 'byteIdentityConsequence'> {
  if (supported)
    return {
      resolutionTemplate: 'supported-orthogonal-forward-stem',
      byteIdentityConsequence: 'current-adjusted-geometry-preserved',
    };
  return {
    resolutionTemplate: 'unsupported-retained-adjustment',
    byteIdentityConsequence: 'cannot-admit-current-adjustment',
  };
}
