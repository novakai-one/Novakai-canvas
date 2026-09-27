/*
 * The workspace shell: the header, the side panels, the canvas (or the Library when no collection
 * is open), Source, the movement review, the alerts (problem bar and Recovery), the status bar,
 * the Reveal button, the collection chooser and the create dialog. Core decides which parts show
 * (`shellLayout`); this adapter draws them from the injected slots. Escape reveals a hidden
 * interface.
 * `start()`, `create()` and a drop's `addObject()` are not awaited: the workspace session handles
 * their failures. For `start()` and `create()`, a failed read or a failed or refused request sets
 * `view.problem`, shown in the problem bar. A failed add sets `creation.problem`, shown in the Add
 * panel; a refused add also sets `view.problem`.
 * The problem bar and status bar (`ShellAlerts.tsx`) and the shell's hooks (`shell-hooks.ts`) come
 * in as slots.
 */
import { useState, useSyncExternalStore } from 'react';
import type { ComponentType, ReactElement } from 'react';
import { palette, planPaletteDrop, shellLayout } from '../../contract/api.js';
import type { PaletteDrop, ShellLayout } from '../../contract/api.js';
import type { ChromeSlots, FeatureProps, WorkspaceProps } from '../../contract/react-types.js';
import type { WorkspaceController } from '../../contract/records/workspace.js';
import type { ActiveDiagram } from '../../contract/records/active-diagram.js';
import styles from './WorkspaceShell.module.css';

/** The work surface is the primary content; chrome uses stable injected sections and shared design tokens. */
export function createWorkspaceShell({
  panels,
  Header,
  Library,
  Panel,
  Recovery,
  ProblemBar,
  StatusBar,
  hooks,
  MovementReview,
  Reveal,
  Source,
  CreateDialog,
  Chooser,
  CanvasSurface,
  FontDefinitions,
  portal,
  nextGestureId,
}: ChromeSlots): ComponentType<WorkspaceProps> {
  const { useAlertClearance, useControllerLifetime, useRevealOnEscape } = hooks;

  /** Mount owns subscription lifetime. Selection and panning remain entirely inside the Canvas session. */
  function WorkspaceShell({ controller }: WorkspaceProps): ReactElement {
    const view = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
    const panelState = useSyncExternalStore(panels.subscribe, panels.getSnapshot);
    const [creating, setCreating] = useState(false);
    const layout = shellLayout(view, panelState);
    useControllerLifetime(controller);
    useRevealOnEscape(layout.reveal, panels.revealInterface);
    const openCreate = (): void => setCreating(true);
    return (
      <div className={styles.shell}>
        <FontDefinitions fonts={view.active?.document.fonts} />
        <Show when={layout.header}>
          <Header
            controller={controller}
            view={view}
            onCreate={openCreate}
            onOpenChooser={controller.beginCollectionSwitch}
          />
        </Show>
        <div className={styles.workspace}>
          <Show when={layout.left}>
            <Panel side="left" controller={controller} view={view} />
          </Show>
          <CanvasHost controller={controller} view={view} layout={layout} onCreate={openCreate} />
          <Show when={layout.right}>
            <Panel side="right" controller={controller} view={view} />
          </Show>
        </div>
        <Show when={layout.status}>
          <StatusBar view={view} />
        </Show>
        <Show when={layout.reveal}>
          <Reveal onReveal={panels.revealInterface} />
        </Show>
        <Chooser
          controller={controller}
          view={view}
          onCreate={() => {
            controller.cancelCollectionSwitch();
            openCreate();
          }}
          portal={portal}
        />
        <CreateDialog
          open={creating}
          onClose={() => setCreating(false)}
          onCreate={(title) => {
            setCreating(false);
            void controller.create(title);
          }}
          portal={portal}
        />
      </div>
    );
  }

  /** The canvas host: the Library or the open diagram, Source, the movement review and the alerts. */
  function CanvasHost({ controller, view, layout, onCreate }: CanvasHostProps): ReactElement {
    const clearance = useAlertClearance();
    const active = view.active;
    return (
      <main
        ref={clearance.host}
        className={styles.canvas}
        data-canvas-host
        aria-label="Diagram workspace"
      >
        {active === null ? (
          <Library controller={controller} view={view} onCreate={onCreate} />
        ) : (
          <DiagramCanvas active={active} controller={controller} layout={layout} />
        )}
        <Show when={layout.source}>
          <Source controller={controller} view={view} />
        </Show>
        <MovementReview controller={controller} view={view} />
        {/* Alerts overlay the bottom of the canvas and never shift layout. */}
        <div ref={clearance.alerts} className={alertsClass(layout.alertsAboveZoom)}>
          <ProblemBar problem={layout.problem} onDismiss={controller.dismissProblem} />
          <Show when={layout.recovery}>
            <Recovery controller={controller} view={view} />
          </Show>
        </div>
      </main>
    );
  }

  /** The open diagram's canvas, painted from its style; a style with no neutral stroke uses its text colour. */
  function DiagramCanvas({ active, controller, layout }: DiagramCanvasProps): ReactElement {
    const style = active.document.style;
    const paint = {
      fill: style.surface,
      stroke: style.roles.neutral?.stroke ?? style.text,
      text: style.text,
    };
    return (
      <CanvasSurface
        followsInterfaceRoles={style.followsInterfaceRoles === true}
        session={active.session}
        reader={active.canvas}
        nextGestureId={nextGestureId}
        onError={controller.report}
        paint={paint}
        label={active.document.collection.title}
        chrome={layout.chrome}
        showRoads={layout.roads}
        palette={palette}
        onPaletteDrop={(kind, target) =>
          dropObject(controller, planPaletteDrop(active.document.collection.sections, kind, target))
        }
        showLabels={layout.labels}
      />
    );
  }

  return WorkspaceShell;
}

/** The canvas host's inputs: the controller and view, the layout core decided, and the create intent. */
interface CanvasHostProps extends FeatureProps {
  readonly layout: ShellLayout;
  readonly onCreate: () => void;
}

/** The open diagram, where its drops and errors go, and the chrome, roads and labels core allows. */
interface DiagramCanvasProps {
  readonly active: ActiveDiagram;
  readonly controller: DropReceiver;
  readonly layout: Pick<ShellLayout, 'chrome' | 'roads' | 'labels'>;
}

/** Whether core shows the part, and the part. */
interface ShowProps {
  readonly when: boolean;
  readonly children: ReactElement;
}

/** Where a palette drop goes: an add to the controller, a refusal to its report. */
type DropReceiver = Pick<WorkspaceController, 'addObject' | 'report'>;

/**
 * One optional part, drawn only when core shows it. Each part keeps its own place in React's tree,
 * so parts hidden together unmount in page order.
 */
function Show({ when, children }: ShowProps): ReactElement | null {
  return when ? children : null;
}

/** Alerts clear the zoom controls only when a canvas shows them; the Library has none. */
function alertsClass(aboveZoom: boolean): string | undefined {
  return aboveZoom ? `${styles.alerts} ${styles.alertsAboveZoom}` : styles.alerts;
}

/**
 * Sends on a palette drop that core has already decided. An add is not awaited (see the file
 * header); a refusal is reported; an ignored drop does nothing.
 */
function dropObject(
  controller: DropReceiver,
  drop: PaletteDrop,
): void {
  switch (drop.kind) {
    case 'add':
      void controller.addObject(drop.draft);
      return;
    case 'refuse':
      controller.report(drop.problem);
      return;
    case 'ignore':
      return;
    default:
      unknownDrop(drop);
  }
}

/** A drop kind this shell does not know; typing it `never` makes a new kind a compile error. */
function unknownDrop(drop: never): void {
  void drop;
}
