import { z } from 'zod';
/** Service-owned workspace metadata has no diagram content or personal UI preference fields. */
export const workspaceMetadata = z
  .strictObject({
    schemaVersion: z.literal(1),
    id: z.string().min(1).max(128),
    title: z.string().min(1).max(256),
    createdAt: z.number().int().nonnegative(),
    presetRevision: z.number().int().nonnegative().default(0),
  })
  .readonly();
/** Asset discovery metadata references admitted bytes; Model creates collection-local bindings independently. */
export const assetMetadata = z
  .strictObject({
    schemaVersion: z.literal(1),
    digest: z.string().regex(/^[a-f0-9]{64}$/),
    alt: z.string().min(1).max(4096),
    source: z.string().min(1).max(2048),
    license: z.string().max(4096).optional(),
    attribution: z.string().max(4096).optional(),
  })
  .readonly();
