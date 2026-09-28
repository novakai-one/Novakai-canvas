import { fail } from '../../contract/errors.js';
import type { Result } from '../../contract/errors.js';
import type {
  Admission,
  StageInput,
  NormalizedMedia,
  StoredBlob,
} from '../../contract/records/media.js';
import type { AssetStorage, AssetTransaction } from '../../contract/ports/storage.js';
import type { IdentityPort } from '../../contract/ports/identity.js';
import type { MediaRegistry } from '../../contract/ports/media.js';
import { success, protectAsync } from '../validation/outcomes.js';
import { validateInput, validateNormalized, byteLength } from './validate.js';
import { resolveBlob } from '../resolution/resolve.js';

/** What staging uses: transactions, hashing and the media processors. No lease or lifecycle services. */
interface StageDependencies {
  readonly storage: Pick<AssetStorage, 'transact'>;
  readonly identity: Pick<IdentityPort, 'digest'>;
  readonly media: Pick<MediaRegistry, 'handlers'>;
}

/**
 * Stages one media file: checks it, normalizes it, and stores the normalized bytes. It creates no
 * diagram binding; Authoring uses the admission's alt text and provenance when it commits one.
 *
 * Steps, in order:
 * 1. check the request (`validateInput`);
 * 2. hash the submitted bytes (the original digest);
 * 3. normalize them with the first processor for the media type (`unsupported-media` at
 *    `mediaType` when there is none), then check its output (`validateNormalized`);
 * 4. hash the normalized bytes;
 * 5. in one storage transaction, store them, or verify the bytes already stored at that digest
 *    ({@link storeBlob}).
 *
 * @param input - The staging request.
 * @param deps - Storage, hasher and media processors.
 * @returns The frozen admission, or the first failure. After `invalid-input`,
 * `unsupported-media` or `unsafe-media`, correct the input before retrying. After a storage
 * failure, re-read and retry; Authoring owns retrying, and collection removes any orphan bytes.
 * @throws Never. Anything thrown becomes `unsafe-media` at `$`.
 */
export function stageMedia(
  input: unknown,
  deps: StageDependencies,
): Promise<Result<Admission>> {
  return protectAsync(async () => {
    const parsed = validateInput(input);
    if (!parsed.ok) {
      return parsed;
    }
    return stageChecked(parsed.value, deps);
  }, 'unsafe-media');
}

/**
 * Normalizes media and builds its stored blob. Staging and restoring share this path.
 *
 * @param input - The checked request.
 * @param media - The media processors.
 * @param identity - The hasher.
 * @returns The blob, or `unsupported-media` when no processor handles the type, the processor's
 * own failure, a `validateNormalized` failure, or the hasher's failure.
 * @throws Whatever a processor or the hasher throws. The callers' boundaries (`protectAsync` in
 * `stageMedia` and `prepareRestored`) turn it into `unsafe-media`.
 */
export async function prepareBlob(
  input: StageInput,
  media: Pick<MediaRegistry, 'handlers'>,
  identity: Pick<IdentityPort, 'digest'>,
): Promise<Result<StoredBlob>> {
  const normalized = await normalizeInput(input, media);
  if (!normalized.ok) {
    return normalized;
  }
  return identifyBlob(normalized.value, identity);
}

/**
 * Stores a blob, or reuses the one already stored at its digest. Existing bytes are verified
 * ({@link resolveBlob}) and must equal the new bytes exactly (`corrupt-asset` at `digest`
 * otherwise). The file adapter also refuses different bytes at a digest.
 *
 * @param transaction - The transaction to read and write in.
 * @param blob - The blob to store.
 * @param identity - The hasher, for verifying existing bytes.
 * @returns Success, or the verification failure.
 * @throws Whatever the storage calls or the hasher throw. It runs inside a storage transaction:
 * the real storage adapter turns the throw into a failure; with other storage the facade's
 * boundary does.
 */
export function storeBlob(
  transaction: Pick<AssetTransaction, 'readBlob' | 'writeBlob'>,
  blob: StoredBlob,
  identity: Pick<IdentityPort, 'digest'>,
): Result<void> {
  const previous = transaction.readBlob(blob.descriptor.digest);
  if (previous !== null) {
    return checkExisting(transaction, blob, identity);
  }
  transaction.writeBlob(blob);
  return success(undefined);
}

/** Hashes normalized media and moves every other field into the descriptor with the digest and byte length. */
function identifyBlob(
  media: NormalizedMedia,
  identity: Pick<IdentityPort, 'digest'>,
): Result<StoredBlob> {
  const hashed = identity.digest(media.base64);
  if (!hashed.ok) {
    return hashed;
  }
  const { base64, ...facts } = media;
  return success({
    base64,
    descriptor: { ...facts, digest: hashed.value, byteLength: byteLength(base64) },
  });
}

/** Runs the first processor that handles the media type, then checks its output. */
async function normalizeInput(
  input: StageInput,
  media: Pick<MediaRegistry, 'handlers'>,
): Promise<Result<NormalizedMedia>> {
  const handler = media.handlers.find((handler) => handler.mediaTypes.includes(input.mediaType));
  if (!handler) {
    return fail('unsupported-media', 'mediaType', 'No processor supports this format');
  }
  const processed = await handler.normalize(input.base64, input.mediaType);
  if (!processed.ok) {
    return processed;
  }
  return validateNormalized(processed.value);
}

/** Verifies the bytes already stored at the digest and requires them to equal the new bytes. */
function checkExisting(
  transaction: Pick<AssetTransaction, 'readBlob'>,
  blob: StoredBlob,
  identity: Pick<IdentityPort, 'digest'>,
): Result<void> {
  const existing = resolveBlob(transaction, blob.descriptor.digest, identity);
  if (!existing.ok) {
    return existing;
  }
  if (existing.value.base64 !== blob.base64) {
    return fail('corrupt-asset', 'digest', 'Existing bytes disagree with normalized media');
  }
  return success(undefined);
}

/** Hashes the original bytes, prepares the normalized blob, then stores it. */
async function stageChecked(
  input: StageInput,
  deps: StageDependencies,
): Promise<Result<Admission>> {
  const original = deps.identity.digest(input.base64);
  if (!original.ok) {
    return original;
  }
  const blob = await prepareBlob(input, deps.media, deps.identity);
  if (!blob.ok) {
    return blob;
  }
  return commitStage(input, original.value, blob.value, deps);
}

/** Stores the blob in one transaction and builds the admission. A failure is never reported as admitted. */
function commitStage(
  input: StageInput,
  originalDigest: Admission['originalDigest'],
  blob: StoredBlob,
  deps: StageDependencies,
): Result<Admission> {
  const written = deps.storage.transact((view) => storeBlob(view, blob, deps.identity));
  if (!written.ok) {
    return written;
  }
  return success({
    descriptor: blob.descriptor,
    originalDigest,
    alt: input.alt,
    provenance: input.provenance,
  });
}
