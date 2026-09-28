import { useRef, type ReactElement, type PointerEvent, type KeyboardEvent } from 'react';
import type { SidePanelProps } from '../../../contract/react-types.js';
import styles from './SidePanel.module.css';
interface DragOrigin {
  readonly pointer: number;
  readonly x: number;
  readonly width: number;
}
/** Controlled geometry is host-owned; gesture callbacks never move the canvas camera themselves. */
export function SidePanel(props: SidePanelProps): ReactElement {
  const drag = useRef<DragOrigin | null>(null);
  /** Capture one pointer; host owns committed width and persistence. */
  function start(event: PointerEvent<HTMLDivElement>): void {
    if (event.button !== 0) return;
    drag.current = { pointer: event.pointerId, x: event.clientX, width: props.width };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  /** A drag emits bounded widths; React ref mutation is confined to this pointer lifecycle. */
  function move(event: PointerEvent<HTMLDivElement>): void {
    const origin = drag.current;
    if (origin === null) return;
    emitDrag(origin, event, props);
  }
  /** Releasing capture ends this gesture without persisting an independent panel state. */
  function end(event: PointerEvent<HTMLDivElement>): void {
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  }
  /** Arrow/Home/End resizing follows the same bounded callback contract as pointer input. */
  function key(event: KeyboardEvent<HTMLDivElement>): void {
    const next = keyboardWidth(event.key, props);
    if (next === null) return;
    event.preventDefault();
    props.onResize(clamp(next, props));
  }
  return (
    <aside
      id={props.id}
      aria-label={props.label}
      className={styles.panel}
      style={{ width: props.width }}
      data-side={props.side}
    >
      {props.header}
      {props.body}
      <div
        role="separator"
        aria-label={'Resize ' + props.label}
        aria-orientation="vertical"
        aria-valuemin={props.minimum}
        aria-valuemax={props.maximum}
        aria-valuenow={props.width}
        aria-controls={props.id}
        tabIndex={0}
        className={styles.resize}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        onLostPointerCapture={() => {
          drag.current = null;
        }}
        onKeyDown={key}
      />
    </aside>
  );
}
/** Pointer direction mirrors the right edge; no click-triggered focus/fit behavior is introduced. */
function emitDrag(
  origin: DragOrigin,
  event: PointerEvent<HTMLDivElement>,
  props: SidePanelProps,
): void {
  if (event.pointerId !== origin.pointer) return;
  const direction = props.side === 'left' ? 1 : -1;
  props.onResize(clamp(origin.width + (event.clientX - origin.x) * direction, props));
}
/** Host supplied bounds are applied equally to keyboard and pointer movement. */
function clamp(
  width: number,
  props: Pick<SidePanelProps, 'minimum' | 'maximum'>,
): number {
  return Math.min(props.maximum, Math.max(props.minimum, width));
}
/** Named key table exposes interaction policy without nested conditional returns. */
function keyboardWidth(
  key: string,
  props: SidePanelProps,
): number | null {
  const direction = props.side === 'left' ? 1 : -1;
  const widths: Readonly<Record<string, number>> = {
    ArrowLeft: props.width - direction,
    ArrowRight: props.width + direction,
    Home: props.minimum,
    End: props.maximum,
  };
  return widths[key] ?? null;
}
