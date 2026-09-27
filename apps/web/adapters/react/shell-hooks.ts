/*
 * The workspace shell's hooks: the controller's lifetime, Escape revealing a hidden interface, and
 * the alerts' height published on the canvas host. Composition binds them to the page and hands
 * them to the shell as one slot; they read no browser global. Not pure: each hook ties a
 * controller or page effect to a component's mount and undoes it on unmount. `start()` is not
 * awaited; the workspace session owns recovery from its failures and shows them in the problem bar.
 */
import { useEffect, useRef } from 'react';
import type { AlertClearance, ShellHooks, ShellPage } from '../../contract/react-types.js';
import type { WorkspaceController } from '../../contract/records/workspace.js';

/** Binds the shell's three hooks to the page's key events and size observer. */
export function createShellHooks(page: ShellPage): ShellHooks {
  return Object.freeze({
    useControllerLifetime,
    useRevealOnEscape: (hidden: boolean, reveal: () => void) =>
      useRevealOnEscape(page, hidden, reveal),
    useAlertClearance: () => useAlertClearance(page),
  });
}

/**
 * Starts the controller on mount and disposes it on unmount or when the controller changes.
 * A disposed controller's `start()` returns early, so a second run of this effect (as StrictMode
 * does) would leave the workspace stopped; apps/web does not use StrictMode.
 */
function useControllerLifetime(controller: Pick<WorkspaceController, 'start' | 'dispose'>): void {
  useEffect(() => {
    void controller.start();
    return controller.dispose;
  }, [controller]);
}

/** While the interface is hidden, Escape reveals it; the key's default action is prevented. */
function useRevealOnEscape(
  page: Pick<ShellPage, 'addEventListener' | 'removeEventListener'>,
  hidden: boolean,
  reveal: () => void,
): void {
  useEffect(() => {
    if (!hidden) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      reveal();
    };
    page.addEventListener('keydown', onKeyDown);
    return () => page.removeEventListener('keydown', onKeyDown);
  }, [page, hidden, reveal]);
}

/** Publishes the alerts' height as --nv-alert-clearance so scrolling views (the Library) can pad
 * their end and never hide their last item under an alert. */
function useAlertClearance(page: Pick<ShellPage, 'ResizeObserver'>): AlertClearance {
  const host = useRef<HTMLElement>(null);
  const alerts = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const box = alerts.current;
    const main = host.current;
    if (box === null || main === null) return undefined;
    const observer = new page.ResizeObserver(() => {
      main.style.setProperty('--nv-alert-clearance', `${box.offsetHeight}px`);
    });
    observer.observe(box);
    return () => observer.disconnect();
  }, [page]);
  return { host, alerts };
}
