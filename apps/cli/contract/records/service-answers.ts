/*
 * What the local service answers, once the HTTP transport has checked its envelope, and the
 * schemas the service-call adapters check each answer with. Pure declarations. A service rejection
 * never arrives here: the transport returns it as `service-rejected`; an answer a schema rejects
 * becomes `invalid-response` in the adapter that asked.
 */
import { z } from 'zod';
import {
  assetDigest,
  collectionId,
  collectionRevision,
  objectId,
  recordId,
  sectionId,
  type CollectionId,
  type CollectionRevision,
  type Generation,
  type RecordId,
} from '../brands.js';
import type { ReadScope } from './command.js';

/** A successful answer's value and the service generation that sent it. */
export interface Observed<T> {
  readonly generation: Generation;
  readonly value: T;
}

/** Where a retained Authoring request goes: `preview` shows the change, `apply` commits it. */
export type SubmitMode = 'preview' | 'apply';

/** A node placement or wire route a person set by hand; `replace` keeps it. */
export interface ManualTarget {
  readonly target: string;
  readonly kind: 'placement' | 'route';
  readonly locked: boolean;
}

/** `read`'s answer: the DSL source of one collection at one revision, and its manual geometry. */
export interface Readout {
  readonly source: string;
  readonly collection: CollectionId;
  readonly revision: CollectionRevision;
  readonly scope: ReadScope;
  readonly manual: readonly ManualTarget[];
}

/**
 * What `/resources/prepare` answered: the Authoring record key the preset is stored under
 * (`preset:<digest>`), and the whole answer, which becomes the preset change payload unchanged.
 */
export interface PresetPreparation {
  readonly key: { readonly kind: 'preset'; readonly id: RecordId };
  readonly document: unknown;
}

/** Checks one manual target. */
const manualTarget = z
  .strictObject({
    target: z.string(),
    kind: z.enum(['placement', 'route']),
    locked: z.boolean(),
  })
  .readonly();

/** Checks a read scope; an answer without one read the whole collection. */
const readScope = z
  .discriminatedUnion('kind', [
    z.object({ kind: z.literal('all') }),
    z.object({ kind: z.literal('section'), id: sectionId }),
    z.object({ kind: z.literal('object'), id: objectId }),
  ])
  .default({ kind: 'all' });

/** Checks `/api/v1/source`'s answer. An answer without `manual` has no manual geometry. */
export const readoutAnswer = z.object({
  source: z.string(),
  collection: collectionId,
  revision: collectionRevision,
  scope: readScope,
  manual: z.array(manualTarget).readonly().default([]),
}) satisfies z.ZodType<Readout>;

/** Checks `/authoring/apply`'s answer; the receipt is checked on its own, the snapshot half is the browser's. */
export const appliedAnswer = z.looseObject({ receipt: z.unknown() });

/** Checks `/resources/stage`'s answer: the Assets descriptor of the staged bytes. */
export const stagedAnswer = z.looseObject({ descriptor: z.looseObject({ digest: assetDigest }) });

/** Checks `/resources/blob`'s answer before its digest is checked (see `byteBackup`). */
export const blobAnswer = z.looseObject({
  descriptor: z.looseObject({ digest: z.string() }),
  base64: z.string(),
});

/** Checks `/resources/prepare`'s answer: the preset's record key and the reads Templates made. */
export const preparedAnswer = z.looseObject({
  key: z.strictObject({ kind: z.literal('preset'), id: recordId }),
  reads: z.array(z.unknown()),
});
