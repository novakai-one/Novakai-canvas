/*
 * Browser-native bindings for the canvas surface: which elements keep their own input, which
 * diagram item has focus, and how the surface observes its size. Reads the DOM and holds no state.
 * The React effect that calls `observeSize` owns cleanup.
 */
import type { BrowserInput } from '../../contract/react-types.js';

/** Input ownership and focus, as the interactions read them. */
export const browserInput: BrowserInput = Object.freeze({ ownsNativeInput, focusedId });

/** Native observation is bound at browser composition, injectable at the surface; cleanup belongs to the React effect. */
export function observeSize(
  element: HTMLDivElement | null,
  resize: (width: number, height: number) => void,
): () => void {
  if (element === null) return () => undefined;
  const observer = new ResizeObserver((entries) => {
    const size = entries[0]?.contentRect;
    if (size) resize(size.width, size.height);
  });
  observer.observe(element);
  return () => observer.disconnect();
}

/** Browser-native controls and modal descendants retain their own keyboard/pointer gestures. */
function ownsNativeInput(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return (
    target.closest(
      'input,textarea,select,button,a,[contenteditable="true"],dialog,[role="dialog"],[aria-modal="true"]',
    ) !== null
  );
}
/** Browser focus carries an opaque React Flow ID; scene policy resolves it through its admitted index. */
function focusedId(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) return null;
  return target.closest('.react-flow__node, .react-flow__edge')?.getAttribute('data-id') ?? null;
}
