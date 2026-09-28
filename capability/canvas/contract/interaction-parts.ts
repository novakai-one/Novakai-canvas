/*
 * The parts `createInteractions` is built from: the geometry gestures and the keyboard commands.
 * Types only. The composition root (`compose.ts`) hands the adapter factories to
 * `createInteractions`, because one adapter never imports another. The host owns recovery of every
 * failure a part reports through `dispatch`.
 */
import type { KeyboardEvent } from 'react';
import type { BrowserInput, FlowNode, InteractionOwners, ViewActions } from './react-types.js';
import type { SessionStore } from './ports/session.js';
import type { Target } from './records/selection.js';

/** The adapter factories `createInteractions` composes; `compose.ts` supplies them. */
export interface InteractionParts {
  readonly createGeometryGestures: (context: GeometryContext) => GeometryGestures;
  readonly createKeyboardCommands: (context: KeyboardContext) => KeyboardCommand;
}

/** Why hover is paused. React Flow owns the drag, pan and connect lifecycles. */
export type HoverPause = 'drag' | 'pan' | 'connect';

/** What `createInteractions` lends every part. */
interface PartContext {
  /** Dispatches to the session; typed failures and diagnostics go to the host's `onError`. */
  readonly dispatch: ViewActions['dispatch'];
  /** True when both targets name the same diagram item. */
  readonly sameTarget: (left: Target, right: Target) => boolean;
}

/** What the drag and resize gestures read and write. */
export interface GeometryContext extends PartContext {
  readonly owners: Pick<InteractionOwners, 'nextGestureId'> & {
    readonly session: Pick<
      SessionStore,
      'getSnapshot' | 'readPointer' | 'writePointer' | 'readPreview' | 'writePreview'
    >;
    readonly input: Pick<BrowserInput, 'ownsNativeInput'>;
  };
  /** Pauses hover while a drag runs; `resumeHover` lifts the same pause. */
  readonly suppressHover: (reason: HoverPause) => void;
  readonly resumeHover: (reason: HoverPause) => void;
}

/** Drag and resize handlers. Resize, release and cancel are also the view's geometry actions. */
export interface GeometryGestures extends Pick<
  ViewActions,
  'beginResize' | 'resize' | 'finishGeometry' | 'cancelGeometry'
> {
  startDrag(
    event: MouseEvent | TouchEvent,
    node: FlowNode,
    nodes: readonly FlowNode[],
  ): void;
  moveDrag(
    event: MouseEvent | TouchEvent,
    node: FlowNode,
  ): void;
}

/** What the keyboard commands read. */
export interface KeyboardContext extends PartContext {
  readonly owners: Pick<InteractionOwners, 'nextGestureId' | 'input'> & {
    readonly session: Pick<SessionStore, 'getSnapshot'>;
  };
}

/** Turns one key press on the canvas into Canvas events. */
export type KeyboardCommand = (event: KeyboardEvent<HTMLDivElement>) => void;
