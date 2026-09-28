import { validate } from '@novakai/canvas-model';
import { fontSet, resolvedStyle, visualAsset } from '@novakai/canvas-presentation';
import { options } from '@novakai/canvas-layout';
import { renderJobMessage } from '../../contract/records/rendering/worker.js';
import type { RenderingJob } from '../../contract/records/rendering/job.js';
import { failure, type Result } from '../../contract/errors.js';
/** Runtime worker decoding uses owner schemas before calling native providers; host owns correction/retry. */
export function readRenderingJob(input: unknown): Result<RenderingJob> {
  try {
    const raw = renderJobMessage.parse(input);
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
