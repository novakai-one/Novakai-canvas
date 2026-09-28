/*
 * Why this file exists
 *
 * A source can name fonts and images, and the service must hold their bytes before a change can
 * use them. `asset @logo image source="./logo.png"` names a file next to the source: the CLI reads
 * it and stores ("stages") it in the service. `source="sha256:…"` names bytes already stored.
 *
 * This file stages each declared font and image, keeps a copy of its bytes for a retry, and has
 * their digests written into the request. It never sends the change. Each step gives back a
 * `Result` (see `contract/errors.ts`); a file that can't be read is reported at its line.
 */
import type { ResourceReader } from '../../contract/ports/resource-reader.js';
import type { ServiceResources } from '../../contract/ports/service-resources.js';
import type { RetainedRequest } from '../../contract/records/retained-request.js';
import type {
  NamedAssetDigest,
  ResourceToStage,
  StagedBackup,
} from '../../contract/records/staged-resource.js';
import type { ResourceRequest, StageInput } from '../../contract/records/foreign.js';
import { resourceAlias } from '../../contract/brands.js';
import type { AssetDigest, FilePath, ResourceAlias } from '../../contract/brands.js';
import type { LocalFailure, Result, SourceLocation } from '../../contract/errors.js';
import { failure, success } from '../../contract/errors.js';
import { combined } from '../shared/results.js';
import { parseAssetPin } from './digests.js';
import { buildStageInput } from './provenance.js';

/**
 * The tools staging uses: the file reader, and the service's `stage` (stores bytes) and `blob`
 * (reads stored bytes back).
 */
export interface StagingDependencies {
  readonly reader: ResourceReader;
  readonly resources: Pick<ServiceResources, 'stage' | 'blob'>;
}

/** The tools {@link prepareResources} uses: the staging tools, plus the service's freeze call. */
export interface ResourceDependencies extends StagingDependencies {
  readonly resources: Pick<ServiceResources, 'stage' | 'blob' | 'freeze'>;
}

/**
 * Stages the fonts and images a source declares, then has the service write their digests into
 * `retained`'s request; this is called freezing the request. Gives back that request with its
 * byte copies. Declared files are read from the folder of `file`, the source file.
 * The mistakes it can find: those of {@link stageResources}, or a failed freeze.
 */
export async function prepareResources(
  file: FilePath,
  declarations: readonly ResourceRequest[],
  retained: RetainedRequest,
  dependencies: ResourceDependencies,
): Promise<Result<RetainedRequest>> {
  const staged = await stageResources(file, declarations, dependencies);
  if (!staged.ok) {
    return staged;
  }
  return freezeRequest(retained, staged.value, dependencies);
}

/**
 * Stores each font and image `declarations` names in the service, and gives back each one's name
 * and a copy of its stored bytes, in order. Theme declarations are skipped: they hold no bytes.
 * The mistakes it can find: a declaration with no name (`invalid-response`), a file that can't be
 * read (the failure names its line), or a store or read-back the service refuses.
 */
export async function stageResources(
  file: FilePath,
  declarations: readonly ResourceRequest[],
  dependencies: StagingDependencies,
): Promise<Result<readonly StagedBackup[]>> {
  const resources = await readEachDeclaredResource(file, declarations, dependencies.reader);
  if (!resources.ok) {
    return resources;
  }
  return stageEachResource(resources.value, dependencies);
}

/**
 * Reads one declared font or image, ready to stage; nothing is stored yet. A `sha256:` pin is used
 * as it is; anything else is read as a file from the folder of `file`, the source that declares it.
 * The mistakes it can find: no name (`invalid-response`), or a file outside that folder, missing,
 * of the wrong type or too large (the failure names the declaration's line).
 */
export async function readDeclaredResource(
  file: FilePath,
  declaration: ResourceRequest,
  reader: ResourceReader,
): Promise<Result<ResourceToStage, LocalFailure>> {
  const alias = checkAlias(declaration);
  if (!alias.ok) {
    return alias;
  }
  const pin = parseAssetPin(declaration.source);
  if (pin !== undefined) {
    return success(pinnedResource(alias.value, pin));
  }
  return readLocalResource(file, declaration, alias.value, reader);
}

/** Lists each staged font or image's name and the digest of its stored bytes, in order. */
export function listNamedAssetDigests(
  staged: readonly StagedBackup[],
): readonly NamedAssetDigest[] {
  return staged.map(pairAliasWithDigest);
}

/** Has the service write the staged digests into the request, and keeps the byte copies with it. */
async function freezeRequest(
  retained: RetainedRequest,
  staged: readonly StagedBackup[],
  dependencies: ResourceDependencies,
): Promise<Result<RetainedRequest>> {
  const assets = listNamedAssetDigests(staged);
  const frozen = await dependencies.resources.freeze(retained.request, assets);
  if (!frozen.ok) {
    return frozen;
  }
  const backups = staged.map((resource) => resource.backup);
  const prepared: RetainedRequest = { ...retained, request: frozen.value, backups };
  return success(prepared);
}

/** Reads every declared font and image at once (themes hold no bytes, so they are skipped). */
async function readEachDeclaredResource(
  file: FilePath,
  declarations: readonly ResourceRequest[],
  reader: ResourceReader,
): Promise<Result<readonly ResourceToStage[], LocalFailure>> {
  const byteDeclarations = declarations.filter(holdsBytes);
  const readCalls = byteDeclarations.map((declaration) =>
    readDeclaredResource(file, declaration, reader),
  );
  const reads = await Promise.all(readCalls);
  return combined(reads);
}

/** Whether the declaration names a font or image; a theme declaration holds no bytes. */
function holdsBytes(declaration: ResourceRequest): boolean {
  return declaration.kind !== 'theme';
}

/** Stages every read font and image at once; gives back all their copies or the first failure. */
async function stageEachResource(
  resources: readonly ResourceToStage[],
  dependencies: StagingDependencies,
): Promise<Result<readonly StagedBackup[]>> {
  const stageCalls = resources.map((resource) => stageResource(resource, dependencies));
  const stagings = await Promise.all(stageCalls);
  return combined(stagings);
}

/** Stages one font or image: a pinned one is only copied back, local bytes are stored first. */
function stageResource(
  resource: ResourceToStage,
  dependencies: StagingDependencies,
): Promise<Result<StagedBackup>> {
  if (resource.kind === 'pinned') {
    return copyStoredBytes(resource.alias, resource.digest, dependencies);
  }
  return stageLocalBytes(resource.alias, resource.input, dependencies);
}

/** Stores local bytes in the service, then copies back the exact bytes it stored. */
async function stageLocalBytes(
  alias: ResourceAlias,
  input: StageInput,
  dependencies: StagingDependencies,
): Promise<Result<StagedBackup>> {
  const digest = await dependencies.resources.stage(input);
  if (!digest.ok) {
    return digest;
  }
  return copyStoredBytes(alias, digest.value, dependencies);
}

/** Reads back the exact bytes the service holds for `digest`, as the copy kept for a retry. */
async function copyStoredBytes(
  alias: ResourceAlias,
  digest: AssetDigest,
  dependencies: StagingDependencies,
): Promise<Result<StagedBackup>> {
  const bytes = await dependencies.resources.blob(digest);
  if (!bytes.ok) {
    return bytes;
  }
  const staged: StagedBackup = { alias, backup: bytes.value };
  return success(staged);
}

/** Checks the declaration has a name, such as `logo` in `asset @logo`. */
function checkAlias(declaration: ResourceRequest): Result<ResourceAlias, LocalFailure> {
  const alias = resourceAlias.safeParse(declaration.alias);
  if (!alias.success) {
    return unnamedResourceFailure();
  }
  return success(alias.data);
}

/** Describes a font or image named by a `sha256:` pin, which is used as it is. */
function pinnedResource(
  alias: ResourceAlias,
  digest: AssetDigest,
): ResourceToStage {
  return { kind: 'pinned', alias, digest };
}

/** Reads the declared file into what Assets stores; a failed read says where it was declared. */
async function readLocalResource(
  file: FilePath,
  declaration: ResourceRequest,
  alias: ResourceAlias,
  reader: ResourceReader,
): Promise<Result<ResourceToStage, LocalFailure>> {
  const bytes = await reader.read(file, declaration);
  if (!bytes.ok) {
    const place = declarationPlace(file, declaration, alias);
    return locatedReadFailure(bytes.error, place);
  }
  const input = buildStageInput(declaration, bytes.value);
  const local: ResourceToStage = { kind: 'local', alias, input };
  return success(local);
}

/** Finds where the declaration is in `file`: the line and column Language gave it, and its name. */
function declarationPlace(
  file: FilePath,
  declaration: ResourceRequest,
  alias: ResourceAlias,
): SourceLocation {
  const { line, column } = declaration.span.start;
  return { file, line, column, alias };
}

/** Pairs one staged font or image's name with the digest of its stored bytes. */
function pairAliasWithDigest(resource: StagedBackup): NamedAssetDigest {
  return { alias: resource.alias, digest: resource.backup.digest };
}

/** Makes the mistake for a declaration Language or the theme grammar gave no alias. */
function unnamedResourceFailure(): Result<never, LocalFailure> {
  return failure({ code: 'invalid-response', message: 'A resource declaration has no alias' });
}

/**
 * Gives back the read failure with the declaration's place added; its code, message and recovery
 * are kept.
 */
function locatedReadFailure(
  readFailure: LocalFailure,
  place: SourceLocation,
): Result<never, LocalFailure> {
  return failure({ ...readFailure, location: place });
}
