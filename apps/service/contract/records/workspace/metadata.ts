/*
 * The two records the service stores beside diagrams: the workspace metadata record and one asset
 * discovery record per admitted upload. Declarations only, on the owners' ID schemas (Authoring's
 * workspace ID and timestamp, Assets' digest). A record these schemas refuse is corrupt; candidate
 * validation refuses it and Authoring owns recovery.
 */
import { z } from 'zod';
import { assetDigest, timestamp, workspaceId } from '../../schemas.js';

/** Service-owned workspace metadata has no diagram content or personal UI preference fields. */
export const workspaceMetadata = z
  .strictObject({
    schemaVersion: z.literal(1),
    id: workspaceId,
    title: z.string().min(1).max(256),
    createdAt: timestamp,
    presetRevision: z.number().int().nonnegative().default(0),
  })
  .readonly();
/** Asset discovery metadata references admitted bytes; Model creates collection-local bindings independently. */
export const assetMetadata = z
  .strictObject({
    schemaVersion: z.literal(1),
    digest: assetDigest,
    alt: z.string().min(1).max(4096),
    source: z.string().min(1).max(2048),
    license: z.string().max(4096).optional(),
    attribution: z.string().max(4096).optional(),
  })
  .readonly();
