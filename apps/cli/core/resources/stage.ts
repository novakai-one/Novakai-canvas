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
  StagedBackup,
  StagedResource,
} from '../../contract/records/staged-resource.js';
import type { ResourceRequest, StageInput } from '../../contract/records/foreign.js';
import { resourceAlias } from '../../contract/brands.js';
import type { AssetDigest, FilePath, ResourceAlias } from '../../contract/brands.js';
import type { FailureInput, LocalFailure, Result, SourceLocation } from '../../contract/errors.js';
import { failure, success } from '../../contract/errors.js';
import { checked } from '../shared/checks.js';
import { combined } from '../shared/results.js';
import { parseAssetPin } from './digests.js';
import { buildStageInput } from './provenance.js';

/** The tools staging uses: the font and image file reader, and the service's `stage` and `blob`. */
export interface StagingDependencies {
  readonly reader: ResourceReader;
  readonly resources: Pick<ServiceResources, 'stage' | 'blob'>;
}

/** The tools {@link prepareResources} uses: the staging tools, plus the service's freeze call. */
export interface ResourceDependencies extends StagingDependencies {
  readonly resources: Pick<ServiceResources, 'stage' | 'blob' | 'freeze'>;
}

/** A declaration Language or the theme grammar gave no alias: a broken answer, not user input. */
const unnamedResource: FailureInput = Object.freeze({
  code: 'invalid-response',
  message: 'A resource declaration has no alias',
});

/**
 * Stages the fonts and images a source declares, then has the service write their digests into
 * `retained`'s request ("freeze" them). Gives back that request with its byte copies.
 * `file` is the source file; declared files are read from its folder.
 * The mistakes it can find: those of {@link stageResources}, or a failed freeze.
 */
export async function prepareResources(
  file: FilePath,
  declarations: readonly ResourceRequest[],
  retained: RetainedRequest,
  dependencies: ResourceDependencies,
): Promise<Result<RetainedRequest>> {
  const staged = await stageResources(file, declarations, dependencies);
  if (!staged.ok) return staged;
  return freeze(retained, staged.value, dependencies);
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
  const read = await Promise.all(
    declarations
      .filter((item) => item.kind !== 'theme')
      .map((item) => readDeclaredResource(file, item, dependencies.reader)),
  );
  const declared = combined(read);
  if (!declared.ok) return declared;
  return combined(await Promise.all(declared.value.map((item) => stage(item, dependencies))));
}

/**
 * Reads one declared font or image. A `sha256:` pin is used as it is; anything else is read as a
 * file from the folder of `file`, the source that declares it. Gives back the resource ready to
 * stage: its name and its bytes or pin. Nothing is stored yet.
 * The mistakes it can find: no name (`invalid-response`), or a file outside that folder, missing,
 * of the wrong type or too large (the failure names the declaration's line).
 */
export async function readDeclaredResource(
  file: FilePath,
  declaration: ResourceRequest,
  reader: ResourceReader,
): Promise<Result<StagedResource, LocalFailure>> {
  const alias = checked(resourceAlias, declaration.alias, unnamedResource);
  if (!alias.ok) return alias;
  const pinned = parseAssetPin(declaration.source);
  if (pinned !== undefined) return success({ kind: 'pinned', alias: alias.value, digest: pinned });
  return localResource(file, declaration, alias.value, reader);
}

/** Lists each staged font or image's name and the digest of its stored bytes, in order. */
export function listNamedAssetDigests(
  staged: readonly StagedBackup[],
): readonly NamedAssetDigest[] {
  return staged.map((item) => ({ alias: item.alias, digest: item.backup.digest }));
}

/**
 * The declared file's bytes as an Assets stage input. Fails as the resource read does, with the
 * declaration's `location`: `absolute-path`, `path-escape`, `source-unavailable`,
 * `unsupported-media`, `resource-mismatch` or `resource-too-large`.
 */
async function localResource(
  file: FilePath,
  request: ResourceRequest,
  alias: ResourceAlias,
  reader: ResourceReader,
): Promise<Result<StagedResource, LocalFailure>> {
  const bytes = await reader.read(file, request);
  if (!bytes.ok) return located(bytes.error, declarationPlace(file, request, alias));
  return success({ kind: 'local', alias, input: buildStageInput(request, bytes.value) });
}

/** Where `request` is declared in `file`: Language's line and column of the declaration. */
function declarationPlace(
  file: FilePath,
  request: ResourceRequest,
  alias: ResourceAlias,
): SourceLocation {
  const { line, column } = request.span.start;
  return { file, line, column, alias };
}

/** The read failure with the declaration's place; its code, message and recovery are kept. */
function located(
  error: LocalFailure,
  location: SourceLocation,
): Result<never, LocalFailure> {
  return failure({ ...error, location });
}

/** Exact aliases are retained after all declared bytes have been admitted. */
async function freeze(
  retained: RetainedRequest,
  values: readonly StagedBackup[],
  dependencies: ResourceDependencies,
): Promise<Result<RetainedRequest>> {
  const frozen = await dependencies.resources.freeze(
    retained.request,
    listNamedAssetDigests(values),
  );
  if (!frozen.ok) return frozen;
  return success({
    ...retained,
    request: frozen.value,
    backups: values.map((item) => item.backup),
  });
}

/** A pinned digest is backed up as it is; local bytes are staged first. */
function stage(
  resource: StagedResource,
  dependencies: StagingDependencies,
): Promise<Result<StagedBackup>> {
  if (resource.kind === 'pinned') return backup(resource.alias, resource.digest, dependencies);
  return stageLocal(resource.alias, resource.input, dependencies);
}

/** One upload is followed by an exact normalized byte read for durable local replay protection. */
async function stageLocal(
  alias: ResourceAlias,
  input: StageInput,
  dependencies: StagingDependencies,
): Promise<Result<StagedBackup>> {
  const digest = await dependencies.resources.stage(input);
  if (!digest.ok) return digest;
  return backup(alias, digest.value, dependencies);
}

/** Every referenced byte, including already-pinned resources, is retained before the Authoring request can be sent. */
async function backup(
  alias: ResourceAlias,
  digest: AssetDigest,
  dependencies: StagingDependencies,
): Promise<Result<StagedBackup>> {
  const bytes = await dependencies.resources.blob(digest);
  if (!bytes.ok) return bytes;
  return success({ alias, backup: bytes.value });
}
