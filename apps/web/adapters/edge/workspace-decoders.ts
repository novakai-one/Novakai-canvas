/*
 * Workspace decoders: checks untrusted server and browser-stored input with the owners' schemas
 * (Authoring owns the snapshot shape, Model each collection) before the workspace uses it. Pure
 * apart from the diagram reader supplied at composition; nothing is written. Every decoder answers
 * a `Result` and never throws; the caller that read the input owns recovery.
 */
import { z } from 'zod';
import { snapshotSchema } from '@novakai/canvas-authoring';
import type { Snapshot } from '@novakai/canvas-authoring';
import { collectionId, validate } from '@novakai/canvas-model';
import { transportGeneration } from '@novakai/canvas-service';
import type { Collection } from '@novakai/canvas-model';
import type { CollectionId } from '../../contract/brands.js';
import { sourceEdit } from '../../contract/brands.js';
import type { WorkspaceDecoders } from '../../contract/ports/workspace-decoders.js';
import type { Result } from '../../contract/errors.js';
import { failure } from '../../contract/errors.js';
import type {
  CapturedCollectionBase,
  RecoveredSource,
} from '../../contract/records/editor-recovery.js';
import { captureCollectionBase } from '../../contract/api.js';
import {
  capturedCollectionBaseSchema,
  hasRecoveryTag,
} from '../../contract/schemas/editor-recovery.js';

/**
 * The workspace decoders. The diagram readout is supplied at composition, so this adapter does not
 * import a sibling reader. Each decoder's failure codes are named on `WorkspaceDecoders`.
 */
export function createWorkspaceDecoders(diagram: WorkspaceDecoders['diagram']): WorkspaceDecoders {
  return { snapshot, diagram, sourceRecovery };
}

/**
 * Authoring owns snapshot shape; Model owns each live collection document. Fails with
 * `invalid-workspace` when either check fails.
 */
function snapshot(input: unknown): ReturnType<WorkspaceDecoders['snapshot']> {
  const checked = snapshotSchema.safeParse(input);
  if (!checked.success) return failure('invalid-workspace', 'Workspace response was invalid');
  const content = collections(checked.data);
  if (!content.ok) return content;
  return { ok: true, value: { snapshot: checked.data, collections: content.value } };
}

/** Invalid canonical data is surfaced, not hidden as an empty collection. Fails with `invalid-workspace`. */
function collections(snapshot: Snapshot): Result<readonly Collection[]> {
  const candidates = snapshot.records
    .filter((item) => item.key.kind === 'collection' && !item.deleted)
    .map((item) => validate(item.value));
  if (candidates.some((item) => !item.ok))
    return failure('invalid-workspace', 'A collection failed Model validation');
  return { ok: true, value: candidates.flatMap((item) => (item.ok ? [item.value] : [])) };
}

/** A recovered draft whose base has been narrowed to the one collection it captured. */
type CapturedSource = RecoveredSource & { readonly base: CapturedCollectionBase };

/** A stored source draft today: tagged, with a captured collection base. */
const currentSource = z.strictObject({
  kind: z.literal('source-draft'),
  schemaVersion: z.literal(1),
  source: z.string(),
  base: capturedCollectionBaseSchema,
  generation: transportGeneration,
  collection: collectionId,
  edit: sourceEdit,
});

/** A stored source draft from before the tag: untagged, with a full snapshot. */
const legacySource = z.strictObject({
  source: z.string(),
  snapshot: snapshotSchema,
  generation: transportGeneration,
  collection: collectionId,
  edit: sourceEdit,
});

/**
 * A stored source draft, current or legacy, checked against the collection it captured. Fails with
 * `invalid-recovery` when the draft, its captured base or its collection identity is invalid.
 */
function sourceRecovery(input: unknown): ReturnType<WorkspaceDecoders['sourceRecovery']> {
  const parsed = sourceInput(input);
  if (!parsed.ok) return parsed;
  const base = captureCollectionBase(parsed.value.base, parsed.value.collection);
  if (!base.ok) return base;
  return admitSource({ ...parsed.value, base: base.value });
}

/** The draft in either stored shape. Fails with `invalid-recovery`. */
function sourceInput(input: unknown): Result<RecoveredSource> {
  const checked = parseSource(input);
  if (!checked.success)
    return failure(
      'invalid-recovery',
      'Stored source draft is invalid; it was preserved for recovery',
    );
  return 'base' in checked.data
    ? currentSourceValue(checked.data)
    : legacySourceValue(checked.data);
}

/** A tagged draft is read as current; anything else as legacy. */
function parseSource(input: unknown) {
  return hasRecoveryTag(input) ? currentSource.safeParse(input) : legacySource.safeParse(input);
}

/** A current draft already has the recovered shape. Cannot fail. */
function currentSourceValue(input: z.infer<typeof currentSource>): Result<RecoveredSource> {
  return { ok: true, value: input };
}

/** A legacy draft's snapshot becomes its base. Cannot fail. */
function legacySourceValue(input: z.infer<typeof legacySource>): Result<RecoveredSource> {
  return {
    ok: true,
    value: {
      source: input.source,
      base: input.snapshot,
      generation: input.generation,
      collection: input.collection,
      edit: input.edit,
    },
  };
}

/** The recovered draft with only its own fields, once its collection is admitted. Fails with `invalid-recovery`. */
function admitSource(input: CapturedSource): ReturnType<WorkspaceDecoders['sourceRecovery']> {
  const collection = admittedCollection(input);
  if (!collection.ok) return collection;
  return {
    ok: true,
    value: {
      source: input.source,
      base: input.base,
      generation: input.generation,
      collection: input.collection,
      edit: input.edit,
    },
  };
}

/** Model admits the captured record. Fails with `invalid-recovery`. */
function admittedCollection(input: CapturedSource): Result<Collection> {
  const collection = validate(input.base.record.value);
  if (!collection.ok)
    return failure('invalid-recovery', 'Stored source collection identity is invalid');
  return checkedSourceCollection(collection.value, input.collection, input.base.record.version);
}

/** The captured record is the draft's collection at the captured revision. Fails with `invalid-recovery`. */
function checkedSourceCollection(
  collection: Collection,
  id: CollectionId,
  version: number,
): Result<Collection> {
  if (collection.id !== id)
    return failure('invalid-recovery', 'Stored source collection identity is invalid');
  if (collection.revision !== version)
    return failure('invalid-recovery', 'Stored source collection revision is invalid');
  return { ok: true, value: collection };
}
