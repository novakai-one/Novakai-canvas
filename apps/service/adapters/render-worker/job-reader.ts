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
import type { z } from 'zod';
import { validate } from '@novakai/canvas-model';
import { fontSet, resolvedStyle, visualAsset } from '@novakai/canvas-presentation';
import { options } from '@novakai/canvas-layout';
import { renderJobMessage } from '../../contract/records/rendering/worker.js';
import type { RenderingJob } from '../../contract/records/rendering/job.js';
import { failure, success, type Result } from '../../contract/errors.js';

/** A job message whose outer shape was checked; every part inside is still unchecked. */
type JobMessage = z.infer<typeof renderJobMessage>;

/**
 * Checks one job message and answers it as a `RenderingJob` the worker can draw. Fails with
 * `invalid-input` at `collection` when Model refuses the collection, and at `render-job` when
 * any other part is malformed.
 */
export function readRenderingJob(message: unknown): Result<RenderingJob> {
  try {
    return checkJobMessage(message);
  } catch {
    return malformedJobFailure();
  }
}

/**
 * Checks the message's outer shape, has Model check the collection, then checks the other parts.
 * Throws when the outer shape or another part is malformed.
 */
function checkJobMessage(message: unknown): Result<RenderingJob> {
  const jobMessage = renderJobMessage.parse(message);
  const collection = validate(jobMessage.collection);
  if (!collection.ok) {
    return invalidCollectionFailure();
  }
  const job = buildCheckedJob(jobMessage, collection.value);
  return success(job);
}

/**
 * Builds the job, with Presentation checking its fonts, style and images and Layout its options.
 * Throws when one is malformed.
 */
function buildCheckedJob(
  jobMessage: JobMessage,
  collection: RenderingJob['collection'],
): RenderingJob {
  return {
    ...jobMessage,
    collection,
    fonts: fontSet.parse(jobMessage.fonts),
    style: resolvedStyle.parse(jobMessage.style),
    assets: jobMessage.assets.map((asset) => visualAsset.parse(asset)),
    options: options.parse(jobMessage.options),
  };
}

/** Makes the mistake for a collection Model refused. */
function invalidCollectionFailure(): Result<never> {
  return failure('invalid-input', 'collection', 'Rendering collection is invalid');
}

/** Makes the mistake for a job whose outer shape, fonts, style, images or options are malformed. */
function malformedJobFailure(): Result<never> {
  return failure(
    'invalid-input',
    'render-job',
    'Rendering job contains invalid resource or geometry input',
  );
}
