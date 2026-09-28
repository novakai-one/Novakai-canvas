/*
 * Why this file exists
 *
 * Besides diagrams, the service stores two records of its own. One describes the workspace: its
 * ID, title and creation time. One describes each uploaded file: for example, a logo's digest,
 * its alt text and where it came from.
 *
 * This file holds the checks for both. A stored record that fails them is corrupt: the check
 * before saving refuses it. Declarations only.
 */
import { z } from 'zod';
import { assetDigest, timestamp, workspaceId } from '../../schemas.js';

/**
 * Checks the workspace record: its ID, title, creation time, and a count that goes up each time a
 * preset is saved. It holds no diagram content and no personal settings.
 */
export const workspaceMetadata = z
  .strictObject({
    schemaVersion: z.literal(1),
    id: workspaceId,
    title: z.string().min(1).max(256),
    createdAt: timestamp,
    presetRevision: z.number().int().nonnegative().default(0),
  })
  .readonly();
/**
 * Checks one uploaded file's record: its digest, alt text, source, and optional license and
 * credit. A collection that uses the file names it separately.
 */
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
