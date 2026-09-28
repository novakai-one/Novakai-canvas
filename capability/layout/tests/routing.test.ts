import { layoutInputKey } from '../contract/index.js';
import { describe, it, expect, assert } from 'vitest';
import type { Projection, Scene, Point, Box, VisualSection } from '../contract/index.js';
import {
  project,
  collection,
  object,
  section,
  edge,
  harness,
  request,
  value,
  node,
  metrics,
  settings,
  flow,
} from './fixtures.js';

describe('Layout routing acceptance', () => {
  it('7 — real Wasm avoids content, attaches measured members and exposes self/parallel wires', async () => {
    const source = routingProjection();
    const layout = await harness([source]);
    const scene = value(await layout.arrange(request(layout, source)));
    const wires = scene.sections[0]?.wires;
    assert(wires);
    expect(wires).toHaveLength(3);
    await groupLabelBorders(false);
    await groupLabelBorders(true);
    await rankedLabelCorridors();
    const first = wires[0];
    const second = wires[1];
    const self = wires[2];
    assert(first && second && self);
    const row = node(scene, 'a').measured.content.anchors.find((anchor) => anchor.member === 'out');
    assert(row);
    expect(first.source.side).toBe('right');
    expect(first.target.side).toBe('left');
    expect(first.source.point.y).toBeCloseTo(node(scene, 'a').box.y + row.y);
    expect(first.source.member).toBe('out');
    expect(first.points).not.toEqual(second.points);
    expect(self.source.node).toBe(self.target.node);
    expect(self.points.length).toBeGreaterThanOrEqual(4);
    expect(wires.every((wire) => !hits(wire.points, node(scene, 'obstacle').box))).toBe(true);
    expect(
      first.points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y)),
    ).toBe(true);
  });
  it('8 — manual locks preserve every point; endpoint movement rejects while soft routes adjust safely', async () => {
    const original = flow();
    const firstLayout = await harness([original]);
    const first = value(await firstLayout.arrange(request(firstLayout, original)));
    const points = first.sections[0]?.wires[0]?.points;
    assert(points);
    const locked = manualProjection(original, first, points, true, 0);
    const moved = manualProjection(original, first, points, true, 80);
    const soft = manualProjection(original, first, points, false, 80);
    const curved = manualProjection(original, first, points, false, 0, 'curve');
    const layout = await harness([locked, moved, soft, curved]);
    const retained = value(await layout.arrange(request(layout, locked)));
    expect(retained.sections[0]?.wires[0]?.points).toEqual(points);
    const conflict = await layout.arrange(request(layout, moved));
    assert(!conflict.ok);
    expect(conflict.error.code).toBe('constraint-conflict');
    expect(conflict.error.targets).toHaveLength(1);
    const adjusted = value(await layout.arrange(request(layout, soft)));
    expect(adjusted.sections[0]?.wires[0]?.points).not.toEqual(points);
    expect(adjusted.adjustments.some((item) => item.reason.includes('manual route'))).toBe(true);
    const curve = value(await layout.arrange(request(layout, curved)));
    expect(curve.sections[0]?.wires[0]?.points).toEqual(points);
    expect(
      value(
        layout.inspect({
          projection: curved,
          measurements: metrics(curved),
          options: settings,
          candidate: curve,
        }),
      ).valid,
    ).toBe(true);
    const obstacleSource = routingProjection();
    const rounded: Projection = {
      ...obstacleSource,
      sections: obstacleSource.sections.map((section) => ({
        ...section,
        wires: section.wires.map((wire) => ({ ...wire, route: { ...wire.route, route: 'curve' } })),
      })),
    };
    const roundedLayout = await harness([rounded]);
    const roundedScene = value(await roundedLayout.arrange(request(roundedLayout, rounded)));
    const roundedWires = roundedScene.sections[0]?.wires ?? [];
    expect(roundedWires.some((wire) => wire.path.includes(' Q '))).toBe(true);
    const obstacle = node(roundedScene, 'obstacle').box;
    roundedWires.forEach((wire) =>
      quadraticSamples(wire.path).forEach((point) =>
        expect(insideBox(point, obstacle)).toBe(false),
      ),
    );
    const fixedRequest = request(layout, soft, adjusted);
    const rerouted = value(
      await layout.route({
        projection: soft,
        measurements: fixedRequest.measurements,
        options: settings,
        fixed: adjusted,
        job: fixedRequest.job,
      }),
    );
    expect(rerouted.sections.map((section) => section.nodes)).toEqual(
      adjusted.sections.map((section) => section.nodes),
    );
    expect(rerouted.sections.map((section) => section.origin)).toEqual(
      adjusted.sections.map((section) => section.origin),
    );
  });
  it('9 — reserves measured ER labels and independent marker extents, and reports real crossings', async () => {
    const er = erProjection();
    const layout = await harness([er]);
    const scene = value(await layout.arrange(request(layout, er)));
    const wire = scene.sections[0]?.wires[0];
    assert(wire);
    expect(wire.sourceMarker).toBe('one');
    expect(wire.targetMarker).toBe('zero-many');
    expect(wire.labelBox.width).toBe(wire.measuredLabel.width);
    expect(wire.labelBox.height).toBe(wire.measuredLabel.height);
    expect(manhattan(wire.points[0], wire.points[1])).toBeGreaterThanOrEqual(
      metrics(er).markers.one.advance,
    );
    expect(manhattan(wire.points.at(-1), wire.points.at(-2))).toBeGreaterThanOrEqual(
      metrics(er).markers['zero-many'].advance,
    );
    expect(scene.sections[0]?.nodes.every((node) => !overlap(node.box, wire.labelBox))).toBe(true);
    // Different field rows must still connect inside the free corridor, without a backward outside loop.
    expect(
      wire.points.every(
        (point) => point.x >= wire.source.point.x && point.x <= wire.target.point.x,
      ),
    ).toBe(true);
    expect(wire.points.map((point) => point.x)).toEqual(
      wire.points.map((point) => point.x).toSorted((a, b) => a - b),
    );
    const crossing = crossingProjection();
    const other = await harness([crossing]);
    const crossed = value(await other.arrange(request(other, crossing)));
    expect(crossed.warnings).toHaveLength(1);
    expect(crossed.warnings[0]?.code).toBe('wire-crossing');
    expect(crossed.warnings[0]?.targets).toEqual(crossed.sections[0]?.wires.map((wire) => wire.id));
  });
});
/** Structured module ports force measured-row attachments; fixed boxes make the obstacle oracle independent of layout. */
function routingProjection(): Projection {
  return project(
    collection({
      objects: [
        object('a', 'module', {
          ports: [{ id: 'out', label: 'Send', type: 'Message', direction: 'out' }],
        }),
        object('b', 'module', {
          ports: [{ id: 'in', label: 'Receive', type: 'Message', direction: 'in' }],
        }),
        object('obstacle', 'module'),
      ],
      relationships: [
        edge('one', 'a', 'b', {
          kind: 'imports',
          source: { object: 'a', member: 'out' },
          target: { object: 'b', member: 'in' },
        }),
        edge('two', 'a', 'b', {
          kind: 'imports',
          source: { object: 'a', member: 'out' },
          target: { object: 'b', member: 'in' },
        }),
        edge('self', 'a', 'a', { kind: 'imports' }),
      ],
      sections: [
        section('modules', [], {
          mode: 'modules',
          layout: { algorithm: 'layered' },
          appearances: [
            { object: 'a', placement: { x: 0, y: 0, height: 160, locked: true } },
            { object: 'b', placement: { x: 600, y: 0, height: 160, locked: true } },
            { object: 'obstacle', placement: { x: 300, y: 0, height: 160, locked: true } },
          ],
          wires: [
            { relationship: 'one', sourceSide: 'right', targetSide: 'left' },
            { relationship: 'two', sourceSide: 'right', targetSide: 'left' },
            { relationship: 'self' },
          ],
        }),
      ],
    }),
  );
}
/** Test transformations retain owner-produced measured data; only explicit authored route/placement intent changes. */
function manualProjection(
  source: Projection,
  scene: Scene,
  points: readonly Point[],
  locked: boolean,
  movement: number,
  route: 'orthogonal' | 'curve' = 'orthogonal',
): Projection {
  return {
    ...source,
    revision: source.revision + 1,
    sections: source.sections.map((section) =>
      manualSection(section, scene, points, locked, movement, route),
    ),
  };
}
/** Public measured input supplies current locked positions so manual endpoint comparison is deterministic. */
function manualSection(
  section: VisualSection,
  scene: Scene,
  points: readonly Point[],
  locked: boolean,
  movement: number,
  route: 'orthogonal' | 'curve',
): VisualSection {
  return {
    ...section,
    nodes: section.nodes.map((source) => {
      const original = node(scene, source.objectId ?? '');
      const x = original.box.x + (source.objectId === 'beta' ? movement : 0);
      return { ...source, placement: { x, y: original.box.y, locked: true } };
    }),
    wires: section.wires.map((wire) => ({
      ...wire,
      route: { ...wire.route, manual: points, locked, route },
    })),
  };
}
/** Independent segment/rectangle test detects interior collisions without using Layout helpers. */
function hits(
  points: readonly Point[],
  box: Box,
): boolean {
  return points.slice(1).some((b, index) => segmentHit(points[index], b, box));
}
/** Test oracle uses axis intervals directly and excludes boundary tangency. */
function segmentHit(
  a: Point | undefined,
  b: Point,
  box: Box,
): boolean {
  assert(a);
  if (a.y === b.y)
    return (
      a.y > box.y &&
      a.y < box.y + box.height &&
      Math.min(a.x, b.x) < box.x + box.width &&
      Math.max(a.x, b.x) > box.x
    );
  return verticalHit(a, b, box);
}
/** Vertical interval oracle complements the independently expressed horizontal test. */
function verticalHit(
  a: Point,
  b: Point,
  box: Box,
): boolean {
  return (
    a.x > box.x &&
    a.x < box.x + box.width &&
    Math.min(a.y, b.y) < box.y + box.height &&
    Math.max(a.y, b.y) > box.y
  );
}
/** A route's first/last lengths must reserve different source and target marker extents. */
function manhattan(
  a: Point | undefined,
  b: Point | undefined,
): number {
  assert(a && b);
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}
/** Rectangle oracle treats shared borders as clear, matching visible non-occlusion rather than coordinate equality. */
function overlap(
  a: Box,
  b: Box,
): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}
/** ER cardinalities differ at each end so an accidental mirrored/default marker cannot pass. */
function erProjection(): Projection {
  return project(
    collection({
      objects: [
        object('user', 'entity', {
          content: [{ kind: 'field', id: 'id', label: 'id', type: 'UserId', key: 'primary' }],
        }),
        object('order', 'entity', {
          content: [
            { kind: 'field', id: 'id', label: 'id', type: 'OrderId', key: 'primary' },
            {
              kind: 'field',
              id: 'userId',
              label: 'userId',
              type: 'UserId',
              key: 'foreign',
              references: { object: 'user', member: 'id' },
            },
          ],
        }),
      ],
      relationships: [
        edge('places', 'user', 'order', {
          kind: 'association',
          from: '1',
          to: '0..many',
          source: { object: 'user', member: 'id' },
          target: { object: 'order', member: 'userId' },
        }),
      ],
      sections: [
        section('er', ['user', 'order'], {
          mode: 'er',
          layout: { algorithm: 'layered' },
          wires: [{ relationship: 'places' }],
        }),
      ],
    }),
  );
}
/** Two hard orthogonal paths cross in free space, away from all four fixed nodes and measured labels. */
function crossingProjection(): Projection {
  return project(
    collection({
      objects: ['left', 'right', 'top', 'bottom'].map((id) => object(id)),
      relationships: [edge('horizontal', 'left', 'right'), edge('vertical', 'top', 'bottom')],
      sections: [
        section('crossing', [], {
          appearances: [
            { object: 'left', placement: { x: 0, y: 300, height: 100, locked: true } },
            { object: 'right', placement: { x: 600, y: 300, height: 100, locked: true } },
            { object: 'top', placement: { x: 300, y: 0, height: 100, locked: true } },
            { object: 'bottom', placement: { x: 300, y: 600, height: 100, locked: true } },
          ],
          wires: [
            {
              relationship: 'horizontal',
              sourceSide: 'right',
              targetSide: 'left',
              manual: [
                { x: 136, y: 350 },
                { x: 600, y: 350 },
              ],
              locked: true,
            },
            {
              relationship: 'vertical',
              sourceSide: 'bottom',
              targetSide: 'top',
              manual: [
                { x: 368, y: 100 },
                { x: 368, y: 600 },
              ],
              locked: true,
            },
          ],
        }),
      ],
    }),
  );
}

/** Independent quadratic evaluation samples actual rendered bends, not only the orthogonal control corridor. */
function quadraticSamples(path: string): readonly Point[] {
  const number = '(-?[0-9]+(?:\\.[0-9]+)?)';
  const expression = new RegExp(
    `L ${number} ${number} Q ${number} ${number} ${number} ${number}`,
    'g',
  );
  const matches = [...path.matchAll(expression)];
  expect(matches.length).toBe((path.match(/ Q /g) ?? []).length);
  return matches.flatMap((match) => {
    const start = { x: Number(match[1]), y: Number(match[2]) };
    const control = { x: Number(match[3]), y: Number(match[4]) };
    const end = { x: Number(match[5]), y: Number(match[6]) };
    return [0.25, 0.5, 0.75].map((t) => quadratic(start, control, end, t));
  });
}
/** Standard quadratic Bezier equation is separate from Layout's corner construction. */
function quadratic(
  a: Point,
  control: Point,
  b: Point,
  t: number,
): Point {
  return {
    x: (1 - t) ** 2 * a.x + 2 * (1 - t) * t * control.x + t ** 2 * b.x,
    y: (1 - t) ** 2 * a.y + 2 * (1 - t) * t * control.y + t ** 2 * b.y,
  };
}
/** Strict rectangle interiors are the independently checked forbidden region. */
function insideBox(
  point: Point,
  box: Box,
): boolean {
  return (
    point.x > box.x &&
    point.x < box.x + box.width &&
    point.y > box.y &&
    point.y < box.y + box.height
  );
}

/** A distant unrelated box cannot select a scene-wide initial lane for either parallel edges or a cycle. */
it('keeps labelled parallel and return routes local when unrelated boxes move far away', async (): Promise<void> => {
  const sources = [0, -10000].map(localProjection);
  const layout = await harness(sources);
  const scenes = await Promise.all(
    sources.map(async (source): Promise<Scene> =>
      value(await layout.arrange(request(layout, source))),
    ),
  );
  scenes.forEach((scene, index): void => {
    const section = scene.sections[0];
    const source = sources[index];
    assert(section && source);
    expect(section.wires).toHaveLength(3);
    section.wires.forEach((wire): void => {
      expect(totalLength(wire.points)).toBeLessThan(1800);
      expect(section.nodes.every((node): boolean => !hits(wire.points, node.box))).toBe(true);
      expect(section.nodes.every((node): boolean => !overlap(node.box, wire.labelBox))).toBe(true);
      expect(section.wires.every((other): boolean => !hits(other.points, wire.labelBox))).toBe(
        true,
      );
    });
    expect(section.wires[0]?.points).not.toEqual(section.wires[1]?.points);
    independentLanes(section.wires);
    expect(
      value(
        layout.inspect({
          projection: source,
          measurements: metrics(source),
          options: settings,
          candidate: scene,
        }),
      ).valid,
    ).toBe(true);
  });
  expect(scenes[0]?.sections[0]?.wires).toEqual(scenes[1]?.sections[0]?.wires);
});
/** Only the unrelated box position varies; endpoint positions, labels, topology and side constraints are constant. */
function localProjection(distant: number): Projection {
  return project(
    collection({
      objects: [object('sender'), object('receiver'), object('unrelated')],
      relationships: [
        edge('send', 'sender', 'receiver'),
        edge('again', 'sender', 'receiver'),
        edge('retry', 'receiver', 'sender'),
      ],
      sections: [
        section('local', [], {
          appearances: [
            { object: 'sender', placement: { x: 0, y: 0, height: 120, locked: true } },
            { object: 'receiver', placement: { x: 600, y: 0, height: 120, locked: true } },
            { object: 'unrelated', placement: { x: distant, y: -2000 + distant, locked: true } },
          ],
          wires: [{ relationship: 'send' }, { relationship: 'again' }, { relationship: 'retry' }],
        }),
      ],
    }),
  );
}
/** Independent travel oracle includes every actual segment rather than bounding-box size. */
function totalLength(points: readonly Point[]): number {
  return points
    .slice(1)
    .reduce((total, point, index): number => total + manhattan(points[index], point), 0);
}

/** Fixed narrow field corridors may reduce optional native clearance while preserving asymmetric cardinality and exact rows. */
it('routes dense measured fields without extending marker stubs into neighbouring content', async (): Promise<void> => {
  const original = erProjection();
  const source: Projection = {
    ...original,
    sections: original.sections.map((section): VisualSection => ({
      ...section,
      layout: { ...section.layout, gap: 'compact' },
      nodes: section.nodes.map((node, index): typeof node => ({
        ...node,
        placement: {
          x: index * ((section.nodes[0]?.width ?? 0) + 24),
          y: 0,
          height: 160,
          locked: true,
        },
      })),
    })),
  };
  const layout = await harness([source]);
  const scene = value(await layout.arrange(request(layout, source)));
  const wire = scene.sections[0]?.wires[0];
  assert(wire);
  const a = node(scene, 'user');
  const b = node(scene, 'order');
  expect(b.box.x - a.box.x - a.box.width).toBe(24);
  expect(wire.source.point).toEqual({
    x: a.box.x + a.box.width,
    y:
      a.box.y +
      (a.measured.content.anchors.find((anchor): boolean => anchor.member === 'id')?.y ?? NaN),
  });
  expect(wire.target.point).toEqual({
    x: b.box.x,
    y:
      b.box.y +
      (b.measured.content.anchors.find((anchor): boolean => anchor.member === 'userId')?.y ?? NaN),
  });
  expect(wire.sourceMarker).toBe('one');
  expect(wire.targetMarker).toBe('zero-many');
  expect(manhattan(wire.points[0], wire.points[1])).toBeGreaterThanOrEqual(7);
  expect(manhattan(wire.points.at(-1), wire.points.at(-2))).toBeGreaterThanOrEqual(22);
  expect(
    [a, b].every(
      (node): boolean => !hits(wire.points, node.box) && !overlap(node.box, wire.labelBox),
    ),
  ).toBe(true);
  expect(totalLength(wire.points)).toBeLessThan(1200);
  expect(
    value(
      layout.inspect({
        projection: source,
        measurements: metrics(source),
        options: settings,
        candidate: scene,
      }),
    ).valid,
  ).toBe(true);
  await lockedLabelConflict();
});
/** A geometrically retained manual lock cannot be silently rerouted when its newly measured label has no adjacent space. */
async function lockedLabelConflict(): Promise<void> {
  const source = flow();
  const original = await harness([source]);
  const scene = value(await original.arrange(request(original, source)));
  const points = scene.sections[0]?.wires[0]?.points;
  assert(points);
  const locked: Projection = {
    ...source,
    sections: source.sections.map((section): VisualSection => ({
      ...section,
      nodes: section.nodes.map((source): typeof source => {
        const placed = node(scene, source.objectId ?? '');
        return { ...source, placement: { x: placed.box.x, y: placed.box.y, locked: true } };
      }),
      wires: section.wires.map((wire): typeof wire => ({
        ...wire,
        label: { ...wire.label, width: 20000, height: 20000 },
        route: { ...wire.route, manual: points, locked: true },
      })),
    })),
  };
  const layout = await harness([locked]);
  const rejected = await layout.arrange(request(layout, locked));
  assert(!rejected.ok);
  expect(rejected.error.code).toBe('constraint-conflict');
  expect(rejected.error.message).toContain('measured label');
  expect(rejected.error.targets).toEqual([locked.sections[0]?.wires[0]?.id]);
}

/** Independent interval oracle rejects shared travel except within explicit common endpoint stubs, including reversed routes. */
function independentLanes(wires: readonly import('../contract/index.js').RoutedWire[]): void {
  wires.forEach((wire, i): void =>
    wires.slice(i + 1).forEach((other): void => {
      wire.points.slice(1).forEach((b, j): void =>
        other.points.slice(1).forEach((d, k): void => {
          const a = wire.points[j];
          const c = other.points[k];
          assert(a && c);
          checkSharedInterval([a, b], [c, d], wire.points, other.points);
        }),
      );
    }),
  );
}
/** Project a coincident pair onto its travel axis; point crossings have no positive common interval. */
function checkSharedInterval(
  a: readonly [Point, Point],
  b: readonly [Point, Point],
  left: readonly Point[],
  right: readonly Point[],
): void {
  const [axis, fixed] = segmentAxes(a);
  if (a[0][fixed] !== b[0][fixed] || b[0][fixed] !== b[1][fixed]) return;
  const low = Math.max(Math.min(a[0][axis], a[1][axis]), Math.min(b[0][axis], b[1][axis]));
  const high = Math.min(Math.max(a[0][axis], a[1][axis]), Math.max(b[0][axis], b[1][axis]));
  if (high <= low) return;
  expect(stubAllows(left, right, axis, fixed, a[0][fixed], low, high)).toBe(true);
}
/** Check both orientations and both complete overlap ends against the longer explicit endpoint approach. */
function stubAllows(
  left: readonly Point[],
  right: readonly Point[],
  axis: 'x' | 'y',
  fixed: 'x' | 'y',
  line: number,
  low: number,
  high: number,
): boolean {
  return [left, left.toReversed()].some((a): boolean =>
    [right, right.toReversed()].some((b): boolean => {
      const start = a[0];
      const other = b[0];
      assert(start && other);
      if (start.x !== other.x || start.y !== other.y || start[fixed] !== line) return false;
      const reach = Math.max(manhattan(start, a[1]), manhattan(other, b[1]));
      return Math.max(Math.abs(low - start[axis]), Math.abs(high - start[axis])) <= reach;
    }),
  );
}

/** Marker width is measured independently of the clear centreline; planning and inspection must both reject its content overlap. */
it('rejects full measured marker boxes without shrinking advance or half-height', async (): Promise<void> => {
  const original = project(
    collection({
      objects: [object('a'), object('b'), object('near')],
      relationships: [edge('link', 'a', 'b')],
      sections: [
        section('markers', [], {
          appearances: [
            { object: 'a', placement: { x: 0, y: 0, height: 100, locked: true } },
            { object: 'b', placement: { x: 600, y: 0, height: 100, locked: true } },
            { object: 'near', placement: { x: 146, y: 55, height: 100, locked: true } },
          ],
          wires: [{ relationship: 'link', sourceSide: 'right', targetSide: 'left' }],
        }),
      ],
    }),
  );
  const source: Projection = {
    ...original,
    sections: original.sections.map((section): VisualSection => ({
      ...section,
      wires: section.wires.map((wire): typeof wire => ({ ...wire, sourceMarker: 'one' })),
    })),
  };
  const layout = await harness([source]);
  const small = {
    ...metrics(source),
    markers: { ...metrics(source).markers, one: { advance: 20, halfHeight: 1 } },
  };
  const { job, ...base } = request(layout, source);
  const input = {
    ...base,
    measurements: small,
    options: { ...settings, routeClearance: 1, gap: { compact: 1, normal: 1, roomy: 1 } },
  };
  const scene = value(
    await layout.arrange({ ...input, job: { ...job, inputKey: value(layout.key(input)) } }),
  );
  const wire = scene.sections[0]?.wires[0];
  assert(wire);
  const obstacle = node(scene, 'near').box;
  const box = { x: wire.source.point.x, y: wire.source.point.y - 8, width: 20, height: 16 };
  expect(hits(wire.points, obstacle)).toBe(false);
  expect(overlap(box, obstacle)).toBe(true);
  const full = { ...small, markers: { ...small.markers, one: { advance: 20, halfHeight: 8 } } };
  const blocked = { ...input, measurements: full };
  const planned = await layout.arrange({
    ...blocked,
    job: { ...job, inputKey: value(layout.key(blocked)) },
  });
  assert(!planned.ok);
  expect(planned.error.code).toBe('constraint-conflict');
  expect(planned.error.targets).toEqual([wire.id]);
  // Rebind transported derivation keys so rejection must come from marker geometry, not stale metadata.
  const candidate = {
    ...scene,
    inputKey: value(layout.key(blocked)),
    sections: scene.sections.map((section): typeof section => ({
      ...section,
      inputKey: layoutInputKey.parse(
        section.inputKey.replace(
          '"one":{"advance":20,"halfHeight":1}',
          '"one":{"advance":20,"halfHeight":8}',
        ),
      ),
    })),
  };
  const inspected = value(
    layout.inspect({ projection: source, measurements: full, options: input.options, candidate }),
  );
  expect(inspected.valid).toBe(false);
  expect(inspected.diagnostics.some((issue): boolean => issue.message.includes('marker'))).toBe(
    true,
  );
  expect(full.markers.one).toEqual({ advance: 20, halfHeight: 8 });
});

/** Axis choice keeps the interval oracle symmetric for vertical routes. */
function segmentAxes(segment: readonly [Point, Point]): readonly ['x' | 'y', 'x' | 'y'] {
  if (segment[0].y === segment[1].y) return ['x', 'y'];
  return ['y', 'x'];
}

/** Real routing crosses nested/root borders while labels retain clear group interior or exterior space. */
async function groupLabelBorders(enter: boolean): Promise<void> {
  const source = groupBorderProjection(enter);
  const layout = await harness([source]);
  const scene = value(await layout.arrange(request(layout, source)));
  const placed = scene.sections[0];
  const wire = placed?.wires[0];
  assert(placed && wire);
  const groups = placed.nodes.filter((node): boolean => node.measured.groupId !== null);
  expect(groups).toHaveLength(2);
  expect(groups.map((group): string | null => group.parent)).toContain(null);
  groups.forEach((group): void => {
    expect(hits(wire.points, group.box)).toBe(true);
    expect(borderCrosses(wire.labelBox, group.box)).toBe(false);
    // Exit ordering selects free interior space; the reversed route may select clear exterior space.
    if (!enter) expect(labelInside(wire.labelBox, group.box)).toBe(true);
    forgedBorderLabels(group.box, group.measured.strokeWidth, wire.labelBox).forEach(
      (labelBox): void => {
        const candidate = {
          ...scene,
          sections: scene.sections.map((section): typeof section => ({
            ...section,
            wires: section.wires.map((wire): typeof wire => ({ ...wire, labelBox })),
          })),
        };
        const inspected = value(
          layout.inspect({
            projection: source,
            measurements: metrics(source),
            options: settings,
            candidate,
          }),
        );
        expect(inspected.valid).toBe(false);
        expect(
          inspected.diagnostics.some(
            (issue): boolean => issue.message === 'Wire label overlaps reserved content',
          ),
        ).toBe(true);
      },
    );
  });
  expect(
    value(
      layout.inspect({
        projection: source,
        measurements: metrics(source),
        options: settings,
        candidate: scene,
      }),
    ).valid,
  ).toBe(true);
  expect(wire.points[0]).toEqual(wire.source.point);
  expect(wire.points.at(-1)).toEqual(wire.target.point);
  const locked: Projection = {
    ...source,
    sections: source.sections.map((section): VisualSection => ({
      ...section,
      wires: section.wires.map((item): typeof item => ({
        ...item,
        route: { ...item.route, locked: true, manual: wire.points },
      })),
    })),
  };
  const retainedLayout = await harness([locked]);
  const retained = value(await retainedLayout.arrange(request(retainedLayout, locked)));
  expect(retained.sections[0]?.wires[0]?.points).toEqual(wire.points);
}
/** Fixed semantic containment makes the first midpoint caption straddle the outer group's right border. */
function groupBorderProjection(enter: boolean): Projection {
  const direction = enter
    ? { source: 'outside', target: 'inside', sourceSide: 'left', targetSide: 'right' }
    : { source: 'inside', target: 'outside', sourceSide: 'right', targetSide: 'left' };
  return project(
    collection({
      objects: [object('inside'), object('outside')],
      relationships: [
        edge('exit', direction.source, direction.target, {
          label: 'cross group boundaries',
        }),
      ],
      sections: [
        section('borders', [], {
          mode: 'grid',
          layout: { algorithm: 'grid' },
          groups: [
            {
              id: 'outer',
              title: 'Outer',
              layout: { algorithm: 'grid' },
              placement: { x: 0, y: 0, width: 820, height: 800, locked: true },
            },
            {
              id: 'inner',
              title: 'Inner',
              parent: 'outer',
              layout: { algorithm: 'grid' },
              placement: { x: 100, y: 100, width: 600, height: 600, locked: true },
            },
          ],
          appearances: [
            {
              object: 'inside',
              group: 'inner',
              placement: { x: 200, y: 300, height: 100, locked: true },
            },
            { object: 'outside', placement: { x: 1300, y: 300, height: 100, locked: true } },
          ],
          wires: [
            {
              relationship: 'exit',
              sourceSide: direction.sourceSide,
              targetSide: direction.targetSide,
            },
          ],
        }),
      ],
    }),
  );
}
/** Independent interval oracle checks four border centre lines without calling production obstacle construction. */
function borderCrosses(
  label: Box,
  group: Box,
): boolean {
  return [
    { ...group, height: 0 },
    { ...group, y: group.y + group.height, height: 0 },
    { ...group, width: 0 },
    { ...group, x: group.x + group.width, width: 0 },
  ].some((border): boolean => overlap(label, border));
}
/** Each forged rectangle touches only the outward painted quarter-stroke, preserving exact measured dimensions. */
function forgedBorderLabels(
  group: Box,
  stroke: number,
  label: Box,
): readonly Box[] {
  const x = group.x + (group.width - label.width) / 2;
  const y = group.y + (group.height - label.height) / 2;
  return [
    { ...label, x, y: group.y - label.height - stroke / 4 },
    { ...label, x, y: group.y + group.height + stroke / 4 },
    { ...label, x: group.x - label.width - stroke / 4, y },
    { ...label, x: group.x + group.width + stroke / 4, y },
  ];
}

/** Both label corners must sit strictly inside the group for the positive interior-space assertion. */
function labelInside(
  label: Box,
  group: Box,
): boolean {
  return (
    insideBox(label, group) &&
    insideBox({ x: label.x + label.width, y: label.y + label.height }, group)
  );
}

/** The existing native acceptance case also covers compressed ranked cycles in every direction. */
async function rankedLabelCorridors(): Promise<void> {
  for (const direction of ['right', 'left', 'down', 'up'] as const) {
    await rankedLabelCorridor(direction, false);
    await rankedLabelCorridor(direction, true);
  }
}
/** Real seeded ranks must reserve readable straight forward wires; the return edge keeps its own lane. */
async function rankedLabelCorridor(
  direction: VisualSection['layout']['direction'],
  grouped: boolean,
): Promise<void> {
  const layoutIntent = {
    algorithm: 'layered',
    direction,
    gap: 'compact',
    constraints: [{ kind: 'rank', targets: ['a', 'b', 'c'].map((id) => ({ kind: 'object', id })) }],
  };
  const source = project(
    collection({
      objects: ['a', 'b', 'c'].map((id) => object(id)),
      relationships: [
        edge('ab', 'a', 'b', { label: 'Submit application for review and record applicant' }),
        edge('bc', 'b', 'c', { label: 'Complete review and record the decision' }),
        edge('ca', 'c', 'a', { label: 'Return for another review' }),
      ],
      sections: [
        section('ranked', [], {
          layout: grouped ? { algorithm: 'layered', direction } : layoutIntent,
          groups: grouped ? [{ id: 'group', title: 'Review', layout: layoutIntent }] : [],
          appearances: ['a', 'b', 'c'].map((object) => ({
            object,
            ...(grouped ? { group: 'group' } : {}),
          })),
          wires: ['ab', 'bc', 'ca'].map((relationship) => ({ relationship })),
        }),
      ],
    }),
  );
  const layout = await harness([source]);
  const scene = value(await layout.arrange(request(layout, source)));
  const placed = scene.sections[0];
  assert(placed);
  placed.wires.slice(0, 2).forEach((wire) => {
    const travel = wire.points
      .slice(1)
      .reduce((sum, point, index) => sum + manhattan(wire.points[index], point), 0);
    expect(travel).toBeCloseTo(manhattan(wire.source.point, wire.target.point));
    expect(placed.nodes.every((node) => !borderCrosses(wire.labelBox, node.box))).toBe(true);
  });
  expect(
    value(
      layout.inspect({
        projection: source,
        measurements: metrics(source),
        options: settings,
        candidate: scene,
      }),
    ).valid,
  ).toBe(true);
}
