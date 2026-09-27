import type { RenderSlots, ReactBindings } from './react-types.js';
import type { Result } from './errors.js';
import { protectAsync } from '../core/validation/outcomes.js';
import type { Canvas, Dependencies } from './types.js';
import type { SessionState } from './records/state.js';
import type { SessionStore } from './ports/session.js';
import { createCanvas } from './api.js';
import { createStore } from '../adapters/session/store.js';
/** Embedded/headless composition needs only scene admission; host owns effects, display and recovery. */
export function composeCanvas(dependencies: Dependencies): Canvas {
  return createCanvas(dependencies);
}
/** Bind live session storage once; pure Canvas API remains available without a subscription adapter. */
export function createSession(
  canvas: Pick<Canvas, 'transition'>,
  state: SessionState,
): SessionStore {
  return createStore(canvas, state);
}

/** Explicit browser composition loads styles and stable view slots; host keeps previous bindings on failure. */
export function createReactBindings(slots: RenderSlots): Promise<Result<ReactBindings>> {
  return protectAsync(async () => {
    await import('../adapters/react-flow/style-entry.js');
    const [
      surface,
      node,
      edge,
      section,
      controls,
      outline,
      sequence,
      scene,
      interactions,
      records,
      icons,
      labels,
      roads,
      tree,
      geometry,
      keyboard,
      browser,
    ] = await Promise.all([
      import('../adapters/react-flow/CanvasSurface.js'),
      import('../adapters/react-flow/SceneNode.js'),
      import('../adapters/react-flow/SceneEdge.js'),
      import('../adapters/react-flow/SectionFrame.js'),
      import('../adapters/react-flow/CanvasControls.js'),
      import('../adapters/react-flow/DiagramOutline.js'),
      import('../adapters/react-flow/SequenceLayer.js'),
      import('../adapters/react-flow/use-scene.js'),
      import('../adapters/react-flow/interaction-handlers.js'),
      import('../adapters/react-flow/flow-records.js'),
      import('../adapters/react-flow/ControlIcon.js'),
      import('../adapters/react-flow/WireLabel.js'),
      import('../adapters/react-flow/RoutingRoads.js'),
      import('../adapters/react-flow/TreeRow.js'),
      import('../adapters/react-flow/geometry-gestures.js'),
      import('../adapters/react-flow/keyboard-commands.js'),
      import('../adapters/react-flow/browser-bindings.js'),
    ]);
    const parts = {
      createGeometryGestures: geometry.createGeometryGestures,
      createKeyboardCommands: keyboard.createKeyboardCommands,
    };
    const CanvasSurface = surface.createCanvasSurface({
      RoutingRoads: roads.RoutingRoads,
      FontDefinitions: slots.FontDefinitions,
      createGraphSelector: records.createGraphSelector,
      useScene: scene.useScene,
      createInteractions: (owners) =>
        interactions.createInteractions(parts, { ...owners, input: browser.browserInput }),
      observeSize: browser.observeSize,
      SceneNode: node.createSceneNode({ ...slots, TreeRow: tree.createTreeRow(slots) }),
      SceneEdge: edge.createSceneEdge({
        ...slots,
        WireLabel: labels.createWireLabel(slots),
      }),
      SectionFrame: section.createSectionFrame(slots),
      CanvasControls: controls.createCanvasControls({ ...slots, Icon: icons.ControlIcon }),
      DiagramOutline: outline.createDiagramOutline(slots),
      SequenceLayer: sequence.createSequenceLayer(slots),
    });
    return { CanvasSurface };
  });
}
