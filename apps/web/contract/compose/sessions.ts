/*
 * The retained form sessions: object forms and wire forms share the browser draft lifecycle;
 * feature policy owns command replay.
 */
import type { InspectorBindings, InspectorSession } from '../records/inspector.js';
import type { WireEditorBindings, WireEditorSession } from '../records/wire-editor.js';
import { createRetainedEditor } from '../../adapters/sessions/retained-editor.js';
import {
  editedObject,
  encodeObjectRecovery,
  encodeWireRecovery,
  retainObjectCommand,
  retainWireCommand,
  wireChanges,
} from '../api.js';

/** Object forms reuse the browser draft lifecycle; feature policy owns command replay. */
export function createInspectorSession(bindings: InspectorBindings): InspectorSession {
  return createRetainedEditor({
    ...bindings,
    slot: 'inspector',
    encode: encodeObjectRecovery,
    edit: retainObjectCommand,
    apply: (draft) => bindings.apply(draft, editedObject(draft)),
  });
}

/** Wire forms reuse the same retention/acknowledgement policy with section-scoped identities. */
export function createWireSession(bindings: WireEditorBindings): WireEditorSession {
  return createRetainedEditor({
    ...bindings,
    slot: 'wire-inspector',
    encode: encodeWireRecovery,
    edit: retainWireCommand,
    apply: (draft) => bindings.apply(draft, wireChanges(draft)),
  });
}
