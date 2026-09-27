import { z } from 'zod';
/** Transport validates only host-owned fields; capability payloads are checked by the corresponding public owners. */
export const renderingEnvelope = z
  .strictObject({
    id: z.string().min(1).max(256),
    collection: z.unknown(),
    fonts: z.unknown(),
    style: z.unknown(),
    assets: z.array(z.unknown()).max(2000),
    options: z.unknown(),
    previous: z.unknown(),
    wasmResource: z.string().min(1).max(4096),
  })
  .readonly();
/** Responses remain unknown until checked against the request's admitted collection and measurement sources. */
export const renderEnvelope = z
  .strictObject({
    collection: z.unknown(),
    projection: z.unknown(),
    measurements: z.unknown(),
    options: z.unknown(),
    scene: z.unknown(),
    fonts: z.unknown(),
    style: z.unknown(),
  })
  .readonly();
