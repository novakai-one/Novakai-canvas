/*
 * Export files: a finished artifact, Markdown text or canonical DSL becomes one download named
 * <collection>-<revision>[-<scope>].<extension> and stamped with the exported revision; an
 * artifact also carries its digest. A failed artifact becomes the route failure. Pure.
 */
import { success, type Result } from '../../contract/errors.js';
import type { StaticFile } from '../../contract/records/transport/server.js';
import type { ExportRequest } from '../../contract/records/export/request.js';
import type { Artifact, ExportResult } from '../../contract/records/capabilities.js';
import { exportRouteFailure } from './faults.js';

/** The artifact as a download, or its failure as the route failure (`exportRouteFailure`). */
export function artifactOutcome(artifact: ExportResult<Artifact>): Result<StaticFile> {
  if (!artifact.ok) return exportRouteFailure(artifact);
  return success(artifactFile(artifact.value));
}

/** Markdown as a UTF-8 download named by collection, revision and scope. Never fails. */
export function markdownFile(
  request: Pick<ExportRequest, 'identity' | 'scope'>,
  source: string,
): StaticFile {
  const scope = request.scope.kind === 'all' ? 'all' : request.scope.id;
  return {
    bytes: UTF8.encode(source),
    mediaType: 'text/markdown; charset=utf-8',
    filename: `${request.identity.collectionId}-${request.identity.revision}-${scope}.md`,
    headers: revisionHeaders(request.identity),
  };
}

/** Canonical DSL as a UTF-8 `.canvas` download named by collection and revision. Never fails. */
export function dslFile(
  identity: ExportRequest['identity'],
  source: string,
): StaticFile {
  return {
    bytes: UTF8.encode(source),
    mediaType: 'text/plain; charset=utf-8',
    filename: `${identity.collectionId}-${identity.revision}.canvas`,
    headers: revisionHeaders(identity),
  };
}

/** Encodes text downloads as UTF-8. */
const UTF8 = new TextEncoder();

/** The header naming the exported revision; every export file carries it. */
const REVISION_HEADER = 'X-Novakai-Export-Revision';

/** The header naming an artifact's digest. */
const DIGEST_HEADER = 'X-Novakai-Export-Digest';

/** The artifact's bytes, named by identity, scope and extension, with revision and digest. */
function artifactFile(artifact: Artifact): StaticFile {
  const name = `${artifact.identity.collectionId}-${artifact.identity.revision}-${artifact.scope.kind}.${artifact.extension}`;
  return {
    bytes: artifact.bytes,
    mediaType: artifact.mediaType,
    filename: name,
    headers: { ...revisionHeaders(artifact.identity), [DIGEST_HEADER]: artifact.digest },
  };
}

/** The headers stamping a download with its exported revision. Never fails. */
function revisionHeaders(
  identity: Pick<ExportRequest['identity'], 'revision'>,
): Readonly<Record<string, string>> {
  return { [REVISION_HEADER]: String(identity.revision) };
}
