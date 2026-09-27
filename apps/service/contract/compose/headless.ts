/*
 * Headless bindings: the service functions a read-only headless export shares with the running
 * service (preset codecs, theme admission, render jobs and the diagram producer). The native
 * render adapter loads lazily. The CLI's `runHeadless` catches a failed load, reports
 * `render-unavailable` and owns retry once dependencies are restored.
 */
import type { PresetCodecs, PresetContext } from '../records/presets/codecs.js';
import type { RenderResourceOwners } from '../records/rendering/resources.js';
import type { RenderJobs } from '../ports/render-jobs.js';
import type { DiagramProducer } from '../ports/rendering.js';
import { createPresetCodecs } from '../../core/presets/codecs.js';
import { prepareTheme } from '../../core/presets/theme-admission.js';
import { createRenderJobs } from '../../core/rendering/jobs.js';

/**
 * What headless export binds. `prepareTheme` keeps its core signature, whose font bindings have
 * no contract record.
 */
export interface HeadlessBindings {
  readonly createPresetCodecs: (context: PresetContext) => PresetCodecs;
  readonly prepareTheme: typeof prepareTheme;
  readonly createRenderJobs: (owners: RenderResourceOwners) => RenderJobs;
  readonly produceDiagram: DiagramProducer['produce'];
}

/**
 * Loads the native render adapter and returns the headless bindings. Rejects when the adapter
 * cannot load; the CLI's `runHeadless` reports that as `render-unavailable`.
 */
export async function createHeadlessBindings(): Promise<HeadlessBindings> {
  const rendering = await import('../../adapters/render-worker/derive.js');
  return {
    createPresetCodecs,
    prepareTheme,
    createRenderJobs,
    produceDiagram: rendering.produceDiagram,
  };
}
