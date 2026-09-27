/*
 * The headless seam: the service functions a read-only headless export (the CLI) shares with the
 * running service, and the owner bags the CLI passes to them. The bags live here, not beside their
 * core consumers, because this declaration cannot import core. Declarations only;
 * compose/headless.ts binds the functions, and the CLI owns retry once dependencies are restored.
 */
import type { Assets, AuthoringResult, Catalog, Json } from '../records/capabilities.js';
import type { DesignSystem } from '@novakai/canvas-design-system';
import type { LoweredIntent } from '@novakai/canvas-language';
import type { Templates } from '@novakai/canvas-templates';
import type { PresetCodecs, PresetContext } from '../records/presets/codecs.js';
import type { DiagramProducer, RenderJobs } from './rendering.js';

/** Installed source location and admitted owners are explicit; no worker consults ambient cwd or personal preferences. */
export interface RenderResourceOwners {
  readonly assets: Pick<Assets, 'resolve'>;
  readonly system: Pick<DesignSystem, 'resolve' | 'projectDiagram'>;
  readonly sources: unknown;
  readonly templates: Pick<Templates<LoweredIntent>, 'read'>;
  readonly wasmResource: string;
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
  readonly createPresetCodecs: (context: PresetContext) => PresetCodecs;
  /** core/presets/theme-admission.ts `prepareTheme`. */
  readonly prepareTheme: (
    admission: Json,
    catalog: Catalog,
    bindings: readonly FontBinding[],
    owners: ThemeAdmissionOwners,
  ) => AuthoringResult<Json>;
  readonly createRenderJobs: (owners: RenderResourceOwners) => RenderJobs;
  readonly produceDiagram: DiagramProducer['produce'];
}
