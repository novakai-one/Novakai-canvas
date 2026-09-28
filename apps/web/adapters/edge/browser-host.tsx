import { createRoot } from 'react-dom/client';
import type { ComponentType } from 'react';
import type { WorkspaceProps } from '../../contract/react-types.js';
import type { WorkspaceController } from '../../contract/records/workspace.js';
import type { Result } from '../../contract/errors.js';
import { failure } from '../../contract/errors.js';
/** DOM ownership is explicit. React unmount releases subscriptions through component effect cleanup. */
export function mountWorkspace(
  element: HTMLElement,
  Workspace: ComponentType<WorkspaceProps>,
  controller: WorkspaceController,
): Result<{ dispose(): void }> {
  try {
    const root = createRoot(element);
    root.render(<Workspace controller={controller} />);
    return { ok: true, value: { dispose: () => root.unmount() } };
  } catch {
    return failure('mount-failed', 'Canvas could not mount its workspace');
  }
}
/** Actual viewport dimensions, not a breakpoint-derived estimate, determine the first collection fit. */
export function viewport(element: HTMLElement): {
  readonly width: number;
  readonly height: number;
} {
  const box = element.querySelector('[data-canvas-host]')?.getBoundingClientRect();
  return { width: box?.width ?? 1, height: box?.height ?? 1 };
}

/** ResizeObserver measures the actual app container, including an in-app browser panel being resized. */
export function observeWorkspaceWidth(
  element: HTMLElement,
  changed: (width: number) => void,
): () => void {
  const observer = new ResizeObserver((entries) => {
    const width = entries[0]?.contentRect.width;
    if (width !== undefined) changed(width);
  });
  observer.observe(element);
  return () => observer.disconnect();
}
