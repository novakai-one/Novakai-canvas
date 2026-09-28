/*
 * Why this file exists
 *
 * `pnpm render:png` draws a diagram with no service running ("headless"). Its picture must match
 * the service's, so it must use the service's own code for themes, render jobs and layout.
 *
 * This file hands that code to the CLI (`HeadlessBindings`). The compiled text-measuring and
 * layout code loads only when asked for. It only reads; it never saves anything.
 */
import type { HeadlessBindings } from '../ports/headless.js';
import { prepareTheme } from '../../core/presets/theme-admission.js';
import { createRenderJobs } from '../../core/rendering/jobs.js';
import { createPresetCodecs } from './capabilities.js';

/**
 * Loads the compiled layout code and hands over the shared service code. Throws if that code
 * can't load; the CLI reports that as `render-unavailable`.
 */
export async function createHeadlessBindings(): Promise<HeadlessBindings> {
  const compiledLayout = await import('../../adapters/render-worker/derive.js');
  return {
    createPresetCodecs,
    prepareTheme,
    createRenderJobs,
    produceDiagram: compiledLayout.produceDiagram,
  };
}
