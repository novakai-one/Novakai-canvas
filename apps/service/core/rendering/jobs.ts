import type { FailureSource } from '../../contract/records/transport/failure-source.js';
import type {
  AuthoringResult,
  Collection,
  FontSource,
  Scene,
  VisualAsset,
} from '../../contract/records/capabilities.js';
import {
  fontSource,
  fontSet,
  visualAsset,
  resolvedStyle,
  layoutOptions,
} from '../../contract/schemas.js';
import { authoringFailure } from '../../contract/errors.js';
import type { RenderResourceOwners } from '../../contract/records/rendering/resources.js';
import type { WorkspaceContents } from '../../contract/records/workspace/contents.js';
import type { RenderingJob } from '../../contract/records/rendering/job.js';
import type { RenderJobs } from '../../contract/ports/render-jobs.js';
/** Known owner failures preserve their actionable explanation at the Authoring feasibility boundary. */
class RenderResourceFault extends Error {
  /** Expected owner failures keep their evidence through private short-circuiting. */
  constructor(
    message: string,
    readonly source?: FailureSource,
  ) {
    super(message);
  }
}
/** Render resources are mandatory owner results, never machine-local fallback fonts or blank images. */
function accepted<T>(result: AuthoringResult<T, FailureSource>): T {
  if (!result.ok)
    throw new RenderResourceFault('A render resource owner rejected input', result.error);
  return result.value;
}
/** Read the normalized admitted font bytes and family that both measurement and browser/export must use. */
function font(
  digest: string,
  owners: RenderResourceOwners,
): FontSource {
  const blob = accepted(owners.assets.resolve(digest));
  return fontSource.parse({
    digest,
    family: blob.descriptor.fontFamily,
    mediaType: blob.descriptor.mediaType,
    base64: blob.base64,
  });
}
/** Image dimensions come from Assets' mechanical admission, never authored pixel hints. */
function asset(
  digest: string,
  owners: RenderResourceOwners,
): VisualAsset {
  const blob = accepted(owners.assets.resolve(digest));
  return visualAsset.parse({
    digest,
    mediaType: blob.descriptor.mediaType,
    base64: blob.base64,
    width: blob.descriptor.width,
    height: blob.descriptor.height,
  });
}
/** Convert the exact pinned theme into native measured input; personal UI scope cannot enter this request. */
function create(
  collection: Collection,
  view: WorkspaceContents,
  previous: Scene | null,
  id: string,
  owners: RenderResourceOwners,
): RenderingJob {
  const preset = accepted(
    owners.templates.read(view.presets, {
      kind: 'theme',
      id: collection.theme.id,
      version: collection.theme.version,
      digest: collection.theme.digest.slice(7),
    }),
  );
  if (preset.kind !== 'theme') throw new RenderResourceFault('Collection does not select a theme');
  const fonts = fontSet.parse(preset.payload.fonts.map((digest) => font(digest, owners)));
  const tokens = accepted(
    owners.system.resolve({
      scope: 'diagram',
      sources: owners.sources,
      theme: preset.payload,
      fonts: fonts.map((item) => ({ family: item.family, digest: item.digest, approved: true })),
      pin: { kind: 'theme', id: preset.id, version: preset.version, digest: preset.digest },
    }),
  );
  const projected = accepted(owners.system.projectDiagram(tokens));
  // Presentation's digest denotes the selected immutable preset; all resolved style values still enter its full derivation key.
  const style = resolvedStyle.parse({
    ...projected,
    digest: preset.digest,
  });
  return {
    id,
    collection,
    fonts,
    style,
    previous,
    wasmResource: owners.wasmResource,
    assets: collection.assets
      .filter((item) => item.mediaType.startsWith('image/'))
      .map((item) => asset(item.digest.slice(7), owners)),
    options: layoutOptions.parse({
      gap: { compact: style.gap * 3, normal: style.gap * 8, roomy: style.gap * 12 },
      padding: style.padding * 2,
      routeClearance: style.padding,
      labelGap: style.gap,
      sequenceGap: style.typography.body.lineHeight * 2,
      activationWidth: style.padding,
      gridColumns: 4,
      maxBranches: 4096,
    }),
  };
}
/** Owner rejection is a correction path; malformed resource output does not escape as a native exception. */
function rejected(error: unknown): AuthoringResult<never> {
  if (error instanceof RenderResourceFault)
    return authoringFailure('missing-asset', 'render-resources', error.message, [], error.source);
  return authoringFailure(
    'invalid-input',
    'render-resources',
    'Render resources could not be decoded',
  );
}
/** Every job is built from one consistent workspace view; Authoring owns admission and keeps the prior scene on failure. */
export function createRenderJobs(owners: RenderResourceOwners): RenderJobs {
  return {
    create(collection, view, previous, id): AuthoringResult<RenderingJob> {
      try {
        return { ok: true, value: create(collection, view, previous, id, owners) };
      } catch (error) {
        return rejected(error);
      }
    },
  };
}
