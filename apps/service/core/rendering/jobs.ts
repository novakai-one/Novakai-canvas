/*
 * Why this file exists
 *
 * The render worker can't read the workspace, so a render job must carry everything it needs. For
 * example, to draw `my-diagram` the job carries the exact theme version it names, that theme's
 * fonts, the collection's images, the diagram style worked out from the theme, and layout spacing.
 *
 * This file builds that job, asking Templates, Assets and Design System for each part. Each step
 * answers Authoring's `Result` (mistakes made in job-refusal.ts). It never writes, and never uses
 * a viewer's personal settings.
 */
import type {
  AuthoringResult,
  Collection,
  FontSource,
  Preset,
  ThemePreset,
} from '../../contract/records/capability-types.js';
import { resolvedStyle, layoutOptions } from '../../contract/schemas.js';
import { success } from '../../contract/errors.js';
import { removeDigestPrefix } from '../../contract/brands.js';
import type { RenderJobInputs } from '../../contract/ports/headless.js';
import type { WorkspaceContents } from '../../contract/records/workspace/contents.js';
import type { RenderingJob, RenderPurpose } from '../../contract/records/rendering/job.js';
import type { RenderJobs } from '../../contract/ports/rendering.js';
import { buildRenderJobId } from './job-id.js';
import { readCollectionImages, readThemeFonts } from './job-files.js';
import {
  malformedResourceFailure,
  missingResourceFailure,
  requireResource,
} from './job-refusal.js';

/**
 * Makes the render-job builder. `inputs` are the parts it asks: Templates for the theme, Assets
 * for fonts and images, Design System for the style. Its `create` builds one collection's job.
 * Mistakes: `missing-asset` when a part refuses, or the exact theme version the collection names
 * is a recipe; `invalid-input` when a part's answer isn't in the form Presentation or Layout
 * expects.
 */
export function createRenderJobs(inputs: RenderJobInputs): RenderJobs {
  return {
    create: (collection, contents, purpose) => buildJob(collection, contents, purpose, inputs),
  };
}

/** The pinned theme's fonts and the diagram style worked out from it. */
interface StyledTheme {
  readonly fonts: RenderingJob['fonts'];
  readonly style: RenderingJob['style'];
}

/** A render job before its layout options are added. */
type JobWithoutOptions = Omit<RenderingJob, 'options'>;

/**
 * One exact theme version, in the form Templates and Design System read it. The ID, version and
 * digest are text as stored; Templates and Design System check them.
 */
interface ThemeVersion {
  readonly kind: 'theme';
  readonly id: string;
  readonly version: string;
  readonly digest: string;
}

/** One theme font in the form Design System reads it, marked as fine to use. */
interface ApprovedFont {
  readonly family: FontSource['family'];
  readonly digest: FontSource['digest'];
  readonly approved: true;
}

/**
 * Builds one collection's job from the exact theme version it pins, never from personal settings.
 *
 * 1. Read the pinned theme through Templates.
 * 2. Read its fonts through Assets, then its diagram style through Design System.
 * 3. Add the job's ID, the collection's images and the layout options.
 */
function buildJob(
  collection: Collection,
  contents: WorkspaceContents,
  purpose: RenderPurpose,
  inputs: RenderJobInputs,
): AuthoringResult<RenderingJob> {
  const theme = readPinnedTheme(collection, contents, inputs);
  if (!theme.ok) {
    return theme;
  }
  const styled = styleTheme(theme.value, inputs);
  if (!styled.ok) {
    return styled;
  }
  return assembleJob(collection, purpose, styled.value, inputs);
}

/** Reads the exact theme version the collection pins, through Templates. */
function readPinnedTheme(
  collection: Collection,
  contents: WorkspaceContents,
  inputs: RenderJobInputs,
): AuthoringResult<ThemePreset> {
  const pin = versionPinnedBy(collection);
  const preset = requireResource(inputs.templates.read(contents.presets, pin));
  if (!preset.ok) {
    return preset;
  }
  return requireTheme(preset.value);
}

/** Writes the exact theme version the collection pins. */
function versionPinnedBy(collection: Collection): ThemeVersion {
  return {
    kind: 'theme',
    id: collection.theme.id,
    version: collection.theme.version,
    digest: removeDigestPrefix(collection.theme.digest),
  };
}

/** Checks the pinned preset is a theme, not a recipe. */
function requireTheme(preset: Preset): AuthoringResult<ThemePreset> {
  if (preset.kind !== 'theme') {
    return notAThemeFailure();
  }
  return success(preset);
}

/** Reads the theme's fonts, then works out the diagram style from the theme and those fonts. */
function styleTheme(
  theme: ThemePreset,
  inputs: RenderJobInputs,
): AuthoringResult<StyledTheme> {
  const fonts = readThemeFonts(theme, inputs.assets);
  if (!fonts.ok) {
    return fonts;
  }
  const style = resolveDiagramStyle(theme, fonts.value, inputs);
  if (!style.ok) {
    return style;
  }
  return success({ fonts: fonts.value, style: style.value });
}

/** Asks Design System for the theme's diagram tokens, then turns them into the diagram style. */
function resolveDiagramStyle(
  theme: ThemePreset,
  fonts: RenderingJob['fonts'],
  inputs: RenderJobInputs,
): AuthoringResult<RenderingJob['style']> {
  const tokenRequest = {
    scope: 'diagram',
    sources: inputs.sources,
    theme: theme.payload,
    fonts: fonts.map(approvedFont),
    pin: versionOf(theme),
  };
  const tokens = requireResource(inputs.system.resolve(tokenRequest));
  if (!tokens.ok) {
    return tokens;
  }
  const projection = requireResource(inputs.system.projectDiagram(tokens.value));
  if (!projection.ok) {
    return projection;
  }
  // The digest names the theme version the style came from. Presentation still keys the style on
  // all of its values, not on the digest alone.
  const unchecked = { ...projection.value, digest: theme.digest };
  return checkStyle(unchecked);
}

/** Writes one theme font in the form Design System reads it. */
function approvedFont(font: FontSource): ApprovedFont {
  return { family: font.family, digest: font.digest, approved: true };
}

/** Writes the theme's own exact version. */
function versionOf(theme: ThemePreset): ThemeVersion {
  return { kind: 'theme', id: theme.id, version: theme.version, digest: theme.digest };
}

/** Checks the style is in the form Presentation expects. */
function checkStyle(unchecked: unknown): AuthoringResult<RenderingJob['style']> {
  const style = resolvedStyle.safeParse(unchecked);
  if (!style.success) {
    return malformedResourceFailure();
  }
  return success(style.data);
}

/** Adds the job's ID and the collection's images, then the layout options. */
function assembleJob(
  collection: Collection,
  purpose: RenderPurpose,
  styled: StyledTheme,
  inputs: RenderJobInputs,
): AuthoringResult<RenderingJob> {
  const id = buildRenderJobId(purpose, collection);
  if (!id.ok) {
    return id;
  }
  const images = readCollectionImages(collection, inputs.assets);
  if (!images.ok) {
    return images;
  }
  const withoutOptions: JobWithoutOptions = {
    id: id.value,
    collection,
    fonts: styled.fonts,
    style: styled.style,
    wasmResource: inputs.wasmResource,
    assets: images.value,
  };
  return addLayoutOptions(withoutOptions);
}

/** Adds the layout options, scaled with the job's style, to finish the job. */
function addLayoutOptions(withoutOptions: JobWithoutOptions): AuthoringResult<RenderingJob> {
  const options = scaleLayoutOptions(withoutOptions.style);
  if (!options.ok) {
    return options;
  }
  const job = { ...withoutOptions, options: options.value };
  return success(job);
}

/** Works out the layout options from the style's gap, padding and body line height. */
function scaleLayoutOptions(
  style: RenderingJob['style'],
): AuthoringResult<RenderingJob['options']> {
  // `gridColumns` is the column count when a section doesn't set one; `maxBranches` is the most
  // Layout allows.
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
  if (!options.success) {
    return malformedResourceFailure();
  }
  return success(options.data);
}

/** Makes the `missing-asset` mistake for a pinned preset that is a recipe, not a theme. */
function notAThemeFailure(): AuthoringResult<never> {
  return missingResourceFailure('Collection does not select a theme');
}
