/*
 * The Canvas's React boundary: the surface props a host passes, the render slots it composes, the
 * view data React Flow nodes and edges carry, and the owners the interactions are built from.
 * Declarations only; nothing to recover. The host repairs failures reported through `onError`.
 */
import type { ComponentType, ReactNode, KeyboardEvent, MouseEventHandler } from 'react';
import type { Node, Edge, NodeProps, EdgeProps, ReactFlowProps } from '@xyflow/react';
import type {
  NodeContentProps,
  MeasuredContentProps,
  MarkerProps,
  Paint,
} from '@novakai/canvas-presentation';
import type { Canvas } from './types.js';
import type { SessionStore, DragPreview } from './ports/session.js';
import type { SessionState } from './records/state.js';
import type {
  CanvasView,
  ViewNode,
  ViewSection,
  ViewWire,
  OutlineSection,
} from './records/view.js';
import type { CanvasEvent } from './events.js';
import type { Target } from './records/selection.js';
import type { DropTarget } from './records/intent.js';
import type { Point, Box } from './records/camera.js';
import type { Diagnostic, Result } from './errors.js';
import type { GestureId } from './brands.js';
export type SurfaceSession = Pick<
  SessionStore,
  | 'getSnapshot'
  | 'subscribe'
  | 'dispatch'
  | 'readPointer'
  | 'writePointer'
  | 'readPreview'
  | 'writePreview'
  | 'subscribePreview'
>;
export type ViewReader = Pick<Canvas, 'present' | 'describeAccessibility' | 'dropTarget'>;
/** Palette chips carry their object kind under this drag type. */
export const paletteType = 'application/x-novakai-kind';
/** An object type the user can drag from the palette onto the canvas. */
export interface PaletteItem {
  readonly kind: string;
  readonly label: string;
}
export interface ButtonProps {
  readonly label: string;
  readonly title?: string | undefined;
  readonly icon?: ReactNode;
  readonly iconOnly?: boolean;
  readonly onClick?: MouseEventHandler<HTMLButtonElement> | undefined;
  readonly disabled?: boolean | undefined;
  readonly selected?: boolean;
}
export type ControlIconName =
  | 'select'
  | 'hand'
  | 'connect'
  | 'minus'
  | 'plus'
  | 'outline'
  | 'fit'
  | 'reading'
  | 'previous'
  | 'next';
export interface CanvasChromeVisibility {
  readonly tools: boolean;
  readonly zoom: boolean;
  readonly minimap: boolean;
  readonly outline: boolean;
}
export interface ControlIconProps {
  readonly name: ControlIconName;
}
/** Required stable renderer slots keep diagram notation and design-system button policy out of Canvas. */
export interface RenderSlots {
  readonly FontDefinitions: ComponentType;
  readonly NodeContent: ComponentType<NodeContentProps>;
  readonly MeasuredContent: ComponentType<MeasuredContentProps>;
  readonly Marker: ComponentType<MarkerProps>;
  readonly Button: ComponentType<ButtonProps>;
}
export interface WireLabelProps {
  readonly wire: ViewWire['wire'];
  readonly zoom: number;
  readonly anchor: Point;
}
export interface TreeRowProps {
  readonly view: ViewNode;
  readonly actions: Pick<ViewActions, 'dispatch'>;
}
export interface RoutingRoadsProps {
  readonly sections: readonly ViewSection[];
}
export interface SurfaceProps {
  readonly showRoads?: boolean;
  /** Show every wire label, not only the selected wire's. */
  readonly showLabels?: boolean;
  readonly followsInterfaceRoles?: boolean;
  readonly session: SurfaceSession;
  readonly reader: ViewReader;
  /** Random text for each new gesture; Canvas parses it into a `GestureId` when the gesture begins. */
  readonly nextGestureId: () => string;
  readonly onError: (diagnostic: Diagnostic) => void;
  readonly paint: Paint;
  readonly label: string;
  readonly chrome?: CanvasChromeVisibility;
  /** Object types shown in the tool rail; dragging one onto the canvas calls `onPaletteDrop`. */
  readonly palette?: readonly PaletteItem[];
  readonly onPaletteDrop?: (kind: string, target: DropTarget) => void;
}
export interface ViewSnapshot {
  readonly state: SessionState;
  readonly view: CanvasView;
  readonly outline: readonly OutlineSection[];
}
export type UseScene = (session: SurfaceSession, reader: ViewReader) => Result<ViewSnapshot>;
/** View actions translate user gestures to typed events only; host drains/submits effects outside rendering. */
export interface ViewActions {
  dispatch(event: CanvasEvent): void;
  beginResize(target: Target): void;
  resize(
    target: Target,
    box: Box,
  ): void;
  finishGeometry(): void;
  cancelGeometry(): void;
  /** A new gesture's identity; see {@link NextGestureId}. */
  nextGestureId(): Result<GestureId>;
  /** Live drag offset; nodes and wires subscribe by id so a move re-renders only what moves. */
  readPreview(): DragPreview | null;
  subscribePreview(listener: () => void): () => void;
}
/** What a control that starts a gesture uses: dispatch and a new gesture ID. */
export type GestureActions = Pick<ViewActions, 'dispatch' | 'nextGestureId'>;
export interface NodeData extends Record<string, unknown> {
  readonly view: ViewNode;
  readonly actions: Pick<
    ViewActions,
    'beginResize' | 'resize' | 'finishGeometry' | 'dispatch' | 'readPreview' | 'subscribePreview'
  >;
  readonly editable: boolean;
  /** Containment depth (0 = top level); presentation tiers nested group floors by depth. */
  readonly depth?: number | undefined;
}
export interface SectionData extends Record<string, unknown> {
  readonly view: ViewSection;
  readonly actions: Pick<ViewActions, 'beginResize' | 'resize' | 'finishGeometry'>;
  readonly editable: boolean;
  readonly paint: Paint;
}
export interface EdgeData extends Record<string, unknown> {
  readonly view: ViewWire;
  /** A wire follows the live drag offset only. */
  readonly actions: Pick<ViewActions, 'readPreview' | 'subscribePreview'>;
  readonly editable: boolean;
  readonly paint: Paint;
  readonly nudge: number;
  readonly zoom: number;
  /** Labels toggle on: where this hidden label sits, section-local. */
  readonly hiddenLabel?: Box | undefined;
}
export type FlowNode = Node<NodeData, 'scene'> | Node<SectionData, 'section'>;
export type FlowEdge = Edge<EdgeData, 'scene'>;
export type SceneNodeProps = NodeProps<Node<NodeData, 'scene'>>;
export type SectionFrameProps = NodeProps<Node<SectionData, 'section'>>;
export type SceneEdgeProps = EdgeProps<FlowEdge> & {
  readonly type: 'scene';
  readonly data: EdgeData;
};
export interface ControlsProps {
  readonly snapshot: ViewSnapshot;
  readonly actions: Pick<ViewActions, 'dispatch'>;
  readonly outlineOpen: boolean;
  readonly onOutline: () => void;
  readonly visibility: CanvasChromeVisibility;
  readonly palette: readonly PaletteItem[];
}
export interface OutlineProps {
  readonly sections: readonly OutlineSection[];
  readonly actions: GestureActions;
  readonly editable: boolean;
}
export interface SequenceProps {
  readonly followsInterfaceRoles?: boolean;
  readonly sections: readonly ViewSection[];
  readonly nodes: readonly ViewNode[];
  readonly actions: Pick<ViewActions, 'dispatch'>;
  readonly paint: Paint;
}
export interface Interactions {
  readonly actions: ViewActions;
  readonly flow: Pick<
    ReactFlowProps<FlowNode, FlowEdge>,
    | 'onNodeDragStart'
    | 'onNodeDrag'
    | 'onNodeDragStop'
    | 'onSelectionDragStart'
    | 'onSelectionDrag'
    | 'onSelectionDragStop'
    | 'onNodeClick'
    | 'onNodeDoubleClick'
    | 'onNodeMouseEnter'
    | 'onNodeMouseLeave'
    | 'onEdgeClick'
    | 'onEdgeDoubleClick'
    | 'onEdgeMouseEnter'
    | 'onEdgeMouseLeave'
    | 'onPaneClick'
    | 'onNodesChange'
    | 'onEdgesChange'
    | 'onViewportChange'
    | 'onMoveStart'
    | 'onMoveEnd'
    | 'onConnect'
    | 'onConnectStart'
    | 'onConnectEnd'
    | 'onPaneMouseLeave'
  >;
  keyboard(event: KeyboardEvent<HTMLDivElement>): void;
}
export interface InteractionOwners {
  readonly session: Pick<
    SessionStore,
    | 'getSnapshot'
    | 'dispatch'
    | 'readPointer'
    | 'writePointer'
    | 'readPreview'
    | 'writePreview'
    | 'subscribePreview'
  >;
  readonly input: BrowserInput;
  readonly nextGestureId: NextGestureId;
  readonly onError: (diagnostic: Diagnostic) => void;
}
/**
 * A new gesture's identity, parsed from the host's text when the gesture begins. A refused text is
 * already reported to the host's `onError`; the caller only starts no gesture.
 */
export type NextGestureId = () => Result<GestureId>;
/** What the surface lends `createInteractions`: its session, gesture text and error sink. */
export type SurfaceHost = Pick<SurfaceProps, 'session' | 'nextGestureId' | 'onError'>;
export interface BrowserInput {
  ownsNativeInput(target: EventTarget | null): boolean;
  focusedId(target: EventTarget | null): string | null;
}
export type CreateInteractions = (host: SurfaceHost) => Interactions;
export type GraphSelector = (
  result: Result<ViewSnapshot>,
  actions: ViewActions,
  paint: Paint,
  showLabels: boolean,
) => { nodes: FlowNode[]; edges: FlowEdge[] };
export interface SurfaceSlots {
  readonly RoutingRoads: ComponentType<RoutingRoadsProps>;
  readonly FontDefinitions: ComponentType;
  readonly createGraphSelector: () => GraphSelector;
  readonly useScene: UseScene;
  readonly createInteractions: CreateInteractions;
  readonly observeSize: (
    element: HTMLDivElement | null,
    resize: (width: number, height: number) => void,
  ) => () => void;
  readonly SceneNode: ComponentType<SceneNodeProps>;
  readonly SceneEdge: ComponentType<SceneEdgeProps>;
  readonly SectionFrame: ComponentType<SectionFrameProps>;
  readonly CanvasControls: ComponentType<ControlsProps>;
  readonly DiagramOutline: ComponentType<OutlineProps>;
  readonly SequenceLayer: ComponentType<SequenceProps>;
}
export interface ReactBindings {
  readonly CanvasSurface: ComponentType<SurfaceProps>;
}
