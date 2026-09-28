/*
 * Why this file exists
 *
 * The service answers over HTTP, and an answer is only text until it is checked. `read` expects
 * one collection's source, its revision and anything placed by hand. An answer missing its
 * revision must not reach the agent as if it were fine.
 *
 * This file names each answer the CLI uses, and the check for each one. An answer that fails its
 * check becomes `invalid-response`. A refusal from the service never arrives here; it is already
 * `service-rejected`. Nothing here sends a request.
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
  type ServiceGeneration,
  type RecordId,
} from '../brands.js';
import { receiptSchema } from '../schemas.js';
import type { ReadScope } from './command.js';
import type { Receipt } from './foreign.js';

/**
 * An answer that worked: what the service sent, and the generation of the service that sent it
 * (the label of one service start; see `brands.ts`).
 */
export interface ServiceAnswer<T> {
  readonly generation: ServiceGeneration;
  readonly value: T;
}

/** What to do with a kept Authoring request: `preview` shows the change, `apply` saves it. */
export type SubmitMode = 'preview' | 'apply';

/** An object placed or a wire routed by hand. `replace` leaves it where it is. */
export interface ManualTarget {
  /** Its address, such as `@section/@object`, as the service prints it. Passed on unchanged. */
  readonly target: string;
  readonly kind: 'placement' | 'route';
  /** Whether a person locked it, so automatic layout never moves it. */
  readonly locked: boolean;
}

/** `read`'s answer: one collection's source at one revision, and what was placed by hand. */
export interface ReadAnswer {
  readonly source: string;
  readonly collection: CollectionId;
  readonly revision: CollectionRevision;
  readonly scope: ReadScope;
  readonly manual: readonly ManualTarget[];
}

/**
 * Whether a request was saved: `committed`, with Authoring's receipt, or `none` when the service
 * holds no receipt for it.
 */
export type ReceiptLookup =
  { readonly kind: 'committed'; readonly receipt: Receipt } | { readonly kind: 'none' };

/**
 * The answer to preparing a theme or recipe (a "preset", in Templates' word). Preparing works out
 * exactly what saving it will store, without saving anything.
 */
export interface PresetPreparation {
  /** The key it will be saved under (`preset:<digest>`). */
  readonly key: { readonly kind: 'preset'; readonly id: RecordId };
  /** The whole answer, key included, sent back unchanged in the save request. */
  readonly document: PresetDocument;
}

/**
 * Checks the DSL vocabulary that `describe` prints. The CLI reads nothing inside it, so it only
 * checks that it is JSON; Language owns its shape.
 */
export const languageDescriptionSchema = z.json().brand<'LanguageDescription'>();

/**
 * Checks Authoring's preview of a change, which `preview` prints. The CLI reads nothing inside it,
 * so it only checks that it is JSON; Authoring owns its shape.
 */
export const changePreviewSchema = z.json().brand<'ChangePreview'>();

/**
 * Checks the whole answer to preparing a theme or recipe, which goes back unchanged in the save
 * request. Only checked to be JSON; {@link preparedAnswerSchema} checks the key the CLI reads.
 */
export const presetDocumentSchema = z.json().brand<'PresetDocument'>();

/** The DSL vocabulary, checked by {@link languageDescriptionSchema}: any JSON. */
export type LanguageDescription = z.infer<typeof languageDescriptionSchema>;

/** Authoring's preview of a change, checked by {@link changePreviewSchema}: any JSON. */
export type ChangePreview = z.infer<typeof changePreviewSchema>;

/** The whole preparation answer, checked by {@link presetDocumentSchema}: any JSON. */
export type PresetDocument = z.infer<typeof presetDocumentSchema>;

/** Checks one manual target. */
const manualTargetSchema = z
  .strictObject({
    target: z.string(),
    kind: z.enum(['placement', 'route']),
    locked: z.boolean(),
  })
  .readonly();

/** Checks a read scope; an answer without one read the whole collection. */
const readScopeSchema = z
  .discriminatedUnion('kind', [
    z.object({ kind: z.literal('all') }),
    z.object({ kind: z.literal('section'), id: sectionId }),
    z.object({ kind: z.literal('object'), id: objectId }),
  ])
  .default({ kind: 'all' });

/** Checks `read`'s answer (`/api/v1/source`). With no `manual` list, nothing was placed by hand. */
export const readAnswerSchema = z.object({
  source: z.string(),
  collection: collectionId,
  revision: collectionRevision,
  scope: readScopeSchema,
  manual: z.array(manualTargetSchema).readonly().default([]),
}) satisfies z.ZodType<ReadAnswer>;

/**
 * Checks that an apply answer (`/authoring/apply`) has a `receipt` field. The receipt itself is
 * checked next, by {@link receiptAnswerSchema}.
 */
export const appliedAnswerSchema = z.looseObject({ receipt: z.unknown() });

/**
 * Checks a receipt answer: Authoring's receipt when the request was saved, `null` when not. Gives
 * back a `ReceiptLookup`.
 */
export const receiptAnswerSchema = receiptSchema.nullable().transform(receiptLookup);

/** Checks the answer to storing a font or image (`/resources/stage`): the digest of its bytes. */
export const stagedAnswerSchema = z.looseObject({
  descriptor: z.looseObject({ digest: assetDigest }),
});

/**
 * Checks the answer to reading stored bytes back (`/resources/blob`). Its digest is checked
 * later, by `byteBackupSchema`.
 */
export const blobAnswerSchema = z.looseObject({
  descriptor: z.looseObject({ digest: z.string() }),
  base64: z.string(),
});

/**
 * Checks the answer to preparing a theme or recipe (`/resources/prepare`): the key it will be
 * saved under.
 */
export const preparedAnswerSchema = z.looseObject({
  key: z.strictObject({ kind: z.literal('preset'), id: recordId }),
  reads: z.array(z.unknown()),
});

/** Authoring's receipt, or `null`, as a lookup: `committed` with the receipt, or `none`. */
function receiptLookup(receipt: Receipt | null): ReceiptLookup {
  if (receipt === null) return { kind: 'none' };
  return { kind: 'committed', receipt };
}
