/*
 * Builds the render job for one collection from one consistent workspace view: the exact pinned
 * theme, its fonts, the collection's images, the resolved diagram style and the layout options.
 * Pure over the injected owners (Assets, Templates, Design System); nothing is written. Authoring
 * owns admission and keeps the prior scene when a job cannot be built.
 */
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
import { authoringFailure, success } from '../../contract/errors.js';
import type { RenderResourceOwners } from '../../contract/records/rendering/resources.js';
import type { WorkspaceContents } from '../../contract/records/workspace/contents.js';
import type { RenderingJob } from '../../contract/records/rendering/job.js';
import type { RenderJobs } from '../../contract/ports/render-jobs.js';

/**
 * Binds job building to the given owners. `create` returns the job for one collection (see
 * `create` below). It fails with `missing-asset` at `render-resources` when an owner rejects a
 * resource (the owner's failure kept as source) or the pinned preset is not a theme, and with
 * `invalid-input` at `render-resources` when anything else throws, such as a resource that does
 * not fit its Presentation or Layout schema.
 */
export function createRenderJobs(owners: RenderResourceOwners): RenderJobs {
  return {
    create(collection, view, previous, id): AuthoringResult<RenderingJob> {
      try {
        return success(create(collection, view, previous, id, owners));
      } catch (error) {
        return rejected(error);
      }
    },
  };
}

/**
 * Builds the job from the collection's exact pinned theme; personal UI scope cannot enter it.
 * Reads the theme through Templates, each theme font and each image asset through Assets, and
 * resolves then projects the diagram tokens through Design System. The layout options scale with
 * the resolved style. Throws `RenderResourceFault` when an owner rejects a resource or the preset
 * is not a theme, and a schema error when a resource does not fit Presentation or Layout.
 */
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

/**
 * Reads one admitted font: the stored bytes and the family Assets recorded, which measurement and
 * the browser and export all use. Throws `RenderResourceFault` when Assets cannot resolve the
 * digest, and a schema error when the result is not a Presentation font source.
 */
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

/**
 * Reads one admitted image. Its dimensions come from Assets' admission, never from authored pixel
 * hints. Throws `RenderResourceFault` when Assets cannot resolve the digest, and a schema error
 * when the result is not a Presentation visual asset.
 */
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

/**
 * The owner's value. Render resources are mandatory owner results: there is no machine-local
 * fallback font or blank image. Throws `RenderResourceFault` with the owner's failure as source
 * when the owner rejected the input.
 */
function accepted<T>(result: AuthoringResult<T, FailureSource>): T {
  if (!result.ok)
    throw new RenderResourceFault('A render resource owner rejected input', result.error);
  return result.value;
}

/** A render resource the owners refused; the owner's failure is kept when there is one. */
class RenderResourceFault extends Error {
  /** A refusal found here (preset is not a theme) has no invented source; owner refusals keep theirs. */
  constructor(
    message: string,
    readonly source?: FailureSource,
  ) {
    super(message);
  }
}

/**
 * The failure for a job that could not be built. A `RenderResourceFault` is `missing-asset` at
 * `render-resources` with its message and source; any other throw is `invalid-input` at
 * `render-resources`, "Render resources could not be decoded". It never throws itself.
 */
function rejected(error: unknown): AuthoringResult<never> {
  if (error instanceof RenderResourceFault)
    return authoringFailure('missing-asset', 'render-resources', error.message, [], error.source);
  return authoringFailure(
    'invalid-input',
    'render-resources',
    'Render resources could not be decoded',
  );
}
