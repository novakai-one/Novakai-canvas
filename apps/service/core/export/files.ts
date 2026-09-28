/*
 * Why this file exists
 *
 * Every export comes back as one file to download, and its name should say what it holds. For
 * example, `my-diagram` at revision 3 as a PNG downloads as `my-diagram-3-all.png`.
 *
 * This file wraps a finished SVG or PNG, or Markdown or DSL text, into that file. Each file is
 * named after the collection and revision, and says its revision in the `X-Novakai-Export-Revision`
 * header. It never reads the workspace.
 */
import { success, type Result } from '../../contract/errors.js';
import type { SentFile } from '../../contract/records/transport/server.js';
import type { ExportRequest } from '../../contract/records/export/request.js';
import type { Artifact, ExportResult } from '../../contract/records/capability-types.js';
import { exportRouteFailure } from './faults.js';

/**
 * Builds the download for Export's finished SVG or PNG (its "artifact"), such as
 * `my-diagram-3-all.svg`, with the file's digest in the `X-Novakai-Export-Digest` header.
 * When Export found a mistake instead, answers it as the service's failure (`exportRouteFailure`).
 */
export function buildArtifactFile(artifact: ExportResult<Artifact>): Result<SentFile> {
  if (!artifact.ok) return exportRouteFailure(artifact);
  return success(artifactFile(artifact.value));
}

/**
 * Builds the UTF-8 download for Markdown text, such as `my-diagram-3-all.md` for the whole
 * collection or `my-diagram-3-intro.md` for the `intro` section. Never fails.
 */
export function buildMarkdownFile(
  request: Pick<ExportRequest, 'identity' | 'scope'>,
  markdown: string,
): SentFile {
  const scope = request.scope.kind === 'all' ? 'all' : request.scope.id;
  return {
    bytes: UTF8.encode(markdown),
    mediaType: 'text/markdown; charset=utf-8',
    filename: `${request.identity.collectionId}-${request.identity.revision}-${scope}.md`,
    headers: revisionHeaders(request.identity),
  };
}

/** Builds the UTF-8 download for DSL text, such as `my-diagram-3.canvas`. Never fails. */
export function buildDslFile(
  identity: ExportRequest['identity'],
  dsl: string,
): SentFile {
  return {
    bytes: UTF8.encode(dsl),
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
function artifactFile(artifact: Artifact): SentFile {
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
