/*
 * Builds the render job for one collection from one consistent workspace view: the exact pinned
 * theme, its fonts, the collection's images, the resolved diagram style and the layout options.
 * Pure over the injected owners (Assets, Templates, Design System); nothing is written. Every
 * refusal is a returned value (job-refusal.ts). Authoring owns admission and keeps the prior scene
 * when a job cannot be built.
 */
import type {
  AuthoringResult,
  Collection,
  FontSource,
  ThemePreset,
  VisualAsset,
} from '../../contract/records/capability-types.js';
import {
  fontSource,
  fontSet,
  visualAsset,
  resolvedStyle,
  layoutOptions,
} from '../../contract/schemas.js';
import { andThen, collect, success } from '../../contract/errors.js';
import { removeDigestPrefix } from '../../contract/brands.js';
import type { RenderJobInputs } from '../../contract/ports/headless.js';
import type { WorkspaceContents } from '../../contract/records/workspace/contents.js';
import type { RenderingJob, RenderPurpose } from '../../contract/records/rendering/job.js';
import type { RenderJobs } from '../../contract/ports/rendering.js';
import { jobId } from './job-id.js';
import { fromOwner, resourceRefused, undecodable } from './job-refusal.js';

/**
 * Binds job building to the given owners. `create` returns the job for one collection, named after
 * its purpose (see `create` below). It fails with `missing-asset` at `render-resources` when an
 * owner rejects a resource (the owner's failure kept as source) or the pinned preset is not a
 * theme, and with `invalid-input` at `render-resources` when a resource does not fit its
 * Presentation or Layout schema.
 */
export function createRenderJobs(owners: RenderJobInputs): RenderJobs {
  return { create: (collection, view, purpose) => create(collection, view, purpose, owners) };
}

/** The pinned theme's fonts and the diagram style resolved from it. */
interface StyledTheme {
  readonly fonts: RenderingJob['fonts'];
  readonly style: RenderingJob['style'];
}

/**
 * Builds the job from the collection's exact pinned theme; personal UI scope cannot enter it.
 *
 * Steps; the first failure stops the build:
 * 1. Read the pinned theme, its fonts and its diagram style (see `styledTheme`).
 * 2. Name the job, read the images and scale the layout options (see `assembleJob`).
 *
 * Fails as `createRenderJobs` names.
 */
function create(
  collection: Collection,
  view: WorkspaceContents,
  purpose: RenderPurpose,
  owners: RenderJobInputs,
): AuthoringResult<RenderingJob> {
  const styled = styledTheme(collection, view, owners);
  return andThen(styled, (theme) => assembleJob(collection, purpose, theme, owners));
}

/**
 * Reads the theme the collection pins through Templates, each of its fonts through Assets, then
 * resolves and projects the diagram tokens through Design System. Fails as `pinnedTheme`,
 * `themeFonts` or `diagramStyle` fails.
 */
function styledTheme(
  collection: Collection,
  view: WorkspaceContents,
  owners: RenderJobInputs,
): AuthoringResult<StyledTheme> {
  const preset = pinnedTheme(collection, view, owners);
  if (!preset.ok) return preset;
  const fonts = themeFonts(preset.value, owners);
  if (!fonts.ok) return fonts;
  const style = diagramStyle(preset.value, fonts.value, owners);
  return andThen(style, (resolved) => success({ fonts: fonts.value, style: resolved }));
}

/**
 * The job: its ID (see `jobId`), the collection, the theme's fonts and style, the collection's
 * images (see `asset`) and the layout options scaled with the style. Fails with `missing-asset`
 * or `invalid-input` at `render-resources` as `jobId`, `asset` or `scaledOptions` fails.
 */
function assembleJob(
  collection: Collection,
  purpose: RenderPurpose,
  theme: StyledTheme,
  owners: RenderJobInputs,
): AuthoringResult<RenderingJob> {
  const id = jobId(purpose, collection);
  if (!id.ok) return id;
  const images = collection.assets.filter((item) => item.mediaType.startsWith('image/'));
  const assets = collect(images, (image) => asset(removeDigestPrefix(image.digest), owners));
  if (!assets.ok) return assets;
  return andThen(scaledOptions(theme.style), (options) =>
    success({
      id: id.value,
      collection,
      fonts: theme.fonts,
      style: theme.style,
      wasmResource: owners.wasmResource,
      assets: assets.value,
      options,
    }),
  );
}

/**
 * The exact theme the collection pins, read through Templates. Fails with `missing-asset` at
 * `render-resources` when Templates refuses the pin (its failure kept as source), or ("Collection
 * does not select a theme") when the pinned preset is not a theme.
 */
function pinnedTheme(
  collection: Collection,
  view: WorkspaceContents,
  owners: RenderJobInputs,
): AuthoringResult<ThemePreset> {
  const preset = fromOwner(
    owners.templates.read(view.presets, {
      kind: 'theme',
      id: collection.theme.id,
      version: collection.theme.version,
      digest: removeDigestPrefix(collection.theme.digest),
    }),
  );
  if (!preset.ok) return preset;
  if (preset.value.kind !== 'theme') return resourceRefused('Collection does not select a theme');
  return success(preset.value);
}

/**
 * Every font the theme pins, read through Assets, as a Presentation font set. Fails as `font`
 * fails, or with `invalid-input` at `render-resources` when they are not a font set.
 */
function themeFonts(
  preset: ThemePreset,
  owners: RenderJobInputs,
): AuthoringResult<RenderingJob['fonts']> {
  const fonts = collect(preset.payload.fonts, (digest) => font(digest, owners));
  if (!fonts.ok) return fonts;
  const checked = fontSet.safeParse(fonts.value);
  if (!checked.success) return undecodable();
  return success(checked.data);
}

/**
 * The diagram style: Design System resolves the theme's tokens with its fonts, then projects them.
 * Presentation's digest denotes the selected immutable preset; all resolved style values still
 * enter its full derivation key. Fails with `missing-asset` at `render-resources` when Design
 * System refuses (its failure kept as source), or `invalid-input` when the projection is not a
 * resolved style.
 */
function diagramStyle(
  preset: ThemePreset,
  fonts: RenderingJob['fonts'],
  owners: RenderJobInputs,
): AuthoringResult<RenderingJob['style']> {
  const tokens = fromOwner(
    owners.system.resolve({
      scope: 'diagram',
      sources: owners.sources,
      theme: preset.payload,
      fonts: fonts.map((item) => ({ family: item.family, digest: item.digest, approved: true })),
      pin: { kind: 'theme', id: preset.id, version: preset.version, digest: preset.digest },
    }),
  );
  if (!tokens.ok) return tokens;
  const projected = fromOwner(owners.system.projectDiagram(tokens.value));
  return andThen(projected, (projection) => checkedStyle({ ...projection, digest: preset.digest }));
}

/** The style checked as Presentation's resolved style. Fails with `invalid-input` otherwise. */
function checkedStyle(candidate: unknown): AuthoringResult<RenderingJob['style']> {
  const style = resolvedStyle.safeParse(candidate);
  if (!style.success) return undecodable();
  return success(style.data);
}

/**
 * The layout options, scaled with the resolved style's gap, padding and body line height. Fails
 * with `invalid-input` at `render-resources` when they are not Layout options.
 */
function scaledOptions(style: RenderingJob['style']): AuthoringResult<RenderingJob['options']> {
  const options = layoutOptions.safeParse({
    gap: { compact: style.gap * 3, normal: style.gap * 8, roomy: style.gap * 12 },
    padding: style.padding * 2,
    routeClearance: style.padding,
    labelGap: style.gap,
    sequenceGap: style.typography.body.lineHeight * 2,
    activationWidth: style.padding,
    gridColumns: 4,
    maxBranches: 4096,
  });
  if (!options.success) return undecodable();
  return success(options.data);
}

/**
 * Reads one admitted font: the stored bytes and the family Assets recorded, which measurement and
 * the browser and export all use. Fails with `missing-asset` at `render-resources` when Assets
 * cannot resolve the digest, and `invalid-input` when the result is not a Presentation font
 * source.
 */
function font(
  digest: string,
  owners: RenderJobInputs,
): AuthoringResult<FontSource> {
  const blob = fromOwner(owners.assets.resolve(digest));
  if (!blob.ok) return blob;
  const source = fontSource.safeParse({
    digest,
    family: blob.value.descriptor.fontFamily,
    mediaType: blob.value.descriptor.mediaType,
    base64: blob.value.base64,
  });
  if (!source.success) return undecodable();
  return success(source.data);
}

/**
 * Reads one admitted image. Its dimensions come from Assets' admission, never from authored pixel
 * hints. Fails with `missing-asset` at `render-resources` when Assets cannot resolve the digest,
 * and `invalid-input` when the result is not a Presentation visual asset.
 */
function asset(
  digest: string,
  owners: RenderJobInputs,
): AuthoringResult<VisualAsset> {
  const blob = fromOwner(owners.assets.resolve(digest));
  if (!blob.ok) return blob;
  const image = visualAsset.safeParse({
    digest,
    mediaType: blob.value.descriptor.mediaType,
    base64: blob.value.base64,
    width: blob.value.descriptor.width,
    height: blob.value.descriptor.height,
  });
  if (!image.success) return undecodable();
  return success(image.data);
}
