/** Public Layout boundary scenarios are replayable; Vitest owns assertion reporting and the developer fixes failures before rerunning. */
import { describe, it, expect, assert, expectTypeOf } from 'vitest';
import type {
  Projection,
  Dependencies,
  Job,
  LayoutInputKey,
  Layout,
  Result,
} from '../contract/index.js';
import { createLayout } from '../contract/index.js';
import { createRouting } from '../adapters/libavoid.js';
import { failingNative } from './native-fixture.js';
import {
  flow,
  harness,
  request,
  value,
  dependencies,
  settings,
  metrics,
  project,
  collection,
  object,
  edge,
  section,
} from './fixtures.js';

describe('Layout boundary/native acceptance', () => {
  it('10 — rejects cancelled/stale native completion and attempts every native cleanup after failure', async () => {
    const source = flow();
    const native = await dependencies([source]);
    const entered = gate();
    const finish = gate();
    let current = true;
    const jobs: Dependencies['jobs'] = {
      checkpoint: async () =>
        current
          ? { ok: true, value: undefined }
          : {
              ok: false,
              error: {
                code: 'cancelled',
                path: 'test-job',
                targets: [],
                message: 'Superseded',
                recovery: 'Retain scene',
              },
            },
    };
    const layout = createLayout({
      ...native,
      jobs,
      placement: {
        ...native.placement,
        async place(problem) {
          entered.release();
          await finish.promise;
          return native.placement.place(problem);
        },
      },
    });
    const pending = layout.arrange(request(layout, source));
    await entered.promise;
    current = false;
    finish.release();
    const cancelled = await pending;
    assert(!cancelled.ok);
    expect(cancelled.error.code).toBe('cancelled');
    await candidateBudget();
    const nativeFailure = failingNative();
    const router = value(await createRouting(async () => nativeFailure.module));
    const failed = await router.route({
      obstacles: [{ id: 'box', box: { x: 40, y: 0, width: 30, height: 30 } }],
      connections: [
        {
          id: 'wire',
          source: { x: 0, y: 10 },
          target: { x: 100, y: 10 },
          sourceSide: 'right',
          targetSide: 'left',
          checkpoints: [
            { x: 10, y: 10 },
            { x: 90, y: 10 },
          ],
        },
      ],
      clearance: 8,
    });
    expect(failed.ok).toBe(false);
    expect(nativeFailure.allocated.length).toBeGreaterThan(5);
    expect(nativeFailure.disposed).toEqual([...nativeFailure.allocated].reverse());
  });
  it('11 — rejects malformed input/native output and independently detects forged geometry', async () => {
    expectTypeOf<string>().not.toExtend<LayoutInputKey>();
    expectTypeOf<Job['inputKey']>().toEqualTypeOf<LayoutInputKey>();
    expectTypeOf<ReturnType<Layout['key']>>().toEqualTypeOf<Result<LayoutInputKey>>();
    const source = flow();
    const duplicate: Projection = {
      ...source,
      sections: source.sections.map((section) => ({
        ...section,
        nodes: [...section.nodes, ...section.nodes],
      })),
    };
    const overLimit = forgedSections(source, 33);
    const layout = await harness([source, duplicate, overLimit]);
    const input = request(layout, source);
    expect(
      layout.key({
        projection: duplicate,
        measurements: metrics(duplicate),
        options: settings,
        previous: null,
      }).ok,
    ).toBe(false);
    expect(
      layout.key({
        projection: overLimit,
        measurements: metrics(overLimit),
        options: settings,
        previous: null,
      }),
    ).toMatchObject({ ok: false, error: { code: 'limit' } });
    expect((await layout.arrange({ ...input, options: { ...settings, padding: NaN } })).ok).toBe(
      false,
    );
    expect(
      (await layout.arrange({ ...input, job: { id: 'old-job', inputKey: 'old-input' } })).ok,
    ).toBe(false);
    const dishonest = await harness([source], {
      placement: { version: 'dishonest', place: async () => ({ ok: true, value: [] }) },
    });
    const missing = await dishonest.arrange(request(dishonest, source));
    assert(!missing.ok);
    expect(missing.error.code).toBe('engine-failed');
    const scene = value(await layout.arrange(input));
    expect(scene.inputKey).toBe(input.job.inputKey);
    const sourceSection = scene.sections[0];
    assert(sourceSection);
    const wrongContent = {
      ...scene,
      sections: [
        {
          ...sourceSection,
          nodes: sourceSection.nodes.map((node) => ({
            ...node,
            measured: { ...node.measured, label: 'Forged' },
          })),
        },
      ],
    };
    expect(
      value(
        layout.inspect({
          projection: source,
          measurements: input.measurements,
          options: settings,
          candidate: wrongContent,
        }),
      ).valid,
    ).toBe(false);
    const omitted = { ...scene, sections: [{ ...sourceSection, wires: [] }] };
    expect(
      value(
        layout.inspect({
          projection: source,
          measurements: input.measurements,
          options: settings,
          candidate: omitted,
        }),
      ).valid,
    ).toBe(false);
    const moved = {
      ...scene,
      sections: [
        {
          ...sourceSection,
          nodes: sourceSection.nodes.map((node) => ({ ...node, box: { ...node.box, x: 0, y: 0 } })),
        },
      ],
    };
    expect(
      value(
        layout.inspect({
          projection: source,
          measurements: input.measurements,
          options: settings,
          candidate: moved,
        }),
      ).valid,
    ).toBe(false);
    const farLabel = {
      ...scene,
      sections: [
        {
          ...sourceSection,
          wires: sourceSection.wires.map((wire) => ({
            ...wire,
            labelBox: { ...wire.labelBox, x: -10000 },
          })),
        },
      ],
    };
    expect(
      value(
        layout.inspect({
          projection: source,
          measurements: input.measurements,
          options: settings,
          candidate: farLabel,
        }),
      ).valid,
    ).toBe(false);
  });
  it('12 — derives 1000 nodes and 1500 labelled wires in 32 sections with bounded work', async () => {
    const source = scaleProjection();
    const layout = await harness([source]);
    const input = {
      projection: source,
      measurements: metrics(source),
      options: { ...settings, gridColumns: 10 },
      previous: null,
    };
    const key = value(layout.key(input));
    const started = performance.now();
    const scene = value(await layout.arrange({ ...input, job: { id: 'scale', inputKey: key } }));
    expect(scene.sections).toHaveLength(32);
    expect(scene.sections.reduce((count, section) => count + section.nodes.length, 0)).toBe(1000);
    expect(scene.sections.reduce((count, section) => count + section.wires.length, 0)).toBe(1500);
    expect(
      scene.sections.every((section) =>
        section.wires.every((wire) => wire.labelBox.width > 0 && wire.labelBox.height > 0),
      ),
    ).toBe(true);
    expect(performance.now() - started).toBeLessThan(20000);
  }, 30000);
});
/** Explicit gates make stale completion deterministic without wall-clock sleeps or a fabricated passing result. */
function gate(): { readonly promise: Promise<void>; readonly release: () => void } {
  const callbacks: (() => void)[] = [];
  const promise = new Promise<void>((resolve) => callbacks.push(resolve));
  const release = callbacks[0];
  assert(release);
  return { promise, release };
}
/** Exact aggregate counts are spread across all 32 admitted sections. */
function scaleProjection(): Projection {
  const sections = Array.from({ length: 32 }, (_, index) =>
    scaleSection(index, index < 8 ? 32 : 31, index < 4 ? 46 : 47),
  );
  return project(
    collection({
      objects: sections.flatMap((item) => item.objects),
      relationships: sections.flatMap((item) => item.relationships),
      sections: sections.map((item) => item.section),
    }),
  );
}
/** Scale fixture geometry is entirely automatic; no hardcoded coordinates make the native work disappear. */
function scaleSection(
  index: number,
  nodeCount: number,
  wireCount: number,
): {
  readonly objects: readonly unknown[];
  readonly relationships: readonly unknown[];
  readonly section: unknown;
} {
  const prefix = `s${index}`;
  const ids = Array.from({ length: nodeCount }, (_, item) => `${prefix}-n${item}`);
  const wireIds = Array.from({ length: wireCount }, (_, item) => `${prefix}-w${item}`);
  const links = wireIds.map((wire, item) =>
    edge(wire, ids[item % nodeCount] ?? '', ids[(item + 1) % nodeCount] ?? '', {
      label: 'uses',
    }),
  );
  return {
    objects: ids.map((id) => object(id)),
    relationships: links,
    section: section(prefix, ids, {
      mode: 'grid',
      order: index,
      layout: { algorithm: 'grid' },
      wires: wireIds.map((relationship) => ({ relationship })),
    }),
  };
}
/** A dishonest reader can supply section-count overflow without a Presentation producer. */
function forgedSections(
  source: Projection,
  count: number,
): Projection {
  const sample = source.sections[0];
  assert(sample);
  return {
    ...source,
    sections: Array.from({ length: count }, (_, index) => ({
      ...sample,
      id: `forged-${index}`,
      nodes: [],
      wires: [],
      sequence: [],
      groups: [],
      root: null,
    })),
  };
}

/** Dishonest projection providers cannot bypass Layout's independently checked intent; callers retain the current scene. */
it('rejects invalid grid columns at each consumed scope and preserves authored placements', async (): Promise<void> => {
  const source = project(
    collection({
      objects: [object('a')],
      sections: [
        section('grid', ['a'], {
          mode: 'grid',
          layout: { algorithm: 'grid' },
          groups: [{ id: 'g', title: 'G', layout: { algorithm: 'grid' } }],
        }),
      ],
    }),
  );
  const invalid = [0, 13, 1.5, NaN, Infinity].flatMap((columns): readonly Projection[] =>
    invalidColumnScopes(source, columns),
  );
  const nonGrid: Projection = {
    ...source,
    arrangement: { ...source.arrangement, algorithm: 'flow', columns: 2 },
  };
  const layout = await harness([source, ...invalid, nonGrid]);
  [...invalid, nonGrid].forEach((projection): void => {
    const result = layout.key({
      projection,
      measurements: metrics(projection),
      options: settings,
      previous: null,
    });
    assert(!result.ok);
    expect(result.error.code).toBe('invalid-input');
    expect(result.error.recovery.length).toBeGreaterThan(0);
  });
  await checkColumnLocks();
});
/** Deliberately dishonest typed data exercises each consumer scope without calling Model validation first. */
function invalidColumnScopes(
  source: Projection,
  columns: number,
): readonly Projection[] {
  return [
    { ...source, arrangement: { ...source.arrangement, columns } },
    {
      ...source,
      sections: source.sections.map((section): Projection['sections'][number] => ({
        ...section,
        layout: { ...section.layout, columns },
      })),
    },
    {
      ...source,
      sections: source.sections.map((section): Projection['sections'][number] => ({
        ...section,
        groups: section.groups.map((group): typeof group => ({
          ...group,
          layout: { ...group.layout, columns },
        })),
      })),
    },
  ];
}
/** Both soft human preferences and hard locks outrank regenerated automatic grid seeds. */
async function checkColumnLocks(): Promise<void> {
  for (const locked of [false, true]) {
    const make = (columns: number): Projection =>
      project(
        collection({
          objects: [object('a'), object('b')],
          sections: [
            section('grid', [], {
              mode: 'grid',
              layout: { algorithm: 'grid', columns },
              appearances: [
                { object: 'a', placement: { x: -400, y: -250, locked } },
                { object: 'b' },
              ],
            }),
          ],
        }),
      );
    const before = make(1);
    const after = make(2);
    const layout = await harness([before, after]);
    const previous = value(await layout.arrange(request(layout, before)));
    const scene = value(await layout.arrange(request(layout, after, previous)));
    expect(scene.sections[0]?.nodes[0]?.box).toMatchObject({ x: -400, y: -250 });
  }
}

/** Real routing remains the success oracle; owned failures exercise budget and operational propagation through the public API. */
async function candidateBudget(): Promise<void> {
  const source = flow();
  const native = await dependencies([source]);
  const attempts: import('../contract/index.js').RoutingProblem[] = [];
  const routing: Dependencies['routing'] = {
    version: native.routing.version,
    async route(
      problem,
    ): Promise<
      import('../contract/index.js').Result<readonly import('../contract/index.js').RouteValue[]>
    > {
      attempts.push(problem);
      if (attempts.length === 1) return routeFailure('candidate-infeasible');
      return native.routing.route(problem);
    },
  };
  const layout = createLayout({ ...native, routing });
  const scene = value(await layout.arrange(request(layout, source)));
  expect(attempts).toHaveLength(9);
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
  await rankedCandidates(source, scene, attempts, native);
  const first = [...attempts];
  attempts.length = 0;
  // The same instance reuses its result; a fresh instance proves the search is deterministic.
  expect(value(await layout.arrange(request(layout, source)))).toEqual(scene);
  expect(attempts).toEqual([]);
  const fresh = createLayout({ ...native, routing });
  expect(value(await fresh.arrange(request(fresh, source)))).toEqual(scene);
  expect(attempts).toEqual(first);
  await terminalRouteFailure(source, 'candidate-infeasible', 10, 'constraint-conflict');
  await terminalRouteFailure(source, 'engine-failed', 1, 'engine-failed');
  await terminalRouteFailure(source, 'cancelled', 1, 'cancelled');
}
/** Each terminal vector records actual native calls; exhausted search returns a named wire and never a partial scene. */
async function terminalRouteFailure(
  source: Projection,
  code: import('../contract/index.js').ErrorCode,
  budget: number,
  expected: import('../contract/index.js').ErrorCode,
): Promise<void> {
  const calls: import('../contract/index.js').RoutingProblem[] = [];
  const layout = await harness([source], {
    routing: {
      version: 'controlled-failure',
      async route(
        problem,
      ): Promise<
        import('../contract/index.js').Result<readonly import('../contract/index.js').RouteValue[]>
      > {
        calls.push(problem);
        return routeFailure(code);
      },
    },
  });
  const result = await layout.arrange(request(layout, source));
  assert(!result.ok);
  expect(result.error.code).toBe(expected);
  expect(result.error.targets).toHaveLength(1);
  expect(calls).toHaveLength(budget);
  if (code !== 'candidate-infeasible') expect(result).toEqual(routeFailure(code));
  if (budget === 10) outsideGeometry(calls);
}
/** Failure discriminants, never message parsing, define which proposals the routing owner may skip. */
function routeFailure(
  code: import('../contract/index.js').ErrorCode,
): import('../contract/index.js').Result<never> {
  return {
    ok: false,
    error: {
      code,
      path: 'controlled',
      targets: ['wire'],
      message: 'Controlled routing outcome',
      recovery: 'Retain the scene',
    },
  };
}

/** Re-admit each native proposal in isolation, then rank its inspected geometry with an independent numeric oracle. */
async function rankedCandidates(
  source: Projection,
  selected: import('../contract/index.js').Scene,
  attempts: readonly import('../contract/index.js').RoutingProblem[],
  native: Dependencies,
): Promise<void> {
  const proposals = await Promise.all(
    attempts.slice(1).map(
      async (
        problem,
        index,
      ): Promise<{
        index: number;
        points: readonly import('../contract/index.js').Point[];
        rank: readonly [number, number, number];
      } | null> => {
        const outcome = await native.routing.route(problem);
        const layout = createLayout({
          ...native,
          routing: {
            version: native.routing.version,
            route: async (): Promise<typeof outcome> => outcome,
          },
        });
        const admitted = await layout.arrange(request(layout, source));
        if (!admitted.ok) return null;
        const wire = admitted.value.sections[0]?.wires[0];
        assert(wire);
        expect(
          value(
            layout.inspect({
              projection: source,
              measurements: metrics(source),
              options: settings,
              candidate: admitted.value,
            }),
          ).valid,
        ).toBe(true);
        return { index, points: wire.points, rank: routeRank(wire.points, index) };
      },
    ),
  );
  const admissible = proposals.filter((item): item is NonNullable<typeof item> => item !== null);
  expect(admissible.length).toBeGreaterThan(1);
  expect(new Set(admissible.map((item): number => item.rank[0])).size).toBeGreaterThan(1);
  const ordered = admissible.toSorted((a, b): number => numericRank(a.rank, b.rank));
  expect(selected.sections[0]?.wires[0]?.points).toEqual(ordered[0]?.points);
  const best = ordered[0];
  assert(best);
  await rankingTies(source, best.points, native);
}
/** Test-owned length and cross-product bend calculation does not import the router's comparison implementation. */
function routeRank(
  points: readonly import('../contract/index.js').Point[],
  index: number,
): readonly [number, number, number] {
  const vectors = points
    .slice(1)
    .map((point, i): readonly [number, number] => [
      point.x - (points[i]?.x ?? NaN),
      point.y - (points[i]?.y ?? NaN),
    ]);
  const length = vectors.reduce(
    (sum, vector): number => sum + Math.abs(vector[0]) + Math.abs(vector[1]),
    0,
  );
  const bends = vectors
    .slice(1)
    .filter(
      (vector, i): boolean =>
        vector[0] * (vectors[i]?.[1] ?? NaN) !== vector[1] * (vectors[i]?.[0] ?? NaN),
    ).length;
  return [length, bends, index];
}
/** Lexicographic ordering makes both bend and original-proposal index tie breakers observable. */
function numericRank(
  a: readonly number[],
  b: readonly number[],
): number {
  return (
    a
      .map((value, index): number => value - (b[index] ?? NaN))
      .find((difference): boolean => difference !== 0) ?? 0
  );
}
/** The tenth proposal must actually leave occupied bounds, retaining distinct source/target approach checkpoints. */
function outsideGeometry(calls: readonly import('../contract/index.js').RoutingProblem[]): void {
  const last = calls.at(-1);
  const first = calls[0];
  assert(last && first);
  const connection = last.connections[0];
  assert(connection);
  const boxes = last.obstacles.map((item): typeof item.box => item.box);
  const middle = connection.checkpoints.slice(1, -1);
  expect(middle).toHaveLength(2);
  expect(middle[0]?.x).toBeLessThan(Math.min(...boxes.map((box): number => box.x)));
  expect(middle[1]?.x).toBeGreaterThan(Math.max(...boxes.map((box): number => box.x + box.width)));
  expect(
    middle.every((point): boolean => point.y < Math.min(...boxes.map((box): number => box.y))),
  ).toBe(true);
  expect(connection.checkpoints).not.toEqual(first.connections[0]?.checkpoints);
  expect(connection.checkpoints[0]).toEqual(connection.sourceApproach);
  expect(connection.checkpoints.at(-1)).toEqual(connection.targetApproach);
}

/** Equal-length admissible proposals force fewer bends first, then stable proposal order; redundant collinear vertices are not bends. */
async function rankingTies(
  source: Projection,
  selected: readonly import('../contract/index.js').Point[],
  native: Dependencies,
): Promise<void> {
  const start = selected[0];
  const end = selected.at(-1);
  const a = selected[1];
  const b = selected.at(-2);
  assert(start && end && a && b);
  expect(start.y).toBe(end.y);
  // Keep the original 376-unit / eight-bend adversarial vector even when native routing improves.
  const distance = (376 - Math.abs(end.x - start.x)) / 2;
  const firstTurn = a.x + (b.x - a.x) / 3;
  const lastTurn = b.x - (b.x - a.x) / 3;
  const original = [
    start,
    a,
    { x: a.x, y: start.y - distance / 2 },
    { x: firstTurn, y: start.y - distance / 2 },
    { x: firstTurn, y: start.y - distance },
    { x: lastTurn, y: start.y - distance },
    { x: lastTurn, y: start.y - distance / 2 },
    { x: b.x, y: start.y - distance / 2 },
    b,
    end,
  ];
  const upper = [
    start,
    a,
    { x: a.x, y: start.y - distance },
    { x: (a.x + b.x) / 2, y: start.y - distance },
    { x: b.x, y: start.y - distance },
    b,
    end,
  ];
  const lower = [
    start,
    a,
    { x: a.x, y: start.y + distance },
    { x: b.x, y: start.y + distance },
    b,
    end,
  ];
  const candidates = [original, upper, lower];
  expect(candidates.map((points): number => routeRank(points, 0)[0])).toEqual([376, 376, 376]);
  expect(candidates.map((points): number => routeRank(points, 0)[1])).toEqual([8, 4, 4]);
  for (const points of candidates) await inspectRankingVector(source, points, native);
  let attempt = -2;
  const layout = createLayout({
    ...native,
    routing: {
      version: native.routing.version,
      route: async (
        problem,
      ): Promise<
        import('../contract/index.js').Result<readonly import('../contract/index.js').RouteValue[]>
      > => {
        attempt += 1;
        const points = candidates[attempt];
        if (points === undefined) return routeFailure('candidate-infeasible');
        return { ok: true, value: [{ id: problem.connections[0]?.id ?? '', points }] };
      },
    },
  });
  const scene = value(await layout.arrange(request(layout, source)));
  expect(scene.sections[0]?.wires[0]?.points).toEqual(upper);
  expect(attempt).toBe(7);
}
/** Each controlled tie vector must independently pass the public geometry inspector before it can establish ranking. */
async function inspectRankingVector(
  source: Projection,
  points: readonly import('../contract/index.js').Point[],
  native: Dependencies,
): Promise<void> {
  const layout = createLayout({
    ...native,
    routing: {
      version: native.routing.version,
      route: async (
        problem,
      ): Promise<
        import('../contract/index.js').Result<readonly import('../contract/index.js').RouteValue[]>
      > => ({ ok: true, value: [{ id: problem.connections[0]?.id ?? '', points }] }),
    },
  });
  const scene = value(await layout.arrange(request(layout, source)));
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
