# Canvas

Owns interactive scene viewing and recoverable geometry intents. React Flow renders actual custom nodes and edges; Presentation supplies measured notation.

Use `createCanvas({sceneAdmission})` for pure operations, `createSession` for an observable session, and explicit `createReactBindings` for browser rendering. Compose once. Scene admission must bind validated Layout/Presentation results; no fallback renderer exists.

Host drains effects after every dispatch, forwards successful diagnostics, submits edits through Authoring and retains durable recovery. The host supplies random text for each new gesture (`nextGestureId`); Canvas parses it into a `GestureId` when the gesture begins (`adapters/react-flow/gesture-ids.ts`), and that gesture's events, drafts, intents and recovery entries carry it. Refused text is reported through `onError` and no gesture starts. Identical accepted edit IDs do not enqueue twice; conflicting reuse rejects. Pan/select events remain repeatable. Session admits at most 10,000 edit identities; preserve drafts before opening a replacement session.

Pointer metadata and reading/camera/selection are session state. Only emitted placement/route intents can become persisted constraints. React Flow records never enter persistence.

Contract cases include mounted drag/route behavior and real shared renderers.

## Navigate

- `adapters/react-flow/`: `CanvasSurface.tsx`, `SceneNode.tsx`, `SceneEdge.tsx`, `TreeRow.tsx`, `RoutingRoads.tsx`, controls and adjacent CSS.
- `core/interaction/`: selection, hover, keyboard and event handling.
- `core/scenes/`: view projection, focus, LOD and tree folding.
- `core/drafts/`: recoverable geometry gestures.
- `../presentation/adapters/react/`: measured node content/chrome; `../../apps/web/adapters/react/`: surrounding application panels.

Tree rows fold without changing section bounds. Individual tree rows cannot move or resize; the containing section remains movable.
