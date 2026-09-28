/*
 * Headless bindings: the service functions a read-only headless export shares with the running
 * service (preset codecs, theme admission, render jobs and the diagram producer). The native
 * render adapter loads lazily. The CLI's `runHeadless` catches a failed load, reports
 * `render-unavailable` and owns retry once dependencies are restored.
 */
import type { HeadlessBindings } from '../ports/headless.js';
import { prepareTheme } from '../../core/presets/theme-admission.js';
import { createRenderJobs } from '../../core/rendering/jobs.js';
import { createPresetCodecs } from './capabilities.js';

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
