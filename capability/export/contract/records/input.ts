/*
 * The export request a caller sends. `createExport` parses unknown input with `requestSchema`
 * before any revision is acquired, so a rejected request never holds a lease or reaches an
 * encoder. The exported schemas are shared, unfrozen objects; their `parse` throws a `ZodError`.
 */
import { z } from 'zod';
import { identity } from '../brands.js';

/**
 * What to export: the whole collection (`{ kind: 'all' }`) or one section
 * (`{ kind: 'section', id }`). Extra fields are rejected.
 */
export const scopeSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('all') }),
  z.strictObject({
    kind: z.literal('section'),
    /** ID of the section to export. */
    id: identity,
  }),
]);

/**
 * A full export request. `identity` pins the collection and revision; `format` is `svg`, `png`,
 * `pdf`, `html` or `bundle`. Omitted options get defaults: scope `all`, scale 1 (allowed 1–4),
 * paper `A4` (or `Letter`) and orientation `portrait` (or `landscape`). Extra fields are
 * rejected. The parsed request is frozen at the top level; its `identity` and `scope` are not.
 */
export const requestSchema = z
  .strictObject({
    /** The collection ID and revision to export. */
    identity: z.strictObject({ collectionId: identity, revision: z.number().int().nonnegative() }),
    /** The output format. */
    format: z.enum(['svg', 'png', 'pdf', 'html', 'bundle']),
    /** The whole collection or one section; defaults to the whole collection. */
    scope: scopeSchema.default({ kind: 'all' }),
    /** PNG pixels per collection unit, 1–4; defaults to 1. */
    scale: z.number().min(1).max(4).default(1),
    /** PDF paper size; defaults to `A4`. */
    paper: z.enum(['A4', 'Letter']).default('A4'),
    /** PDF page orientation; defaults to `portrait`. */
    orientation: z.enum(['portrait', 'landscape']).default('portrait'),
  })
  .readonly();

/** A parsed export request, with every default filled in. */
export type ExportRequest = z.infer<typeof requestSchema>;

/** A parsed scope: the whole collection or one section. */
export type Scope = z.infer<typeof scopeSchema>;

/** The output format of an export request. */
export type Format = ExportRequest['format'];

/**
 * An optional cancellation flag the caller can set. Export reads it only between stages:
 * before acquiring the revision, before encoding and after encoding. The PDF, PNG and bundle
 * encoders also read it between their own steps. Native work already running is not
 * interrupted. A cancelled export returns a `cancelled` diagnostic.
 */
export interface Cancellation {
  /** `true` once the caller has cancelled the export. */
  readonly aborted: boolean;
}
