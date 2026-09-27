/*
 * The browser composition root: installation resources, design bindings, feature registration,
 * the workspace controller and the shell mount are assembled once before rendering, so every
 * child registry retains stable component identity across edits. Startup resource reading lives
 * in compose/startup, feature registration in compose/features, the movement review binding in
 * compose/movement-review, and the retained form sessions in compose/sessions.
 */
import { folderIdSchema } from '@novakai/canvas-library';
import { createLibraryController } from '../adapters/sessions/library-session.js';
import { createLibraryReader } from '../adapters/readers/library-reader.js';
import { createLibraryBrowser } from '../adapters/react/LibraryBrowser.js';
import { createLibraryFilters } from '../adapters/react/LibraryFilters.js';
import { createLibraryResults } from '../adapters/react/LibraryResults.js';
import { createLibraryOrganisation } from '../adapters/react/LibraryOrganisation.js';
import { createPreferenceController } from '../adapters/sessions/preference-session.js';
import {
  readEnvironment,
  observeEnvironment,
} from '../adapters/preferences/browser-preferences.js';
import { createThemeSelector } from '../adapters/react/ThemeSelector.js';
import { readWireDrafts } from '../adapters/readers/wire-reader.js';
import { readInspectorDrafts } from '../adapters/readers/inspector-reader.js';
import { createDefinitionSession } from '../adapters/sessions/definition-session.js';
import { readDefinitionDrafts } from '../adapters/readers/definition-reader.js';
import { createSourceController } from '../adapters/sessions/source-session.js';
import { createWorkspaceNavigation } from '../adapters/edge/browser-navigation.js';
import { createPanelController } from '../adapters/sessions/panel-session.js';
import { readPanelPreferences } from '../adapters/preferences/panel-preferences.js';
import {
  createReactBindings as designBindings,
  composeDesignSystem,
  createScopeInstaller,
} from '@novakai/canvas-design-system';
import { createBrowserReactBindings as presentationBindings } from '@novakai/canvas-presentation';
import { createCanvas, createReactBindings as canvasBindings } from '@novakai/canvas-canvas';
import { createLanguage } from '@novakai/canvas-language';
import { validate, plan, stage } from '@novakai/canvas-model';
import { createServiceClient } from '../adapters/edge/service-client.js';
import { readDiagram, createSceneAdmission } from '../adapters/readers/diagram-reader.js';
import { createWorkspaceInputs } from '../adapters/edge/workspace-inputs.js';
import { createCanvasSessions } from '../adapters/sessions/canvas-session.js';
import { createDraftRetention } from '../adapters/sessions/draft-retention.js';
import { createSubmissionSession } from '../adapters/sessions/submission-session.js';
import { createSubmissionReaders } from '../adapters/readers/submission-readers.js';
import { createWorkspaceController } from '../adapters/sessions/workspace-session.js';
import { createHistoryControls } from '../adapters/react/HistoryControls.js';
import { createWorkspaceHeader } from '../adapters/react/WorkspaceHeader.js';
import { createCollectionChooser } from '../adapters/react/CollectionChooser.js';
import { createViewMenu } from '../adapters/react/ViewMenu.js';
import { RevealInterface } from '../adapters/react/RevealInterface.js';
import { createCollectionLibrary } from '../adapters/react/CollectionLibrary.js';
import { createCollectionDialog } from '../adapters/react/CreateCollectionDialog.js';
import { createPanelTabs } from '../adapters/react/PanelTabs.js';
import { createWorkspaceSidePanel } from '../adapters/react/WorkspaceSidePanel.js';
import { createRequestRecovery } from '../adapters/react/RequestRecovery.js';
import { createMovementReview } from '../adapters/react/MovementReview.js';
import { createSourceEditor } from '../adapters/react/SourceEditor.js';
import { createWorkspaceShell } from '../adapters/react/WorkspaceShell.js';
import { mountWorkspace, viewport, observeWorkspaceWidth } from '../adapters/edge/browser-host.js';
import { planCanvasEdit } from './api.js';
import { chooseMoveOption } from '../core/editing/movement.js';
import { previewModuleRoutes } from '../adapters/readers/route-preview.js';
import type { Result } from './errors.js';
import type { ServiceClient } from './ports/client.js';
import type { PanelController } from './panel-types.js';
import type { WorkspaceController } from './records/workspace.js';
import {
  accepted,
  initializationFailure,
  panelSizing,
  resources,
  themeChoices,
} from './compose/startup.js';
import { featureSections, panelDefinitions } from './compose/features.js';
import { createMovementReviewBinding } from './compose/movement-review.js';
import { createInspectorSession, createWireSession } from './compose/sessions.js';

export { createInspectorSession, createWireSession } from './compose/sessions.js';

/** Browser entry reports startup failure visibly; restarting after correcting the dependency does not alter canonical diagram data. */
export async function startWeb(element: HTMLElement): Promise<Result<{ dispose(): void }>> {
  try {
    return await mount(element);
  } catch (error) {
    return initializationFailure(error);
  }
}

/** Assemble once before rendering: every child/React Flow registry retains stable component identity across edits. */
async function mount(element: HTMLElement): Promise<Result<{ dispose(): void }>> {
  const client = createServiceClient();
  const installed = await resources(client);
  const design = accepted(await designBindings());
  const scope = accepted(createScopeInstaller(design.createScopeTarget(element)));
  const tokens = composeDesignSystem();
  const environment = readEnvironment(window);
  const themes = themeChoices(tokens, installed.tokens, environment);
  const preferences = accepted(
    createPreferenceController({
      tokens,
      sources: installed.tokens,
      installer: scope,
      retention: createDraftRetention(localStorage),
      environment,
      themes: themes.map(({ pin }) => pin),
    }),
  );
  const stopPreferences = observeEnvironment(window, preferences.environment);
  const presentation = accepted(await presentationBindings(installed.fonts));
  const surface = accepted(await canvasBindings({ ...presentation, Button: design.Button }));
  const Browser = createLibraryBrowser([
    { id: 'filters', Content: createLibraryFilters(design) },
    { id: 'results', Content: createLibraryResults(design) },
    { id: 'organisation', Content: createLibraryOrganisation(design) },
  ]);
  const ChooserBrowser = createLibraryBrowser([
    { id: 'filters', Content: createLibraryFilters(design, { compact: true }) },
    { id: 'results', Content: createLibraryResults(design) },
  ]);
  const ThemeSelector = createThemeSelector(design, preferences, themes);
  const sections = featureSections(design, preferences, ThemeSelector, Browser, {
    subscribe: (listener) => panels.subscribe(listener),
    getSnapshot: () => panels.getSnapshot(),
    setInterfaceVisibility: (control, visible) => panels.setInterfaceVisibility(control, visible),
  });
  const sizing = panelSizing(element);
  const panels: PanelController = createPanelController({
    definitions: panelDefinitions(sections),
    sizing,
    initialWidth: element.getBoundingClientRect().width,
    retention: createDraftRetention(localStorage),
    read: readPanelPreferences,
    report: (message) =>
      runtime.report({
        code: 'panel-preferences',
        message,
        recovery: 'Customize or reset the panel layout.',
        owner: 'panel-preferences',
      }),
  });
  const runtime: WorkspaceController = controller(client, element, panels);
  const stopWidth = observeWorkspaceWidth(element, panels.viewport);
  const Workspace = createWorkspaceShell({
    panels,
    Header: createWorkspaceHeader(
      design,
      panels,
      createViewMenu(design, panels, element),
      createHistoryControls(design),
    ),
    Library: createCollectionLibrary({ ...design, Browser }),
    Panel: createWorkspaceSidePanel({
      ...design,
      sections,
      panels,
      sizing,
      portal: element,
      Tabs: createPanelTabs(design),
      tabs: {
        left: [
          {
            id: 'add',
            label: 'Add',
            scope: 'Create diagram content',
            empty: 'Creation tools are hidden. Customize panels to show them.',
          },
          {
            id: 'browse',
            label: 'Browse',
            scope: 'Shared collection',
            empty: 'All Browse sections are hidden. Customize to show them.',
          },
        ],
        right: [
          {
            id: 'inspect',
            label: 'Inspect',
            scope: 'Selected diagram content',
            empty: 'All Inspect sections are hidden. Customize to show them.',
          },
          {
            id: 'settings',
            label: 'Settings',
            scope: 'Personal to this browser',
            empty: 'Settings are hidden. Customize to show them.',
          },
        ],
      },
    }),
    Source: createSourceEditor(design, element),
    Recovery: createRequestRecovery(design),
    Button: design.Button,
    MovementReview: createMovementReview(design),
    Reveal: RevealInterface,
    CreateDialog: createCollectionDialog(design),
    Chooser: createCollectionChooser({ ...design, Browser: ChooserBrowser }),
    CanvasSurface: surface.CanvasSurface,
    FontDefinitions: presentation.FontDefinitions,
    portal: element,
    nextGestureId: () => crypto.randomUUID(),
  });
  const mounted = accepted(mountWorkspace(element, Workspace, runtime));
  return {
    ok: true,
    value: {
      dispose: () => {
        stopWidth();
        mounted.dispose();
        stopPreferences();
        preferences.dispose();
      },
    },
  };
}

/** Native adapters receive narrow roles; every human mutation uses captured Authoring preconditions. */
function controller(
  client: ServiceClient,
  element: HTMLElement,
  panels: PanelController,
): WorkspaceController {
  const canvas = createCanvas({ sceneAdmission: createSceneAdmission() });
  const language = createLanguage({ reader: { validate }, planner: { plan }, stage: { stage } });
  const retention = createDraftRetention(localStorage);
  const inputs = createWorkspaceInputs(readDiagram, language);
  return createWorkspaceController({
    client,
    panels: {
      restore: panels.restore,
      open: (side, open) => {
        panels.open(side, open);
        if (side === 'right' && open) panels.selectTab('inspect');
      },
    },
    navigation: createWorkspaceNavigation(window.location, window.history),
    inputs,
    library: (callbacks) =>
      createLibraryController({
        retention,
        reader: createLibraryReader(),
        now: () => Date.now(),
        nextFolderId: () => folderIdSchema().parse(`folder-${crypto.randomUUID()}`),
        ...callbacks,
      }),
    wires: (callbacks) => createWireSession({ retention, read: readWireDrafts, ...callbacks }),
    inspector: (callbacks) =>
      createInspectorSession({ retention, read: readInspectorDrafts, ...callbacks }),
    definitions: (callbacks) =>
      createDefinitionSession({ retention, read: readDefinitionDrafts, ...callbacks }),
    source: (callbacks) =>
      createSourceController({
        inputs,
        retention,
        nextId: () => crypto.randomUUID(),
        ...callbacks,
      }),
    sessions: createCanvasSessions(canvas, () => viewport(element)),
    edits: { plan: planCanvasEdit },
    moveReview: createMovementReviewBinding,
    chooseMoveOption: chooseMoveOption,
    previewRoutes: previewModuleRoutes,
    submissions: (callbacks) =>
      createSubmissionSession({
        client,
        retention,
        readers: createSubmissionReaders(inputs),
        ...callbacks,
      }),
    nextId: () => crypto.randomUUID(),
  });
}
