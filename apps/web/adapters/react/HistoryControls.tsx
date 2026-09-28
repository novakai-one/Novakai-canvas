import { useSyncExternalStore } from 'react';
import type { ComponentType, ReactElement } from 'react';
import type { HeaderProps, DesignSlots } from '../../contract/react-types.js';
import type { HistoryAction } from '@novakai/canvas-authoring';
type HistoryProps = Pick<HeaderProps, 'controller' | 'view'>;
function describe(
  verb: string,
  action: HistoryAction | null,
): string {
  if (action === null) return `${verb}: no available action`;
  const affected = action.collections.join(', ') || 'workspace';
  return `${verb} ${action.label} — ${action.actor.kind} ${action.actor.id} — ${affected}`;
}
const subscribeIdle = () => () => undefined;
const idle = () => false;
/** Shared buttons use the existing theme; toolbar and keys invoke the same gated controller operation. */
export function createHistoryControls({
  Button,
}: Pick<DesignSlots, 'Button'>): ComponentType<HistoryProps> {
  function HistoryControls({ controller, view }: HistoryProps): ReactElement {
    const session = view.active?.session;
    const gesture = useSyncExternalStore(
      session?.subscribe ?? subscribeIdle,
      session ? () => session.getSnapshot().draft !== null : idle,
    );
    const blocked =
      !view.connected ||
      view.history?.busy ||
      gesture ||
      view.pending.some((item) => item.state !== 'rejected');
    const status = view.history?.status;
    const undo = status?.undo ?? null;
    const redo = status?.redo ?? null;
    return (
      <>
        <Button
          label="Undo"
          title={describe('Undo', undo)}
          aria-keyshortcuts="Meta+Z Control+Z"
          disabled={Boolean(blocked) || undo === null}
          onClick={() => void controller.navigateHistory('undo')}
        />
        <Button
          label="Redo"
          title={describe('Redo', redo)}
          aria-keyshortcuts="Meta+Shift+Z Control+Shift+Z"
          disabled={Boolean(blocked) || redo === null}
          onClick={() => void controller.navigateHistory('redo')}
        />
      </>
    );
  }
  return HistoryControls;
}
