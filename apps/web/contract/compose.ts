/*
 * The browser composition root: installation resources, design bindings, feature registration,
 * the workspace controller and the shell mount are assembled once before rendering, so every
 * child registry retains stable component identity across edits. The browser entry hands in the
 * page globals, so nothing here reads one. Startup resource reading lives in compose/startup,
 * feature registration in compose/features, the side panel tabs in compose/panel-tabs, the
 * workspace controller in compose/workspace, the movement review binding in
 * compose/movement-review, and the retained form sessions in compose/sessions.
 */
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
import { createPanelController } from '../adapters/sessions/panel-session.js';
import { createWorkspaceNavigation } from '../adapters/edge/browser-navigation.js';
import { readPanelPreferences } from '../adapters/preferences/panel-preferences.js';
import {
  createReactBindings as designBindings,
  composeDesignSystem,
  createScopeInstaller,
} from '@novakai/canvas-design-system';
import { createBrowserReactBindings as presentationBindings } from '@novakai/canvas-presentation';
import { createReactBindings as canvasBindings } from '@novakai/canvas-canvas';
import { createServiceClient } from '../adapters/edge/service-client.js';
import { createDraftRetention } from '../adapters/sessions/draft-retention.js';
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
import { createProblemBar, StatusBar } from '../adapters/react/ShellAlerts.js';
import { createShellHooks } from '../adapters/react/shell-hooks.js';
import { mountWorkspace, observeWorkspaceWidth } from '../adapters/edge/browser-host.js';
import type { Result } from './errors.js';
import type { BrowserGlobals } from './ports/browser-globals.js';
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
import { panelTabs } from './compose/panel-tabs.js';
import { composeWorkspace } from './compose/workspace.js';

export { createInspectorSession, createWireSession } from './compose/sessions.js';

/** Browser entry reports startup failure visibly; restarting after correcting the dependency does not alter canonical diagram data. */
export async function startWeb(
  element: HTMLElement,
  globals: BrowserGlobals,
): Promise<Result<{ dispose(): void }>> {
  try {
    return await mount(element, globals);
  } catch (error) {
    return initializationFailure(error);
  }
}

/** Assemble once before rendering: every child/React Flow registry retains stable component identity across edits. */
async function mount(
  element: HTMLElement,
  globals: BrowserGlobals,
): Promise<Result<{ dispose(): void }>> {
  const client = createServiceClient();
  const retention = createDraftRetention(globals.storage());
  const installed = await resources(client);
  const design = accepted(await designBindings());
  const scope = accepted(createScopeInstaller(design.createScopeTarget(element)));
  const tokens = composeDesignSystem();
  const environment = readEnvironment(globals.window);
  const themes = themeChoices(tokens, installed.tokens, environment);
  const preferences = accepted(
    createPreferenceController({
      tokens,
      sources: installed.tokens,
      installer: scope,
      retention,
      environment,
      themes: themes.map(({ pin }) => pin),
    }),
  );
  const stopPreferences = observeEnvironment(globals.window, preferences.environment);
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
  // `panels` and `runtime` are declared below; these closures read them only after mount returns.
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
    retention,
    read: readPanelPreferences,
    report: (message) =>
      runtime.report({
        code: 'panel-preferences',
        message,
        recovery: 'Customize or reset the panel layout.',
        owner: 'panel-preferences',
      }),
  });
  const runtime: WorkspaceController = composeWorkspace({
    element,
    client,
    panels,
    retention,
    navigation: createWorkspaceNavigation(globals.window.location, globals.window.history),
    random: globals.random,
    now: globals.now,
  });
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
      tabs: panelTabs,
    }),
    Source: createSourceEditor(design, element),
    Recovery: createRequestRecovery(design),
    ProblemBar: createProblemBar(design),
    StatusBar,
    hooks: createShellHooks(globals.window),
    MovementReview: createMovementReview(design),
    Reveal: RevealInterface,
    CreateDialog: createCollectionDialog(design),
    Chooser: createCollectionChooser({ ...design, Browser: ChooserBrowser }),
    CanvasSurface: surface.CanvasSurface,
    FontDefinitions: presentation.FontDefinitions,
    portal: element,
    nextGestureId: globals.random,
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
