/*
 * Why this file exists
 *
 * The CLI can draw a diagram file as a PNG with no service running ("headless"), for example
 * `pnpm render:png --collection my-diagram.canvas --out my-diagram.png`. The picture must still
 * match the service's, so the CLI must use the service's own theme, render-job and layout code.
 *
 * This file declares what the service shares for that (`HeadlessBindings`), and what the CLI
 * passes in for each step (`RenderJobInputs`, `ThemeSavingInputs`): only the few capability calls
 * that step uses. They live here because the CLI may not import service core. Declarations only.
 */
import type {
  Assets,
  AuthoringResult,
  Catalog,
  DesignSystem,
  Json,
  LoweredIntent,
  Templates,
} from '../records/capability-types.js';
import type { PresetCodecs, PresetContext } from '../records/presets/codecs.js';
import type { HostPath } from '../brands.js';
import type { DiagramProducer, RenderJobs } from './rendering.js';

/**
 * What building a render job reads from: stored files, Design System, the token sources, Templates
 * and libavoid's file. Never the working folder or personal settings.
 */
export interface RenderJobInputs {
  /** Finds the stored bytes of each font and image. */
  readonly assets: Pick<Assets, 'resolve'>;
  /** Resolves the theme's tokens and the diagram's style. */
  readonly system: Pick<DesignSystem, 'resolve' | 'projectDiagram'>;
  /** The shipped design token sources, as read from disk; Design System checks them. */
  readonly sources: unknown;
  /** Reads the exact theme version a collection names. */
  readonly templates: Pick<Templates<LoweredIntent>, 'read'>;
  /** The path of libavoid's WebAssembly file (libavoid routes the wires). */
  readonly wasmResource: HostPath;
}

/** What saving a theme reads from: Assets to check its fonts, Templates to find its base theme. */
export interface ThemeSavingInputs {
  readonly assets: Pick<Assets, 'resolve'>;
  readonly templates: Pick<Templates<LoweredIntent>, 'read'>;
}

/**
 * One font name a theme uses, and the uploaded font file it stands for. Both are text as sent;
 * theme saving (core/presets/theme-admission.ts) checks the digest with Assets.
 */
export interface FontBinding {
  /** The font name the theme uses, for example `body` in `font body source="…"`. */
  readonly alias: string;
  /** The digest of the uploaded font file. */
  readonly digest: string;
}

/** The service code a headless render shares with the running service (compose/headless.ts). */
export interface HeadlessBindings {
  /** Makes the recipe and theme codecs for one set of themes and files. Never fails. */
  readonly createPresetCodecs: (context: PresetContext) => PresetCodecs;
  /**
   * Readies a preset for saving: a theme in source syntax comes back in the form Templates saves,
   * with its fonts checked; any other preset comes back unchanged. The answer is JSON that
   * Templates checks when it saves it. Fails with `invalid-input` when the base theme can't be
   * found, a font is not a checked upload, or the theme is malformed, and `missing-asset` when
   * Assets can't find a font.
   */
  readonly prepareTheme: (
    preset: Json,
    catalog: Catalog,
    bindings: readonly FontBinding[],
    inputs: ThemeSavingInputs,
  ) => AuthoringResult<Json>;
  /** Makes the render-job builder from the given inputs (see `RenderJobs.create`). Never fails. */
  readonly createRenderJobs: (inputs: RenderJobInputs) => RenderJobs;
  /**
   * Measures, lays out and routes one job right here, without a worker. Fails with `invalid-input`
   * at `render` when a capability refuses the input, or `unavailable` at `render` when the
   * compiled layout code fails.
   */
  readonly produceDiagram: DiagramProducer['produce'];
}
