import { layoutInputKey } from '../../layout/contract/index.js';
import { descendantId, objectId } from '@novakai/canvas-model';
import { assert } from 'vitest';
import { visualNode, content } from '@novakai/canvas-presentation';
import type { MeasuredContent } from '@novakai/canvas-presentation';
import { createCanvas } from '../contract/index.js';
import type {
  Scene,
  SceneAdmission,
  Result,
  Canvas,
  SessionState,
  Target,
  CanvasEvent,
  GestureId,
  Transition,
} from '../contract/index.js';
/** A gesture event with its identity as plain text; the transition parses it into a `GestureId`. */
type TextIdentity<E> = E extends { readonly id: GestureId }
  ? Omit<E, 'id'> & { readonly id: string }
  : E;
/** A Canvas event as a test writes it. */
export type FixtureEvent = TextIdentity<CanvasEvent>;
/** Public outcome extraction fails at the calling oracle instead of manufacturing an accepted value. */
export function value<T>(
  result: { readonly ok: true; readonly value: T } | { readonly ok: false },
): T {
  assert(result.ok, JSON.stringify(result));
  return result.value;
}
/** Literal geometry is the independent interaction oracle; typography is admitted through Presentation schema. */
export function measured(label: string): MeasuredContent {
  return content.parse({
    width: 80,
    height: 20,
    primitives: [
      {
        kind: 'text',
        text: label,
        x: 0,
        y: 14,
        width: 80,
        font: {
          family: 'Inter',
          digest: '8909904ab6c872eb994093482a88a28eca2cd95912d7b6fecd72103b0dc07edc',
        },
        size: 14,
        fill: '#222222',
      },
    ],
    anchors: [],
    outline: [label],
  });
}
/** Nodes carry explicit measured content and typed row anchors; no production layout helper supplies expected positions. */
function node(
  id: string,
  x: number,
  y: number,
  parent: string | null = null,
  group = false,
): Scene['sections'][number]['nodes'][number] {
  const shape = nodeShape(id, group);
  const box = { x, y, ...shape.dimensions };
  const data = visualNode.parse({
    id,
    objectId: shape.objectId,
    groupId: shape.groupId,
    sectionId: 'flow',
    kind: shape.kind,
    label: id,
    role: 'neutral',
    size: 'medium',
    shape: shape.kind,
    paint: { fill: '#ffffff', stroke: '#222222', text: '#222222' },
    content: {
      ...measured(id),
      outline: [id, 'id: UUID primary key', 'Image: process icon'],
      anchors: [
        { member: 'id', x: 0, y: 30, direction: 'inout', collapsed: false, label: 'id: UUID' },
      ],
    },
    navigation: [],
    width: box.width,
    height: box.height,
    headerHeight: 24,
    frame: 'auto',
    radius: 4,
    strokeWidth: 1,
    placement: null,
    parent,
  });
  return { id, parent, sectionId: 'flow', box, measured: data };
}
/** Section box is collection-global, node/wire boxes are section-local; origin is deliberately not zero. */
export function scene(revision = 0): Scene {
  const nodes = [
    node('group', 0, 0, null, true),
    node('alpha', 20, 40, 'group'),
    node('beta', 380, 40),
  ];
  return {
    collectionId: 'demo',
    revision,
    inputKey: layoutInputKey.parse(`scene-${revision}`),
    engineVersions: ['fixture'],
    bounds: { x: 80, y: 160, width: 560, height: 280 },
    warnings: [],
    adjustments: [],
    sections: [
      {
        id: 'flow',
        origin: { x: 100, y: 200 },
        box: { x: 80, y: 160, width: 560, height: 280 },
        title: {
          content: measured('Engineering'),
          box: { x: -20, y: -40, width: 180, height: 24 },
        },
        inputKey: layoutInputKey.parse('flow'),
        nodes,
        wires: [
          {
            id: 'owns',
            source: { node: 'alpha', member: 'id', point: { x: 140, y: 70 }, side: 'right' },
            target: { node: 'beta', member: 'id', point: { x: 380, y: 70 }, side: 'left' },
            points: [
              { x: 140, y: 70 },
              { x: 380, y: 70 },
            ],
            path: 'M 140 70 L 380 70',
            labelBox: { x: 240, y: 80, width: 80, height: 20 },
            measuredLabel: measured('owns'),
            appearance: {
              paint: { fill: '#ffffff', stroke: '#222222', text: '#222222' },
              width: 2,
              dash: [8, 4],
            },
            sourceMarker: 'one',
            targetMarker: 'zero-many',
            style: 'solid',
          },
        ],
        sequence: { lifelines: [], events: [], fragments: [], activations: [], source: [] },
      },
    ],
  };
}
/** Test-only admission recognizes exact independently authored scene fixtures; production host must bind real owners. */
export function admission(scenes: readonly Scene[]): SceneAdmission {
  return {
    read(input): Result<Scene> {
      const found = scenes.find((scene) => JSON.stringify(scene) === JSON.stringify(input));
      if (found) return { ok: true, value: found };
      return {
        ok: false,
        error: {
          code: 'invalid-scene',
          path: 'fixture',
          targets: [],
          message: 'Unknown fixture scene',
          recovery: 'Correct the test fixture',
        },
      };
    },
  };
}
export const alpha: Target = { kind: 'node', section: 'flow', id: 'alpha' };
export const beta: Target = { kind: 'node', section: 'flow', id: 'beta' };
export const group: Target = { kind: 'node', section: 'flow', id: 'group' };
export const section: Target = { kind: 'section', id: 'flow' };
export const wire: Target = { kind: 'wire', section: 'flow', id: 'owns' };
/** Each harness starts from actual public open, with an explicit restored camera for exact arithmetic checks. */
export function harness(
  scenes: readonly Scene[] = [scene()],
  readOnly = false,
): { canvas: Canvas; state: SessionState } {
  const first = scenes[0];
  assert(first);
  const canvas = createCanvas({ sceneAdmission: admission(scenes) });
  const state = value(
    canvas.open({
      scene: first,
      expected: {
        collectionId: first.collectionId,
        revision: first.revision,
        inputKey: first.inputKey,
        generation: 0,
      },
      viewport: { width: 800, height: 600 },
      camera: { x: 0, y: 0, zoom: 1, viewport: { width: 800, height: 600 } },
      readOnly,
    }),
  );
  return { canvas, state };
}
/** Public transitions are replayed in order; only their explicit effects represent output operations. */
export function step(
  canvas: Canvas,
  state: SessionState,
  event: FixtureEvent,
): Transition {
  return value(canvas.transition(state, event));
}
/** Begin one selected movement with a caller-controlled identity. */
export function begin(
  canvas: Canvas,
  state: SessionState,
  targets: readonly Target[] = [alpha],
  id = 'drag',
): SessionState {
  return step(canvas, state, { kind: 'begin', id, gesture: 'move', targets }).state;
}

/** Literal fixture kind profiles keep container dimensions and semantic identity consistent. */
function nodeShape(
  id: string,
  group: boolean,
): {
  readonly objectId: string | null;
  readonly groupId: string | null;
  readonly kind: 'container' | 'entity';
  readonly dimensions: { readonly width: number; readonly height: number };
} {
  if (group)
    return {
      objectId: null,
      groupId: id,
      kind: 'container',
      dimensions: { width: 300, height: 200 },
    };
  return { objectId: id, groupId: null, kind: 'entity', dimensions: { width: 120, height: 60 } };
}

/** A complete alternative sequence fixture supplies independent participant/fragment/message geometry. */
export function sequenceScene(): Scene {
  const base = scene();
  const client = node('client', 0, 0);
  const server = node('server', 300, 0);
  const participants = [client, server].map((node) => ({
    ...node,
    sectionId: 'sequence',
    measured: {
      ...node.measured,
      sectionId: 'sequence',
      kind: 'participant',
      shape: 'participant' as const,
    },
  }));
  const fragment = {
    id: descendantId.parse('choice'),
    kind: 'fragment' as const,
    order: 0,
    operator: 'alt' as const,
    label: 'Authorize',
    branches: [
      { id: descendantId.parse('allowed'), label: 'Allowed' },
      { id: descendantId.parse('denied'), label: 'Denied' },
    ],
  };
  const item = {
    id: descendantId.parse('request'),
    kind: 'event' as const,
    order: 0,
    parent: fragment.id,
    branch: descendantId.parse('allowed'),
    source: objectId.parse('client'),
    target: objectId.parse('server'),
    label: 'Send request',
    message: 'call' as const,
  };
  const content = measured('Send request');
  const sequence = {
    lifelines: [
      { participant: 'client', from: { x: 60, y: 60 }, to: { x: 60, y: 300 } },
      { participant: 'server', from: { x: 360, y: 60 }, to: { x: 360, y: 300 } },
    ],
    events: [
      {
        id: 'request',
        source: 'client',
        target: 'server',
        points: [
          { x: 60, y: 140 },
          { x: 360, y: 140 },
        ],
        labelBox: { x: 150, y: 115, width: 80, height: 20 },
        content,
        marker: 'arrow' as const,
        message: 'call' as const,
      },
    ],
    fragments: [
      {
        id: 'choice',
        parent: null,
        box: { x: 0, y: 80, width: 420, height: 220 },
        labelBox: { x: 8, y: 85, width: 80, height: 20 },
        content: measured('Authorize'),
        branches: [
          {
            id: 'allowed',
            box: { x: 0, y: 110, width: 420, height: 90 },
            labelBox: { x: 8, y: 110, width: 80, height: 20 },
            content: measured('Allowed'),
          },
          {
            id: 'denied',
            box: { x: 0, y: 200, width: 420, height: 100 },
            labelBox: { x: 8, y: 210, width: 80, height: 20 },
            content: measured('Denied'),
          },
        ],
      },
    ],
    activations: [
      {
        participant: 'server',
        fromEvent: 'request',
        toEvent: null,
        box: { x: 354, y: 140, width: 12, height: 140 },
      },
    ],
    source: [
      { item: fragment, label: measured('Authorize'), marker: 'none' as const },
      { item, label: content, marker: 'arrow' as const },
    ],
  };
  return {
    ...base,
    bounds: { x: 80, y: 160, width: 1060, height: 400 },
    sections: [
      ...base.sections,
      {
        id: 'sequence',
        origin: { x: 700, y: 200 },
        box: { x: 680, y: 160, width: 460, height: 400 },
        title: {
          box: { x: -20, y: -40, width: 180, height: 24 },
          content: measured('Concurrent authoring'),
        },
        inputKey: layoutInputKey.parse('sequence'),
        nodes: participants,
        wires: [],
        sequence,
      },
    ],
  };
}
