/*
 * The host's undo/redo keybinding: platform modifier and Z, Shift for redo, never inside an
 * editable target, never on key repeat. The predicates are pure; the window binding is the only
 * effect.
 */

/** The host owns shortcuts even when all interface chrome is hidden. */
export function bindHistoryKeys(
  navigate: (direction: 'undo' | 'redo') => Promise<void>,
): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const handle = (event: KeyboardEvent): void => {
    const target = direction(event);
    if (target === null) return;
    event.preventDefault();
    if (!event.repeat) void navigate(target);
  };
  window.addEventListener('keydown', handle);
  return () => window.removeEventListener('keydown', handle);
}

/** The direction of a history key, or null when the event is not one or an editor owns it. */
function direction(event: KeyboardEvent): 'undo' | 'redo' | null {
  if (!historyKey(event) || editorOwns(event)) return null;
  return event.shiftKey ? 'redo' : 'undo';
}

/** Platform modifier and Z without Alt. */
function historyKey(event: KeyboardEvent): boolean {
  return (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z' && !event.altKey;
}

/** Keep browser editing shortcuts native, including composition and nested editable elements. */
function editorOwns(event: KeyboardEvent): boolean {
  if (event.defaultPrevented || event.isComposing) return true;
  return event.composedPath().some(editableTarget);
}

/** Inputs, textareas, selects and contentEditable elements own their keys. */
function editableTarget(target: EventTarget): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || target.matches('input, textarea, select'))
  );
}
