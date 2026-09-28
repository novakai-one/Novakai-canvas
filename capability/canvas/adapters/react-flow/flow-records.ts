import type {
  GraphSelector,
  ViewSnapshot,
  ViewActions,
  SurfaceProps,
  FlowNode,
  FlowEdge,
} from '../../contract/react-types.js';
import { hiddenLabelBoxes } from '@novakai/canvas-layout';
import type { Result } from '../../contract/errors.js';
import type { ViewNode } from '../../contract/records/view.js';
import type { Box } from '../../contract/records/camera.js';
/** Group interiors belong to the camera; only their explicit boundary hit surface receives input. */
function nodeSurfaceStyle(view: ViewNode): NonNullable<FlowNode['style']> {
  return {
    width: view.box.width,
    height: view.box.height,
    pointerEvents: view.placed.measured.groupId === null ? 'auto' : 'none',
  };
}
/** Containment depth per node, memoized along the parent chain; admitted acyclic references guarantee progress. */
function depthMap(views: readonly ViewNode[]): ReadonlyMap<string, number> {
  const parents = new Map(views.map((view) => [view.id, view.parentId]));
  const memo = new Map<string, number>();
  const depth = (id: string, seen: ReadonlySet<string>): number => {
    const cached = memo.get(id);
    if (cached !== undefined) return cached;
    const parent = parents.get(id);
    if (parent === undefined || seen.has(id)) {
      memo.set(id, 0);
      return 0;
    }
    const value = depth(parent, new Set(seen).add(id)) + 1;
    memo.set(id, value);
    return value;
  };
  views.forEach((view) => depth(view.id, new Set()));
  return memo;
}
/** Convert admitted node/section views to controlled React Flow records; generated JSON never leaves this adapter. */
function flowNodes(
  snapshot: ViewSnapshot,
  actions: ViewActions,
  paint: SurfaceProps['paint'],
): FlowNode[] {
  const depths = depthMap(snapshot.view.nodes);
  const sections: FlowNode[] = snapshot.view.sections.map((view) => ({
    id: view.id,
    type: 'section',
    position: view.position,
    width: view.box.width,
    height: view.box.height,
    measured: { width: view.box.width, height: view.box.height },
    style: { width: view.box.width, height: view.box.height, pointerEvents: 'none' },
    data: {
      view,
      actions,
      editable: snapshot.view.editable,
      paint,
    },
    selected: view.selected,
    dragHandle: '.section-drag-handle',
    draggable: snapshot.view.editable && snapshot.view.tool === 'select',
    selectable: true,
    zIndex: -1,
  }));
  const nodes: FlowNode[] = snapshot.view.nodes.map((view) => ({
    id: view.id,
    type: 'scene',
    parentId: view.parentId,
    position: view.position,
    width: view.box.width,
    height: view.box.height,
    measured: { width: view.box.width, height: view.box.height },
    style: nodeSurfaceStyle(view),
    data: {
      view,
      actions,
      editable: snapshot.view.editable && view.tree === undefined,
      depth: depths.get(view.id) ?? 0,
    },
    selected: view.selected,
    hidden: view.hidden,
    draggable: [
      snapshot.view.editable,
      snapshot.view.tool === 'select',
      view.tree === undefined,
    ].every(Boolean),
    selectable: true,
    connectable:
      snapshot.view.editable && snapshot.view.tool === 'connect' && view.tree === undefined,
    zIndex: 1,
  }));
  return [...sections, ...parentOrder(nodes)];
}
/** React Flow requires parents before their children; admitted acyclic references guarantee progress. */
function parentOrder(nodes: readonly FlowNode[]): FlowNode[] {
  const pending = new Map(nodes.map((node) => [node.id, node]));
  const result: FlowNode[] = [];
  while (pending.size > 0) {
    const ready = [...pending.values()].filter((node) => !pending.has(node.parentId ?? ''));
    ready.forEach((node) => {
      result.push(node);
      pending.delete(node.id);
    });
  }
  return result;
}
/** One placement pass per section, so shown labels never sit on each other. */
function hiddenLabels(snapshot: ViewSnapshot): ReadonlyMap<string, Box> {
  return new Map(
    snapshot.view.sections.flatMap((item) => {
      const wires = snapshot.view.wires.filter(
        (view) => view.target.kind === 'wire' && view.target.section === item.section.id,
      );
      const boxes = hiddenLabelBoxes(
        wires.map((view) => view.wire),
        item.section.nodes,
      );
      return wires.flatMap((view) => {
        const box = boxes.get(view.wire.id);
        return box === undefined ? [] : [[view.id, box] as const];
      });
    }),
  );
}
/** Edges preserve supplied labels/markers/routes and their scene scope; no routing algorithm runs here. */
function flowEdges(
  snapshot: ViewSnapshot,
  actions: ViewActions,
  paint: SurfaceProps['paint'],
  showLabels: boolean,
): FlowEdge[] {
  const labels = showLabels ? hiddenLabels(snapshot) : new Map<string, Box>();
  return snapshot.view.wires.map((view) => ({
    id: view.id,
    type: 'scene',
    source: view.sourceId,
    target: view.targetId,
    data: {
      view,
      actions,
      editable: snapshot.view.editable,
      paint,
      nudge: snapshot.state.profile.nudge,
      zoom: view.showLabel ? snapshot.view.camera.zoom : 1,
      hiddenLabel: labels.get(view.id),
    },
    selected: view.selected,
    hidden: view.hidden,
    focusable: true,
    ariaLabel: view.wire.measuredLabel.outline.join(' '),
  }));
}
/** Failed projections render no invented graph; the diagnostic is reported through the host callback. */
function graphRecords(
  result: Result<ViewSnapshot>,
  actions: ViewActions,
  paint: SurfaceProps['paint'],
  showLabels: boolean,
): { nodes: FlowNode[]; edges: FlowEdge[] } {
  if (!result.ok) return { nodes: [], edges: [] };
  return {
    nodes: flowNodes(result.value, actions, paint),
    edges: flowEdges(result.value, actions, paint, showLabels),
  };
}
/** Cache actual React Flow records, not just inner data. Repeated projections are semantically safe; host remounts the surface after a reported rendering failure, rebuilding this disposable cache. */
export function createGraphSelector(): GraphSelector {
  let previousNodes = new Map<string, FlowNode>();
  let previousEdges = new Map<string, FlowEdge>();
  return (result, actions, paint, showLabels): ReturnType<typeof graphRecords> => {
    const next = graphRecords(result, actions, paint, showLabels);
    const nodes = next.nodes.map((node) => stableFlowNode(node, previousNodes.get(node.id)));
    const edges = next.edges.map((edge) => stableFlowEdge(edge, previousEdges.get(edge.id)));
    previousNodes = new Map(nodes.map((node) => [node.id, node]));
    previousEdges = new Map(edges.map((edge) => [edge.id, edge]));
    return { nodes, edges };
  };
}
/** A semantic view/reference or interaction permission change invalidates only that React Flow node record. */
function stableFlowNode(
  next: FlowNode,
  previous: FlowNode | undefined,
): FlowNode {
  if (!previous) return next;
  const equal = [
    next.data.view === previous.data.view,
    next.data.editable === previous.data.editable,
    next.draggable === previous.draggable,
    next.connectable === previous.connectable,
    next.data.paint === previous.data.paint,
    next.data.actions === previous.data.actions,
  ].every(Boolean);
  return equal ? previous : next;
}
/** Pinned paint, route and action identity determine edge changes; camera movement does not rebuild edge data. */
function stableFlowEdge(
  next: FlowEdge,
  previous: FlowEdge | undefined,
): FlowEdge {
  if (!previous) return next;
  const equal = [
    next.data?.view === previous.data?.view,
    next.data?.actions === previous.data?.actions,
    next.data?.editable === previous.data?.editable,
    next.data?.paint === previous.data?.paint,
    next.data?.nudge === previous.data?.nudge,
    next.data?.zoom === previous.data?.zoom,
    sameBox(next.data?.hiddenLabel, previous.data?.hiddenLabel),
  ].every(Boolean);
  return equal ? previous : next;
}
function sameBox(
  a: Box | undefined,
  b: Box | undefined,
): boolean {
  if (a === undefined || b === undefined) return a === b;
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}
