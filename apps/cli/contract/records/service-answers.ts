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
  manualAddress,
  objectId,
  recordId,
  sectionId,
  type CollectionId,
  type CollectionRevision,
  type Generation,
  type ManualAddress,
  type RecordId,
} from '../brands.js';
import { receiptSchema } from '../schemas.js';
import type { ReadScope } from './command.js';
import type { Receipt } from './foreign.js';

/** An answer that worked: what the service sent, and the generation of the service that sent it. */
export interface ServiceAnswer<T> {
  readonly generation: Generation;
  readonly value: T;
}

/** What to do with a kept Authoring request: `preview` shows the change, `apply` saves it. */
export type SubmitMode = 'preview' | 'apply';

/** An object placed or a wire routed by hand. `replace` leaves it where it is. */
export interface ManualTarget {
  readonly target: ManualAddress;
  readonly kind: 'placement' | 'route';
  readonly locked: boolean;
}

/** `read`'s answer: one collection's source at one revision, and what was placed by hand. */
export interface Readout {
  readonly source: string;
  readonly collection: CollectionId;
  readonly revision: CollectionRevision;
  readonly scope: ReadScope;
  readonly manual: readonly ManualTarget[];
}

/**
 * Whether one request was saved: `committed`, with Authoring's receipt, or `none` when no save is
 * recorded for it.
 */
export type ReceiptLookup =
  { readonly kind: 'committed'; readonly receipt: Receipt } | { readonly kind: 'none' };

/**
 * The answer to preparing a theme or recipe for saving: the key it will be saved under
 * (`preset:<digest>`), and the whole answer, which is sent on unchanged.
 */
export interface PresetPreparation {
  readonly key: { readonly kind: 'preset'; readonly id: RecordId };
  readonly document: PresetDocument;
}

/**
 * Checks the DSL vocabulary that `describe` prints. The CLI reads nothing inside it, so it only
 * checks that it is JSON; Language owns its shape.
 */
export const languageDescription = z.json().brand<'LanguageDescription'>();

/**
 * Checks Authoring's preview of a change, which `preview` prints. The CLI reads nothing inside it,
 * so it only checks that it is JSON; Authoring owns its shape.
 */
export const changePreview = z.json().brand<'ChangePreview'>();

/**
 * Checks the whole answer to preparing a theme or recipe, which is sent on unchanged. Only checked
 * to be JSON; {@link preparedAnswer} checks the key the CLI reads from it.
 */
export const presetDocument = z.json().brand<'PresetDocument'>();

/** The DSL vocabulary, checked by {@link languageDescription}: any JSON. */
export type LanguageDescription = z.infer<typeof languageDescription>;

/** Authoring's preview of a change, checked by {@link changePreview}: any JSON. */
export type ChangePreview = z.infer<typeof changePreview>;

/** The whole preparation answer, checked by {@link presetDocument}: any JSON. */
export type PresetDocument = z.infer<typeof presetDocument>;

/** Checks one manual target. */
const manualTarget = z
  .strictObject({
    target: manualAddress,
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

/** Checks `read`'s answer (`/api/v1/source`). With no `manual` list, nothing was placed by hand. */
export const readoutAnswer = z.object({
  source: z.string(),
  collection: collectionId,
  revision: collectionRevision,
  scope: readScope,
  manual: z.array(manualTarget).readonly().default([]),
}) satisfies z.ZodType<Readout>;

/** Checks that an apply answer (`/authoring/apply`) has a `receipt`, which is checked apart. */
export const appliedAnswer = z.looseObject({ receipt: z.unknown() });

/**
 * Checks a receipt answer: Authoring's receipt when the request was saved, `null` when not. Gives
 * back a `ReceiptLookup`.
 */
export const receiptAnswer = receiptSchema.nullable().transform(receiptLookup);

/** Checks the answer to storing a font or image (`/resources/stage`): the digest of its bytes. */
export const stagedAnswer = z.looseObject({ descriptor: z.looseObject({ digest: assetDigest }) });

/**
 * Checks the answer to reading stored bytes back (`/resources/blob`). Its digest is checked
 * later, by `byteBackup`.
 */
export const blobAnswer = z.looseObject({
  descriptor: z.looseObject({ digest: z.string() }),
  base64: z.string(),
});

/**
 * Checks the answer to preparing a theme or recipe (`/resources/prepare`): the key it will be
 * saved under.
 */
export const preparedAnswer = z.looseObject({
  key: z.strictObject({ kind: z.literal('preset'), id: recordId }),
  reads: z.array(z.unknown()),
});

/** Authoring's receipt, or `null`, as a lookup: `committed` with the receipt, or `none`. */
function receiptLookup(receipt: Receipt | null): ReceiptLookup {
  if (receipt === null) return { kind: 'none' };
  return { kind: 'committed', receipt };
}
