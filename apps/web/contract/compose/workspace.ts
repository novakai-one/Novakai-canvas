/*
 * The workspace controller assembly: the Canvas and Language owners, the decoders and request
 * builders (with the request identity checked here), every editor session factory and the
 * submission session, joined into one workspace session. The source editor's Apply request joins
 * the ID source to the DSL builder here, so the editor never mints. Called once by compose.ts
 * before rendering, which supplies every browser handle (draft storage, navigation, clock) and the
 * ID source, so nothing here reads a browser global. The session it returns owns recovery.
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
import { planCanvasEdit, chooseMoveOption } from '../api.js';
import type { ServiceClient } from '../ports/client.js';
import type { DraftRetention } from '../ports/draft-retention.js';
import type { WorkspaceNavigation } from '../ports/navigation.js';
import type { IdSource } from '../ports/ids.js';
import type { WorkspaceBindings } from '../ports/workspace.js';
import type { PanelController } from '../panel-types.js';
import type { WorkspaceController } from '../records/workspace.js';
import type { RequestBuilders } from '../ports/request-builders.js';
import type { RequestIdentity } from '../records/request-identity.js';
import type { SourceBindings } from '../records/source.js';
import type { VisitTime } from '../brands.js';
import type { Result } from '../errors.js';
import { createMovementReviewBinding } from './movement-review.js';
import { requestIdentity } from './request-identity.js';
import { createInspectorSession, createWireSession } from './sessions.js';

/** What the workspace is assembled from: its mount element, the service, the panels and browser handles. */
export interface WorkspaceParts {
  readonly element: HTMLElement;
  readonly client: ServiceClient;
  readonly panels: SidePanels;
  readonly retention: DraftRetention;
  readonly navigation: WorkspaceNavigation;
  /** The one ID source: request, collection, folder, diagram, object, group and relationship IDs. */
  readonly ids: IdSource;
  /** The current time in epoch milliseconds, for Library visits. */
  readonly now: () => VisitTime;
}

/** The panel methods the workspace uses. */
type SidePanels = Pick<PanelController, 'restore' | 'open' | 'selectTab'>;

/**
 * The workspace controller. Native adapters receive narrow roles; every human mutation uses
 * captured Authoring preconditions. Fails with `initialization-failed` only when Authoring refuses
 * the browser's request identity; new IDs come from the ID source, which answers
 * `id-unavailable` instead of throwing.
 */
export function composeWorkspace(parts: WorkspaceParts): Result<WorkspaceController> {
  const identity = requestIdentity();
  if (!identity.ok) return identity;
  return { ok: true, value: workspaceController(parts, identity.value) };
}

/** The workspace session over the owners, readers, builders and editor factories. Cannot fail. */
function workspaceController(
  parts: WorkspaceParts,
  identity: RequestIdentity,
): WorkspaceController {
  const { element, client, retention, ids } = parts;
  const canvas = createCanvas({ sceneAdmission: createSceneAdmission() });
  const language = createLanguage({ reader: { validate }, planner: { plan }, stage: { stage } });
  const builders = createRequestBuilders(language, identity);
  const inputs = { ...createWorkspaceDecoders(readDiagram), ...builders };
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
        dslPlanner: identity.planners.dsl,
        replaceRequest: sourceReplaceRequest(ids, builders),
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

/**
 * The source editor's Apply request: the draft as a DSL replace of the captured collection, under
 * a new request ID from the ID source. Fails with `id-unavailable` (nothing is built) or as the
 * DSL builder does.
 */
function sourceReplaceRequest(
  ids: Pick<IdSource, 'requestId'>,
  builders: Pick<RequestBuilders, 'dsl'>,
): SourceBindings['replaceRequest'] {
  return (captured, source) => {
    const request = ids.requestId();
    if (!request.ok) return request;
    return builders.dsl(captured.base, captured.collection, source, 'replace', request.value);
  };
}
