/*
 * The headless seam: the service functions a read-only headless export (the CLI) shares with the
 * running service, and the owner bags the CLI passes to them. The bags live here, not beside their
 * core consumers, because this declaration cannot import core. Declarations only;
 * compose/headless.ts binds the functions, and the CLI owns retry once dependencies are restored.
 */
import type {
  Assets,
  AuthoringResult,
  Catalog,
  DesignSystem,
  Json,
  LoweredIntent,
  Templates,
} from '../records/capabilities.js';
import type { PresetCodecs, PresetContext } from '../records/presets/codecs.js';
import type { HostPath } from '../brands.js';
import type { DiagramProducer, RenderJobs } from './rendering.js';

/** Installed source location and admitted owners are explicit; no worker consults ambient cwd or personal preferences. */
export interface RenderResourceOwners {
  readonly assets: Pick<Assets, 'resolve'>;
  readonly system: Pick<DesignSystem, 'resolve' | 'projectDiagram'>;
  readonly sources: unknown;
  readonly templates: Pick<Templates<LoweredIntent>, 'read'>;
  readonly wasmResource: HostPath;
}

/** What theme admission uses: Assets to verify fonts, Templates to select the base theme. */
export interface ThemeAdmissionOwners {
  readonly assets: Pick<Assets, 'resolve'>;
  readonly templates: Pick<Templates<LoweredIntent>, 'read'>;
}

/** One font alias the theme names and the digest of the uploaded font bytes it binds. */
export interface FontBinding {
  readonly alias: string;
  readonly digest: string;
}

/** What headless export binds (compose/headless.ts). */
export interface HeadlessBindings {
  /** Binds the recipe and theme codecs to one preset context. Never fails. */
  readonly createPresetCodecs: (context: PresetContext) => PresetCodecs;
  /**
   * core/presets/theme-admission.ts `prepareTheme`: a source-syntax theme admission with its fonts
   * verified. Fails with `invalid-input` when the base theme cannot be selected, a font is not a
   * verified font or the theme is malformed, and `missing-asset` when Assets cannot resolve a font.
   */
  readonly prepareTheme: (
    admission: Json,
    catalog: Catalog,
    bindings: readonly FontBinding[],
    owners: ThemeAdmissionOwners,
  ) => AuthoringResult<Json>;
  /** Binds render-job building to the given owners (see `RenderJobs.create`). Never fails. */
  readonly createRenderJobs: (owners: RenderResourceOwners) => RenderJobs;
  /**
   * Measures, lays out and routes one job in this realm. Fails with `invalid-input` at `render`
   * when an owner rejects the input, or `unavailable` at `render` when the native runtime fails.
   */
  readonly produceDiagram: DiagramProducer['produce'];
}
