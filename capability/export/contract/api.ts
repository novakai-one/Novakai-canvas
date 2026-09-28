/*
 * The Export service factory. Each operation runs entirely inside `protect`, input checks
 * included, so nothing it calls can make it throw or reject.
 */
import type { Export, Dependencies } from './types.js';
import type { Result } from './errors.js';
import type { Artifact } from './records/artifact.js';
import type { Cancellation } from './records/input.js';
import { requestSchema } from './records/input.js';
import { importSchema } from './records/bundle.js';
import type { PreparedImport } from './records/bundle.js';
import { parse, protect } from '../core/validation/outcomes.js';
import { produce } from '../core/artifacts/produce.js';
import { inspectBundle } from '../core/bundles/inspect.js';
import { prepareImport } from '../core/bundles/prepare.js';

/**
 * Builds the Export service from its dependencies, which are bound once. Every operation only
 * reads, so a failed call is safe to retry; the host repairs providers and performs any writes.
 *
 * @param deps - Snapshots, format handlers, documents, resources and encoding.
 * @returns A frozen service. A throw inside `exportArtifact` becomes `encoding-failed`, inside
 * `inspectBundle` `invalid-bundle`, and inside `prepareImport` `invalid-import`.
 * @throws Never; building the service only freezes an object.
 */
export function createExport(deps: Dependencies): Export {
  return Object.freeze({
    exportArtifact:
      /** Exports one artifact; an unexpected throw becomes `encoding-failed`. */
      (input, signal) => protect(/** Runs the export. */ () => exportInput(input, deps, signal)),
    inspectBundle:
      /** Inspects bundle bytes; an unexpected throw becomes `invalid-bundle`. */
      (bytes) =>
        protect(/** Runs the inspection. */ () => inspectBundle(bytes, deps), 'invalid-bundle'),
    prepareImport:
      /** Prepares an import; an unexpected throw becomes `invalid-import`. */
      (input) =>
        protect(
          /** Runs the import preparation. */ () => importInput(input, deps),
          'invalid-import',
        ),
  } satisfies Export);
}

/**
 * Parses the export request. A malformed one fails (`invalid-input`) before any revision is
 * acquired or encoded.
 */
async function exportInput(
  input: unknown,
  deps: Dependencies,
  signal?: Cancellation,
): Promise<Result<Artifact>> {
  const request = parse(requestSchema, input);
  if (!request.ok) return request;
  return produce(request.value, deps, signal);
}

/**
 * Parses the import request (`invalid-input` if malformed), then prepares it. Nothing is
 * committed; the caller submits through Authoring.
 */
async function importInput(
  input: unknown,
  deps: Dependencies,
): Promise<Result<PreparedImport>> {
  const request = parse(importSchema, input);
  if (!request.ok) return request;
  return prepareImport(request.value, deps);
}
