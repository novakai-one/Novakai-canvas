import { validateWireLabel } from '../scenes/validate.js';
import { targetInfo, targetKey } from '../scenes/address.js';
import { reject } from '../validation/outcomes.js';
import type { SessionState } from '../../contract/records/state.js';
import type { GeometryPreview, WireRoutePreview } from '../../contract/records/draft.js';
import { sameStamp } from '../scenes/accept.js';
import { handler, type Handler } from './handler.js';
import { changed } from './changes.js';
import { beginDraft } from '../drafts/begin.js';
import { activeDraft, moveDraft, resizeDraft, updateRoute } from '../drafts/update.js';
import { finishDraft } from '../drafts/finish.js';
import { rejectDraft, removeRecovery } from '../drafts/reconcile.js';
/** Draft lifecycle handlers return immutable previews/effects; none allocate a persistence request or revision. */
export function draftHandlers(): readonly Handler[] {
  return [
    handler('begin', (state, event) =>
      changed(state, {
        ...state,
        routePreview: null,
        hover: null,
        draft: beginDraft(state, event),
      }),
    ),
    handler('move', (state, event) => changed(state, { ...state, draft: moveDraft(state, event) })),
    handler('resize', (state, event) =>
      changed(state, { ...state, draft: resizeDraft(state, event) }),
    ),
    handler('route', (state, event) =>
      changed(state, { ...state, draft: updateRoute(state, event) }),
    ),
    handler('preview-routes', (state, event) => {
      const pending = state.recovery.find(
        (entry) => entry.draft.id === event.id && entry.reason === 'submitted',
      );
      if (!pending || !sameStamp(pending.draft.base, state.stamp)) return changed(state, state);
      event.wires.forEach((wire) => validatePreviewLabel(state, wire));
      validateGeometry(state, event);
      return changed(state, {
        ...state,
        routePreview: {
          gesture: event.id,
          bounds: event.bounds,
          wires: event.wires,
          boxes: event.boxes,
          sections: event.sections,
        },
      });
    }),
    handler('finish', (state, event) => finishDraft(state, event.id)),
    handler('cancel', (state, event) => {
      activeDraft(state, event.id);
      return changed(state, { ...state, draft: null });
    }),
    handler('reject', (state, event) =>
      changed(state, rejectDraft(state, event.id, event.message)),
    ),
    handler('confirmed', (state, event) => changed(state, removeRecovery(state, event.id))),
    handler('discard', (state, event) => changed(state, removeRecovery(state, event.id))),
  ];
}

/** Preview label bounds follow the admitted wire visibility, never a payload override. */
function validatePreviewLabel(
  state: SessionState,
  preview: WireRoutePreview,
): void {
  const source = state.scene.sections
    .find((section) => section.id === preview.section)
    ?.wires.find((wire) => wire.id === preview.id);
  if (!source) reject('invalid-input', preview.id, 'Preview wire is not in the admitted scene');
  if (
    source.source.node !== preview.source.node ||
    source.target.node !== preview.target.node ||
    source.source.member !== preview.source.member ||
    source.target.member !== preview.target.member
  )
    reject('invalid-input', preview.id, 'Preview must preserve semantic endpoints');
  validateWireLabel({ ...source, labelBox: preview.labelBox });
}

/** Release geometry is complete and identity-preserving; partial overlays cannot mix old/new frames. */
function validateGeometry(
  state: SessionState,
  preview: GeometryPreview,
): void {
  const expected = state.scene.sections.flatMap((section) => [
    targetKey({ kind: 'section', id: section.id }),
    ...section.nodes.map((node) => targetKey({ kind: 'node', section: section.id, id: node.id })),
  ]);
  const keys = preview.boxes.map((entry) => targetInfo(state.index, entry.target).key);
  if (
    keys.length !== expected.length ||
    new Set(keys).size !== expected.length ||
    expected.some((key) => !keys.includes(key))
  )
    reject('invalid-input', 'preview', 'Preview must include every node and section exactly once');
  const sections = new Set(
    preview.sections.map((entry) => targetInfo(state.index, { kind: 'section', id: entry.id }).key),
  );
  const wireIds = new Set(
    preview.wires.map((wire) => targetKey({ kind: 'wire', section: wire.section, id: wire.id })),
  );
  const wireCount = state.scene.sections.reduce((sum, section) => sum + section.wires.length, 0);
  if (
    sections.size !== state.scene.sections.length ||
    preview.sections.length !== sections.size ||
    wireIds.size !== wireCount ||
    preview.wires.length !== wireCount
  )
    reject('invalid-input', 'preview', 'Preview must include every origin and wire exactly once');
}
