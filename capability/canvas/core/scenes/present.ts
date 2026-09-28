import type { SessionState } from '../../contract/records/state.js';
import type { CanvasView, ViewNode, ViewWire, ViewSection } from '../../contract/records/view.js';
import { viewNode, viewSection } from './view-nodes.js';
import { viewWire } from './view-wires.js';
import { canMutate } from '../interaction/changes.js';
import { projectFocus } from './focus.js';
import { detailAtZoom } from './detail.js';
/** Stable node content plus identical interaction/geometry fields retains the previous hot-render object. */
function stableNode(
  next: ViewNode,
  previous: ViewNode | undefined,
): ViewNode {
  if (!previous) return next;
  const equal = [
    next.placed === previous.placed,
    next.tree?.collapsed === previous.tree?.collapsed,
    next.tree?.folder === previous.tree?.folder,
    next.selected === previous.selected,
    next.hovered === previous.hovered,
    next.emphasis === previous.emphasis,
    next.detail === previous.detail,
    next.hidden === previous.hidden,
    next.draft === previous.draft,
    next.position.x === previous.position.x,
    next.position.y === previous.position.y,
    next.box.width === previous.box.width,
    next.box.height === previous.box.height,
  ].every(Boolean);
  return equal ? previous : next;
}
/** Unchanged wire references and origin preserve memoized edge props during unrelated selection/drag. */
function stableWire(
  next: ViewWire,
  previous: ViewWire | undefined,
): ViewWire {
  if (!previous) return next;
  const equal = [
    next.wire === previous.wire,
    next.selected === previous.selected,
    next.hovered === previous.hovered,
    next.emphasis === previous.emphasis,
    next.showLabel === previous.showLabel,
    next.hidden === previous.hidden,
    next.origin.x === previous.origin.x,
    next.origin.y === previous.origin.y,
  ].every(Boolean);
  return equal ? previous : next;
}
/** Section frames remain stable while unrelated descendants are edited. */
function stableSection(
  next: ViewSection,
  previous: ViewSection | undefined,
): ViewSection {
  if (!previous) return next;
  const equal = [
    next.section === previous.section,
    next.selected === previous.selected,
    next.box === previous.box,
    next.collapsed === previous.collapsed,
  ].every(Boolean);
  return equal ? previous : next;
}
/** Public view projection owns only interaction overlays; presentation/layout data retains its original authority. */
export function presentScene(
  state: SessionState,
  previous?: CanvasView,
): CanvasView {
  const focus = projectFocus(state, previous?.focus);
  const detail = detailAtZoom(state.camera.zoom);
  const oldNodes = new Map(previous?.nodes.map((node) => [node.id, node]));
  const oldWires = new Map(previous?.wires.map((wire) => [wire.id, wire]));
  const oldSections = new Map(previous?.sections.map((section) => [section.id, section]));
  const nodes = state.scene.sections
    .flatMap((section) =>
      section.nodes.map((node) => viewNode(state, node, section, focus, detail)),
    )
    .map((node) => stableNode(node, oldNodes.get(node.id)));
  const wires = state.scene.sections
    .flatMap((section) => section.wires.map((wire) => viewWire(state, wire, section, focus)))
    .map((wire) => stableWire(wire, oldWires.get(wire.id)));
  const sections = state.scene.sections
    .map((section) => viewSection(state, section))
    .map((section) => stableSection(section, oldSections.get(section.id)));
  return {
    camera: state.camera,
    nodes,
    wires,
    sections,
    editable: canMutate(state),
    tool: state.tool,
    focus,
    detail,
  };
}
