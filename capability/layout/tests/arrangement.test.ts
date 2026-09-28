/** Public Layout scenarios use real injected engines; Vitest owns assertion reporting and the developer fixes failures before rerunning. */
import { describe, it, expect, assert } from 'vitest';
import {
  collection,
  object,
  edge,
  section,
  project,
  harness,
  request,
  value,
  flow,
  rejected,
} from './fixtures.js';
import { node, dependencies, settings, metrics } from './fixtures.js';
import { createLayout, toCollection, toSection, toParent } from '../contract/index.js';
import type {
  LayoutIntent,
  PlacementProblem,
  PlacementValue,
  Projection,
  Scene,
  SolverProblem,
  Box,
  SupplementalMeasurements,
} from '../contract/index.js';
describe('Layout arrangement acceptance', () => {
  it('1 — lays out mixed section policies deterministically with complete labelled wires', async () => {
    const source = flow();
    const layout = await harness([source]);
    const input = request(layout, source);
    const first = value(await layout.arrange(input));
    const second = value(await layout.arrange(input));
    expect(first).toEqual(second);
    expect(first.sections).toHaveLength(1);
    expect(first.sections[0]?.nodes).toHaveLength(2);
    expect(first.sections[0]?.wires).toHaveLength(1);
    expect(
      value(
        layout.inspect({
          projection: source,
          measurements: input.measurements,
          options: input.options,
          candidate: first,
        }),
      ).valid,
    ).toBe(true);
    const mixed = project(
      collection({
        objects: [object('a'), object('b'), object('c', 'concept'), object('d', 'concept')],
        relationships: [edge('parent', 'c', 'd', { kind: 'parent' })],
        sections: [
          section('grid', ['a', 'b'], { mode: 'grid', layout: { algorithm: 'grid' } }),
          section('tree', ['c', 'd'], {
            mode: 'tree',
            layout: { algorithm: 'tree' },
            root: 'c',
            wires: [{ relationship: 'parent' }],
            order: 1,
          }),
        ],
      }),
    );
    const mixedLayout = await harness([mixed]);
    const scene = value(await mixedLayout.arrange(request(mixedLayout, mixed)));
    expect(scene.sections.map((item) => item.id)).toEqual(['grid', 'tree']);
    expect(scene.sections.map((item) => item.nodes.length)).toEqual([2, 2]);
    // A tall third-row card cannot inflate the distance between the first two short rows.
    const compactGrid = project(
      collection({
        objects: ['a', 'b', 'c', 'd', 'e', 'f'].map((id) =>
          object(id, 'note', {
            content: [
              { id: 'text', kind: 'text', text: id === 'e' ? 'Tall\n'.repeat(12) : 'Short' },
            ],
          }),
        ),
        sections: [
          section('cards', ['a', 'b', 'c', 'd', 'e', 'f'], {
            mode: 'grid',
            layout: { algorithm: 'grid' },
          }),
        ],
      }),
    );
    const gridLayout = await harness([compactGrid]);
    const gridInput = {
      projection: compactGrid,
      measurements: metrics(compactGrid),
      options: { ...settings, gridColumns: 2 },
      previous: null,
    };
    const gridScene = value(
      await gridLayout.arrange({
        ...gridInput,
        job: { id: 'heterogeneous-grid', inputKey: value(gridLayout.key(gridInput)) },
      }),
    );
    const a = node(gridScene, 'a').box;
    const b = node(gridScene, 'b').box;
    const c = node(gridScene, 'c').box;
    expect(c.y - a.y).toBeCloseTo(Math.max(a.height, b.height) + settings.gap.normal);
    expect(node(gridScene, 'e').box.height).toBeGreaterThan(a.height);
  });

  it('2 — encloses nested represented groups and preserves coordinate conversions', async () => {
    const source = project(
      collection({
        objects: [object('system', 'system'), object('a'), object('b')],
        sections: [
          section('nested', [], {
            mode: 'grid',
            layout: { algorithm: 'grid' },
            groups: [
              {
                id: 'outer',
                title: 'Outer',
                represents: 'system',
                layout: { algorithm: 'grid', direction: 'down' },
              },
              { id: 'inner', title: 'Inner', parent: 'outer', layout: { algorithm: 'grid' } },
            ],
            appearances: [
              { object: 'a', group: 'inner' },
              { object: 'b', group: 'outer' },
            ],
            placement: { x: -200, y: 300, locked: true },
          }),
        ],
      }),
    );
    const layout = await harness([source]);
    const scene = value(await layout.arrange(request(layout, source)));
    const outer = node(scene, 'system');
    const a = node(scene, 'a');
    const inner = scene.sections[0]?.nodes.find((item) => item.measured.groupId === 'inner');
    assert(inner);
    expect(a.parent).toBe(inner.id);
    expect(inner.parent).toBe(outer.id);
    expect(a.box.y).toBeGreaterThanOrEqual(
      inner.box.y + inner.measured.headerHeight + settings.padding - 0.000001,
    );
    expect(a.box.x + a.box.width).toBeLessThanOrEqual(
      inner.box.x + inner.box.width - settings.padding + 0.000001,
    );
    expect(inner.box.y).toBeGreaterThanOrEqual(
      outer.box.y + outer.measured.headerHeight + settings.padding - 0.000001,
    );
    expect(scene.sections[0]?.origin).toEqual({ x: -200, y: 300 });
    expect(
      scene.sections[0]?.nodes.filter((item) => item.measured.objectId === 'system'),
    ).toHaveLength(1);
    expect(
      toSection(toCollection({ x: -17, y: 29 }, { x: -200, y: 300 }), { x: -200, y: 300 }),
    ).toEqual({ x: -17, y: 29 });
    expect(toParent({ x: 140, y: 250 }, { x: 100, y: 200, width: 200, height: 200 })).toEqual({
      x: 40,
      y: 50,
    });
  });
  it('3 — honours all relative meanings in all four directions and relaxes contradictions visibly', async () => {
    const directions: readonly LayoutIntent['direction'][] = ['right', 'down', 'left', 'up'];
    const kinds: readonly LayoutIntent['constraints'][number]['kind'][] = [
      'rank',
      'before',
      'below',
      'align',
    ];
    await Promise.all(
      directions.flatMap((direction) => kinds.map((kind) => checkRelative(kind, direction))),
    );
    const source = relativeProjection('before', 'right', [
      {
        kind: 'before',
        targets: [
          { kind: 'object', id: 'b' },
          { kind: 'object', id: 'a' },
        ],
      },
    ]);
    const layout = await harness([source]);
    const scene = value(await layout.arrange(request(layout, source)));
    const relaxed = scene.warnings.filter((warning) => warning.code === 'constraint-relaxed');
    expect(relaxed).toHaveLength(1);
    expect(relaxed[0]?.targets.toSorted()).toEqual(['a', 'b']);
  });
  it('4 — preserves hard negative positions and explicit sizes, rejecting impossible measured fit', async () => {
    const source = lockedProjection(240);
    const impossible = lockedProjection(1);
    const soft = project(
      collection({
        objects: [object('a'), object('b')],
        sections: [
          section('soft', [], {
            mode: 'grid',
            layout: { algorithm: 'grid' },
            appearances: [
              { object: 'a', placement: { x: 0, y: 0 } },
              { object: 'b', placement: { x: 0, y: 0 } },
            ],
          }),
        ],
      }),
    );
    const layout = await harness([source, impossible, soft]);
    const result = value(await layout.arrange(request(layout, source)));
    expect(node(result, 'a').box).toEqual({ x: -400, y: -250, width: 240, height: 100 });
    const failed = await layout.arrange(request(layout, impossible));
    assert(!failed.ok);
    expect(failed.error.code).toBe('constraint-conflict');
    const adjusted = value(await layout.arrange(request(layout, soft)));
    expect(adjusted.adjustments.length).toBeGreaterThan(0);
    expect(node(adjusted, 'a').box).not.toEqual(node(adjusted, 'b').box);
  });
  it('5 — reuses untouched local geometry and rejects forged cache content', async () => {
    const before = twoSections(0, 'a');
    const after = twoSections(1, 'a changed enough to wrap onto two lines');
    const native = await dependencies([before, after]);
    let placements = 0;
    const layout = createLayout({
      ...native,
      placement: {
        ...native.placement,
        async place(problem) {
          placements += 1;
          return native.placement.place(problem);
        },
      },
    });
    const first = value(await layout.arrange(request(layout, before)));
    placements = 0;
    const next = value(await layout.arrange(request(layout, after, first)));
    expect(placements).toBe(1);
    expect(next.sections[1]?.nodes).toEqual(first.sections[1]?.nodes);
    expect(next.sections[1]?.wires).toEqual(first.sections[1]?.wires);
    expect(next.sections[0]?.nodes).not.toEqual(first.sections[0]?.nodes);
    const forged = structuredClone(first);
    const broken = {
      ...forged,
      sections: forged.sections.map((section) => ({ ...section, nodes: [] })),
    };
    const repaired = value(await layout.arrange(request(layout, before, broken)));
    expect(repaired.sections.map((section) => section.nodes.length)).toEqual([2, 2]);
    const future = { ...first, revision: 999 };
    expect(
      value(await layout.arrange(request(layout, before, future))).sections.map(
        (item) => item.nodes,
      ),
    ).toEqual(first.sections.map((item) => item.nodes));
    const changedEngine = createLayout({
      ...native,
      placement: { ...native.placement, version: `${native.placement.version}/changed` },
    });
    const rederived = value(await changedEngine.arrange(request(changedEngine, before, first)));
    expect(rederived.sections.map((item) => item.nodes)).toEqual(
      first.sections.map((item) => item.nodes),
    );
    expect(rederived.sections.map((item) => item.inputKey)).not.toEqual(
      first.sections.map((item) => item.inputKey),
    );
  });
  it('6 — renders ordered sequence messages, nested fragments, measured branches and activations', async (): Promise<void> => {
    const source = sequenceProjection('compact');
    const layout = await harness([source]);
    const scene = value(await layout.arrange(request(layout, source)));
    await checkSequenceSpacing(source, scene);
    const sequence = scene.sections[0]?.sequence;
    assert(sequence);
    expect(sequence.events.map((item) => item.id)).toEqual([
      'call',
      'self',
      'return',
      'fallback',
      'after',
    ]);
    expect(sequence.fragments.map((item) => item.id)).toEqual(['alternatives', 'retry']);
    expect(sequence.fragments[0]?.branches.map((item) => item.id)).toEqual(['yes', 'no']);
    expect(sequence.events.map((item) => item.message)).toEqual([
      'call',
      'call',
      'return',
      'async',
      'async',
    ]);
    expect(sequence.events[1]?.points).toHaveLength(4);
    expect(sequence.events[2]?.labelBox.y).toBeGreaterThan(
      sequence.events[1]?.points.at(-1)?.y ?? -Infinity,
    );
    expect(sequence.activations[0]).toMatchObject({ fromEvent: 'call', toEvent: 'return' });
    expect(sequence.lifelines).toHaveLength(2);
    expect(sequence.lifelines[0]?.to.y).toBeGreaterThan(
      sequence.events.at(-1)?.labelBox.y ?? Infinity,
    );
    const headings = metrics(source).branchHeadings.map((item) => item.content);
    expect(sequence.fragments[0]?.branches.map((item) => item.content)).toEqual(headings);
    const wideInput = request(layout, source);
    const wideMeasurements = {
      ...wideInput.measurements,
      branchHeadings: wideInput.measurements.branchHeadings.map((item) => ({
        ...item,
        content:
          item.branch === 'yes' ? { ...item.content, width: 900, height: 160 } : item.content,
      })),
    };
    const wideScene = value(
      await layout.arrange({
        ...wideInput,
        measurements: wideMeasurements,
        job: {
          id: 'wide-alternative',
          inputKey: value(
            layout.key({
              projection: source,
              measurements: wideMeasurements,
              options: wideInput.options,
              previous: null,
            }),
          ),
        },
      }),
    );
    expect(
      value(
        layout.inspect({
          projection: source,
          measurements: wideMeasurements,
          options: wideInput.options,
          candidate: wideScene,
        }),
      ).valid,
    ).toBe(true);
    assertSequenceMeasurements(source, wideScene);
    const wideSequence = wideScene.sections[0]?.sequence;
    const parent = wideSequence?.fragments.find((item) => item.id === 'alternatives');
    assert(parent && wideSequence);
    parent.branches.forEach((branch) => expect(contained(parent.box, branch.box)).toBe(true));
    wideSequence.fragments
      .filter((fragment) => fragment.parent === parent.id)
      .forEach((fragment) => expect(contained(parent.box, fragment.box)).toBe(true));
    expect(wideSequence.events.map((item) => item.id)).toEqual(
      sequence.events.map((item) => item.id),
    );
    expect(wideSequence.fragments.map((item) => item.id)).toEqual(
      sequence.fragments.map((item) => item.id),
    );
    expect(wideSequence.activations).toHaveLength(sequence.activations.length);
    const isolated = isolatedAlternatives();
    const scoped = await harness([isolated]);
    const isolatedScene = value(await scoped.arrange(request(scoped, isolated)));
    const view = isolatedScene.sections[0];
    assert(view);
    expect(view.sequence.activations).toHaveLength(1);
    const activation = view.sequence.activations[0];
    const yes = view.sequence.fragments[0]?.branches[0];
    assert(activation && yes);
    expect(activation).toMatchObject({ fromEvent: 'branchCall', toEvent: null });
    expect(activation.box.y + activation.box.height).toBeLessThanOrEqual(
      yes.box.y + yes.box.height,
    );
    const trimSource = unclosedTrim();
    const trimLayout = await harness([trimSource]);
    const trimScene = value(await trimLayout.arrange(request(trimLayout, trimSource)));
    const trimView = trimScene.sections[0];
    assert(trimView);
    const bar = trimView.sequence.activations[0];
    const lastEvent = trimView.sequence.events.at(-1);
    assert(bar);
    assert(lastEvent);
    expect(bar.box.y + bar.box.height).toBeCloseTo(
      Math.max(...lastEvent.points.map((point) => point.y)) + settings.sequenceGap / 2,
    );
    expect(bar.box.y + bar.box.height).toBeLessThan(
      trimView.sequence.lifelines[0]?.to.y ?? Infinity,
    );
    const forged = {
      ...isolatedScene,
      sections: [
        {
          ...view,
          sequence: { ...view.sequence, activations: [{ ...activation, toEvent: 'branchReturn' }] },
        },
      ],
    };
    const inspected = value(
      scoped.inspect({
        projection: isolated,
        measurements: metrics(isolated),
        options: settings,
        candidate: forged,
      }),
    );
    expect(inspected.valid).toBe(false);
    expect(inspected.diagnostics[0]?.message).toBe(
      'Mutually exclusive alternatives cannot share an activation interval',
    );
  });
  it('renders canonical module endpoints as sequence lifelines without adding objects', async (): Promise<void> => {
    const source = project(
      collection({
        objects: [object('api', 'module'), object('worker', 'module'), object('unused', 'module')],
        sections: [
          section('sequence', ['api', 'worker', 'unused'], {
            mode: 'sequence',
            layout: { algorithm: 'sequence' },
            sequence: [
              {
                id: 'request',
                kind: 'event',
                source: 'api',
                target: 'worker',
                label: 'Request',
                message: 'call',
                order: 0,
              },
            ],
          }),
        ],
      }),
    );
    const engine = await harness([source]);
    const scene = value(await engine.arrange(request(engine, source)));
    const sequence = scene.sections[0]?.sequence;
    assert(sequence);
    expect(sequence.lifelines.map((lifeline) => lifeline.participant)).toEqual([
      'sequence:object:api',
      'sequence:object:worker',
    ]);
    expect(scene.sections[0]?.nodes.map((node) => node.measured.objectId)).toEqual([
      'api',
      'worker',
      'unused',
    ]);
  });
});

it('keeps measured flow spacing independent across directions and nested scopes', async (): Promise<void> => {
  const directions: readonly LayoutIntent['direction'][] = ['right', 'down', 'left', 'up'];
  for (const direction of directions) await checkDirectionalSpacing(direction);
  await checkNestedSpacing();
  await checkTreeSeed();
  await checkTreeAcceptance();
});

/** Real ELK output for unequal boxes must preserve the measured flow reservation without inflating siblings. */
async function checkDirectionalSpacing(direction: LayoutIntent['direction']): Promise<void> {
  const source = directionalProjection(direction);
  const captured: PlacementProblem[] = [];
  let placed: readonly PlacementValue[] = [];
  const native = await dependencies([source]);
  const layout = createLayout({
    ...native,
    placement: {
      ...native.placement,
      async place(problem) {
        captured.push(problem);
        const result = await native.placement.place(problem);
        if (result.ok && problem.edges.length === 2) placed = result.value;
        return result;
      },
    },
  });
  const outcome = await layout.arrange(request(layout, source));
  if (!outcome.ok) expect(outcome.error.code).toBe('engine-failed');
  const problem = captured.find((item) => item.edges.length === 2);
  assert(problem);
  const first = placed.find((item) => item.id === problem.nodes[0]?.id);
  const second = placed.find((item) => item.id === problem.nodes[1]?.id);
  const third = placed.find((item) => item.id === problem.nodes[2]?.id);
  assert(first && second && third);
  expect(problem.spacing).toBe(expectedCrossSpacing(source));
  expect(problem.layerSpacing).toBe(expectedLayerSpacing(source, direction));
  expect(mainClearance(first.box, second.box, direction)).toBeGreaterThanOrEqual(
    problem.layerSpacing - 0.000001,
  );
  const siblingGap = crossClearance(second.box, third.box, direction);
  expect(siblingGap).toBeGreaterThanOrEqual(problem.spacing - 0.000001);
  expect(siblingGap).toBeLessThan(problem.layerSpacing);
}

/** Nested groups reserve only their contracted local edges using their own reading direction. */
async function checkNestedSpacing(): Promise<void> {
  const source = nestedSpacingProjection();
  const captured: PlacementProblem[] = [];
  const native = await dependencies([source]);
  const layout = createLayout({
    ...native,
    placement: {
      ...native.placement,
      async place(problem) {
        captured.push(problem);
        return native.placement.place(problem);
      },
    },
  });
  value(await layout.arrange(request(layout, source)));
  const scopes = captured.filter((item) => item.edges.length === 1);
  expect(scopes.map((item) => item.direction).toSorted()).toEqual(['down', 'right']);
  scopes.forEach((problem) => {
    expect(problem.spacing).toBe(
      expectedCrossSpacing(
        source,
        problem.edges.map((edge) => edge.id),
      ),
    );
    expect(problem.layerSpacing).toBe(expectedLayerSpacing(source, problem.direction));
  });
}

/** Tree seeds retain validated parent topology while annotation references stay out of native ranking. */
async function checkTreeSeed(): Promise<void> {
  const source = treeProjection('Annotation\nwith context\nand provenance');
  const { problems } = await captureSeeds(source);
  const problem = problems.find((item) => item.algorithm === 'tree');
  assert(problem);
  const parent = source.sections[0]?.wires.find((wire) => wire.relationshipId === 'parent');
  assert(parent);
  expect(problem.edges).toEqual([
    { id: parent.id, source: parent.source.node, target: parent.target.node },
  ]);
  expect(problem.spacing).toBe(expectedCrossSpacing(source));
  expect(problem.layerSpacing).toBe(expectedWireSpacing(source, 'down'));
}

/** Projection labels deliberately have unequal flow extents so width/height swaps cannot pass. */
function directionalProjection(direction: LayoutIntent['direction']): Projection {
  return project(
    collection({
      objects: [
        object('a'),
        object('b', 'note', { content: [{ id: 'body', kind: 'text', text: 'Tall\nTall\nTall' }] }),
        object('c', 'note', { label: 'Unequal sibling width' }),
      ],
      relationships: [
        edge('ab', 'a', 'b', { label: 'Measured directional reservation' }),
        edge('ac', 'a', 'c', { label: 'Measured directional reservation' }),
      ],
      sections: [
        section('directional', ['a', 'b', 'c'], {
          layout: { algorithm: 'layered', direction, gap: 'compact' },
          wires: [{ relationship: 'ab' }, { relationship: 'ac' }],
        }),
      ],
    }),
  );
}

/** One child-local edge and one contracted outer edge expose accidental cross-scope leakage. */
function nestedSpacingProjection(): Projection {
  return project(
    collection({
      objects: [object('a'), object('b'), object('c')],
      relationships: [
        edge('inner-edge', 'a', 'b', { kind: 'reference', label: 'Inner vertical label' }),
        edge('outer-edge', 'b', 'c', { label: 'Outer horizontal reservation label' }),
      ],
      sections: [
        section('nested-spacing', [], {
          layout: { algorithm: 'layered', direction: 'right', gap: 'compact' },
          groups: [
            {
              id: 'inner',
              title: 'Inner',
              layout: { algorithm: 'layered', direction: 'down', gap: 'compact' },
            },
          ],
          appearances: [
            { object: 'a', group: 'inner' },
            { object: 'b', group: 'inner' },
            { object: 'c' },
          ],
          wires: [{ relationship: 'inner-edge' }, { relationship: 'outer-edge' }],
        }),
      ],
    }),
  );
}

/** Reservation is independently specified from public measured labels and marker metrics. */
function expectedLayerSpacing(
  source: Projection,
  direction: LayoutIntent['direction'],
): number {
  const wire = source.sections[0]?.wires.find((item) =>
    direction === 'down'
      ? ['inner-edge', 'ab', 'parent'].includes(item.relationshipId)
      : item.relationshipId === 'outer-edge' || item.relationshipId === 'ab',
  );
  assert(wire);
  const label =
    direction === 'right' || direction === 'left' ? wire.label.width : wire.label.height;
  return (
    metrics(source).markers[wire.sourceMarker].advance +
    metrics(source).markers[wire.targetMarker].advance +
    settings.routeClearance * 4 +
    label +
    settings.labelGap * 2
  );
}

/** Boundary clearance follows the declared forward or reverse flow axis. */
function mainClearance(
  first: Scene['bounds'],
  second: Scene['bounds'],
  direction: LayoutIntent['direction'],
): number {
  const values = {
    right: second.x - first.x - first.width,
    left: first.x - second.x - second.width,
    down: second.y - first.y - first.height,
    up: first.y - second.y - second.height,
  };
  return values[direction];
}

/** Sibling clearance uses the physical axis perpendicular to local flow. */
function crossClearance(
  first: Scene['bounds'],
  second: Scene['bounds'],
  direction: LayoutIntent['direction'],
): number {
  const horizontal = direction === 'right' || direction === 'left';
  const starts = horizontal ? [first.y, second.y] : [first.x, second.x];
  const ends = horizontal
    ? [first.y + first.height, second.y + second.height]
    : [first.x + first.width, second.x + second.width];
  return Math.max(...starts) - Math.min(...ends);
}

/** Parent bounds include a candidate when every physical edge stays inside. */
function contained(
  parent: Scene['bounds'],
  child: Scene['bounds'],
): boolean {
  return (
    child.x >= parent.x &&
    child.y >= parent.y &&
    child.x + child.width <= parent.x + parent.width &&
    child.y + child.height <= parent.y + parent.height
  );
}
/** Relative scenarios use public Model/Presentation constructors rather than forged checked types. */
function relativeProjection(
  kind: string,
  direction: string,
  extra: readonly unknown[] = [],
): Projection {
  return project(
    collection({
      objects: [object('a'), object('b')],
      sections: [
        section('relative', ['a', 'b'], {
          mode: 'grid',
          layout: {
            algorithm: 'grid',
            direction,
            constraints: [
              {
                kind,
                targets: [
                  { kind: 'object', id: 'a' },
                  { kind: 'object', id: 'b' },
                ],
              },
              ...extra,
            ],
          },
        }),
      ],
    }),
  );
}
/** Independent numeric assertions describe DSL meaning directly instead of importing the equation compiler. */
async function checkRelative(
  kind: LayoutIntent['constraints'][number]['kind'],
  direction: LayoutIntent['direction'],
): Promise<void> {
  const source = relativeProjection(kind, direction);
  const layout = await harness([source]);
  const scene = value(await layout.arrange(request(layout, source)));
  const a = node(scene, 'a').box;
  const b = node(scene, 'b').box;
  const policies = {
    right: {
      main: b.x - a.x - a.width,
      cross: b.y - a.y,
      mainEqual: a.x - b.x,
      crossOrder: b.y - a.y - a.height,
    },
    left: {
      main: a.x - b.x - b.width,
      cross: b.y - a.y,
      mainEqual: a.x - b.x,
      crossOrder: b.y - a.y - a.height,
    },
    down: {
      main: b.y - a.y - a.height,
      cross: b.x - a.x,
      mainEqual: a.y - b.y,
      crossOrder: b.x - a.x - a.width,
    },
    up: {
      main: a.y - b.y - b.height,
      cross: b.x - a.x,
      mainEqual: a.y - b.y,
      crossOrder: b.x - a.x - a.width,
    },
  };
  const actual = policies[direction];
  const assertions = {
    before: () => expect(actual.main).toBeGreaterThanOrEqual(settings.gap.normal - 0.000001),
    rank: () => {
      expect(actual.cross).toBeCloseTo(0);
      expect(actual.main).toBeGreaterThanOrEqual(settings.gap.normal - 0.000001);
    },
    align: () => {
      expect(actual.mainEqual).toBeCloseTo(0);
      expect(actual.crossOrder).toBeGreaterThanOrEqual(settings.gap.normal - 0.000001);
    },
    below: () =>
      expect(a.y - b.y - b.height).toBeGreaterThanOrEqual(settings.gap.normal - 0.000001),
  };
  assertions[kind]();
  expect(scene.warnings.filter((warning) => warning.code === 'constraint-relaxed')).toEqual([]);
}
/** A hard width smaller than measured minimum must fail rather than resize a user's locked box. */
function lockedProjection(width: number): Projection {
  return project(
    collection({
      objects: [object('a')],
      sections: [
        section('locked', [], {
          appearances: [
            { object: 'a', placement: { x: -400, y: -250, width, height: 100, locked: true } },
          ],
        }),
      ],
    }),
  );
}
/** Revision/title changes affect only one measured section; the other is a real incremental reuse oracle. */
function twoSections(
  revision: number,
  label: string,
): Projection {
  return project(
    collection({
      revision,
      objects: [object('a', 'step', { label }), object('b'), object('c'), object('d')],
      sections: [section('first', ['a', 'b']), section('second', ['c', 'd'], { order: 1 })],
    }),
  );
}
/** Nested sequence fixture includes all required message forms and branch-owned headings. */
function sequenceProjection(gap: LayoutIntent['gap'] = 'normal'): Projection {
  return project(
    collection({
      objects: [object('client', 'participant'), object('server', 'participant')],
      sections: [
        section('sequence', ['client', 'server'], {
          mode: 'sequence',
          layout: { algorithm: 'sequence', direction: 'right', gap },
          sequence: [
            {
              id: 'call',
              kind: 'event',
              source: 'client',
              target: 'server',
              label: 'Request',
              message: 'call',
              order: 0,
              activate: true,
            },
            {
              id: 'alternatives',
              kind: 'fragment',
              operator: 'alt',
              label: 'Result',
              order: 1,
              branches: [
                { id: 'yes', label: 'Available' },
                { id: 'no', label: 'Unavailable' },
              ],
            },
            {
              id: 'retry',
              kind: 'fragment',
              operator: 'loop',
              label: 'Retry once',
              parent: 'alternatives',
              branch: 'yes',
              order: 0,
            },
            {
              id: 'self',
              kind: 'event',
              source: 'server',
              target: 'server',
              label: 'Check cache',
              message: 'call',
              parent: 'retry',
              order: 0,
            },
            {
              id: 'return',
              kind: 'event',
              source: 'server',
              target: 'client',
              label: 'Result',
              message: 'return',
              parent: 'alternatives',
              branch: 'yes',
              order: 1,
              activate: false,
            },
            {
              id: 'fallback',
              kind: 'event',
              source: 'server',
              target: 'client',
              label: 'Retry later',
              message: 'async',
              parent: 'alternatives',
              branch: 'no',
              order: 0,
            },
            {
              id: 'after',
              kind: 'event',
              source: 'client',
              target: 'server',
              label: 'Audit',
              message: 'async',
              order: 2,
            },
          ],
        }),
      ],
    }),
  );
}

/** The same measured content must fit every semantic gap; native engines and public inspection stay authoritative. */
async function checkSequenceSpacing(
  compact: Projection,
  compactScene: Scene,
): Promise<void> {
  const normal = sequenceProjection('normal');
  const roomy = sequenceProjection('roomy');
  const sources = [compact, normal, roomy];
  const layout = await harness(sources);
  const scenes = [compactScene];
  for (const source of [normal, roomy])
    scenes.push(value(await layout.arrange(request(layout, source))));
  expect(scenes[0]?.bounds.height).toBeLessThan(scenes[1]?.bounds.height ?? 0);
  expect(scenes[1]?.bounds.height).toBeLessThan(scenes[2]?.bounds.height ?? 0);
  sources.forEach((source, index): void => {
    const scene = scenes[index];
    assert(scene);
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
    assertSequenceMeasurements(source, scene);
    expect(scene.sections[0]?.sequence.events.map((event): string => event.id)).toEqual(
      compactScene.sections[0]?.sequence.events.map((event): string => event.id),
    );
    expect(
      scene.sections[0]?.sequence.activations.map((item): readonly unknown[] => [
        item.participant,
        item.fromEvent,
        item.toEvent,
      ]),
    ).toEqual(
      compactScene.sections[0]?.sequence.activations.map((item): readonly unknown[] => [
        item.participant,
        item.fromEvent,
        item.toEvent,
      ]),
    );
  });
}

/** Independent box assertions catch clipping even when inspection regenerates the same sequence policy. */
function assertSequenceMeasurements(
  source: Projection,
  scene: Scene,
): void {
  const view = scene.sections[0];
  const section = source.sections[0];
  assert(view && section);
  const sequence = view.sequence;
  const participants = view.nodes.filter((item): boolean => item.measured.kind === 'participant');
  expect(sequence.lifelines.map((item): string => item.participant)).toEqual(
    participants.map((item): string => item.id),
  );
  expect(participants.map((item): string => item.id)).toEqual(
    section.nodes
      .filter((item): boolean => item.kind === 'participant')
      .map((item): string => item.id),
  );
  const gap = (settings.sequenceGap * settings.gap[section.layout.gap]) / settings.gap.normal;
  const first = sequence.events[0];
  assert(first);
  expect(
    first.labelBox.y -
      Math.max(...participants.map((item): number => item.box.y + item.box.height)),
  ).toBeCloseTo(gap);
  sequence.events.forEach((event, index): void => {
    const measured = section.sequence.find((item): boolean => item.item.id === event.id);
    assert(measured);
    expect(event.content).toEqual(measured.label);
    expect(event.labelBox.width).toBe(measured.label.width);
    expect(event.labelBox.height).toBe(measured.label.height);
    expect(event.points[0]?.y).toBeCloseTo(
      event.labelBox.y + measured.label.height + settings.labelGap,
    );
    assertSequenceOrder(sequence.events[index - 1], event);
    assertSequencePitch(section, sequence.events[index - 1], event, gap);
  });
  sequence.fragments.forEach((frame): void => {
    expect(contained(frame.box, frame.labelBox)).toBe(true);
    expect(frame.labelBox.height).toBe(frame.content.height);
    frame.branches.forEach((branch): void => {
      expect(contained(frame.box, branch.box)).toBe(true);
      expect(contained(branch.box, branch.labelBox)).toBe(true);
      expect(branch.labelBox.height).toBe(branch.content.height);
    });
  });
}

/** Adjacent events retain complete paths below their labels and above the next measured band. */
function assertSequenceOrder(
  previous: Scene['sections'][number]['sequence']['events'][number] | undefined,
  event: Scene['sections'][number]['sequence']['events'][number],
): void {
  if (previous === undefined) return;
  expect(event.labelBox.y).toBeGreaterThan(
    Math.max(...previous.points.map((point): number => point.y)),
  );
}
/** Same-body event identity lookups stay inside the independent source projection. */
function sequenceBand(
  source: Projection['sections'][number],
  id: string,
): string {
  const found = source.sequence.find((entry) => entry.item.id === id);
  return `${found?.item.parent ?? ''}/${found?.item.branch ?? ''}`;
}
/** Consecutive same-body events pitch to exactly one label gap plus one scaled sequence gap. */
function assertSequencePitch(
  source: Projection['sections'][number],
  previous: Scene['sections'][number]['sequence']['events'][number] | undefined,
  event: Scene['sections'][number]['sequence']['events'][number],
  gap: number,
): void {
  if (previous === undefined) return;
  if (sequenceBand(source, previous.id) !== sequenceBand(source, event.id)) return;
  expect(event.labelBox.y - Math.max(...previous.points.map((point) => point.y))).toBeCloseTo(gap);
}

/** An unclosed call followed by later messages trims its bar half a gap past the participant's last event. */
function unclosedTrim(): Projection {
  return project(
    collection({
      objects: [object('agent', 'participant'), object('service', 'participant')],
      sections: [
        section('sequence', ['agent', 'service'], {
          mode: 'sequence',
          layout: { algorithm: 'sequence' },
          sequence: [
            {
              id: 'open',
              kind: 'event',
              source: 'agent',
              target: 'service',
              label: 'Open',
              message: 'call',
              activate: true,
              order: 0,
            },
            {
              id: 'note',
              kind: 'event',
              source: 'service',
              target: 'agent',
              label: 'Note',
              message: 'return',
              order: 1,
            },
            {
              id: 'done',
              kind: 'event',
              source: 'agent',
              target: 'service',
              label: 'Done',
              message: 'call',
              order: 2,
            },
          ],
        }),
      ],
    }),
  );
}

/** A1 counterexample: activation starts in one alternative while an unrelated sibling deactivation follows visually. */
function isolatedAlternatives(): Projection {
  return project(
    collection({
      objects: [object('client', 'participant'), object('server', 'participant')],
      sections: [
        section('sequence', ['client', 'server'], {
          mode: 'sequence',
          layout: { algorithm: 'sequence' },
          sequence: [
            {
              id: 'choice',
              kind: 'fragment',
              operator: 'alt',
              label: 'Choice',
              order: 0,
              branches: [
                { id: 'yes', label: 'Yes' },
                { id: 'no', label: 'No' },
              ],
            },
            {
              id: 'branchCall',
              kind: 'event',
              source: 'client',
              target: 'server',
              label: 'Call',
              message: 'call',
              activate: true,
              parent: 'choice',
              branch: 'yes',
              order: 0,
            },
            {
              id: 'branchReturn',
              kind: 'event',
              source: 'server',
              target: 'client',
              label: 'Return',
              message: 'return',
              activate: false,
              parent: 'choice',
              branch: 'no',
              order: 0,
            },
          ],
        }),
      ],
    }),
  );
}

/** Public measured geometry supplies the oracle; failures are surfaced by Vitest and fixtures can be replayed. */
it('explicit horizontal tracks override automatic history in every direction and nested scope', async (): Promise<void> => {
  const directions: readonly LayoutIntent['direction'][] = ['right', 'left', 'down', 'up'];
  for (const direction of directions) await checkColumnsDirection(direction);
  await checkScopedColumns();
});
/** Unequal dimensions detect transposed physical tracks and wrong reverse-edge alignment. */
function columnsProjection(
  columns: number | undefined,
  direction: LayoutIntent['direction'],
  labelled = false,
): Projection {
  const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
  return project(
    collection({
      objects: ids.map((id, index): unknown =>
        object(id, 'note', {
          label: id.repeat(index + 1),
          content: [{ id: 'text', kind: 'text', text: 'Line\n'.repeat(index + 1) }],
        }),
      ),
      relationships: labelled
        ? [
            edge('ab', 'a', 'b', {
              kind: 'reference',
              label: 'Measured grid reservation with unequal axes',
            }),
          ]
        : [],
      sections: [
        section('cards', ids, {
          mode: 'grid',
          layout: {
            algorithm: 'grid',
            direction,
            gap: gridGap(labelled),
            ...optionalColumns(columns),
          },
          wires: labelled ? [{ relationship: 'ab' }] : [],
        }),
      ],
    }),
  );
}
/** Omission is represented as absence, allowing a direct regression comparison against legacy options. */
function optionalColumns(columns: number | undefined): Readonly<Record<string, number>> {
  if (columns === undefined) return {};
  return { columns };
}
/** Track anchors use leading edges forward and trailing edges in reverse; dimensions never masquerade as extra columns. */
function assertTracks(
  boxes: readonly {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  }[],
  columns: number,
  direction: LayoutIntent['direction'],
): void {
  const horizontal = boxes.map((box): number => (direction === 'left' ? box.x + box.width : box.x));
  const vertical = boxes.map((box): number => (direction === 'up' ? box.y + box.height : box.y));
  expect(new Set(horizontal.map((position): number => Math.round(position))).size).toBe(columns);
  expect(new Set(vertical.map((position): number => Math.round(position))).size).toBe(
    Math.ceil(boxes.length / columns),
  );
}
/** Every derivation uses explicit columns, including a second replay with unchanged intent and a previous scene. */
async function checkColumnsDirection(direction: LayoutIntent['direction']): Promise<void> {
  await checkLabelledGrid(direction);
  const before = columnsProjection(undefined, direction);
  const variants = [1, 2, 3, 12].map((columns): Projection =>
    columnsProjection(columns, direction),
  );
  const layout = await harness([before, ...variants]);
  const legacy = value(await layout.arrange(request(layout, before)));
  for (const source of variants) {
    const scene = value(await layout.arrange(request(layout, source, legacy)));
    const columns = Math.min(source.sections[0]?.layout.columns ?? 0, 6);
    assertTracks(
      scene.sections[0]?.nodes.map((node): typeof node.box => node.box) ?? [],
      columns,
      direction,
    );
    const replay = value(await layout.arrange(request(layout, source, scene)));
    expect(replay.sections).toEqual(scene.sections);
    const displaced = displacedHistory(scene);
    expect(
      value(
        layout.inspect({
          projection: source,
          measurements: metrics(source),
          options: settings,
          candidate: displaced,
        }),
      ),
    ).toEqual({ valid: true, diagnostics: [] });
    const corrected = value(await layout.arrange(request(layout, source, displaced)));
    expect(corrected.sections[0]?.nodes).toEqual(scene.sections[0]?.nodes);
    assertDirection(scene, columns, direction);
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
}
/** Collection and nested-group columns choose independent scopes while a human origin and node lock stay authoritative. */
async function checkScopedColumns(): Promise<void> {
  const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
  const make = (columns: number): Projection =>
    project(
      collection({
        arrangement: { algorithm: 'grid', columns },
        objects: ids.map((id): unknown => object(id)),
        sections: [
          section('nested', [], {
            mode: 'grid',
            layout: { algorithm: 'grid', columns: 1 },
            placement: { x: -1000, y: -1000, locked: true },
            groups: [
              { id: 'outer', title: 'Outer', layout: { algorithm: 'grid', columns: 1 } },
              {
                id: 'inner',
                title: 'Inner',
                parent: 'outer',
                layout: { algorithm: 'grid', columns },
              },
            ],
            appearances: ids.map((object): unknown => ({ object, group: 'inner' })),
          }),
          ...ids.slice(0, 5).map((id, index): unknown =>
            section(`s${id}`, [id], {
              order: index + 1,
              mode: 'grid',
              layout: { algorithm: 'grid' },
            }),
          ),
        ],
      }),
    );
  const before = make(3);
  const after = make(2);
  const layout = await harness([before, after]);
  const previous = value(await layout.arrange(request(layout, before)));
  const scene = value(await layout.arrange(request(layout, after, previous)));
  expect(scene.sections[0]?.origin).toEqual({ x: -1000, y: -1000 });
  assertTracks(
    scene.sections[0]?.nodes
      .filter((node): boolean => node.measured.objectId !== null)
      .map((node): typeof node.box => node.box) ?? [],
    2,
    'right',
  );
  const freeBefore = project(
    collection({
      objects: ids.map((id): unknown => object(id)),
      sections: ids.map((id, index): unknown => section(id, [id], { order: index })),
      arrangement: { algorithm: 'grid', columns: 3 },
    }),
  );
  const freeAfter = { ...freeBefore, arrangement: { ...freeBefore.arrangement, columns: 2 } };
  const freeLayout = await harness([freeBefore, freeAfter]);
  const freePrevious = value(await freeLayout.arrange(request(freeLayout, freeBefore)));
  const freeScene = value(await freeLayout.arrange(request(freeLayout, freeAfter, freePrevious)));
  assertTrackGaps(
    freeScene.sections.map((section) => section.box),
    'x',
    false,
    settings.gap.normal,
  );
  assertTrackGaps(
    freeScene.sections.map((section) => section.box),
    'y',
    false,
    settings.gap.normal,
  );
  assertTracks(
    freeScene.sections.map((section): typeof section.box => section.box),
    2,
    'right',
  );
}

/** Translate the complete node-only fixture, including title and bounds; public inspection proves admissibility before replay. */
function displacedHistory(scene: Scene): Scene {
  return {
    ...scene,
    bounds: shiftedBox(scene.bounds),
    sections: scene.sections.map((section): Scene['sections'][number] => ({
      ...section,
      box: shiftedBox(section.box),
      title: { ...section.title, box: shiftedBox(section.title.box) },
      nodes: section.nodes.map((node): typeof node => ({
        ...node,
        box: shiftedBox(node.box),
      })),
    })),
  };
}
/** Apply one explicit translation; dimensions and section origin retain their original meaning. */
function shiftedBox(box: Scene['bounds']): Scene['bounds'] {
  return { ...box, x: box.x + 1234, y: box.y + 987 };
}
/** Independent six-node/two-column spatial memberships specify all four reading directions. */
function assertDirection(
  scene: Scene,
  columns: number,
  direction: LayoutIntent['direction'],
): void {
  if (columns !== 2) return;
  const memberships = {
    right: { rows: ['ab', 'cd', 'ef'], columns: ['ace', 'bdf'] },
    left: { rows: ['ba', 'dc', 'fe'], columns: ['bdf', 'ace'] },
    down: { rows: ['ad', 'be', 'cf'], columns: ['abc', 'def'] },
    up: { rows: ['cf', 'be', 'ad'], columns: ['cba', 'fed'] },
  };
  const expected = memberships[direction];
  assertMembership(scene, expected.rows, 'y', direction === 'up');
  assertMembership(scene, expected.columns, 'x', direction === 'left');
}
/** Each named member shares its track edge, and successive tracks clear every preceding member. */
function assertMembership(
  scene: Scene,
  groups: readonly string[],
  axis: 'x' | 'y',
  trailing: boolean,
): void {
  const size = axis === 'x' ? 'width' : 'height';
  const tracks = groups.map((ids) => [...ids].map((id) => node(scene, id).box));
  tracks.forEach((track) => {
    const anchors = track.map((box) => box[axis] + (trailing ? box[size] : 0));
    anchors.forEach((anchor) => expect(anchor).toBeCloseTo(anchors[0] ?? NaN));
  });
  tracks.slice(1).forEach((track, index) => {
    const previousEnd = Math.max(...(tracks[index] ?? []).map((box) => box[axis] + box[size]));
    expect(Math.min(...track.map((box) => box[axis]))).toBeGreaterThan(previousEnd);
  });
}

/** Capture genuine native/grid seeds at the owned solver boundary, then deliberately stop before routing. */
async function captureSeeds(
  source: Projection,
  measurements = metrics(source),
): Promise<{
  readonly problems: readonly PlacementProblem[];
  readonly boxes: ReadonlyMap<string, Box>;
}> {
  const problems: PlacementProblem[] = [];
  const captured: SolverProblem[] = [];
  const native = await dependencies([source]);
  const stop = rejected<never>('Seed-only boundary capture; routing acceptance is a separate gate');
  const layout = createLayout({
    ...native,
    placement: {
      ...native.placement,
      async place(problem) {
        problems.push(problem);
        const placed = value(await native.placement.place(problem));
        return { ok: true, value: placed };
      },
    },
    solver: {
      ...native.solver,
      solve(problem) {
        captured.push(problem);
        return stop;
      },
    },
    routing: {
      ...native.routing,
      async route() {
        throw new Error('Seed-only test must not invoke routing');
      },
    },
  });
  const { job, ...seedInput } = request(layout, source);
  const input = { ...seedInput, measurements };
  expect(
    await layout.arrange({ ...input, job: { ...job, inputKey: value(layout.key(input)) } }),
  ).toEqual(stop);
  expect(captured).toHaveLength(1);
  const variables = captured[0]?.variables ?? [];
  const field = (id: string, name: string): number => {
    const found = variables.find((item) => item.id === `${id}.${name}`);
    assert(found);
    return found.initial;
  };
  const boxes = new Map(
    (source.sections[0]?.nodes ?? []).map((node) => [
      node.id,
      {
        x: field(node.id, 'x'),
        y: field(node.id, 'y'),
        width: field(node.id, 'width'),
        height: field(node.id, 'height'),
      },
    ]),
  );
  return { problems, boxes };
}
/** Cross-axis checkpoint plus adjacent obstacle clearance, independently of label length. */
function expectedCrossSpacing(
  source: Projection,
  wireIds: readonly string[] = source.sections.flatMap((section) =>
    section.wires.map((wire) => wire.id),
  ),
): number {
  const advances = source.sections.flatMap((section) =>
    section.wires
      .filter((wire) => wireIds.includes(wire.id))
      .flatMap((wire) => [
        metrics(source).markers[wire.sourceMarker].advance,
        metrics(source).markers[wire.targetMarker].advance,
      ]),
  );
  return Math.max(settings.gap.compact, settings.routeClearance * 3 + Math.max(...advances));
}
/** Every local wire reserves its measured flow extent, including references omitted from tree ranking. */
function expectedWireSpacing(
  source: Projection,
  direction: LayoutIntent['direction'],
): number {
  return Math.max(
    ...(source.sections[0]?.wires ?? []).map((wire) => {
      const label =
        direction === 'right' || direction === 'left' ? wire.label.width : wire.label.height;
      return (
        metrics(source).markers[wire.sourceMarker].advance +
        metrics(source).markers[wire.targetMarker].advance +
        settings.routeClearance * 4 +
        label +
        settings.labelGap * 2
      );
    }),
  );
}
/** Unequal measured boxes and labelled edges make swapping/equalizing either axis observable in all directions. */
async function checkLabelledGrid(direction: LayoutIntent['direction']): Promise<void> {
  const source = columnsProjection(2, direction, true);
  const { boxes } = await captureSeeds(source);
  assertTracks([...boxes.values()], 2, direction);
  const flow = expectedWireSpacing(source, direction);
  const cross = expectedCrossSpacing(source);
  expect(flow).toBeGreaterThan(cross);
  const horizontal = direction === 'right' || direction === 'left';
  assertTrackGaps([...boxes.values()], 'x', direction === 'left', horizontal ? flow : cross);
  assertTrackGaps([...boxes.values()], 'y', direction === 'up', horizontal ? cross : flow);
}
/** Adjacent track envelopes, including unequal trailing edges, expose the actual reserved boundary gap. */
function assertTrackGaps(
  boxes: readonly Box[],
  axis: 'x' | 'y',
  reverse: boolean,
  expected: number,
): void {
  const size = axis === 'x' ? 'width' : 'height';
  const tracks = new Map<number, Box[]>();
  boxes.forEach((box) => {
    const anchor = reverse ? box[axis] + box[size] : box[axis];
    tracks.set(anchor, [...(tracks.get(anchor) ?? []), box]);
  });
  const envelopes = [...tracks.values()]
    .map((members) => ({
      start: Math.min(...members.map((box) => box[axis])),
      end: Math.max(...members.map((box) => box[axis] + box[size])),
    }))
    .toSorted((a, b) => a.start - b.start);
  envelopes
    .slice(1)
    .forEach((track, index) =>
      expect(track.start - (envelopes[index]?.end ?? NaN)).toBeCloseTo(expected),
    );
}

/** ER's 23-unit marker is longer than the old 24−12 corridor; native and grid seeds must both accommodate it. */
it('reserves measured ER marker approaches independently of label length in native and grid scopes', async (): Promise<void> => {
  const directions: readonly LayoutIntent['direction'][] = ['right', 'left', 'down', 'up'];
  for (const direction of directions) await checkErCorridors(direction);
});
/** Two label sizes keep cross-axis clearance invariant while exercising the actual measured marker bound. */
async function checkErCorridors(direction: LayoutIntent['direction']): Promise<void> {
  await checkErSeed(direction, 'layered', 'relates');
  await checkErSeed(direction, 'layered', 'A considerably longer relationship label');
  await checkErSeed(direction, 'grid', 'relates');
  await checkErSeed(direction, 'grid', 'A considerably longer relationship label');
}
/** The diamond supplies real siblings; measured track envelopes supply the grid oracle. */
async function checkErSeed(
  direction: LayoutIntent['direction'],
  algorithm: 'grid' | 'layered',
  label: string,
): Promise<void> {
  const source = erCorridorProjection(direction, algorithm, label);
  const measured: SupplementalMeasurements = {
    ...metrics(source),
    markers: { ...metrics(source).markers, 'zero-many': { advance: 23, halfHeight: 7 } },
  };
  const { problems, boxes } = await captureSeeds(source, measured);
  const floor = settings.routeClearance * 3 + measured.markers['zero-many'].advance;
  expect(floor).toBe(59);
  if (algorithm === 'grid') return assertErGrid(boxes, direction, floor);
  expect(problems[0]?.spacing).toBe(floor);
  const siblings =
    source.sections[0]?.nodes.filter((node) => ['b', 'c'].includes(node.objectId ?? '')) ?? [];
  const first = boxes.get(siblings[0]?.id ?? '');
  const second = boxes.get(siblings[1]?.id ?? '');
  assert(first && second);
  expect(crossClearance(first, second, direction)).toBeGreaterThanOrEqual(floor - 0.000001);
}
/** Cross tracks must leave checkpoint 2c+a plus the adjacent node's c-wide clearance region. */
function assertErGrid(
  boxes: ReadonlyMap<string, Box>,
  direction: LayoutIntent['direction'],
  floor: number,
): void {
  const axis = direction === 'right' || direction === 'left' ? 'y' : 'x';
  assertTrackGaps([...boxes.values()], axis, false, floor);
}
/** Model-valid associations use measured entity boxes, semantic cardinalities and no authored coordinates. */
function erCorridorProjection(
  direction: LayoutIntent['direction'],
  algorithm: 'grid' | 'layered',
  label: string,
): Projection {
  const ids = ['a', 'b', 'c', 'd'];
  const relations = [
    ['ab', 'a', 'b'],
    ['ac', 'a', 'c'],
    ['bd', 'b', 'd'],
    ['cd', 'c', 'd'],
  ];
  return project(
    collection({
      objects: ids.map((id) =>
        object(id, 'entity', {
          content: [{ kind: 'field', id: 'id', label: 'id', type: 'Id', key: 'primary' }],
        }),
      ),
      relationships: relations.map(([id = '', source = '', target = '']) =>
        edge(id, source, target, { kind: 'association', from: '1', to: '0..many', label }),
      ),
      sections: [
        section('er-corridor', ids, {
          mode: 'er',
          layout: {
            algorithm,
            direction,
            gap: 'compact',
            ...(algorithm === 'grid' ? { columns: 2 } : {}),
          },
          wires: relations.map(([relationship]) => ({ relationship })),
        }),
      ],
    }),
  );
}

/** Preserve existing wire-free history fixtures' normal semantic spacing. */
function gridGap(labelled: boolean): 'compact' | 'normal' {
  return labelled ? 'compact' : 'normal';
}

/** Same original Model-valid tree; varying the annotation label tests reservation without changing parent topology. */
function treeProjection(annotation: string): Projection {
  return project(
    collection({
      objects: [object('root', 'concept'), object('child', 'concept'), object('note', 'note')],
      relationships: [
        edge('parent', 'root', 'child', { kind: 'parent' }),
        edge('annotation', 'root', 'note', {
          kind: 'reference',
          label: annotation,
        }),
      ],
      sections: [
        section('tree', [], {
          mode: 'tree',
          root: 'root',
          layout: { algorithm: 'tree', direction: 'down', gap: 'compact' },
          appearances: [
            { object: 'root' },
            { object: 'child' },
            { object: 'note', participation: 'annotation' },
          ],
          wires: [{ relationship: 'parent' }, { relationship: 'annotation' }],
        }),
      ],
    }),
  );
}
/** Route acceptance requires real native success and independent inspection, separately from the seed-only capture. */
async function checkTreeAcceptance(): Promise<void> {
  const source = treeProjection('annotation');
  const layout = await harness([source]);
  const scene = value(await layout.arrange(request(layout, source)));
  expect(scene.sections[0]?.wires.map((wire) => wire.id).toSorted()).toEqual(
    source.sections[0]?.wires.map((wire) => wire.id).toSorted(),
  );
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
