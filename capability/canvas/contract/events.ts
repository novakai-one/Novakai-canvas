import { z } from 'zod';
import { identity, gestureId } from './brands.js';
import { point, box, camera, viewport } from './records/camera.js';
import { target, selection } from './records/selection.js';
import { stamp } from './records/scene.js';
import { endpoint } from './records/intent.js';
const routedEndpoint = z
  .strictObject({
    node: identity,
    member: identity.nullable(),
    point,
    side: z.enum(['top', 'right', 'bottom', 'left']),
  })
  .readonly();
const side = z.enum(['preserve', 'auto', 'top', 'right', 'bottom', 'left']);
export const event = z
  .discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('pan'), delta: point }),
    z.strictObject({ kind: z.literal('viewport'), camera }),
    z.strictObject({
      kind: z.literal('zoom'),
      factor: z.number().finite().positive().max(100),
      pointer: point,
    }),
    z.strictObject({ kind: z.literal('fit'), target: target.nullable() }),
    z.strictObject({ kind: z.literal('locate'), target }),
    z.strictObject({ kind: z.literal('resize-viewport'), viewport }),
    z.strictObject({
      kind: z.literal('select'),
      targets: selection,
      mode: z.enum(['replace', 'toggle', 'add']),
    }),
    z.strictObject({ kind: z.literal('marquee'), box, additive: z.boolean() }),
    z.strictObject({ kind: z.literal('target-enter'), target }),
    z.strictObject({ kind: z.literal('target-leave'), target }),
    z.strictObject({ kind: z.literal('tool'), tool: z.enum(['select', 'hand', 'connect']) }),
    z.strictObject({ kind: z.literal('inspect'), target }),
    z.strictObject({
      kind: z.literal('begin'),
      id: gestureId,
      gesture: z.enum(['move', 'resize', 'route']),
      targets: selection,
    }),
    z.strictObject({ kind: z.literal('move'), id: gestureId, delta: point }),
    z.strictObject({ kind: z.literal('resize'), id: gestureId, box }),
    z.strictObject({
      kind: z.literal('route'),
      id: gestureId,
      points: z.array(point).min(2).max(10000).readonly(),
      sourceSide: side,
      targetSide: side,
      locked: z.union([z.boolean(), z.literal('preserve')]),
    }),
    z.strictObject({
      kind: z.literal('preview-routes'),
      id: gestureId,
      bounds: box,
      boxes: z.array(z.strictObject({ target, box }).readonly()).max(10000).readonly(),
      sections: z
        .array(z.strictObject({ id: identity, origin: point }).readonly())
        .max(1000)
        .readonly(),
      wires: z
        .array(
          z
            .strictObject({
              id: identity,
              section: identity,
              source: routedEndpoint,
              target: routedEndpoint,
              points: z.array(point).min(2).max(10000).readonly(),
              labelBox: z.union([
                box,
                point
                  .unwrap()
                  .extend({ width: z.literal(0), height: z.literal(0) })
                  .readonly(),
              ]),
            })
            .readonly(),
        )
        .max(10000)
        .readonly(),
    }),
    z.strictObject({ kind: z.literal('finish'), id: gestureId }),
    z.strictObject({ kind: z.literal('cancel'), id: gestureId }),
    z.strictObject({
      kind: z.literal('reject'),
      id: gestureId,
      message: z.string().min(1).max(2000),
    }),
    z.strictObject({ kind: z.literal('confirmed'), id: gestureId }),
    z.strictObject({ kind: z.literal('discard'), id: gestureId }),
    z.strictObject({ kind: z.literal('expect-scene'), stamp }),
    z.strictObject({ kind: z.literal('receive-scene'), stamp, scene: z.unknown() }),
    z.strictObject({ kind: z.literal('connected'), value: z.boolean() }),
    z.strictObject({ kind: z.literal('mutation-available'), value: z.boolean() }),
    z.strictObject({ kind: z.literal('connect'), id: gestureId, endpoint }),
    z.strictObject({ kind: z.literal('remove-appearances'), id: gestureId }),
    z.strictObject({ kind: z.literal('duplicate'), id: gestureId }),
    z.strictObject({
      kind: z.literal('align'),
      id: gestureId,
      axis: z.enum(['left', 'center', 'right', 'top', 'middle', 'bottom']),
    }),
    z.strictObject({
      kind: z.literal('nudge'),
      id: gestureId,
      direction: z.enum(['left', 'right', 'up', 'down']),
      coarse: z.boolean(),
    }),
    z.strictObject({
      kind: z.literal('keyboard'),
      id: gestureId,
      key: z.string(),
      alt: z.boolean(),
      shift: z.boolean(),
      typing: z.boolean(),
      modal: z.boolean(),
    }),
    z.strictObject({ kind: z.literal('escape') }),
    z.strictObject({
      kind: z.literal('reading'),
      action: z.enum(['enter', 'next', 'previous', 'exit']),
    }),
    z.strictObject({ kind: z.literal('collapse'), target }),
  ])
  .readonly();
export type CanvasEvent = z.infer<typeof event>;
export type EventOf<K extends CanvasEvent['kind']> = Extract<CanvasEvent, { kind: K }>;
