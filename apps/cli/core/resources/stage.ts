/*
 * Resource staging for authoring and preset admission: each declared font or image gets its alias
 * checked, then is either a pinned `sha256:` digest (nothing is read) or a file read through the
 * confined resource reader and staged with Assets; the normalized bytes are backed up, then the
 * aliases are frozen into the Authoring request. A read failure is given the declaration's
 * location here. Uses injected ports only. A failure stops before any Authoring request is sent;
 * staged bytes left behind are collectable Assets orphans.
 */
import type { ResourceReader } from '../../contract/ports/resource-reader.js';
import type { ServiceResources } from '../../contract/ports/service-resources.js';
import type { RetainedRequest } from '../../contract/records/retained-request.js';
import type {
  AssetBinding,
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
import { assetOfPin } from './digests.js';
import { stageInput } from './provenance.js';

/** What staging uses: the confined resource reader and the service's stage and blob calls. */
export interface StagingDependencies {
  readonly reader: ResourceReader;
  readonly resources: Pick<ServiceResources, 'stage' | 'blob'>;
}

/** What DSL preparation adds: the service's freeze. */
export interface ResourceDependencies extends StagingDependencies {
  readonly resources: Pick<ServiceResources, 'stage' | 'blob' | 'freeze'>;
}

/** A declaration Language or the theme grammar gave no alias: a broken answer, not user input. */
const unnamedResource: FailureInput = Object.freeze({
  code: 'invalid-response',
  message: 'A resource declaration has no alias',
});

/**
 * Stage each of the source's declarations, read relative to its `file`, before freezing aliases
 * into `retained`'s request. Fails with `invalid-response` (a declaration has no alias), as the
 * resource read or a service call does, or with `invalid-input` when the frozen request fails
 * Authoring's schema.
 */
export async function prepareResources(
  file: FilePath,
  requests: readonly ResourceRequest[],
  retained: RetainedRequest,
  dependencies: ResourceDependencies,
): Promise<Result<RetainedRequest>> {
  const staged = await stageResources(file, requests, dependencies);
  if (!staged.ok) return staged;
  return freeze(retained, staged.value, dependencies);
}

/**
 * Stage a declaration list; a failed member prevents any canonical request submission. Fails as
 * the first failed declaration does (`invalid-response` when it has no alias, or the resource
 * read's failure), then as the first failed stage or blob call does.
 */
export async function stageResources(
  file: FilePath,
  requests: readonly ResourceRequest[],
  dependencies: StagingDependencies,
): Promise<Result<readonly StagedBackup[]>> {
  const read = await Promise.all(
    requests
      .filter((item) => item.kind !== 'theme')
      .map((item) => declaredResource(file, item, dependencies.reader)),
  );
  const declared = combined(read);
  if (!declared.ok) return declared;
  return combined(await Promise.all(declared.value.map((item) => stage(item, dependencies))));
}

/**
 * One declaration, read relative to `file`: its pinned digest when its source is a Model
 * `sha256:` pin (nothing is read), otherwise its file's bytes as an Assets stage input. Fails with
 * `invalid-response` (the declaration has no alias), or as {@link localResource} does.
 */
export async function declaredResource(
  file: FilePath,
  request: ResourceRequest,
  reader: ResourceReader,
): Promise<Result<StagedResource, LocalFailure>> {
  const alias = checked(resourceAlias, request.alias, unnamedResource);
  if (!alias.ok) return alias;
  const pinned = assetOfPin(request.source);
  if (pinned !== undefined) return success({ kind: 'pinned', alias: alias.value, digest: pinned });
  return localResource(file, request, alias.value, reader);
}

/** Each staged alias and the digest of its bytes, in declaration order. */
export function assetBindings(staged: readonly StagedBackup[]): readonly AssetBinding[] {
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
  return success({ kind: 'local', alias, input: stageInput(request, bytes.value) });
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
  const frozen = await dependencies.resources.freeze(retained.request, assetBindings(values));
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
