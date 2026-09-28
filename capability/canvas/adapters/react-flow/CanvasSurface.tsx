import { useMemo, useRef, useEffect, useState } from 'react';
import type { ComponentType, DragEvent, ReactElement } from 'react';
import { ReactFlow, MiniMap } from '@xyflow/react';
import type { NodeTypes, EdgeTypes } from '@xyflow/react';
import type {
  SurfaceProps,
  SurfaceSlots,
  FlowNode,
  FlowEdge,
  ViewSnapshot,
  ViewActions,
  CanvasChromeVisibility,
} from '../../contract/react-types.js';
import type { Result } from '../../contract/errors.js';
import type { DropTarget } from '../../contract/records/intent.js';
import type { Point } from '../../contract/records/camera.js';
import { paletteType } from '../../contract/react-types.js';
import styles from './CanvasSurface.module.css';
import themeStyles from './react-flow-theme.module.css';
/** Report a rejected view from an effect, never as a render-time side effect; host retains its last committed data. */
function reportView(
  result: Result<ViewSnapshot>,
  onError: SurfaceProps['onError'],
): void {
  if (!result.ok) onError(result.error);
}
/** Bind stable React Flow registries once. Host retains committed state/drafts and repairs reported rendering or measurement failures before remounting. */
export function createCanvasSurface(slots: SurfaceSlots): ComponentType<SurfaceProps> {
  const nodeTypes: NodeTypes = { scene: slots.SceneNode, section: slots.SectionFrame };
  const edgeTypes: EdgeTypes = { scene: slots.SceneEdge };
  const Fonts = slots.FontDefinitions;
  const Controls = slots.CanvasControls;
  const Outline = slots.DiagramOutline;
  const Sequence = slots.SequenceLayer;
  const Roads = slots.RoutingRoads;
  const defaultChrome: CanvasChromeVisibility = {
    tools: true,
    zoom: true,
    minimap: true,
    outline: true,
  };
  /** Surface is controlled by Canvas session; native gestures never write React Flow data directly to storage. */
  function CanvasSurface(props: SurfaceProps): ReactElement {
    const result = slots.useScene(props.session, props.reader);
    const interactions = useMemo(
      () => slots.createInteractions(props),
      [props.session, props.nextGestureId, props.onError],
    );
    const ref = useRef<HTMLDivElement>(null);
    const [outlineOpen, setOutlineOpen] = useState(false);
    const [pointer, setPointer] = useState<'fineThreshold' | 'coarseThreshold'>('fineThreshold');
    useEffect(() => reportView(result, props.onError), [result, props.onError]);
    useEffect(
      () =>
        slots.observeSize(ref.current, (width, height) =>
          dispatchSize(interactions.actions, width, height),
        ),
      [interactions.actions],
    );
    const selectGraph = useMemo(() => slots.createGraphSelector(), []);
    const graph = useMemo(
      () => selectGraph(result, interactions.actions, props.paint, props.showLabels === true),
      [selectGraph, result, interactions.actions, props.paint, props.showLabels],
    );
    if (!result.ok) return <div role="alert">Canvas unavailable: {result.error.message}</div>;
    const snapshot = result.value;
    const chrome = props.chrome ?? defaultChrome;
    const controlsVisible = chrome.tools || chrome.zoom || chrome.outline;
    const hand = snapshot.view.tool === 'hand';
    const energized =
      snapshot.view.nodes.some((node) => node.emphasis === 'primary') ||
      snapshot.view.wires.some((wire) => wire.emphasis === 'primary');
    return (
      <div
        ref={ref}
        className={`${styles.surface} ${themeStyles.theme}`}
        role="region"
        aria-label={props.label}
        tabIndex={0}
        data-zoom-tier={snapshot.view.detail}
        data-follows-interface-roles={props.followsInterfaceRoles === true}
        onKeyDown={interactions.keyboard}
        onPointerCancel={interactions.actions.cancelGeometry}
        onPointerDownCapture={(event) => setPointer(pointerThreshold(event.pointerType))}
        onDragOver={acceptPalette}
        onDrop={(event) => dropPalette(event, snapshot, props)}
      >
        <Fonts />
        <ReactFlow<FlowNode, FlowEdge>
          nodes={graph.nodes}
          edges={graph.edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          viewport={snapshot.view.camera}
          {...interactions.flow}
          onError={(code, message) =>
            props.onError({
              code: 'provider-failure',
              path: `react-flow.${code}`,
              targets: [],
              message,
              recovery: 'Host retains committed data and repairs the Canvas binding.',
            })
          }
          fitView={false}
          minZoom={snapshot.state.profile.zoomMin}
          maxZoom={snapshot.state.profile.zoomMax}
          panOnScroll
          zoomOnScroll={false}
          zoomOnPinch
          zoomOnDoubleClick={false}
          panOnDrag={panButtons(hand, snapshot.state.profile.blankDrag)}
          panActivationKeyCode="Space"
          selectionOnDrag={snapshot.state.profile.blankDrag === 'marquee'}
          selectionKeyCode="Shift"
          multiSelectionKeyCode="Shift"
          deleteKeyCode={null}
          disableKeyboardA11y
          elevateEdgesOnSelect
          nodeDragThreshold={snapshot.state.profile[pointer]}
          nodeClickDistance={snapshot.state.profile.fineThreshold}
          onlyRenderVisibleElements
        >
          {chrome.minimap && (
            <MiniMap
              pannable
              zoomable
              ariaLabel="Collection minimap"
              nodeColor={(node) => minimapColor(node as FlowNode)}
            />
          )}
          {props.showRoads && <Roads sections={snapshot.view.sections} />}
          <Sequence
            followsInterfaceRoles={props.followsInterfaceRoles === true}
            sections={snapshot.view.sections}
            nodes={snapshot.view.nodes}
            actions={interactions.actions}
            paint={props.paint}
          />
        </ReactFlow>
        <div aria-hidden="true" className={styles.vignette} data-active={energized} />
        {controlsVisible && (
          <Controls
            snapshot={snapshot}
            actions={interactions.actions}
            outlineOpen={outlineOpen}
            onOutline={() => setOutlineOpen((value) => !value)}
            visibility={chrome}
            palette={props.onPaletteDrop === undefined ? [] : (props.palette ?? [])}
          />
        )}
        {outlineOpen && chrome.outline && (
          <Outline
            sections={snapshot.outline}
            actions={interactions.actions}
            editable={snapshot.view.editable}
          />
        )}
      </div>
    );
  }
  return CanvasSurface;
}
/** Hidden/zero-sized elements cannot supply a valid camera viewport; wait for their next visible measurement. */
function dispatchSize(
  actions: Pick<ViewActions, 'dispatch'>,
  width: number,
  height: number,
): void {
  if (width <= 0 || height <= 0) return;
  actions.dispatch({ kind: 'resize-viewport', viewport: { width, height } });
}

/** Minimap nodes carry their role color so the overview map encodes meaning, not just geometry. */
function minimapColor(node: FlowNode): string {
  if (node.type === 'section') return 'var(--nv-canvas-group-boundary)';
  const measured = node.data.view.placed.measured;
  if (measured.groupId !== null) return 'var(--nv-canvas-group-boundary)';
  return minimapRoleColor(measured.role);
}

/** Neutral nodes stay quiet; authored roles keep their shared palette color. */
function minimapRoleColor(role: string): string {
  if (role === 'neutral') return 'var(--nv-canvas-constellation-wire)';
  return `var(--nv-role-${role}-fill, var(--nv-canvas-constellation-wire))`;
}

/** Touch input uses the coarse threshold; mouse and pen retain precise manipulation. */
function pointerThreshold(type: string): 'coarseThreshold' | 'fineThreshold' {
  return type === 'touch' ? 'coarseThreshold' : 'fineThreshold';
}
/** Hand tool pans with any button. Otherwise the middle button pans, plus the left one when blank drag pans. Space+drag always pans. */
function panButtons(
  hand: boolean,
  blankDrag: 'pan' | 'marquee',
): boolean | number[] {
  if (hand) return true;
  return blankDrag === 'pan' ? [0, 1] : [1];
}
function acceptPalette(event: DragEvent<HTMLDivElement>): void {
  if (!event.dataTransfer.types.includes(paletteType) || onControls(event)) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'copy';
}
/** Screen point → world point → the group or section there → host creates the object. */
function dropPalette(
  event: DragEvent<HTMLDivElement>,
  snapshot: ViewSnapshot,
  props: SurfaceProps,
): void {
  const kind = event.dataTransfer.getData(paletteType);
  const drop = props.onPaletteDrop;
  if (kind === '' || drop === undefined || onControls(event)) return;
  event.preventDefault();
  const target = props.reader.dropTarget(snapshot.state, worldPoint(event, snapshot));
  deliver(target, (value) => drop(kind, value), props.onError);
}
/** A drop onto the tool rail, zoom controls or outline is not a drop onto the canvas. */
function onControls(event: DragEvent<HTMLDivElement>): boolean {
  return event.target instanceof Element && event.target.closest('[data-canvas-controls]') !== null;
}
function worldPoint(
  event: DragEvent<HTMLDivElement>,
  snapshot: ViewSnapshot,
): Point {
  const frame = event.currentTarget.getBoundingClientRect();
  const camera = snapshot.view.camera;
  return {
    x: (event.clientX - frame.left - camera.x) / camera.zoom,
    y: (event.clientY - frame.top - camera.y) / camera.zoom,
  };
}
function deliver(
  result: Result<DropTarget | null>,
  onTarget: (target: DropTarget) => void,
  onError: SurfaceProps['onError'],
): void {
  if (!result.ok) return onError(result.error);
  if (result.value !== null) onTarget(result.value);
}
