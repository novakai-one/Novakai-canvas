// @vitest-environment jsdom
import { it, expect, afterEach, vi, assert } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react';
import { createReactBindings, createSession } from '../contract/index.js';
import type { ViewNode, ViewActions } from '../contract/index.js';
import type { FlowNode } from '../contract/index.js';
import { createInteractions } from '../adapters/react-flow/interaction-handlers.js';
import { createGeometryGestures } from '../adapters/react-flow/geometry-gestures.js';
import { createKeyboardCommands } from '../adapters/react-flow/keyboard-commands.js';
import { harness, value, alpha } from './fixtures.js';
import { slots, installDomGeometry, renderedScene, mouseGesture } from './react-fixtures.js';
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it('15 actual React Flow bindings render measured nodes, labelled crow-foot edges, controls and minimap', async () => {
  installDomGeometry();
  const setup = harness([renderedScene()]);
  const fitted = value(setup.canvas.transition(setup.state, { kind: 'fit', target: null })).state;
  const session = createSession(setup.canvas, fitted);
  const binding = value(await createReactBindings(await slots()));
  const Surface = binding.CanvasSurface;
  const errors = vi.fn();
  const element = render(
    <div style={{ width: 800, height: 600 }}>
      <Surface
        label="Engineering canvas"
        session={session}
        reader={setup.canvas}
        nextGestureId={() => 'ui'}
        onError={errors}
        paint={{ fill: '#ffffff', stroke: '#222222', text: '#222222' }}
      />
    </div>,
  );
  expect(screen.getByRole('region', { name: 'Engineering canvas' })).toBeTruthy();
  await waitFor(() =>
    expect(element.container.querySelectorAll('.react-flow__node-scene').length).toBe(5),
  );
  expect(element.container.querySelectorAll('.react-flow__node-section')).toHaveLength(2);
  await waitFor(() =>
    expect(element.container.querySelectorAll('.react-flow__edge-scene').length).toBe(1),
  );
  expect(element.container.querySelector('[data-marker="zero-many"]')).not.toBeNull();
  expect(element.container.querySelector('.react-flow__minimap')).not.toBeNull();
  expect(screen.getByRole('button', { name: 'Fit collection' })).toBeTruthy();
  const camera = session.getSnapshot().camera;
  fireEvent.click(screen.getByRole('button', { name: 'Diagram outline' }));
  fireEvent.click(screen.getByRole('button', { name: 'Select alpha' }));
  expect(session.getSnapshot().camera).toEqual(camera);
  expect(session.getSnapshot().selection).toEqual([alpha]);
  expect(screen.getByRole('navigation', { name: 'Diagram contents' }).textContent).toContain(
    'zero or many',
  );
  expect(screen.getByRole('button', { name: 'Send request' })).toBeTruthy();
  fireEvent.keyDown(screen.getByRole('button', { name: 'Send request' }), { key: 'Enter' });
  expect(session.drainEffects()).toMatchObject([
    { kind: 'inspect-request', target: { kind: 'sequence', section: 'sequence', id: 'request' } },
  ]);
  fireEvent.click(screen.getByRole('button', { name: 'hand' }));
  await waitFor(() =>
    expect(element.container.querySelectorAll('.react-flow__node.draggable')).toHaveLength(0),
  );
  act(() => session.dispatch({ kind: 'mutation-available', value: false }));
  await waitFor(() =>
    expect(element.container.querySelectorAll('.react-flow__resize-control')).toHaveLength(0),
  );
  act(() => session.dispatch({ kind: 'mutation-available', value: true }));
  fireEvent.click(screen.getByRole('button', { name: 'select' }));
  expect(errors).not.toHaveBeenCalled();
});
it('16 real adapter callbacks coalesce drag, cancel safely, preserve viewport and ignore native field starts', async () => {
  installDomGeometry();
  const setup = harness();
  const session = createSession(setup.canvas, setup.state);
  let id = 0;
  const errors = vi.fn();
  const parts = { createGeometryGestures, createKeyboardCommands };
  const handlers = createInteractions(parts, {
    session,
    input: {
      ownsNativeInput: (target) =>
        target instanceof Element &&
        target.closest('input,textarea,select,button,a,[contenteditable="true"]') !== null,
      focusedId: (target) =>
        target instanceof Element
          ? (target.closest('[data-id]')?.getAttribute('data-id') ?? null)
          : null,
    },
    nextGestureId: () => `gesture-${++id}`,
    onError: errors,
  });
  const view = value(setup.canvas.present(setup.state)).nodes.find(
    (node) => node.target.id === 'alpha',
  );
  expect(view).toBeDefined();
  assert(view);
  const node = flowNode(view, handlers.actions);
  const event = new MouseEvent('mousedown');
  act(() => handlers.flow.onNodeDragStart?.(event, node, [node]));
  act(() =>
    handlers.flow.onNodeDrag?.(
      event,
      { ...node, position: { x: node.position.x + 24, y: node.position.y + 16 } },
      [node],
    ),
  );
  expect(session.drainEffects()).toEqual([]);
  act(() => handlers.flow.onNodeDragStop?.(event, node, [node]));
  expect(session.drainEffects()).toMatchObject([
    {
      kind: 'edit-intent',
      intent: { kind: 'placement', entries: [{ target: alpha, placement: { x: 44, y: 56 } }] },
    },
  ]);
  act(() => handlers.flow.onNodeDragStop?.(event, node, [node]));
  expect(session.drainEffects()).toEqual([]);
  act(() => handlers.flow.onNodeDragStart?.(event, node, [node]));
  act(() => handlers.actions.cancelGeometry());
  expect(session.getSnapshot().draft).toBeNull();
  expect(session.drainEffects()).toEqual([]);
  act(() => handlers.flow.onViewportChange?.({ x: 120, y: 80, zoom: 2 }));
  expect(session.getSnapshot().camera).toMatchObject({ x: 120, y: 80, zoom: 2 });
  const input = document.createElement('input');
  document.body.append(input);
  const inputEvent = new MouseEvent('mousedown', { bubbles: true });
  input.dispatchEvent(inputEvent);
  act(() => handlers.flow.onNodeDragStart?.(inputEvent, node, [node]));
  expect(session.getSnapshot().draft).toBeNull();
  input.remove();
  const bindings = value(await createReactBindings(await slots()));
  const Surface = bindings.CanvasSurface;
  render(
    <Surface
      label="Route editing canvas"
      session={session}
      reader={setup.canvas}
      nextGestureId={() => `route-${++id}`}
      onError={errors}
      paint={{ fill: '#ffffff', stroke: '#222222', text: '#222222' }}
    />,
  );
  act(() =>
    session.dispatch({
      kind: 'select',
      mode: 'replace',
      targets: [{ kind: 'wire', section: 'flow', id: 'owns' }],
    }),
  );
  const add = await screen.findByRole('button', { name: 'Add bend' });
  fireEvent.click(add);
  expect(session.drainEffects()).toMatchObject([
    {
      kind: 'edit-intent',
      intent: {
        kind: 'route',
        route: {
          points: [
            { x: 140, y: 70 },
            { x: 260, y: 70 },
            { x: 380, y: 70 },
          ],
          sourceSide: 'preserve',
          targetSide: 'preserve',
          locked: 'preserve',
        },
      },
    },
  ]);
  fireEvent.change(screen.getByLabelText('Source side'), { target: { value: 'bottom' } });
  expect(session.drainEffects()).toMatchObject([
    {
      kind: 'edit-intent',
      intent: {
        kind: 'route',
        route: { sourceSide: 'bottom', targetSide: 'preserve', locked: 'preserve' },
      },
    },
  ]);
  act(() => session.dispatch({ kind: 'fit', target: null }));
  const betaId = value(setup.canvas.present(session.getSnapshot())).nodes.find(
    (item) => item.target.id === 'beta',
  )?.id;
  await waitFor(() => expect(document.querySelector(`[data-id='${betaId}']`)).not.toBeNull());
  const focused = document.querySelector(`[data-id='${betaId}']`);
  expect(focused).not.toBeNull();
  assert(focused);
  fireEvent.keyDown(focused, { key: 'Enter' });
  expect(session.drainEffects()).toMatchObject([
    { kind: 'inspect-request', target: { kind: 'node', section: 'flow', id: 'beta' } },
  ]);
  act(() =>
    session.dispatch({
      kind: 'viewport',
      camera: { x: 0, y: 0, zoom: 1, viewport: { width: 800, height: 600 } },
    }),
  );
  const alphaId = view.id;
  await waitFor(() => expect(document.querySelector(`[data-id='${alphaId}']`)).not.toBeNull());
  const draggable = document.querySelector(`[data-id='${alphaId}']`);
  expect(draggable).not.toBeNull();
  if (draggable) {
    mouseGesture(draggable, 'mousedown', 140, 260);
    mouseGesture(window, 'mousemove', 146, 264);
    mouseGesture(window, 'mousemove', 186, 284);
    mouseGesture(window, 'mouseup', 186, 284);
  }
  expect(session.drainEffects()).toMatchObject([
    {
      kind: 'edit-intent',
      intent: {
        kind: 'placement',
        entries: [{ target: alpha, placement: { x: 60, y: 60 } }],
      },
    },
  ]);
  await act(async () => new Promise<void>((resolve) => setTimeout(resolve, 0)));
  expect(errors).not.toHaveBeenCalled();
  const region = screen.getByRole('region', { name: 'Route editing canvas' });
  expect(region.className).toMatch(/surface/);
  const modal = document.createElement('div');
  modal.setAttribute('role', 'dialog');
  modal.tabIndex = 0;
  region.append(modal);
  fireEvent.keyDown(modal, { key: 'Delete' });
  expect(session.drainEffects()).toEqual([]);
  modal.removeAttribute('role');
  modal.addEventListener('keydown', (event) => event.preventDefault());
  fireEvent.keyDown(modal, { key: 'Delete' });
  expect(session.drainEffects()).toEqual([]);
  modal.remove();
  const removeFailingListener = session.subscribe(() => {
    throw new Error('broken subscriber');
  });
  fireEvent.click(screen.getByRole('button', { name: 'hand' }));
  expect(errors).toHaveBeenCalledWith(expect.objectContaining({ code: 'listener-failure' }));
  removeFailingListener();
  errors.mockClear();
  expect(errors).not.toHaveBeenCalled();
});
/** Actual adapter node data uses the public projected view; fixture expected coordinates are independently literal. */
function flowNode(
  view: ViewNode,
  actions: ViewActions,
): FlowNode {
  return {
    id: view.id,
    type: 'scene',
    position: view.position,
    data: { view, actions, editable: true },
    width: view.box.width,
    height: view.box.height,
  };
}
