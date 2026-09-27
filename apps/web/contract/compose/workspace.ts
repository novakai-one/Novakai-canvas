/*
 * The workspace controller assembly: the Canvas and Language owners, the decoders and request
 * builders, every editor session factory and the submission session, joined into one workspace
 * session. Called once by compose.ts before rendering, which supplies every browser handle (draft
 * storage, navigation, clock, random text), so nothing here reads a browser global. The session
 * it returns owns recovery.
 */
import { createCanvas } from '@novakai/canvas-canvas';
import { createLanguage } from '@novakai/canvas-language';
import { validate, plan, stage } from '@novakai/canvas-model';
import { createLibraryController } from '../../adapters/sessions/library-session.js';
import { createLibraryReader } from '../../adapters/readers/library-reader.js';
import { readWireDrafts } from '../../adapters/readers/wire-reader.js';
import { readInspectorDrafts } from '../../adapters/readers/inspector-reader.js';
import { createDefinitionSession } from '../../adapters/sessions/definition-session.js';
import { readDefinitionDrafts } from '../../adapters/readers/definition-reader.js';
import { createSourceController } from '../../adapters/sessions/source-session.js';
import { readDiagram, createSceneAdmission } from '../../adapters/readers/diagram-reader.js';
import { createWorkspaceDecoders } from '../../adapters/edge/workspace-decoders.js';
import { createRequestBuilders } from '../../adapters/edge/request-builders.js';
import { createCanvasSessions } from '../../adapters/sessions/canvas-session.js';
import { createSubmissionSession } from '../../adapters/sessions/submission-session.js';
import { createSubmissionReaders } from '../../adapters/readers/submission-readers.js';
import { createWorkspaceController } from '../../adapters/sessions/workspace-session.js';
import { viewport } from '../../adapters/edge/browser-host.js';
import { previewModuleRoutes } from '../../adapters/readers/route-preview.js';
import { createIdSource } from '../../adapters/edge/ids.js';
import { planCanvasEdit, chooseMoveOption } from '../api.js';
import type { ServiceClient } from '../ports/client.js';
import type { DraftRetention } from '../ports/draft-retention.js';
import type { WorkspaceNavigation } from '../ports/navigation.js';
import type { WorkspaceBindings } from '../ports/workspace.js';
import type { PanelController } from '../panel-types.js';
import type { WorkspaceController } from '../records/workspace.js';
import type { VisitTime } from '../brands.js';
import { createMovementReviewBinding } from './movement-review.js';
import { createInspectorSession, createWireSession } from './sessions.js';

/** What the workspace is assembled from: its mount element, the service, the panels and browser handles. */
export interface WorkspaceParts {
  readonly element: HTMLElement;
  readonly client: ServiceClient;
  readonly panels: SidePanels;
  readonly retention: DraftRetention;
  readonly navigation: WorkspaceNavigation;
  /** Fresh random text (a UUID) for request, collection and folder IDs. */
  readonly random: () => string;
  /** The current time in epoch milliseconds, for Library visits. */
  readonly now: () => VisitTime;
}

/** The panel methods the workspace uses. */
type SidePanels = Pick<PanelController, 'restore' | 'open' | 'selectTab'>;

/**
 * The workspace controller. Native adapters receive narrow roles; every human mutation uses
 * captured Authoring preconditions. Cannot fail: collection and folder IDs come from the ID
 * source, which answers `id-unavailable` instead of throwing.
 */
export function composeWorkspace(parts: WorkspaceParts): WorkspaceController {
  const { element, client, retention, random } = parts;
  const ids = createIdSource(random);
  const canvas = createCanvas({ sceneAdmission: createSceneAdmission() });
  const language = createLanguage({ reader: { validate }, planner: { plan }, stage: { stage } });
  const inputs = { ...createWorkspaceDecoders(readDiagram), ...createRequestBuilders(language) };
  return createWorkspaceController({
    client,
    panels: sidePanels(parts.panels),
    navigation: parts.navigation,
    inputs,
    library: (callbacks) =>
      createLibraryController({
        retention,
        reader: createLibraryReader(),
        now: parts.now,
        nextFolderId: ids.folderId,
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
        nextId: random,
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
    ids,
    nextId: random,
  });
}

/** The panel roles the session uses. Opening the right side also selects the Inspect tab. */
function sidePanels(panels: SidePanels): WorkspaceBindings['panels'] {
  return {
    restore: panels.restore,
    open: (side, open) => {
      panels.open(side, open);
      if (side === 'right' && open) panels.selectTab('inspect');
    },
  };
}
