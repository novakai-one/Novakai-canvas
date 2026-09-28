import { assert, expect, it } from 'vitest';
import type { Scene, Point, Projection } from '../contract/index.js';
import {
  project,
  collection,
  object,
  section,
  edge,
  harness,
  request,
  value,
  metrics,
  settings,
} from './fixtures.js';

/** Two independently placed rows let inspection failures isolate foreign labels and hidden shared travel. */
function parallelRows(): Projection {
  return project(
    collection({
      objects: ['a', 'b', 'c', 'd'].map((id) => object(id)),
      relationships: [edge('first', 'a', 'b', { step: 1 }), edge('second', 'c', 'd', { step: 2 })],
      sections: [
        section('rows', [], {
          appearances: [
            { object: 'a', placement: { x: 0, y: 100, height: 100, locked: true } },
            { object: 'b', placement: { x: 600, y: 100, height: 100, locked: true } },
            { object: 'c', placement: { x: 0, y: 600, height: 100, locked: true } },
            { object: 'd', placement: { x: 600, y: 600, height: 100, locked: true } },
          ],
          wires: [
            { relationship: 'first', sourceSide: 'right', targetSide: 'left' },
            { relationship: 'second', sourceSide: 'right', targetSide: 'left' },
          ],
        }),
      ],
    }),
  );
}

/** Candidate transport preserves owner metadata while changing only one supplied route for adversarial inspection. */
function changedRoute(
  scene: Scene,
  points: readonly Point[],
): Scene {
  return {
    ...scene,
    sections: scene.sections.map((section) => ({
      ...section,
      wires: section.wires.map((wire, index) => changedWire(wire, index, points)),
    })),
  };
}

/** The second route receives a valid orthogonal path string, so rejection cannot rely on stale SVG syntax. */
function changedWire(
  wire: Scene['sections'][number]['wires'][number],
  index: number,
  points: readonly Point[],
): typeof wire {
  if (index !== 1) return wire;
  const path = points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`)
    .join(' ');
  return { ...wire, points, path };
}

/** In one scenario the detour strikes an annotation; in the other it obscures the first horizontal route. */
function adversarialRoute(
  scene: Scene,
  label: boolean,
): readonly Point[] {
  const first = scene.sections[0]?.wires[0];
  const second = scene.sections[0]?.wires[1];
  assert(first && second);
  const corner = label
    ? { x: first.labelBox.x + first.labelBox.width / 2, y: first.labelBox.y - 20 }
    : { x: first.source.point.x + 64, y: first.source.point.y };
  const { x: entry, y: height } = corner;
  const exit = first.target.point.x - 64;
  return [
    second.source.point,
    { x: entry, y: second.source.point.y },
    { x: entry, y: height },
    { x: exit, y: height },
    { x: exit, y: second.target.point.y },
    second.target.point,
  ];
}

/** One generic fork/join/return graph checks broad route admission with numbered labels. */
function forkJoin(): Projection {
  const relationships = [
    edge('start', 'request', 'split'),
    edge('left', 'split', 'legal'),
    edge('right', 'split', 'technical'),
    edge('legalDone', 'legal', 'join'),
    edge('techDone', 'technical', 'join'),
    edge('decide', 'join', 'decision'),
    edge('accepted', 'decision', 'finish'),
    edge('revise', 'decision', 'request', { label: 'needs revision', style: 'dashed' }),
  ];
  return project(
    collection({
      objects: [
        object('request'),
        object('split', 'fork'),
        object('legal'),
        object('technical'),
        object('join', 'join'),
        object('decision', 'decision'),
        object('finish', 'end'),
      ],
      relationships,
      sections: [
        section(
          'review',
          ['request', 'split', 'legal', 'technical', 'join', 'decision', 'finish'],
          {
            wires: [
              'start',
              'left',
              'right',
              'legalDone',
              'techDone',
              'decide',
              'accepted',
              'revise',
            ].map((relationship) => ({ relationship })),
          },
        ),
      ],
    }),
  );
}

/** Real native routing plus independent inspection must retain fixed nodes and reject actual information-obscuring geometry. */
it('routes branches and rejects foreign-annotation intersections and hidden shared runs', async () => {
  const rows = parallelRows();
  const branch = forkJoin();
  const layout = await harness([rows, branch]);
  const scene = value(await layout.arrange(request(layout, rows)));
  const inspected = value(
    layout.inspect({
      projection: rows,
      measurements: metrics(rows),
      options: settings,
      candidate: scene,
    }),
  );
  expect(inspected.valid).toBe(true);
  const input = request(layout, rows, scene);
  const repeated = value(
    await layout.route({
      projection: rows,
      measurements: input.measurements,
      options: settings,
      fixed: scene,
      job: input.job,
    }),
  );
  expect(repeated.sections.map((section) => section.nodes)).toEqual(
    scene.sections.map((section) => section.nodes),
  );
  expect(repeated.sections.map((section) => section.origin)).toEqual(
    scene.sections.map((section) => section.origin),
  );
  expect(repeated.sections.map((section) => section.wires)).toEqual(
    scene.sections.map((section) => section.wires),
  );
  [true, false].forEach((label) => {
    const candidate = changedRoute(scene, adversarialRoute(scene, label));
    const result = value(
      layout.inspect({
        projection: rows,
        measurements: metrics(rows),
        options: settings,
        candidate,
      }),
    );
    expect(result.valid).toBe(false);
    const message = label
      ? 'Another wire crosses this label'
      : 'Wires share an obscuring interior route';
    expect(result.diagnostics.map((issue) => issue.message)).toContain(message);
  });
  const routed = value(await layout.arrange(request(layout, branch)));
  expect(routed.sections[0]?.wires).toHaveLength(8);
  expect(
    value(
      layout.inspect({
        projection: branch,
        measurements: metrics(branch),
        options: settings,
        candidate: routed,
      }),
    ).valid,
  ).toBe(true);
});
