/*
 * Keying a movement preview by target: the keys a document expects, and a preview's boxes
 * indexed with unexpected or duplicate keys rejected. Pure.
 */
import type { RenderDocument } from '../../../contract/records/owners.js';
import type { Result } from '../../../contract/errors.js';
import { failure } from '../../../contract/errors.js';
import { targetKey, type Box } from '../capture/boxes.js';
import { mapResults } from '../results.js';
import type { GeometryPreview, PreviewBox } from './types.js';

/** Every scene section key and every scene node key. */
export function expectedKeys(document: RenderDocument): readonly string[] {
  const sections = document.scene.sections.map((section) =>
    targetKey({ kind: 'section', id: section.id }),
  );
  const nodes = document.scene.sections.flatMap((section) =>
    section.nodes.map((node) => targetKey({ kind: 'node', section: section.id, id: node.id })),
  );
  return [...sections, ...nodes];
}

/** The preview keyed by target; unexpected or duplicate keys are rejected. */
export function indexCompletePreview(
  preview: GeometryPreview,
  expected: readonly string[],
): Result<ReadonlyMap<string, Box>> {
  const entries = mapResults(preview.boxes, (item) => completeEntry(expected, item));
  if (!entries.ok) return entries;
  return uniqueKeys(entries.value);
}

/** The preview keyed by target, keeping each target's identity. */
export function indexMovePreview(
  preview: GeometryPreview,
): Result<ReadonlyMap<string, PreviewBox>> {
  const entries = mapResults(preview.boxes, movePreviewEntry);
  if (!entries.ok) return entries;
  const keyed = uniqueKeys(entries.value);
  return keyed;
}

/** One expected preview entry as a key/box pair. */
function completeEntry(
  expected: readonly string[],
  item: PreviewBox,
): Result<readonly [string, Box]> {
  const key = targetKey(item.target);
  if (!expected.includes(key)) {
    return failure(
      'invalid-edit',
      'Movement preview contains an unexpected or duplicate geometry target',
    );
  }
  return { ok: true, value: [key, item.box] };
}

/** One preview entry as a key/box pair. */
function movePreviewEntry(item: PreviewBox): Result<readonly [string, PreviewBox]> {
  return { ok: true, value: [targetKey(item.target), item] };
}

/** The entries as a map; a repeated key is rejected. */
function uniqueKeys<V>(entries: readonly (readonly [string, V])[]): Result<ReadonlyMap<string, V>> {
  const keys = entries.map(([key]) => key);
  if (new Set(keys).size !== keys.length) {
    return failure(
      'invalid-edit',
      'Movement preview contains an unexpected or duplicate geometry target',
    );
  }
  return { ok: true, value: new Map(entries) };
}
