import { useSyncExternalStore } from 'react';
import type { ReactElement } from 'react';
import type { EventOf, NodeTarget, SessionState } from '@novakai/canvas-canvas';
import type { FeatureProps } from '../../contract/react-types.js';
import styles from './Navigation.module.css';
/** The outline shows canonical objects independently of how often they appear on canvas. Clicking a row selects and locates that object on the canvas. */
export function ObjectOutline({ view }: FeatureProps): ReactElement {
  const session = view.active?.session ?? null;
  const state = useSyncExternalStore(
    session?.subscribe ?? emptySubscribe,
    session?.getSnapshot ?? emptySnapshot,
  );
  return (
    <ul className={styles.list}>
      {view.active?.document.collection.objects.map((object) => {
        const targets = objectNodes(view, object.id);
        const selected =
          state !== null && targets.some((target) => isSelected(state.selection, target));
        return (
          <li key={object.id}>
            <button
              type="button"
              className={styles.row}
              disabled={targets.length === 0}
              aria-current={selected ? 'true' : undefined}
              onClick={() => selectAndLocate(view, object.id)}
            >
              <span>{object.label}</span>
              <small>{object.kind}</small>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
/**
 * Selects the object's node and centers the camera on it at the current zoom, like Locate. An
 * object shown in several diagrams has one node per diagram; each repeat click moves to the next
 * one. An object with no node on the canvas does nothing.
 */
function selectAndLocate(
  view: FeatureProps['view'],
  objectId: string,
): void {
  const session = view.active?.session;
  const targets = objectNodes(view, objectId);
  if (session === undefined || targets.length === 0) return;
  const selection = session.getSnapshot().selection;
  const current = targets.findIndex((target) => isSelected(selection, target));
  const next = targets[(current + 1) % targets.length];
  if (next === undefined) return;
  const select: EventOf<'select'> = { kind: 'select', targets: [next], mode: 'replace' };
  const locate: EventOf<'locate'> = { kind: 'locate', target: next };
  session.dispatch(select);
  session.dispatch(locate);
}
/** Returns every scene node that shows the object, in diagram order; empty when it is not on the canvas. */
function objectNodes(
  view: FeatureProps['view'],
  objectId: string,
): readonly NodeTarget[] {
  if (view.active === null) return [];
  return view.active.document.scene.sections
    .flatMap((section) => section.nodes.map((node) => ({ section: section.id, node })))
    .filter((item) => item.node.measured.objectId === objectId)
    .map((item): NodeTarget => ({ kind: 'node', section: item.section, id: item.node.id }));
}
/** Returns whether the canvas selection includes this node. */
function isSelected(
  selection: SessionState['selection'],
  target: NodeTarget,
): boolean {
  return selection.some(
    (item) => item.kind === 'node' && item.section === target.section && item.id === target.id,
  );
}
/** Initial collection loading has no Canvas subscription or fabricated selection. */
function emptySubscribe(): () => void {
  return () => undefined;
}
/** Stable empty snapshot keeps React hook order while the first collection loads. */
function emptySnapshot(): null {
  return null;
}
