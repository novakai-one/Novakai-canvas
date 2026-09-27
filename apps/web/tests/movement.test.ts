import { assert, expect, it } from 'vitest';
import { buildMoveReview } from '../contract/index.js';
import { previewModuleRoutes } from '../adapters/readers/route-preview.js';
import { workspaceFixture, request as makeRequest } from './host-workspace-fixture.js';
import type { RenderDocument, SceneStamp } from '../contract/records/owners.js';
import type { GeometryPreview } from '@novakai/canvas-canvas';

const source = `canvas 1
collection @movement "Movement" theme=paper {
 node @leaf module "Leaf" {}
 node @sibling module "Sibling" {}
 node @child module "Child" {}
 section @affected "Affected" mode=modules layout=grid columns=2 direction=right gap=roomy {
  group @group "Group" layout=grid columns=1 { show @child }
  show @leaf @sibling
 }
 section @companion "Companion" mode=modules layout=grid { show @sibling }
}`;

async function renderedFixture() {
  const fixture = await workspaceFixture();
  const initial = await fixture.session.read();
  assert(initial.ok);
  const created = await fixture.session.apply(
    makeRequest(
      initial.value,
      'movement-create',
      'movement',
      'dsl',
      { source, mode: 'create' },
      true,
    ),
    new AbortController().signal,
  );
  assert(created.ok, JSON.stringify(created));
  const rendered = await fixture.session.render('movement', new AbortController().signal);
  assert(rendered.ok, JSON.stringify(rendered));
  return { fixture, document: rendered.value };
}

function stamp(document: RenderDocument): SceneStamp {
  return {
    collectionId: 'movement',
    revision: document.collection.revision,
    inputKey: document.scene.inputKey,
    generation: 1,
  };
}

function intent(
  document: RenderDocument,
  targetId: string,
  id = 'movement',
) {
  const section = document.scene.sections.find((item) => item.id === 'affected');
  assert(section);
  const node = section.nodes.find(
    (item) =>
      item.id === targetId ||
      item.measured.objectId === targetId ||
      item.measured.groupId === targetId,
  );
  assert(node);
  return {
    kind: 'placement' as const,
    id,
    scope: 'appearance' as const,
    base: stamp(document),
    entries: [
      {
        target: { kind: 'node' as const, section: section.id, id: node.id },
        placement: { x: node.box.x + 10, y: node.box.y, locked: false },
      },
    ],
  };
}

// eslint-disable-next-line sonarjs/cognitive-complexity
function previewFor(
  document: RenderDocument,
  placement: Extract<Parameters<typeof previewModuleRoutes>[1], { kind: 'placement' }>,
): GeometryPreview {
  const entry = placement.entries[0];
  assert(entry);
  const section = document.scene.sections.find(
    (item) => item.id === ('section' in entry.target ? entry.target.section : ''),
  );
  const selected = section?.nodes.find((item) => item.id === entry.target.id);
  assert(section && selected);
  const dx = entry.placement.x - selected.box.x;
  const dy = entry.placement.y - selected.box.y;
  const closure = new Set<string>();
  for (const node of section.nodes) {
    let parent: string | null = node.id;
    while (parent !== null) {
      if (parent === selected.id) {
        closure.add(node.id);
        break;
      }
      parent = section.nodes.find((item) => item.id === parent)?.parent ?? null;
    }
  }
  return {
    bounds: document.scene.bounds,
    sections: document.scene.sections.map((item) => ({ id: item.id, origin: item.origin })),
    boxes: document.scene.sections.flatMap((item) => [
      { target: { kind: 'section' as const, id: item.id }, box: item.box },
      ...item.nodes.map((node) => ({
        target: { kind: 'node' as const, section: item.id, id: node.id },
        box:
          closure.has(node.id) && item.id === section.id
            ? {
                ...node.box,
                x: node.box.x + item.origin.x + dx,
                y: node.box.y + item.origin.y + dy,
              }
            : { ...node.box, x: node.box.x + item.origin.x, y: node.box.y + item.origin.y },
      })),
    ]),
    wires: [],
  };
}

function previewWith(
  document: RenderDocument,
  mutate: (preview: GeometryPreview) => GeometryPreview,
) {
  return (
    _current: RenderDocument,
    placement: Extract<Parameters<typeof previewModuleRoutes>[1], { kind: 'placement' }>,
  ) => ({
    ok: true as const,
    value: mutate(previewFor(document, placement)),
  });
}

it('rejects companion node and section drift while retaining selected group closure', async () => {
  const { fixture, document } = await renderedFixture();
  try {
    const move = intent(document, 'leaf');
    const context = {
      document,
      stamp: stamp(document),
      preview: previewWith(document, (preview) => preview),
    };
    const accepted = buildMoveReview(move, context);
    assert(accepted.ok, JSON.stringify(accepted));
    expect(accepted.value.options).toHaveLength(1);
    const selected = document.scene.sections.find((item) => item.id === 'affected');
    assert(selected);
    const group = selected.nodes.find((item) => item.measured.groupId === 'group');
    assert(group);
    const groupMove = {
      ...move,
      id: 'group-movement',
      entries: [
        {
          ...move.entries[0],
          target: { kind: 'node' as const, section: 'affected', id: group.id },
          placement: { x: group.box.x + 80, y: group.box.y, locked: false },
        },
      ],
    };
    const groupReview = buildMoveReview(groupMove, context);
    assert(groupReview.ok, JSON.stringify(groupReview));
    const closure = groupReview.value.options[0]?.geometryChanges.map((change) => change.target);
    expect(closure?.some((target) => target.kind === 'node' && target.id === group.id)).toBe(true);
    const child = selected.nodes.find((item) => item.measured.objectId === 'child');
    assert(child);
    expect(closure?.some((target) => target.kind === 'node' && target.id === child.id)).toBe(true);

    const companionNode = document.scene.sections.find((item) => item.id === 'companion')?.nodes[0];
    assert(companionNode);
    const nodeDrift = buildMoveReview(move, {
      ...context,
      preview: previewWith(document, (preview) => ({
        ...preview,
        boxes: preview.boxes.map((item) =>
          item.target.kind === 'node' && item.target.id === companionNode.id
            ? { ...item, box: { ...item.box, x: item.box.x + 1 } }
            : item,
        ),
      })),
    });
    expect(nodeDrift).toMatchObject({ ok: false, error: { code: 'invalid-edit' } });

    const companionSection = document.scene.sections.find((item) => item.id === 'companion');
    assert(companionSection);
    const sectionDrift = buildMoveReview(move, {
      ...context,
      preview: previewWith(document, (preview) => ({
        ...preview,
        boxes: preview.boxes.map((item) =>
          item.target.kind === 'section' && item.target.id === companionSection.id
            ? { ...item, box: { ...item.box, y: item.box.y + 1 } }
            : item,
        ),
      })),
    });
    expect(sectionDrift).toMatchObject({ ok: false, error: { code: 'invalid-edit' } });
  } finally {
    await fixture.close();
  }
});

it('rejects missing and extra preview targets before producing a movement option', async () => {
  const { fixture, document } = await renderedFixture();
  try {
    const move = intent(document, 'leaf');
    const context = {
      document,
      stamp: stamp(document),
      preview: previewWith(document, (preview) => preview),
    };
    const missing = buildMoveReview(move, {
      ...context,
      preview: previewWith(document, (preview) => ({ ...preview, boxes: preview.boxes.slice(1) })),
    });
    expect(missing).toMatchObject({ ok: false, error: { code: 'invalid-edit' } });
    const extra = buildMoveReview(move, {
      ...context,
      preview: previewWith(document, (preview) => ({
        ...preview,
        boxes: [
          ...preview.boxes,
          {
            target: { kind: 'node' as const, section: 'affected', id: 'unknown' },
            box: { x: 0, y: 0, width: 1, height: 1 },
          },
        ],
      })),
    });
    expect(extra).toMatchObject({ ok: false, error: { code: 'invalid-edit' } });
  } finally {
    await fixture.close();
  }
});

import { createSubmissionSession } from '../adapters/sessions/submission-session.js';
import { failure } from '../contract/index.js';
import { memoryRetention, snapshot, submissionReaders } from './recovery-fixtures.js';
import type { TransportResponse } from '../contract/records/owners.js';

it('retains a movement draft when journaling fails before transmission', async () => {
  const initial = snapshot(0);
  const submittedRequest = makeRequest(initial, 'movement-journal-failure', 'demo', 'model', {
    collection: 'demo',
    changes: [],
  });
  let sends = 0;
  let changed = 0;
  const session = createSubmissionSession({
    client: {
      get: async () => ({
        ok: true as const,
        value: {
          version: 1,
          generation: 'generation-one',
          outcome: { ok: true as const, value: null },
        },
      }),
      post: async () => {
        sends += 1;
        return failure<TransportResponse>('connection-uncertain', 'should not send');
      },
    },
    retention: {
      ...memoryRetention(),
      write: () => failure('storage-unavailable', 'journal unavailable'),
    },
    readers: submissionReaders(),
    changed: () => {
      changed += 1;
    },
    confirmed: () => undefined,
    report: () => undefined,
  });
  session.restore('test-workspace');
  const result = await session.submit({
    request: submittedRequest,
    generation: 'generation-one',
    sourceEdit: 0,
    gesture: null,
  });
  expect(result).toMatchObject({ ok: false, error: { code: 'storage-unavailable' } });
  expect(sends).toBe(0);
  expect(changed).toBe(0);
  expect(session.dismiss(submittedRequest.request)).toMatchObject({ ok: false });
});
