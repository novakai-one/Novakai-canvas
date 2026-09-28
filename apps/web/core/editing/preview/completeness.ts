/*
 * Verifying a complete movement preview: the whole captured target set appears exactly once.
 * Pure; Authoring owns commit and recovery.
 */
import type { RenderDocument } from '../../../contract/records/owners.js';
import type { Result } from '../../../contract/errors.js';
import { failure } from '../../../contract/errors.js';
import type { Box } from '../capture/boxes.js';
import { expectedKeys, indexCompletePreview } from './indexing.js';
import type { GeometryPreview } from './types.js';

/** The preview indexed by target key: every captured target, exactly once, boxes only. */
export function completePreview(
  document: RenderDocument,
  preview: GeometryPreview,
): Result<ReadonlyMap<string, Box>> {
  const expected = expectedKeys(document);
  const actual = indexCompletePreview(preview, expected);
  if (!actual.ok) return actual;
  return verifyComplete(actual.value, expected);
}

/** The whole captured set is present in the preview. */
function verifyComplete(
  actual: ReadonlyMap<string, Box>,
  expected: readonly string[],
): Result<ReadonlyMap<string, Box>> {
  const complete = actual.size === expected.length && expected.every((key) => actual.has(key));
  if (!complete) {
    return failure(
      'invalid-edit',
      'Movement preview did not preserve the complete captured target set',
    );
  }
  return { ok: true, value: actual };
}
