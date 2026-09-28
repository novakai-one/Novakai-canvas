/*
 * Keyboard commands on the React Flow canvas: arrow keys, Enter, Delete, Backspace and Escape
 * become one `keyboard` event for the focused diagram item. Not pure: it reads the session and
 * stops the browser default for those keys. The host drains effects and owns recovery.
 */
import type { KeyboardEvent } from 'react';
import type { KeyboardCommand, KeyboardContext } from '../../contract/interaction-parts.js';
import type { BrowserInput } from '../../contract/react-types.js';
import type { Target } from '../../contract/records/selection.js';
import type { SessionState } from '../../contract/records/state.js';

/** Canvas handles only its documented key vocabulary; global browser and text-editor shortcuts remain native. */
export function createKeyboardCommands(context: KeyboardContext): KeyboardCommand {
  const { owners, dispatch } = context;
  return function keyboard(event) {
    if (!handlesKey(event, owners.input)) return;
    const issued = owners.nextGestureId();
    if (!issued.ok) return;
    event.preventDefault();
    focusKeyboardTarget(context, event.target);
    dispatch({
      kind: 'keyboard',
      id: issued.value,
      key: event.key,
      alt: event.altKey,
      shift: event.shiftKey,
      typing: false,
      modal: false,
    });
  };
}

/** The keys the canvas handles; every other key stays with the browser. */
const canvasKeys: ReadonlySet<string> = new Set([
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Enter',
  'Delete',
  'Backspace',
  'Escape',
]);

/** True for a canvas key that no earlier handler took and that was not typed into a native control. */
function handlesKey(
  event: KeyboardEvent<HTMLDivElement>,
  input: Pick<BrowserInput, 'ownsNativeInput'>,
): boolean {
  if (event.defaultPrevented || input.ownsNativeInput(event.target)) return false;
  return canvasKeys.has(event.key);
}

/** Keyboard commands follow the focused diagram item; an already-selected item preserves its multi-selection. */
function focusKeyboardTarget(
  context: KeyboardContext,
  element: EventTarget | null,
): void {
  const state = context.owners.session.getSnapshot();
  const target = keyboardTarget(state, context.owners.input.focusedId(element));
  if (!target) return;
  const selected = state.selection.some((item) => context.sameTarget(item, target));
  if (selected) return;
  context.dispatch({ kind: 'select', targets: [target], mode: 'replace' });
}

/** Resolve browser focus against the admitted index; controls outside graph items have no implicit target. */
function keyboardTarget(
  state: SessionState,
  id: string | null,
): Target | undefined {
  if (!id) return undefined;
  return state.index.targets[id]?.target;
}
