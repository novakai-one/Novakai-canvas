/*
 * Export files: a finished artifact, Markdown text or canonical DSL becomes one download named
 * <collection>-<revision>[-<scope>].<extension> and stamped with the exported revision; an
 * artifact also carries its digest. A failed artifact becomes the route failure.
 */
import type { RouteOutcome } from '../../contract/records/transport/protocol.js';
import type { StaticFile } from '../../contract/records/transport/server.js';
import type {
  Artifact,
  ExportRequest,
  ExportResult,
} from '../../contract/records/export/export.js';
import { exportRouteFailure } from './faults.js';

/** The artifact as a download, or its failure as the route failure. */
export function artifactOutcome(artifact: ExportResult<Artifact>): RouteOutcome {
  return artifact.ok
    ? { kind: 'bytes', file: artifactFile(artifact.value) }
    : exportRouteFailure(artifact);
}

/** Markdown as a UTF-8 download named by collection, revision and scope. */
export function markdownFile(
  request: Pick<ExportRequest, 'identity' | 'scope'>,
  source: string,
): RouteOutcome {
  const scope = request.scope.kind === 'all' ? 'all' : request.scope.id;
  return {
    kind: 'bytes',
    file: {
      bytes: Buffer.from(source, 'utf8'),
      mediaType: 'text/markdown; charset=utf-8',
      filename: `${request.identity.collectionId}-${request.identity.revision}-${scope}.md`,
      headers: { 'X-Novakai-Export-Revision': String(request.identity.revision) },
    },
  };
}

/** Canonical DSL as a UTF-8 `.canvas` download named by collection and revision. */
export function dslFile(
  identity: ExportRequest['identity'],
  source: string,
): RouteOutcome {
  return {
    kind: 'bytes',
    file: {
      bytes: Buffer.from(source, 'utf8'),
      mediaType: 'text/plain; charset=utf-8',
      filename: `${identity.collectionId}-${identity.revision}.canvas`,
      headers: { 'X-Novakai-Export-Revision': String(identity.revision) },
    },
  };
}

/** The artifact's bytes, named by identity, scope and extension, with revision and digest. */
function artifactFile(artifact: Artifact): StaticFile {
  const name = `${artifact.identity.collectionId}-${artifact.identity.revision}-${artifact.scope.kind}.${artifact.extension}`;
  return {
    bytes: artifact.bytes,
    mediaType: artifact.mediaType,
    filename: name,
    headers: {
      'X-Novakai-Export-Revision': String(artifact.identity.revision),
      'X-Novakai-Export-Digest': artifact.digest,
    },
  };
}
