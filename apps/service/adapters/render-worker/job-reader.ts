/*
 * Why this file exists
 *
 * A render job reaches the worker thread as a plain message, so nothing in it can be trusted yet.
 * For example, the job's collection could be missing a field, or its font list could be malformed.
 *
 * This file checks one job message before the worker draws it. Model checks the collection;
 * Presentation checks the fonts, style and images; Layout checks the layout options. It never
 * draws, and never fixes a bad job: the mistake goes back to the server.
 */
import { validate } from '@novakai/canvas-model';
import { fontSet, resolvedStyle, visualAsset } from '@novakai/canvas-presentation';
import { options } from '@novakai/canvas-layout';
import { renderJobMessage } from '../../contract/records/rendering/worker.js';
import type { RenderingJob } from '../../contract/records/rendering/job.js';
import { failure, type Result } from '../../contract/errors.js';
/**
 * Checks one job message and answers it as a `RenderingJob` the worker can draw. Fails with
 * `invalid-input` at `collection` when Model refuses the collection, and at `render-job` when
 * any other part is malformed.
 */
export function readRenderingJob(message: unknown): Result<RenderingJob> {
  try {
    const raw = renderJobMessage.parse(message);
    const collection = validate(raw.collection);
    if (!collection.ok)
      return failure('invalid-input', 'collection', 'Rendering collection is invalid');
    return {
      ok: true,
      value: {
        ...raw,
        collection: collection.value,
        fonts: fontSet.parse(raw.fonts),
        style: resolvedStyle.parse(raw.style),
        assets: raw.assets.map((asset) => visualAsset.parse(asset)),
        options: options.parse(raw.options),
      },
    };
  } catch {
    return failure(
      'invalid-input',
      'render-job',
      'Rendering job contains invalid resource or geometry input',
    );
  }
}
