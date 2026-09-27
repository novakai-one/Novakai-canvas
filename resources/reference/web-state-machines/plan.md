# Web workspace as pure state machines: build plan (option 2)

| | |
|---|---|
| **What** | Replace `apps/web/adapters/sessions/workspace-session.ts` (1,746 lines) with pure state machines in `apps/web/core/` and one runner in `apps/web/adapters/`. |
| **Code base** | `owners-base` @ `5571c7e`, read-only. |
| **New work stacks on** | `origin/owners/delete-apps-tests`: the same web code with the apps tests deleted (checked: only `apps/web/tests/` differs). |
| **Built** | P1–P8: #115, #131, #135, #138, #140, #143, #151, #154. Their "Plan corrections needed" are applied here (28 Sep). |
| **Paths** | Under `apps/web/` unless they start with `capability/` or `apps/service/`. |
| **Sources** | The code, four research inventories (types, session map, inventory, movement), designs A and B. No Codex plan file was used. |
| **Tests** | None now (Chris, 27 Sep). Each PR is proven by a headless drive. Table tests are listed for later (§14). |
| **Corrections** | Every place this plan differs from the design text it was built from is listed in §15. |
| **Authority** | When this file and a canvas disagree, this file wins. The canvases are pictures of it. |

## Contents

1. Words used in this plan
2. Decisions
3. Facts checked in the code
4. Brands
5. Where each type lives
6. The machines
7. Root: routing, cross-machine rules, view
8. Runner, effects, executors, facade
9. Error codes
10. Target file tree
11. Behaviour kept
12. Intentional changes and the 17 quirks
13. PRs
14. Tests (later)
15. Corrections made while writing this plan
16. Open decisions for Chris

---

## 1. Words used in this plan

| Word | Meaning |
|---|---|
| Machine | A state type plus a pure function `update(state, event, context) → { state, effects, out }`. No I/O, clock or randomness. Each machine may return only its own effect kinds (§6.0). |
| Event | A plain object sent to the runner. Every event has `to` (the machine it is for) and `kind`. |
| Effect | A plain object that asks an adapter to do I/O: fetch, write storage, draw on the Canvas. Its answer comes back as an event. |
| Executor | The adapter that runs one family of effects. |
| Runner | The one adapter that queues events, calls the root machine, publishes the view and runs effects. |
| Out | A fact a machine reports to its parent, for example "send this request". |
| Lift file | `core/workspace/lift/<machine>.ts`. Turns one machine's outs into queued events for other machines. |
| Pass-down | The `diagram` machine handing an event to its gesture, connection or forms child (`diagram/children.ts`). |
| After-rule | A cross-machine rule run at the end of every event, inside the same step (F1–F6, `finalize.ts`). |
| Gate | `gatedSend`: the one rule every request passes before it is posted. Its request-free part, `sendReadiness`, also answers "may I send now?" for the view. |
| Command | An event a person starts: a click, a key, a drop. The list is `commandKeys` (§7.1). |
| Bridge | Temporary code that lets the old session and the runner run side by side while the session shrinks (§8.5). Deleted in the last machine PR. |
| View | The read-only object React renders. It is computed from the state (`projectWorkspace`). Each React feature gets its own part of it. |
| `may` | Part of the view: what a person may do now, with a reason when blocked. |
| Ticket | A counter stored in a machine. An answer is used only when its ticket is the newest. |
| Journal | The browser's list of sent requests (today `submission-session.ts`). |
| Catalogue | The last accepted workspace read: snapshot plus collections. |
| Table notation | `→` next state · `fx` effects · `out` facts for the parent · `—` nothing. A (state, event) pair not listed changes nothing. An answer whose ticket or request is not the current one is dropped. |

---

## 2. Decisions

| # | Decision | Why |
|---|---|---|
| D1 | **Two parent machines.** The root holds lifecycle, link, catalogue, journal, history, source and notices. The `diagram` parent holds navigation and `shown`. Gesture, connection and Add forms exist only inside `shown: open`. | Their lifetimes nest. The journal restores before any diagram opens (`workspace-session.ts:1431-1442`); the undo gate spans diagrams. A move review or connection draft left over after leaving a diagram (quirk 9) can no longer be represented. |
| D2 | Every event carries `to`. The root has one exhaustive `switch (event.to)`. Each machine has one lift file. Cross-machine rules run inside the same transition. The runner tells React about a change only when its queue is empty (R2). | Typed routing, no broadcast. React never sees a half-updated view, including the middle of a lift chain. |
| D3 | Pure helpers from other capabilities are injected as `WorkflowDeps` and called inside transitions: request builders, route preview, DSL print, connection policy. | The route preview is pure (§3), and the movement builders already take it injected. Choices appear at once after a local refusal with no extra phases. |
| D4 | The Canvas gets `reject` only when a gesture ends. After a server refusal that may offer choices, the Canvas entry stays `submitted`. No Canvas edit is planned; PR M28b is the fallback if the headless drive disproves this. | `draft-events.ts:31-35`, `reconcile.ts:61-75` |
| D5 | Machine state types live next to their machine in core. Types named by events, effects, ports or the view live in `contract/` (§5). The runner treats state as opaque. | Types sit with their owner (TS standard §1). Declaration files may not import core (`.dependency-cruiser.cjs`, `declarations-no-policy`). |
| D6 | The view is split by feature: `DiagramView`, `JournalView`, `HistoryView`, `EditingView`, `SourceView`, `status`, `may` (§7.7). Each React feature gets its own view part and its own command set (§8.4). Stored `busy` flags are removed; "can I act now?" has one answer, `may`. | Today React reads `Pick` slices of one flat view and one 38-member controller (`library-react.ts:4-5`, `react-types.ts:42-51`), and `busy` sits beside `may`. |
| D7 | Status text is derived. The notices machine stores only the problem slot and one status note. | Store each fact once. |
| D8 | The library, panel, preference, inspector/wire and definition stores stay stores until the U-series. They send through the journal. Inspector, wire and library get answers through waiters; definitions through one settle effect. U32–U42 turn them into machines and delete the waiters. | Smallest change for M-series. |
| D9 | `TransportGeneration` is a Service brand. `GestureId` is a Canvas brand, parsed by Canvas when a gesture begins. | Service mints the generation (`local-credentials.ts:102`). Canvas events carry gesture IDs (`react-types.ts:106,240`). |
| D10 | The journal writes storage first, then posts when the write answers. Two effects; the decision between them is made in core. | One piece of I/O per executor; the policy is testable. |
| D11 | The bridge (§8.5) lets old and new code run side by side. It has a written interface, a message table (which PR adds and removes each message) and a line budget. It is deleted in the last machine PR. | The app works after every PR. |
| D12 | No tests now. Each PR is proven by a headless drive. | Chris, 27 Sep. |

---

## 3. Facts checked in the code

| Claim | Evidence |
|---|---|
| The route preview is pure: no DOM, no fonts, no clock | `adapters/readers/route-preview.ts:29-37,71-86`; `capability/presentation/contract/compose.ts:148-156` |
| Core already receives the preview as an injected function | `core/editing/movement.ts:24-32,77-83`; `contract/compose/movement-review.ts:17-28` |
| Canvas accepts `preview-routes` only for a `submitted` entry at the current stamp. `reject` clears that gesture's preview | `capability/canvas/core/interaction/draft-events.ts:31-35`; `core/drafts/reconcile.ts:61-75` |
| Adapters may not import core or other adapters | `.dependency-cruiser.cjs`, `adapter-isolation` |
| Declaration files may not import core | `.dependency-cruiser.cjs`, `declarations-no-policy` |
| Web core may not import `@novakai/*`; it reaches owner types through `contract/records/owners.ts` | `eslint.config.js` (`coreForbidden`) |
| Today the request ID is the gesture ID. The journal also stores the gesture separately; three lookups match by request = gesture | `workspace-session.ts:891-906`; lookups at `:815, :850, :1489` |
| The service wire failure is `OperationSource` with `code: string`. Authoring and Service both have `invalid-input` and `cancelled` | `apps/service/contract/records/failure-source.ts:30`; `apps/service/contract/errors.ts:3-4`; `capability/authoring/contract/errors.ts:15-28` |
| Canvas, Library and Layout failures reach the web as they are | `react/WorkspaceShell.tsx:151` (`onError={controller.report}`); `readers/library-reader.ts:87`; `readers/route-preview.ts:88` |
| Authoring checks read versions before layout feasibility, so a foreign commit gives `revision-conflict`, never `constraint-conflict`. `constraint-conflict` comes only from the service's layout run | `capability/authoring/core/admission/pipeline.ts:96-105`; `apps/service/adapters/planning/feasibility.ts:29-36` |
| A fetch that throws becomes `connection-uncertain`; with no receipt, Check notes `No receipt found…` | `edge/service-client.ts:40-42`; `workspace-session.ts:1457` |
| The chooser's failure screen calls `beginCollectionSwitch` while the switch is `failed`; today it opens the chooser from any phase but `loading` and cancels a render in flight | `react/CollectionChooser.tsx:78,136`; `workspace-session.ts:1349-1353` |
| Editor stores await `apply()`; today a blocked send returns a failed `Result` to them | `sessions/retained-editor.ts:105`; `sessions/definition-session.ts:125-129`; `workspace-session.ts:908-931` |
| A snapshot that invalidates an in-flight render fails it, then reopens | `workspace-session.ts:316-356` |
| A new collection opens only after its carried snapshot is installed | `workspace-session.ts:969-1016, 1061-1068` |
| Authoring has 12 error codes; the web treats 8 as refusals | `capability/authoring/contract/errors.ts:15-28`; `core/editing/submissions.ts:33-44` |
| Model's index does not export `CollectionId`, `GroupId`, `RelationshipId` types | `capability/model/contract/index.ts:33` |
| Canvas's index does not export `ConnectionIntent` | `capability/canvas/contract/index.ts` |
| Service's index exports `ErrorCode` but not `OperationSource` | `apps/service/contract/index.ts:2`; `records/failure-source.ts:30` |
| Web mints IDs in 9 places, including React and the content ID | `compose.ts:200,242,254,269`; `compose/features.ts:79`; `react/Definitions.tsx:58`; `workspace-session.ts:200-202,1046` |
| `ConnectionPolicy` and `PaletteDrop` types are declared in core | `core/editing/connection/types.ts`; `core/editing/palette-drop.ts:8` |
| The dev server serves `apps/web/dist`, so a smoke needs a web build first | `apps/service/cli/serve.ts:39` |
| Zod is 4.6.2 (`z.ZodType<Output, Input>`; no `ZodTypeDef`) | `apps/web/package.json:20` |
| **Type-only imports hide 25 cycle reports and 3 web core-direction breaks.** By the module each report starts from: 14 `apps/web`, 2 `apps/service`, 7 `capability/layout`, 2 `capability/export`. Core-direction: `core/workspace/panel-state.ts`, `core/panels/preferences.ts`, `core/inspector/endpoints.ts` | `pnpm exec depcruise capability apps --config .dependency-cruiser.cjs --ts-pre-compilation-deps --output-type err` on `5571c7e` (27 Sep). `pnpm architecture` is repo-wide, so the flag cannot be turned on until all 25 are fixed. |

---

## 4. Brands

### 4.1 Every identity and domain scalar

| # | Kind | Web type | Owner | Minted or parsed at (one place) | PR |
|---|---|---|---|---|---|
| 1 | Transport generation | `TransportGeneration` | **Service (new brand)**, `apps/service/contract/brands.ts`; Service exports the runtime schema `transportGeneration` | Parsed by the service envelope schemas (`protocol.ts:11,51`). Stored generations are parsed with the same schema by the web readers: `submission-readers.ts:10`, `inspector-reader.ts:81,91`, `wire-reader.ts:58,69`, `definition-reader.ts:14`, `workspace-inputs.ts:139,146` (after P3: `workspace-decoders.ts`). Readers import it from `@novakai/canvas-service` (adapters may). | B1, B2b |
| 2 | Workspace | `WorkspaceId` | Authoring | Snapshot reader (already branded); panel-preference reader | B2a |
| 3 | Collection | `CollectionId` | Model (add the type export) | Minted: `IdSource.collectionId`. Parsed: URL reader, recovery readers | B3a |
| 4 | Request | `RequestId` | Authoring | Minted: `IdSource.requestId`. Parsed: journal reader | B4 |
| 5 | Gesture | `GestureId` | **Canvas (new brand)** | Canvas parses the host's random text when a gesture begins, in a new small file `capability/canvas/adapters/react-flow/gesture-ids.ts`. If parsing fails, no gesture starts. The web re-exports the type from B5 on. | B5 |
| 6 | Section, object, group, relationship, definition, descendant (content) | Model types | Model (add `GroupId`, `RelationshipId` to the index) | Minted: `IdSource`. Parsed: recovery readers. `Definitions.tsx:58` and `compose/features.ts:79` stop minting. | B3b |
| 7 | Canvas target, scene key | `TargetId`, `SceneKey` (named aliases; open decision §16 Q1) | Canvas | Turned into Model IDs only in `core/editing/targets.ts` and `placements.ts` | B1 |
| 8 | Draft keys | `ObjectDraftKey`, `WireDraftKey`, `DefinitionDraftKey` | Web | Made only by the three key functions. Readers rebuild the key and reject a mismatch. | B6a |
| 9 | Storage slot | `RetentionSlot` (closed union of 9) | Web | Only `draft-retention.ts` builds key text | B6a |
| 10 | Panel section | `PanelSectionId` (from an `as const` list) | Web | `z.enum` on the JSON file and on stored preferences | B6b |
| 11 | Source edit counter | `SourceEdit` | Web | `firstSourceEdit` / `nextCount(sourceEdit, e)` in the source machine; readers reuse the schema | B6b |
| 12 | Sequence, revision | `WorkspaceSequence`, `CollectionRevision` (named aliases; open decision §16 Q1) | Authoring / Model | Aliases only. `-1` becomes the `Listing` union. | B1 |
| 13 | Move choice | `ChoiceKind = 'expand' \| 'rearrange'` | Web | `MoveOption.id` is deleted; choices are keyed by kind | M27 |
| 14 | Latest-answer tickets | `ReadTicket`, `HistoryTicket`, `RenderId`, `JournalTick` | Web | Advanced only by the owning machine: `catalogue/` (ReadTicket), `history/` (HistoryTicket), `diagram/` (RenderId), `journal/` (JournalTick). ESLint `no-restricted-imports` with `importNames` lets only that folder import the ticket's schema and `nextCount` (M2). Kept in machine state; never written to storage. | M2 |
| 15 | Actor, planner | `ActorId`, `PlannerId` | Authoring | Checked once at composition with `safeParse`. | B4 |
| 16 | Folder, cursor, visit time | `FolderId`; `LibraryCursor`, `VisitTime` (named aliases; open decision §16 Q1) | Library | `IdSource.folderId` | B3a |
| 17 | Error codes | Closed unions (§9) | Web | — | ER1 |

Titles, labels and DSL text stay `string`. They are content, not identity. `ReadVersion` (`capability/authoring/contract/records/storage.ts:93`) is an owner record `{key, version}`, not a brand: it is imported as a record type through `contract/records/owners.ts`, and the local `ExpectedVersion` copy is deleted in B4.

The named aliases (rows 7, 12, 16) are not brands: an alias gives one name and one import place, so a later owner brand reaches the web with no web edits. Branding them is open decision §16 Q1.

### 4.2 `contract/brands.ts` (~130 lines)

```ts
/*
 * The web's identity vocabulary. Owner brands are re-exported unchanged. The web adds a brand only
 * where no owner has one, and each web brand is minted or parsed at one place, named on it.
 * Declarations and one pure helper; nothing to recover. Core, adapters and React take every ID
 * type from here.
 */
import { z } from 'zod';
import type { Snapshot } from '@novakai/canvas-authoring';
import type { Collection } from '@novakai/canvas-model';
import type { Target, TargetInfo } from '@novakai/canvas-canvas';
import type { QueryRequest, RecentVisit } from '@novakai/canvas-library';

export type { WorkspaceId, RequestId, RecordId, ActorId, PlannerId } from '@novakai/canvas-authoring';
export type {
  CollectionId, SectionId, ObjectId, GroupId, RelationshipId, DefinitionId, DescendantId,
} from '@novakai/canvas-model';
export type { FolderId } from '@novakai/canvas-library';
export type { TransportGeneration } from '@novakai/canvas-service';
/* B5 adds: export type { GestureId } from '@novakai/canvas-canvas'; */

/** A workspace's commit count (Authoring). An alias, so a later Authoring brand arrives unchanged. */
export type WorkspaceSequence = Snapshot['sequence'];
/** A collection's revision (Model). */
export type CollectionRevision = Collection['revision'];
/** A Canvas target ID. Only core/editing/targets.ts turns it into a Model ID. */
export type TargetId = Target['id'];
/** A Canvas scene index key. */
export type SceneKey = TargetInfo['key'];
/** A Library page cursor. */
export type LibraryCursor = NonNullable<QueryRequest['cursor']>;
/** When a collection was last opened. */
export type VisitTime = RecentVisit['openedAt'];

const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

/** Source-editor keystrokes. Parsed from storage only by the source and journal readers. */
export const sourceEdit = count.brand<'SourceEdit'>();
export type SourceEdit = z.infer<typeof sourceEdit>;

/**
 * Latest-answer tickets and the journal's clock. Each is advanced only by its own machine folder;
 * an ESLint no-restricted-imports rule (importNames) enforces that (§4.1 row 14).
 */
export const readTicket = count.brand<'ReadTicket'>();
export const historyTicket = count.brand<'HistoryTicket'>();
export const renderId = count.brand<'RenderId'>();
export const journalTick = count.brand<'JournalTick'>();
export type ReadTicket = z.infer<typeof readTicket>;
export type HistoryTicket = z.infer<typeof historyTicket>;
export type RenderId = z.infer<typeof renderId>;
export type JournalTick = z.infer<typeof journalTick>;

/** The first value of each count brand. `parse(0)` cannot throw: 0 is in range. */
export const firstSourceEdit: SourceEdit = sourceEdit.parse(0);
export const firstReadTicket: ReadTicket = readTicket.parse(0);
export const firstHistoryTicket: HistoryTicket = historyTicket.parse(0);
export const firstRender: RenderId = renderId.parse(0);
export const firstTick: JournalTick = journalTick.parse(0);

/**
 * The value after `current` in the same brand. At MAX_SAFE_INTEGER (about 9e15 steps; not
 * reachable in one browser session) it returns `current` unchanged. Never fails.
 */
export function nextCount<T extends number>(schema: z.ZodType<T, number>, current: T): T {
  const next = schema.safeParse(current + 1);
  if (!next.success) return current;
  return next.data;
}

export type ChoiceKind = 'expand' | 'rearrange';
export type FormKind = 'diagram' | 'object' | 'group';
export type Direction = 'undo' | 'redo';
export type EditorKind = 'inspector' | 'wires' | 'definitions' | 'library';
export type RetentionSlot =
  | 'pending' | 'source-draft' | 'inspector' | 'wire-inspector' | 'definitions'
  | 'panels' | 'folder-draft' | 'visits' | 'ui-preferences';
export const panelSectionIds = [
  'creation', 'collections', 'sections', 'objects', 'export', 'definitions',
  'shared-content', 'connection', 'interface',
] as const;
export type PanelSectionId = (typeof panelSectionIds)[number];
/* ObjectDraftKey, WireDraftKey, DefinitionDraftKey: string brands added in B6a. */
```

### 4.3 The one ID source

```ts
// contract/ports/ids.ts (~40 lines)
/** New IDs for the facade and the executors. Core never mints; minted IDs arrive on events. */
export interface IdSource {
  requestId(): Result<RequestId>;
  collectionId(): Result<CollectionId>;     // `collection-<uuid>`: Model IDs start with a letter
  sectionId(): Result<SectionId>;
  objectId(): Result<ObjectId>;
  groupId(): Result<GroupId>;
  relationshipId(): Result<RelationshipId>;
  definitionId(): Result<DefinitionId>;
  descendantId(): Result<DescendantId>;     // content IDs; today compose/features.ts:79
  folderId(): Result<FolderId>;
}
```

- `adapters/edge/ids.ts` (~90 lines) builds each value from `random()` and checks it with the owner's schema using `safeParse`, never `parse`. The only failure code is `id-unavailable`. The caller reports it and keeps its draft.
- The web calls `crypto.randomUUID()` in exactly one place: `cli/main.ts`, the browser entry (P3). It reaches composition as `BrowserGlobals.random` (`contract/ports/browser-globals.ts`). `contract/compose/workspace.ts` passes `random` to `createIdSource` and to Canvas `nextGestureId`; Canvas parses that value itself. Until B3b, `compose/features.ts` builds content IDs from `random` (P6).
- ID text. All but the relationship ID match today's text, so stored drafts and records keep working:

| ID | Text | Today |
|---|---|---|
| Request | `<uuid>` | same (`compose/workspace.ts`; was `compose.ts:254,269`) |
| Collection | `collection-<uuid>` | same (`workspace-session.ts:1046`) |
| Section, object, group | `section-<uuid>`, `object-<uuid>`, `group-<uuid>` | same (`workspace-session.ts:200-202`) |
| Relationship | `relationship-<uuid>` | `relationship-<gesture ID>` (`core/editing/connection/request.ts:69`); change I28 |
| Definition | `definition-<uuid>` | same (`react/Definitions.tsx:58`) |
| Content (descendant) | `content-<uuid>` | same (`compose/features.ts`, from `random` since P6) |
| Folder | `folder-<uuid>` | same (`compose/workspace.ts`; was `compose.ts:242`) |

---

## 5. Where each type lives

Rule: a type named by an event, an effect, a port or the view is a declaration in `contract/`. A type named only by transitions lives in core, next to its machine.

| Types | File | Why |
|---|---|---|
| Events of every machine; `LocationRead`, `CommitSeen`, `Latest`, `Origin`, `SendGeneration`, `SendWanted`, `RefusedCode`, `Settlement`, `ApplyAnswer`, `ReceiptAnswer`, `JournalWrite`, `RetainedEntry`, `SourceDraft`, `FailureShown`, `StatusNote`, `Listing`, `Via`, `RenderTicket`, `RenderAnswer`, `ShownFacts`, `CanvasEditIntent`, `ConnectionIntent`, `PreviewAsk`, `PreviewPlan`, `DraftOf`, `IdOf`, `SendBlock`, `SendTarget`, `AdmittedSend` | `contract/records/workflow/<machine>.ts`, `gate.ts` | Events and effects name them. |
| `CommandKey`, `commandKeys` | `contract/records/workflow/events.ts` | F6 and the facade use one list. |
| `PaletteDrop` (moved from `core/editing/palette-drop.ts`) | `contract/records/creation.ts` | `FormsEvent` names it. |
| Effects by family; `SceneFlags`, `GestureSettle`, `LocationTarget`; `Executor<E, A>` | `contract/records/workflow/effects.ts` | Executors run them. |
| `RootStep`, `WorkflowMachine` | `contract/records/workflow/machine.ts` | The runner drives them. |
| `ProjectedView`, `DiagramView`, `JournalView`, `PendingView`, `HistoryView`, `EditingView`, `SourceView` | `contract/records/workflow/view.ts` | React reads them. |
| `Permission`, `Permissions`, `BlockReason` | `contract/records/workflow/permissions.ts` | React reads them. |
| The command sets (`NavigationCommands` … `EditorSends`) and `WorkspaceController` | `contract/records/commands.ts`, `contract/records/workspace.ts` | React calls them (§8.4). |
| `WorkflowDeps`, `HistoryPlan`, `RoutePreview` | `contract/ports/workflow-deps.ts` | Injected at composition. |
| `RequestBuilders`, `WorkspaceDecoders` | `contract/ports/request-builders.ts`, `contract/ports/workspace-decoders.ts` (P2a). M1 reshapes `RequestBuilders` to §6.0; no second port. | Seams an adapter implements. |
| `ConnectionPolicy`, `IdGrammar` (moved from `core/editing/connection/types.ts`) | `contract/ports/connection-policy.ts` | `WorkflowDeps` names them; a port may not import core. |
| `IdSource` | `contract/ports/ids.ts` | Facade and executors call it. |
| `ExecutorHandles`, `CanvasHandles`, `BrowserHandles`, `StoreHandles`, `Waiters` | `contract/ports/executors.ts` | Compose passes them to executors (§8.6). |
| `SessionBridge`, `LegacySession` (temporary) | `contract/ports/bridge.ts` | Compose joins the runner and the old session (§8.5). |
| Machine states, outs, contexts, per-machine effect subsets: `Lifecycle`, `Link`, `Reach`, `Catalogue`, `Journal`, `JournalEntry`, `EntryPhase`, `History`, `Gate`, `SourceEditor`, `Readout`, `OwnSend`, `Notices`, `ProblemSlot`, `DiagramSession`, `Navigation`, `Install`, `OpenDiagram`, `Shown`, `SceneContext`, `SourceContext`, `DiagramContext`, `Gesture`, `GestureCapture`, `Choice`, `Choices`, `GesturePlan`, `Connection`, `Forms`, `Form`, `FormNote`, `Workspace`, `Step`, `JournalEffect` and the other `<Machine>Effect` subsets | `core/workspace/<machine>/state.ts`, `core/workspace/step.ts`, `core/workspace/state.ts`, `core/workspace/contexts.ts`, `core/editing/gesture-plan.ts` | D5. Adapters cannot read internal state, only the view. |
| `GateContext`, `SendMode` | `core/workspace/rules/gated-send.ts` | `GateContext` names the core `Gate`. |

---

## 6. The machines

### 6.0 Shared shape

```ts
// core/workspace/step.ts: a child machine's answer to one event
/**
 * Next state, I/O to run, and facts for the parent. `E` is the machine's own effect subset, so a
 * machine cannot return another machine's effects: only `JournalEffect` contains `ApplyEffect`.
 */
export interface Step<S, O, E extends Effect> {
  readonly state: S;
  readonly effects: readonly E[];
  readonly out: readonly O[];
}
// Each machine's state.ts names its subset, e.g.
// type JournalEffect = ApplyEffect | Extract<ServiceEffect, { kind: 'read-receipt' }> | JournalStorageEffect;
// type GestureEffect = Extract<SceneEffect, { kind: 'settle-gesture' | 'preview' }>;

// contract/records/workflow/machine.ts: what the runner drives (state is opaque to adapters)
export interface RootStep<W> {
  readonly state: W;
  readonly effects: readonly Effect[];
  readonly events: readonly WorkspaceEvent[]; // queued FIFO after this step
}
export interface WorkflowMachine<W> {
  readonly initial: W;
  transition(state: W, event: WorkspaceEvent): RootStep<W>;
}

// contract/ports/workflow-deps.ts: pure helpers, injected at composition (D3)
export interface WorkflowDeps {
  readonly requests: RequestBuilders;             // adapters/edge/request-builders.ts (Authoring schemas)
  readonly preview: RoutePreview;                 // adapters/readers/route-preview.ts (Layout re-measure)
  readonly connection: ConnectionPolicy;          // contract/workspace-model.ts (Model tables)
  print(collection: Collection): Result<string>;  // Language print
}
export interface RequestBuilders {
  model(base: EditingBase, collection: CollectionId, changes: readonly Change[], request: RequestId): Result<Request>;
  dsl(base: EditingBase, collection: CollectionId, source: string, request: RequestId): Result<Request>;
  create(base: Snapshot, collection: CollectionId, title: string, request: RequestId): Result<Request>;
  library(base: Snapshot, changes: readonly OrganisationChange[], request: RequestId): Result<Request>;
  history(status: HistoryStatus, direction: Direction, request: RequestId): Result<HistoryPlan>;
}
export type HistoryPlan = { readonly kind: 'nothing' } | { readonly kind: 'request'; readonly request: Request };
export type RoutePreview = (document: RenderDocument, intent: PlacementIntent, changes: readonly Change[]) => Result<PreviewPlan>;

// contract/records/workflow/gesture.ts
export type PreviewPlan = { readonly kind: 'none' } | { readonly kind: 'routes'; readonly preview: GeometryPreview };
```

- Web core (`planCanvasEdit`, the movement builders, `core/creation/records.ts`) is called directly, not injected.
- Every update is an exhaustive `switch` whose cases call one-guard helpers (Sonar complexity ≤ 2).

House-style exemplar for every machine file:

```ts
// core/workspace/link/link.ts (~100 lines)
/*
 * The change-stream link: whether the stream is watched and open, whether the service answered
 * lately, and whether a commit notice means the catalogue must be read again. Pure. The service
 * executor owns reconnecting; the catalogue owns the reread.
 */
/**
 * The link after `event`. Asks for a reread every time the stream opens, when a notice cannot be
 * read, or when a notice names a commit this browser has not installed and is not itself waiting
 * for. A successful read changes only `reach`, never the stream phase. Never fails.
 */
export function updateLink(state: Link, event: LinkEvent, context: LinkContext): Step<Link, LinkOut, LinkEffect> {
  switch (event.kind) {
    case 'watch-wanted':
      return watch(state);
    case 'stream-opened':
      return opened(state);
    case 'stream-failed':
      return failed(state);
    case 'read-succeeded':
      return reached(state);
    case 'commit-seen':
      return commit(state, event.seen, context);
    default:
      return unsupported(event);
  }
}

/** Starts watching once. A second request while watching changes nothing. */
function watch(state: Link): Step<Link, LinkOut, LinkEffect> {
  if (state.stream !== 'unwatched') return unchanged(state);
  return { state: { ...state, stream: 'connecting' }, effects: [watchChanges], out: [] };
}
/* opened, failed, reached, commit, unseenForeign: one guard each, in reading order. */
```

### 6.1 `lifecycle`: `core/workspace/lifecycle/*` (~120 lines)

```ts
// contract/records/workflow/lifecycle.ts
export type LocationRead =
  | { readonly kind: 'none' }
  | { readonly kind: 'collection'; readonly collection: CollectionId }
  | { readonly kind: 'invalid'; readonly problem: Diagnostic };
export type LifecycleEvent =
  | { readonly to: 'lifecycle'; readonly kind: 'started' }
  | { readonly to: 'lifecycle'; readonly kind: 'first-snapshot' }
  | { readonly to: 'lifecycle'; readonly kind: 'first-read-failed' }
  | { readonly to: 'lifecycle'; readonly kind: 'location-read'; readonly location: LocationRead }
  | { readonly to: 'lifecycle'; readonly kind: 'location-settled' }
  | { readonly to: 'lifecycle'; readonly kind: 'disposed' };

// core/workspace/lifecycle/state.ts
export type Lifecycle =
  | { readonly phase: 'booting' }
  | { readonly phase: 'reading' }   // no snapshot accepted yet
  | { readonly phase: 'locating' }  // opening the collection named in the URL
  | { readonly phase: 'live' }
  | { readonly phase: 'disposed' };
export type LifecycleOut =
  | { readonly kind: 'read-wanted' } | { readonly kind: 'watch-wanted' }
  | { readonly kind: 'open-wanted'; readonly collection: CollectionId }
  | { readonly kind: 'report'; readonly problem: Diagnostic };
```

| State | Event | → | fx | out |
|---|---|---|---|---|
| booting | started | reading | bind-keys | read-wanted |
| reading | first-snapshot | locating | read-location | — |
| reading | first-read-failed | reading | — | watch-wanted (a reconnect rereads) |
| locating | location-read none | live | — | watch-wanted |
| locating | location-read collection | locating | — | open-wanted |
| locating | location-read invalid | live | — | report, watch-wanted |
| locating | location-settled | live | — | watch-wanted |
| ≠ disposed | disposed | disposed | unbind-keys, stop-watching, scene close | — |

- **L1.** After a successful first read, the change stream is watched only after the URL collection has opened, failed or been replaced by another open.
- **L2.** `disposed` is terminal. The root ignores every later event (§7.2); the runner closes (§8.1).
- **L3.** `locating` always ends. The diagram accepts `open-requested` in every navigation phase once the catalogue is read (§6.8), and every exit from `opening` sends `navigation-settled` (install, fail, a newer open, the chooser opening). The lifecycle ignores `navigation-settled` outside `locating`.

### 6.2 `link`: `core/workspace/link/*` (~125 lines)

```ts
// contract/records/workflow/link.ts
export type CommitSeen = { readonly kind: 'commit'; readonly commit: CommitNotice } | { readonly kind: 'unreadable' };
export type LinkEvent =
  | { readonly to: 'link'; readonly kind: 'watch-wanted' }
  | { readonly to: 'link'; readonly kind: 'stream-opened' }
  | { readonly to: 'link'; readonly kind: 'stream-failed' }
  | { readonly to: 'link'; readonly kind: 'read-succeeded' }
  | { readonly to: 'link'; readonly kind: 'commit-seen'; readonly seen: CommitSeen };

// core/workspace/link/state.ts
/** Whether the service answered lately. Only reads and stream failures change it. */
export type Reach = 'unknown' | 'reachable' | 'unreachable';
/** Two facts: the stream phase, and reach. An open stream means reachable, so it carries no reach. */
export type Link =
  | { readonly stream: 'open' }
  | { readonly stream: 'unwatched' | 'connecting' | 'closed'; readonly reach: Reach };
export interface LinkContext {
  readonly installed: WorkspaceSequence | 'unread';
  readonly sending: readonly RequestId[]; // this browser's entries in phase `sending`
}
export type LinkOut = { readonly kind: 'reread-wanted' };
export type LinkEffect = Extract<ServiceEffect, { kind: 'watch-changes' }>;
```

| State | Event | → | fx | out |
|---|---|---|---|---|
| unwatched | watch-wanted | connecting (reach kept) | watch-changes | — |
| connecting / closed | stream-opened | open | — | reread-wanted (always) |
| connecting / open | stream-failed | closed{reach: unreachable} | — | — |
| unwatched / connecting / closed | read-succeeded | same stream, reach: reachable | — | — |
| open | read-succeeded | same | — | — |
| open | commit-seen unreadable | open | — | reread-wanted |
| open | commit-seen c, `c.sequence > installed ∧ c.request ∉ sending` | open | — | reread-wanted |

- **K1.** A commit notice for this browser's own request that is still `sending` never triggers a reread; its own answer installs the snapshot. An own `uncertain` request is not skipped.
- **K2.** A read never moves the stream phase. So `watch-wanted` after the first read still finds `unwatched` and opens the stream, and every open (first or reconnect) asks for a reread: commits made before the stream opened are read.
- `connected` (view) and the Canvas `online` flag ≡ `stream = open ∨ reach = reachable` (change I22). The Canvas flag is pushed by after-rule F5, not by this machine.

### 6.3 `catalogue`: `core/workspace/catalogue/*` (~110 lines)

```ts
// contract/records/workflow/catalogue.ts
export interface Latest {
  readonly generation: TransportGeneration;
  readonly snapshot: Snapshot;              // .workspace: WorkspaceId, .sequence: WorkspaceSequence
  readonly collections: readonly Collection[];
}
export type CatalogueEvent =
  | { readonly to: 'catalogue'; readonly kind: 'read-wanted' }
  | { readonly to: 'catalogue'; readonly kind: 'read-answered'; readonly ticket: ReadTicket; readonly answer: Result<Latest> }
  | { readonly to: 'catalogue'; readonly kind: 'carried'; readonly carried: CarriedSnapshot };

// core/workspace/catalogue/state.ts
export type Catalogue =
  | { readonly phase: 'unread'; readonly issued: ReadTicket }
  | { readonly phase: 'read'; readonly issued: ReadTicket; readonly latest: Latest };
export type CatalogueOut =
  | { readonly kind: 'accepted'; readonly latest: Latest; readonly previous: Latest | 'none' }
  | { readonly kind: 'read-failed'; readonly problem: Diagnostic; readonly read: 'first' | 'later' };
```

| State | Event | → | fx | out |
|---|---|---|---|---|
| any | read-wanted | issued′ = next | read-workspace{issued′} | — |
| any | read-answered, ticket = issued, failure | same | — | read-failed |
| any | read-answered, ticket = issued, L not stale | read{L} | — | accepted |
| read | carried S, not stale | read{generation: latest.generation, S} | — | accepted |

- `stale(L) ≡ L.generation = latest.generation ∧ L.snapshot.sequence < latest.snapshot.sequence`
- **CT1.** Within one generation, the sequence never goes down.
- **CT2.** Only the answer to the newest issued ticket is applied. Reads are never aborted; the ticket decides.

### 6.4 `journal`: replaces `submission-session.ts`. `core/workspace/journal/*` (7 files: state, journal, send, answers, recovery, restore, entries; ≤ 120 lines each)

```ts
// contract/records/workflow/journal.ts: who sent a request; routes its settlement to one owner
export type Origin =
  | { readonly kind: 'gesture'; readonly collection: CollectionId; readonly gesture: GestureId }
  | { readonly kind: 'move-choice'; readonly collection: CollectionId; readonly gesture: GestureId; readonly choice: ChoiceKind }
  | { readonly kind: 'connection'; readonly collection: CollectionId }
  | { readonly kind: 'add-form'; readonly collection: CollectionId; readonly form: FormKind }
  | { readonly kind: 'palette'; readonly collection: CollectionId }
  | { readonly kind: 'create-collection'; readonly collection: CollectionId }
  | { readonly kind: 'source'; readonly collection: CollectionId; readonly edit: SourceEdit }
  | { readonly kind: 'history'; readonly direction: Direction }
  | { readonly kind: 'editor'; readonly editor: EditorKind }
  | { readonly kind: 'restored' }; // restored from storage with no live owner
/**
 * `current` only for history, create-collection and the library editor (they act on the latest
 * read). Every other origin sends `captured`: gesture and move-choice use the gesture capture's
 * generation, palette and add-form the open diagram's, connection its draft's, source its draft's,
 * the inspector, wire and definition editors their draft's.
 */
export type SendGeneration = { readonly kind: 'captured'; readonly generation: TransportGeneration } | { readonly kind: 'current' };
export interface SendWanted { readonly request: Request; readonly generation: SendGeneration; readonly origin: Origin }
/** The 8 Authoring codes the web treats as refusals (today `core/editing/submissions.ts:33-44`). */
export type RefusedCode =
  | 'invalid-input' | 'unsupported-version' | 'unknown-reference' | 'invariant-violation'
  | 'constraint-conflict' | 'revision-conflict' | 'missing-asset' | 'permission-denied';
/** An Authoring refusal: the class is decided once, by the apply executor (§9). */
export interface Refusal { readonly code: RefusedCode; readonly problem: AuthoringDiagnostic }
export type Settlement = { readonly kind: 'confirmed'; readonly receipt: Receipt } | { readonly kind: 'refused'; readonly refusal: Refusal };
export type ApplyAnswer =
  | { readonly kind: 'committed'; readonly receipt: Receipt; readonly carried: CarriedSnapshot }
  | { readonly kind: 'refused'; readonly refusal: Refusal }
  | { readonly kind: 'unknown'; readonly problem: Diagnostic };
export type ReceiptAnswer =
  | { readonly kind: 'found'; readonly receipt: Receipt } | { readonly kind: 'none' }
  | { readonly kind: 'failed'; readonly problem: Diagnostic };
export type JournalWrite = { readonly kind: 'before-send'; readonly request: RequestId } | { readonly kind: 'after-change' };
/** One request as kept in storage. The storage executor maps it to the unchanged stored shape (table below). */
export interface RetainedEntry {
  readonly request: Request;
  readonly generation: TransportGeneration;
  readonly origin: Origin;
  readonly state: 'sending' | 'uncertain' | 'retryable';
}
export type JournalEvent =
  | { readonly to: 'journal'; readonly kind: 'bind'; readonly workspace: WorkspaceId }
  | { readonly to: 'journal'; readonly kind: 'loaded'; readonly workspace: WorkspaceId; readonly stored: Result<readonly RetainedEntry[]> }
  | { readonly to: 'journal'; readonly kind: 'send-wanted'; readonly send: SendWanted }
  | { readonly to: 'journal'; readonly kind: 'written'; readonly workspace: WorkspaceId; readonly purpose: JournalWrite; readonly result: Result<void> }
  | { readonly to: 'journal'; readonly kind: 'apply-answered'; readonly request: RequestId; readonly answer: ApplyAnswer }
  | { readonly to: 'journal'; readonly kind: 'check-requested'; readonly request: RequestId }
  | { readonly to: 'journal'; readonly kind: 'retry-requested'; readonly request: RequestId }
  | { readonly to: 'journal'; readonly kind: 'receipt-answered'; readonly request: RequestId; readonly answer: ReceiptAnswer }
  | { readonly to: 'journal'; readonly kind: 'dismiss-requested'; readonly request: RequestId; readonly by: 'person' | 'system' };

// core/workspace/journal/state.ts
export type EntryPhase =
  | { readonly phase: 'recording'; readonly after: 'new' | 'retryable' } // storage write before the post; `retryable` = a Retry
  | { readonly phase: 'sending' }
  | { readonly phase: 'uncertain' }
  | { readonly phase: 'checking'; readonly after: 'uncertain' | 'retryable' }
  | { readonly phase: 'looking-up'; readonly after: 'uncertain' | 'retryable' } // Retry's receipt lookup
  | { readonly phase: 'retryable' }
  | { readonly phase: 'rejected'; readonly refusal: Refusal; readonly at: JournalTick }; // the one copy of a refusal
export interface JournalEntry {
  readonly request: Request;                 // request.request: RequestId
  readonly generation: TransportGeneration;
  readonly origin: Origin;
  readonly started: JournalTick;
  readonly phase: EntryPhase;
  readonly autoCheck: 'waiting' | 'no';      // a restored undo/redo not yet checked; checked one at a time, in entry order
}
export type Journal =
  | { readonly phase: 'unbound' }
  | { readonly phase: 'restoring'; readonly workspace: WorkspaceId }
  | BoundJournal;
export interface BoundJournal {
  readonly phase: 'bound';
  readonly workspace: WorkspaceId;
  readonly entries: readonly JournalEntry[];
  readonly clock: JournalTick;
}
export type JournalEffect =
  | ApplyEffect | Extract<ServiceEffect, { kind: 'read-receipt' }>
  | Extract<StorageEffect, { kind: 'write-journal' | 'read-journal' }>;
export type JournalOut =
  | { readonly kind: 'started'; readonly entry: JournalEntry }
  | { readonly kind: 'settled'; readonly entry: JournalEntry; readonly outcome: Settlement; readonly carried: CarriedSnapshot | 'none' }
  | { readonly kind: 'uncertain'; readonly entry: JournalEntry; readonly problem: Diagnostic }
  | { readonly kind: 'blocked'; readonly send: SendWanted; readonly block: SendBlock }
  | { readonly kind: 'dismissed'; readonly entry: JournalEntry }
  | { readonly kind: 'no-receipt'; readonly request: RequestId }
  | { readonly kind: 'restored-inverse'; readonly request: RequestId }
  | { readonly kind: 'report'; readonly problem: Diagnostic };
```

Storage shape is unchanged: `{request, generation, sourceEdit, gesture, state}`.

| Stored field | Written from | Read back |
|---|---|---|
| `request` | `entry.request` | `request` |
| `generation` | `entry.generation` | branded by the reader |
| `sourceEdit` | `source` origin → its `edit`; any other origin → `firstSourceEdit` | used only by `restoredOrigin` |
| `gesture` | `gesture` / `move-choice` origin → its gesture; else `null` | ignored: a Canvas gesture does not survive a reload |
| `state` | recording, sending → `sending`; uncertain, checking, looking-up → `uncertain`; retryable → `retryable`; rejected → never written | ignored: every restored entry becomes `uncertain` |

`restoredOrigin` (a pure function in `adapters/readers/submission-readers.ts`):
- an undo/redo intent → `history`;
- a `dsl` change whose scope names one collection → `source{collection, edit}` (the same test as `source-session.ts:75-81` today);
- anything else → `restored`.

| State | Event | Guard | → | fx | out |
|---|---|---|---|---|---|
| any | bind ws | ws ≠ bound ws | restoring{ws} | read-journal | — |
| restoring{ws} | loaded ok | — | bound: own-workspace, not-rejected entries, all `uncertain`; inverses get autoCheck `waiting`; the first waiting entry → checking{after: uncertain} | write-journal after-change; read-receipt for that entry | restored-inverse per inverse |
| restoring | loaded failure | — | bound{[]} | — | report |
| unbound / restoring | send-wanted | — | same | — | blocked `not-restored` |
| bound | send-wanted s | `gatedSend(first)` admits | + entry recording{after: new} (started = tick′, generation admitted, autoCheck no) | write-journal{before-send r} | — |
| bound | send-wanted s | gate blocks | same | — | blocked{code} |
| recording r | written before-send ok | — | sending | post-apply{admitted} | started |
| recording{new} r | written before-send failed | — | − r | — | blocked `journal-unsaved` |
| recording{retryable} r | written before-send failed | — | retryable | — | report `journal-unsaved` |
| any | written after-change failed | — | same | — | report (the change stays published) |
| sending r | apply-answered committed | receipt names r (checked by the executor) | − r | write-journal | settled confirmed{carried} |
| sending r | apply-answered refused{refusal} | — (the executor already classified it) | rejected{refusal, at: tick′} | write-journal (rejected excluded) | settled refused |
| sending r | apply-answered unknown | — | uncertain | write-journal | uncertain |
| uncertain / retryable r | check-requested | — | checking{after} | read-receipt | — |
| uncertain / retryable r | retry-requested | — | looking-up{after} | read-receipt | — |
| other phase | check / retry | — | same | — | report `pending-request` |
| r unknown | check / retry / dismiss | — | same | — | report `unknown-request` |
| checking / looking-up r | receipt-answered found | — | − r | write-journal | settled confirmed{carried none} |
| checking r | receipt-answered none | — | retryable | write-journal | no-receipt |
| looking-up r | receipt-answered none | `gatedSend(resend)` admits | recording{after: retryable} (generation = current) | write-journal{before-send r} | — |
| looking-up r | receipt-answered none | gate blocks | retryable | — | blocked |
| checking / looking-up r | receipt-answered failed | — | `after` | — | report |
| r autoCheck waiting | receipt-answered | — | as the rows above; r autoCheck no; the next waiting entry → checking{after: uncertain} | read-receipt for the next | as above |
| rejected r | dismiss-requested | — | − r | — | dismissed |
| not rejected | dismiss-requested | — | same | — | report `confirmation-required` |

- **J1.** Every entry belongs to `workspace`.
- **J2.** No two unrefused entries write the same record (one request in flight per collection).
- **J3.** `post-apply` for r is emitted only after the before-send write of r has succeeded, and it carries the `AdmittedSend` that `gatedSend` returned. Three limits:
  - Types: only `JournalEffect` contains `ApplyEffect` (§6.0), so no other machine's step can return it.
  - Lint inside core: the `'post-apply'` literal may appear under `apps/web/core` only in `journal/send.ts`, and `journal/send.ts` may be imported only from `journal/` (`no-restricted-imports`).
  - Lint config: a folder override in flat config replaces the global `no-restricted-syntax` options, so every override repeats the `ExportAllDeclaration` selector through one `syntax(extra)` helper, as `restrict()` already repeats `capabilityEntry` (`eslint.config.js:30-34`).
- **J4.** Rejected entries are never stored.
- **J5.** Retry posts the same RequestId and body under the current generation.
- **J6.** Check and Retry are phases (`checking`, `looking-up`), so a second click is refused by phase.

### 6.5 `history`: `core/workspace/history/*` (history.ts ~130, gate.ts ~80, navigable.ts ~40)

```ts
// contract/records/workflow/history.ts
export type CanvasActivity = 'idle' | 'drafting';
export type HistoryEvent =
  | { readonly to: 'history'; readonly kind: 'requested'; readonly direction: Direction; readonly request: RequestId; readonly canvas: CanvasActivity }
  | { readonly to: 'history'; readonly kind: 'status-wanted' }
  | { readonly to: 'history'; readonly kind: 'status-answered'; readonly ticket: HistoryTicket; readonly answer: Result<HistoryStatus> }
  | { readonly to: 'history'; readonly kind: 'settled'; readonly request: RequestId; readonly outcome: Settlement }
  | { readonly to: 'history'; readonly kind: 'blocked'; readonly request: RequestId }
  | { readonly to: 'history'; readonly kind: 'snapshot-seen'; readonly sequence: WorkspaceSequence }
  | { readonly to: 'history'; readonly kind: 'restored-inverse'; readonly request: RequestId };

// core/workspace/history/state.ts
export type Gate =
  | { readonly phase: 'idle' }
  | { readonly phase: 'sending'; readonly request: RequestId }            // sending, uncertain or retryable
  | { readonly phase: 'settling'; readonly sequence: WorkspaceSequence }  // waiting for a snapshot at or past it
  | { readonly phase: 'caught-up'; readonly sequence: WorkspaceSequence }; // waiting for the release rule (F4)
export type HistoryKnowledge = { readonly kind: 'unknown' } | { readonly kind: 'known'; readonly status: HistoryStatus };
export interface History { readonly gate: Gate; readonly status: HistoryKnowledge; readonly issued: HistoryTicket }
export interface HistoryContext { readonly journal: 'quiet' | 'busy'; readonly latest: Latest | 'unread' }
export type HistoryOut = { readonly kind: 'send'; readonly send: SendWanted } | { readonly kind: 'report'; readonly problem: Diagnostic };
```

| Gate | Event | Guard | → | fx | out |
|---|---|---|---|---|---|
| idle | requested d r c | navigable, builder gives a request | sending{r} | — | send (origin history, generation current) |
| idle | requested | builder gives `nothing` / not navigable | idle | — | — |
| idle | requested | builder fails | idle | — | report |
| sending{r} | blocked r | — | idle | — | — |
| sending{r} | settled r confirmed | — | settling{receipt.sequence} | read-history | — |
| sending{r} | settled r refused | — | settling{latest.sequence} | read-history | — |
| settling{s} | snapshot-seen q ≥ s | — | caught-up{s} | — | — |
| idle | restored-inverse r | — | sending{r} | — | — |
| any | status-wanted | — | issued′ | read-history{issued′} | — |
| any | status-answered, ticket = issued | — | known, or unknown on failure (not reported) | — | — |

- **H1.** `navigable ⇔ gate idle ∧ journal quiet ∧ canvas idle ∧ status known`.
- **H2.** A gate that is not idle blocks change sends (§7.5).
- **H3.** Only F4 returns the gate from caught-up to idle.

### 6.6 `source`: replaces `source-session.ts`. `core/workspace/source/*` (source.ts ~130, editing.ts ~110, rebase.ts ~80)

```ts
// contract/records/workflow/source.ts
export interface SourceDraft {
  readonly collection: CollectionId; readonly text: string; readonly base: EditingBase;
  readonly generation: TransportGeneration; readonly edit: SourceEdit;
}
export type SourceEvent =
  | { readonly to: 'source'; readonly kind: 'bind'; readonly workspace: WorkspaceId }
  | { readonly to: 'source'; readonly kind: 'loaded'; readonly workspace: WorkspaceId; readonly stored: Result<SourceDraft | 'none'> }
  | { readonly to: 'source'; readonly kind: 'shown'; readonly panel: 'open' | 'closed' }
  | { readonly to: 'source'; readonly kind: 'edited'; readonly text: string }
  | { readonly to: 'source'; readonly kind: 'apply-requested'; readonly request: RequestId }
  | { readonly to: 'source'; readonly kind: 'close-decided'; readonly decision: 'keep' | 'discard' | 'stay' }
  | { readonly to: 'source'; readonly kind: 'settled'; readonly request: RequestId; readonly edit: SourceEdit; readonly collection: CollectionId; readonly outcome: Settlement }
  | { readonly to: 'source'; readonly kind: 'blocked'; readonly request: RequestId }
  | { readonly to: 'source'; readonly kind: 'snapshot-accepted'; readonly latest: Latest }
  | { readonly to: 'source'; readonly kind: 'diagram-shown'; readonly shown: ShownFacts };

// core/workspace/source/state.ts
export type Readout =
  | { readonly kind: 'none' }
  | { readonly kind: 'printed'; readonly collection: CollectionId; readonly text: string; readonly base: EditingBase; readonly generation: TransportGeneration };
export type OwnSend =
  | { readonly kind: 'none' }
  | { readonly kind: 'sent'; readonly request: RequestId; readonly edit: SourceEdit }
  | { readonly kind: 'confirmed'; readonly receipt: Receipt }; // kept only so the base can move across it
export type SourceEditor =
  | { readonly phase: 'unbound' }
  | { readonly phase: 'loading'; readonly workspace: WorkspaceId }
  | { readonly phase: 'readout'; readonly workspace: WorkspaceId; readonly panel: 'open' | 'closed'; readonly readout: Readout }
  | { readonly phase: 'draft'; readonly workspace: WorkspaceId; readonly panel: 'open' | 'closed' | 'confirm-close'; readonly draft: SourceDraft; readonly own: OwnSend }
  // A foreign or corrupt stored draft was found and kept. Read-only until the workspace changes.
  | { readonly phase: 'blocked'; readonly workspace: WorkspaceId; readonly panel: 'open' | 'closed'; readonly readout: Readout; readonly problem: Diagnostic };
export type SourceOut = { readonly kind: 'send'; readonly send: SendWanted } | { readonly kind: 'report'; readonly problem: Diagnostic };
export type SourceEffect = Extract<StorageEffect, { kind: 'read-source' | 'write-source' | 'remove-source' }>;

// core/workspace/contexts.ts
/** What the source machine sees: the diagram shown now, if any. */
export interface SourceContext {
  readonly shown:
    | { readonly kind: 'library' }
    | { readonly kind: 'open'; readonly collection: Collection; readonly base: EditingBase; readonly generation: TransportGeneration };
}
```

`reprint` ≡ `deps.print(context.shown.collection)` → `Readout printed{collection, text, base, generation}`; `none` in the library; a print failure gives `none` plus a report (Language failure, §9).

| State | Event | Guard | → | fx | out |
|---|---|---|---|---|---|
| any | bind ws | new workspace | loading{ws} | read-source | — |
| loading | loaded draft of this workspace | — | draft{panel open} (reopens dirty) | — | — |
| loading | loaded none | — | readout{closed, reprint} | — | — |
| loading | loaded foreign / corrupt | — | blocked{closed, reprint, problem}; stored draft kept | — | report |
| readout / blocked | diagram-shown | — | readout = reprint (even when closed) | — | report if print fails |
| readout / blocked | shown open | — | panel open; readout = reprint | — | report if print fails |
| draft | shown open | — | panel open | — | — |
| readout / blocked | shown closed | — | panel closed | — | — |
| draft | shown closed | — | panel confirm-close | — | — |
| readout printed / draft | edited t | — | draft{edit = next} | write-source | — |
| readout none | edited | — | same | — | report `source-unavailable` |
| blocked | edited / apply-requested | — | same | — | — (view reason `stored-draft-kept`) |
| draft, own ≠ sent | apply-requested r | builder ok | own sent{r, edit} | — | send (origin source, generation captured) |
| draft | settled confirmed | collection = draft's, edit = draft.edit | readout{same panel, reprint}; reprinted again on the next diagram-shown | remove-source | — |
| draft | settled confirmed | collection = draft's, edit ≠ draft.edit | own confirmed{receipt} | write-source | — |
| draft | settled refused / blocked | — | own none | — | — |
| draft, own confirmed | snapshot-accepted | receipt version = snapshot record version | base = snapshot, own none | write-source | — |
| confirm-close | close-decided keep | — | draft{closed} | — | — |
| confirm-close | close-decided discard | — | readout{closed, reprint} | remove-source | — |
| confirm-close | close-decided stay | — | draft{open} | — | — |
| unbound / loading | apply-requested | — | same | — | report `source-unavailable` |

- **S1.** `confirm-close ⇒ draft`, enforced by the type.
- **S2.** The base moves only across this editor's own confirmed receipt.
- **S3.** No source send happens before the workspace draft has loaded.
- **S4.** A kept foreign or corrupt draft is never overwritten: `blocked` has no row that writes storage (today `source-session.ts:134-141, 212-223`; change I30).

### 6.7 `notices`: `core/workspace/notices/*` (~110 lines)

```ts
// contract/records/workflow/notices.ts
export type FailureShown = 'action' | 'open' | 'panel-preferences';
export type StatusNote =
  | { readonly kind: 'none' } | { readonly kind: 'movement-cancelled' } | { readonly kind: 'no-receipt' }
  | { readonly kind: 'collection-gone' }
  | { readonly kind: 'add-elsewhere'; readonly title: string; readonly problem: Diagnostic };
export type NoticesEvent =
  | { readonly to: 'notices'; readonly kind: 'reported'; readonly problem: Diagnostic; readonly shown: FailureShown }
  | { readonly to: 'notices'; readonly kind: 'refused'; readonly request: RequestId } // the refusal itself stays in the journal entry
  | { readonly to: 'notices'; readonly kind: 'problem-dismissed' }
  | { readonly to: 'notices'; readonly kind: 'cleared'; readonly keep: 'nothing' | 'panel-preferences' }
  | { readonly to: 'notices'; readonly kind: 'noted'; readonly note: StatusNote }
  | { readonly to: 'notices'; readonly kind: 'drafts-changed'; readonly drafts: readonly CollectionId[] };

// core/workspace/notices/state.ts
export type ProblemSlot =
  | { readonly kind: 'none' }
  | { readonly kind: 'refusal'; readonly request: RequestId } // the view reads the Diagnostic from the journal's rejected entry
  | { readonly kind: 'failure'; readonly shown: FailureShown; readonly problem: Diagnostic };
export interface Notices {
  readonly problem: ProblemSlot;
  readonly note: StatusNote;
  readonly drafts: readonly CollectionId[]; // collections with unapplied inspector, wire or definition drafts
}
```

| Event | → problem | → note |
|---|---|---|
| reported | failure{shown, problem} | unchanged |
| refused r | refusal{r} | unchanged |
| problem-dismissed, cleared keep=nothing | none | unchanged |
| cleared keep=panel-preferences | none, unless `shown = panel-preferences` | unchanged |
| noted n | unchanged | n |
| drafts-changed | unchanged | unchanged (drafts replaced) |

The rules that dismiss refusals, clear stale uncertainty and expire notes are after-rules (§7.4).

- **N1.** A `refusal` slot always names an entry in phase `rejected`. F2 sets the slot to `none` in the same step that removes its entry.
- **N2.** Panel-preference failures arrive as `reported{shown: 'panel-preferences'}`. The panel controller's `report` is wired in compose to the facade's `reportPanel` (§8.4), not to the general `report`, so they survive renders and chooser actions (behaviour 21). Today: `compose.ts:133-139` sets `owner: 'panel-preferences'`; `render/patches.ts:92-95` keeps it.

### 6.8 `diagram` (child parent): `core/workspace/diagram/*`

```ts
// contract/records/workflow/diagram.ts
export type Listing = { readonly kind: 'listed'; readonly revision: CollectionRevision } | { readonly kind: 'unlisted' };
export type Via = 'navigation' | 'chooser';        // stored only on `installing`; elsewhere the phase says it
export interface RenderTicket {
  readonly render: RenderId; readonly collection: CollectionId; readonly listing: Listing;
  readonly workspace: WorkspaceId; readonly generation: TransportGeneration;
}
export type RenderAnswer =
  | { readonly kind: 'rendered'; readonly generation: TransportGeneration; readonly document: RenderDocument }
  | { readonly kind: 'failed'; readonly problem: Diagnostic };
export interface ShownFacts {
  readonly scene: RenderId; readonly collection: CollectionId; readonly revision: CollectionRevision;
  readonly install: 'reuse' | 'open';
}
export type DiagramOwnEvent =
  | { readonly to: 'diagram'; readonly kind: 'open-requested'; readonly collection: CollectionId; readonly by: 'person' | 'system' }
  | { readonly to: 'diagram'; readonly kind: 'chooser-opened' }
  | { readonly to: 'diagram'; readonly kind: 'chooser-closed' }
  | { readonly to: 'diagram'; readonly kind: 'collection-chosen'; readonly collection: CollectionId }
  | { readonly to: 'diagram'; readonly kind: 'chooser-retried' }
  | { readonly to: 'diagram'; readonly kind: 'render-answered'; readonly render: RenderId; readonly answer: RenderAnswer }
  | { readonly to: 'diagram'; readonly kind: 'scene-installed'; readonly render: RenderId; readonly stamp: SceneStamp }
  | { readonly to: 'diagram'; readonly kind: 'scene-failed'; readonly render: RenderId; readonly problem: Diagnostic }
  | { readonly to: 'diagram'; readonly kind: 'snapshot-accepted'; readonly latest: Latest }
  | { readonly to: 'diagram'; readonly kind: 'create-requested'; readonly title: string; readonly collection: CollectionId; readonly request: RequestId }
  | { readonly to: 'diagram'; readonly kind: 'created'; readonly collection: CollectionId }
  | { readonly to: 'diagram'; readonly kind: 'forms-elsewhere'; readonly title: string; readonly problem: Diagnostic }
  | { readonly to: 'diagram'; readonly kind: 'inspect-requested' };
export type DiagramEvent = DiagramOwnEvent | GestureEvent | ConnectionEvent | FormsEvent;

// core/workspace/diagram/state.ts
export interface Install { readonly document: RenderDocument; readonly base: Snapshot; readonly mode: 'reuse' | 'open' }
/** An open asked for while a scene installs; started right after `scene-installed`. */
export type NextOpen = { readonly kind: 'none' } | { readonly kind: 'open'; readonly collection: CollectionId; readonly by: 'person' | 'system' };
export type Navigation =
  | { readonly phase: 'idle' }
  | { readonly phase: 'opening'; readonly ticket: RenderTicket; readonly by: 'person' | 'system' }
  | { readonly phase: 'choosing' }
  | { readonly phase: 'switching'; readonly ticket: RenderTicket }
  | { readonly phase: 'installing'; readonly ticket: RenderTicket; readonly install: Install; readonly via: Via; readonly next: NextOpen }
  | { readonly phase: 'switch-failed'; readonly target: CollectionId; readonly problem: Diagnostic };
export interface ReleasedGesture { readonly gesture: GestureId; readonly base: CollectionRevision }
export interface OpenDiagram {
  readonly scene: RenderId;                      // the render the live Canvas session came from
  readonly generation: TransportGeneration;
  readonly base: Snapshot;
  readonly document: RenderDocument;             // .collection.id: CollectionId
  readonly stamp: SceneStamp;
  readonly released: readonly ReleasedGesture[]; // confirmed; preview kept until a newer scene
  readonly gesture: Gesture;
  readonly connection: Connection;
  readonly forms: Forms;
}
export type Shown = { readonly phase: 'library' } | { readonly phase: 'open'; readonly diagram: OpenDiagram };
export interface DiagramSession { readonly shown: Shown; readonly navigation: Navigation; readonly renders: RenderId }
/** What the diagram parent sees of the rest of the workspace. Built by core/workspace/contexts.ts. */
export interface DiagramContext {
  readonly latest: Latest | 'unread';
  readonly may: Permissions;        // rules/permissions.ts, computed once per step from the state before it
}
/** What a child sees of the open diagram and the workspace. Built by diagram/children.ts. */
export interface SceneContext {
  readonly scene: RenderId; readonly stamp: SceneStamp; readonly document: RenderDocument;
  readonly base: Snapshot; readonly generation: TransportGeneration; readonly latest: Latest;
  readonly listed: Listing;         // the open collection in the latest catalogue
  readonly may: Permissions; readonly move: 'held' | 'free';
}
export type DiagramOut =
  | { readonly kind: 'send'; readonly send: SendWanted }
  | { readonly kind: 'report'; readonly problem: Diagnostic; readonly shown: FailureShown }
  | { readonly kind: 'cleared'; readonly keep: 'nothing' | 'panel-preferences' }
  | { readonly kind: 'noted'; readonly note: StatusNote }
  | { readonly kind: 'read-wanted' }
  | { readonly kind: 'shown'; readonly shown: ShownFacts }
  | { readonly kind: 'navigation-settled' }
  | { readonly kind: 'history-status-wanted' };
```

`ticket(c)` is built from the latest catalogue. A new ticket aborts the old render.

| Navigation | Event | Guard | → | fx | out |
|---|---|---|---|---|---|
| any | open-requested / created | catalogue unread | same | — | — |
| idle / opening / choosing / switching / switch-failed | open-requested c by | read | opening{ticket(c), by} (closes the chooser, as today) | abort-render if a render is in flight; read-render | cleared keep=panel-preferences (only when by = person); navigation-settled if it left `opening` |
| installing | open-requested c by | read | same; next = open{c, by} | — | — |
| any | created c | read | as open-requested c by person | | |
| idle / switch-failed | chooser-opened | — | choosing | — | cleared keep=panel-preferences |
| opening | chooser-opened | — | choosing | abort-render | cleared keep=panel-preferences; navigation-settled |
| switching / installing | chooser-opened | — | same (ignored while loading, as today) | — | — |
| choosing / switching / switch-failed | collection-chosen c | c ≠ shown | switching{ticket(c)} | abort old?; read-render | cleared keep=panel-preferences |
| choosing / switching / switch-failed | collection-chosen c | c = shown | as chooser-closed | | |
| switch-failed{t} | chooser-retried | — | switching{ticket(t)} | read-render | cleared keep=panel-preferences |
| choosing / switching / switch-failed | chooser-closed | — | idle, then refresh-active (as the snapshot rows below) | abort-render? | cleared keep=panel-preferences; history-status-wanted |
| opening / switching{t} | render-answered t rendered | `generationChanged` | fail | — | read-wanted; `workspace-generation` |
| same | same | wrong collection | fail | — | `stale-diagram` |
| same | same | `renderAdmission` fails | fail | — | read-wanted; `render-input-changed` |
| same | same | `snapshotBase` fails | fail | — | read-wanted; `snapshot-mismatch` |
| same | same | admitted, `reusableSession` | installing{reuse, via = the phase it left, next none} | scene update{scene, document} | — |
| same | same | admitted, new session | installing{open, via, next none} | scene open{t.render, document, camera keep if same workspace and collection else fit, flags} | — |
| opening / switching{t} | render-answered t failed | — | fail | — | — |
| installing{t} | scene-installed t, stamp | — | idle; shown = open{scene, …}; children kept iff same collection; `released` = [] if mode open, else released entries with `base < stamp.revision` are settled; then: next = open{c} ⇒ as open-requested c; else `activeRefresh` against the current latest (reopen if a snapshot arrived during install) | open: record-visit, write-location collection; settle-gesture confirmed per released | shown; navigation-settled |
| installing{t} | scene-failed t | — | fail; then next = open{c} ⇒ as open-requested c | — | — |
| opening / switching{t} | snapshot-accepted | `renderInvalidation` ∧ target still listed | same phase, ticket′ = ticket(target) (restart) | abort-render; read-render | — |
| opening / switching{t} | snapshot-accepted | target gone | fail with `stale-diagram` | abort-render | — |
| idle, shown open c | snapshot-accepted | `activeRefresh` = gone | shown library | scene close; write-location library | noted collection-gone |
| idle, shown open c | snapshot-accepted | `activeRefresh` = reopen | opening{ticket(c), system} | read-render | — |
| any, read | create-requested t c r | builder ok | same | — | send (origin create-collection, generation current) |
| any, read | create-requested | builder fails | same | — | report |
| shown open | forms-elsewhere | — | forms.note = elsewhere | — | noted add-elsewhere |
| shown library | forms-elsewhere | — | same | — | noted add-elsewhere |
| any | inspect-requested | — | same | open-inspect | — |

**fail** means: a navigation render → idle, keep `shown`, out report{shown: 'open'}; a chooser render → switch-failed{target, problem}. Both then out navigation-settled.

**Pass-down (parent → child)**, in `diagram/children.ts`:
- An event with `to ∈ {gesture, connection, forms}` reaches the child only while `shown = open`. If the event names a collection, it must equal the open one. Otherwise it is dropped.
- The child receives a `SceneContext`.

**Lift (child → parent):**
- child `send`, `report`, `cleared` and `noted` → passed through.
- gesture `confirmed{gesture, base}` → added to `released`, or settled at once if `stamp.revision > base`.
- connection `opened` → fx open-inspect.

Invariants:
- **DG1.** Gesture, connection and forms exist only while `shown = open` (by type).
- **DG2.** A reinstall keeps the children only for the same collection.
- **DG3.** At most one render ticket is in flight (by the union).
- **DG4.** A render answer is applied only when its ticket is the current one.
- **DG5.** Every failure keeps the diagram currently shown.
- **DG6.** Every exit from `opening` sends `navigation-settled` (L3). An open asked for during `installing` is never dropped: it runs right after the install ends.

### 6.9 `gesture` (child): decision 1. `core/workspace/gesture/*`

```ts
// contract/records/workflow/gesture.ts
export type CanvasEditIntent = Exclude<EditIntent, { readonly kind: 'connection' }>;
/** What a preview is for. A choice preview names its choice; the plain move's preview has none. */
export type PreviewAsk =
  | { readonly purpose: 'released' }                                    // the plain move, drawn once its send starts
  | { readonly purpose: 'first' | 'switch'; readonly choice: ChoiceKind }; // a choice: when choices appear, or on a switch
export type GestureEvent =
  | { readonly to: 'gesture'; readonly kind: 'intent-received'; readonly intent: CanvasEditIntent; readonly request: RequestId }
  | { readonly to: 'gesture'; readonly kind: 'option-shown'; readonly choice: ChoiceKind }
  | { readonly to: 'gesture'; readonly kind: 'preview-answered'; readonly gesture: GestureId; readonly ask: PreviewAsk; readonly result: 'shown' | 'refused' }
  | { readonly to: 'gesture'; readonly kind: 'choice-applied'; readonly choice: ChoiceKind; readonly request: RequestId }
  | { readonly to: 'gesture'; readonly kind: 'move-cancelled' }
  | { readonly to: 'gesture'; readonly kind: 'started'; readonly collection: CollectionId; readonly request: RequestId }
  | { readonly to: 'gesture'; readonly kind: 'settled'; readonly collection: CollectionId; readonly request: RequestId; readonly outcome: Settlement }
  | { readonly to: 'gesture'; readonly kind: 'blocked'; readonly collection: CollectionId; readonly request: RequestId; readonly block: SendBlock }
  | { readonly to: 'gesture'; readonly kind: 'scene-changed'; readonly scene: RenderId; readonly stamp: SceneStamp };

// core/workspace/gesture/state.ts
export interface GestureCapture<I extends CanvasEditIntent = CanvasEditIntent> {
  readonly gesture: GestureId; readonly intent: I;
  readonly scene: RenderId; readonly stamp: SceneStamp;   // both are checked: a new session can reuse a stamp
  readonly base: Snapshot; readonly document: RenderDocument; readonly generation: TransportGeneration;
}
export interface Choice { readonly changes: readonly Change[]; readonly preview: GeometryPreview }
/** At least one choice, the shown one is present, and no kind appears twice (the kind is the key). */
export type Choices =
  | { readonly shown: 'expand'; readonly expand: Choice; readonly rearrange: Choice | 'none' }
  | { readonly shown: 'rearrange'; readonly expand: Choice | 'none'; readonly rearrange: Choice };
export type Gesture =
  | { readonly phase: 'idle' }
  | { readonly phase: 'sending'; readonly capture: GestureCapture; readonly request: RequestId; readonly preview: PreviewPlan }
  | { readonly phase: 'choosing'; readonly capture: GestureCapture<PlacementIntent>; readonly choices: Choices; readonly cause: 'local' | 'server' }
  | { readonly phase: 'applying'; readonly capture: GestureCapture<PlacementIntent>; readonly choices: Choices; readonly request: RequestId };
export type GestureEffect = Extract<SceneEffect, { kind: 'settle-gesture' | 'preview' }>;

// core/editing/gesture-plan.ts (pure; absorbs movement-review/outcome.ts and compose/movement-review.ts)
export type GesturePlan =
  | { readonly kind: 'no-change' }
  | { readonly kind: 'placeable'; readonly changes: readonly Change[]; readonly preview: PreviewPlan }
  | { readonly kind: 'unplaceable'; readonly capture: GestureCapture<PlacementIntent>; readonly choices: Choices }
  | { readonly kind: 'refused'; readonly problem: Diagnostic };
/** The plan for a drop. Codes: invalid-edit, unsupported-edit, stale-target, duplicate-selection. */
export function planGesture(capture: GestureCapture, preview: RoutePreview): GesturePlan;
/** Expand and Rearrange for a refused move, Expand shown first; 'none' when neither fits. Code: preview-refused. */
export function choicesAfterRefusal(capture: GestureCapture<PlacementIntent>, preview: RoutePreview): Choices | 'none';
/** The capture narrowed to a placement, or 'other'. Used before choices are offered after a server refusal. */
export function placementCapture(capture: GestureCapture): GestureCapture<PlacementIntent> | 'other';
```

`moduleMove(document, intent)` lives in `core/editing/module-move.ts`. It is true when there is at least one entry, every entry is a modules section or a node in one, and nothing is resized. It replaces the `some` check at `outcome.ts:25-26` and the separate check in `route-preview.ts` (`supportedMove`).

`settle g x` below means fx scene settle-gesture{g, x}. `preview k p` means fx scene preview{g, ask: {purpose p, choice k}}.

| Phase | Event | Guard / plan | → | fx | out |
|---|---|---|---|---|---|
| ≠ idle | intent-received g′ | — | same | settle g′ reject | report `movement-active` |
| idle | intent-received g r | no-change | idle | settle g discard | — |
| idle | intent-received | refused p (incl. duplicate / ancestor) | idle | settle g reject | report p |
| idle | intent-received | placeable, builder ok | sending{r, preview} | — | send (origin gesture, generation captured) |
| idle | intent-received | placeable, builder fails | idle | settle g reject | report |
| idle | intent-received | unplaceable{capture, choices} | choosing{local, choices} | preview choices.shown first | — |
| sending r | started r | preview = routes | same | preview{ask released} (+ measure) | — |
| sending r | started r | preview = none | same | — | — |
| sending r | settled confirmed | — | idle | — | confirmed{g, base revision} |
| sending r | settled refused{code} | `moveRefusal[code] = offer` ∧ placement capture ∧ capture current ∧ choices ≠ none | choosing{server, choices} | preview choices.shown first | — |
| sending r | settled refused | otherwise | idle | settle g reject{message} | — |
| sending r | blocked r | — | idle | settle g reject | — |
| choosing | preview-answered first refused | — | idle | settle g reject | report `preview-refused` |
| choosing | option-shown k | choices[k] ≠ none, k ≠ choices.shown | same | preview k switch | — |
| choosing | preview-answered switch k shown | — | choices.shown = k | — | — |
| choosing | preview-answered switch refused | — | same | — | report `preview-refused` |
| choosing | choice-applied k r′ | k = choices.shown ∧ `may.applyMove` allowed ∧ capture current ∧ builder ok | applying{r′} | — | send (origin move-choice, generation captured) |
| choosing | choice-applied | otherwise | same | — | report (code; the UI already shows the reason) |
| choosing | move-cancelled | — | idle | settle g discard | noted movement-cancelled; cleared keep=nothing |
| applying r′ | settled confirmed | — | idle | — | confirmed |
| applying r′ | settled refused / blocked | — | choosing{server, same choices} | preview choices.shown first | — |
| choosing | scene-changed | scene or stamp ≠ capture | idle | settle g reject "The diagram changed" | — |

"capture current" ≡ `capture.scene = context.scene ∧ capture.stamp = context.stamp ∧ context.listed = listed{capture.document revision} ∧ capture.generation = context.latest.generation`. The last two restore today's checks that the review was made on the listed revision in the latest generation (`movement-review/phases.ts:158-177`), so a foreign commit that is listed but not yet drawn gives a local `diagram-changed` instead of a request Authoring would refuse. `uncertain` and `retryable` produce no settle event, so `sending` and `applying` wait; the view shows the reason (§7.6).

- **G1.** `request: RequestId` and `capture.gesture: GestureId` are separate types. Every send (plain move and every applied choice) carries a fresh ID minted by the facade or the canvas intake.
- **G2.** `choices` holds at least one choice, holds the shown one, and never holds a kind twice (by the union).
- **G3.** Each gesture receives exactly one of `confirmed`, `discard` or `reject`, only when it leaves this machine. `confirmed` goes through `released`.
- **G4.** `choosing` is reached only from a refusal, never after a confirmed move.
- **G5.** Journal settlements match on `RequestId`; Canvas effects are keyed on `GestureId`.
- **G6.** `moveRefusal` is a frozen `Readonly<Record<RefusedCode, 'offer' | 'reject'>>`. Only `constraint-conflict` maps to `offer` (open decision §16 Q3).
- **G7.** Choices are offered only for a placement: `choosing` and `applying` hold `GestureCapture<PlacementIntent>`, which `RoutePreview` needs.

### 6.10 `connection` (child): `core/workspace/connection/*` (~130 lines)

```ts
// contract/records/workflow/connection.ts
/** Canvas does not export ConnectionIntent from its index; derive it. */
export type ConnectionIntent = Extract<EditIntent, { readonly kind: 'connection' }>;
export type ConnectionEvent =
  | { readonly to: 'connection'; readonly kind: 'begun'; readonly intent: ConnectionIntent }
  | { readonly to: 'connection'; readonly kind: 'edited'; readonly edit: ConnectionEdit }
  | { readonly to: 'connection'; readonly kind: 'applied'; readonly request: RequestId; readonly relationship: RelationshipId }
  | { readonly to: 'connection'; readonly kind: 'cancelled' }
  | { readonly to: 'connection'; readonly kind: 'settled'; readonly collection: CollectionId; readonly request: RequestId; readonly outcome: Settlement }
  | { readonly to: 'connection'; readonly kind: 'blocked'; readonly collection: CollectionId; readonly request: RequestId; readonly block: SendBlock }
  | { readonly to: 'connection'; readonly kind: 'dismissed'; readonly collection: CollectionId; readonly request: RequestId };

// core/workspace/connection/state.ts
export type ConnectionProblem = { readonly kind: 'none' } | { readonly kind: 'problem'; readonly problem: Diagnostic };
export type Connection =
  | { readonly phase: 'none' }
  | { readonly phase: 'editing'; readonly draft: ConnectionDraft; readonly problem: ConnectionProblem }
  | { readonly phase: 'sent'; readonly draft: ConnectionDraft; readonly request: RequestId };
```

`ConnectionDraft` loses `id`, `problem` and `requestState`. The view reads `requestState` from the journal.

| Phase | Event | Guard | → | out |
|---|---|---|---|---|
| none | begun | move free ∧ draft builds (`core/editing/connection/draft.ts`) | editing | opened; cleared keep=nothing |
| none | begun | fails | none | report |
| ≠ none | begun | — | same | report `connection-open` |
| editing | edited | — | editing{problem none} | cleared keep=nothing |
| editing | applied r rel | same generation ∧ label not blank ∧ builder ok | sent{r} | send (origin connection, generation captured) |
| editing | applied | fails | editing{problem} | report |
| sent{r} | settled confirmed | — | none | — |
| sent{r} | blocked | — | editing{problem} | — |
| sent{r} | dismissed | — | editing{problem none} | — |
| editing | cancelled | — | none | cleared keep=nothing |

A refused connection stays `sent`, and the view shows `rejected`, until the refusal is dismissed.

### 6.11 `forms` (child: the Add panel): `core/workspace/forms/*` (forms.ts ~120, submit.ts ~130)

```ts
// contract/records/workflow/forms.ts
export interface DraftOf { readonly diagram: AddDiagramDraft; readonly object: AddObjectDraft; readonly group: AddGroupDraft }
export interface IdOf { readonly diagram: SectionId; readonly object: ObjectId; readonly group: GroupId }
type Edited = { [K in FormKind]: { readonly to: 'forms'; readonly kind: 'edited'; readonly form: K; readonly draft: DraftOf[K] } }[FormKind];
type Submitted = { [K in FormKind]: { readonly to: 'forms'; readonly kind: 'submitted'; readonly form: K; readonly fresh: IdOf[K]; readonly request: RequestId } }[FormKind];
export type FormsEvent =
  | Edited | Submitted
  | { readonly to: 'forms'; readonly kind: 'cancelled'; readonly form: FormKind }
  | { readonly to: 'forms'; readonly kind: 'palette-dropped'; readonly drop: PaletteDrop; readonly object: ObjectId; readonly request: RequestId }
  | { readonly to: 'forms'; readonly kind: 'settled'; readonly collection: CollectionId; readonly request: RequestId; readonly outcome: Settlement }
  | { readonly to: 'forms'; readonly kind: 'blocked'; readonly collection: CollectionId; readonly request: RequestId; readonly block: SendBlock };
// AddObjectDraft: reuse {kind:'new'} | {kind:'reuse'; object: ObjectId}; group {kind:'none'} | {kind:'group'; id: GroupId}
// AddGroupDraft: placement 'fixed' | 'find-room'

// core/workspace/forms/state.ts
export interface Capture { readonly base: Snapshot; readonly generation: TransportGeneration } // taken at each edit (I33)
export type Form<K extends FormKind> =
  | { readonly phase: 'empty' }
  | { readonly phase: 'editing'; readonly draft: DraftOf[K]; readonly capture: Capture }
  | { readonly phase: 'sent'; readonly draft: DraftOf[K]; readonly capture: Capture; readonly request: RequestId };
export type FormNote =
  | { readonly kind: 'none' }
  | { readonly kind: 'invalid'; readonly form: FormKind; readonly problem: Diagnostic }
  | { readonly kind: 'elsewhere'; readonly title: string; readonly problem: Diagnostic };
export interface Forms { readonly forms: { readonly [K in FormKind]: Form<K> }; readonly note: FormNote }
```

`locked(forms) ≡ ∃ form in phase sent`. Derived, never stored.

| Form | Event | Guard | → | out |
|---|---|---|---|---|
| any, not locked | edited k | — | k editing{draft, capture = open diagram base} (I33) | note none |
| locked | edited / submitted / cancelled | — | same | — (view reason `form-locked`) |
| empty / editing | submitted k | validation fails (`core/creation/validation.ts`) | same | note invalid |
| empty / editing | submitted k fresh r | valid ∧ builder ok | sent{r} | send (origin add-form, generation captured) |
| sent{r} | settled confirmed | — | empty | — |
| sent{r} | settled refused / blocked | — | editing (same draft and capture) | — (the bar shows the refusal) |
| editing | cancelled | — | empty | — |
| any | palette-dropped, tree section | — | same | report `tree-section-drop` |
| any | palette-dropped, module | builder ok | same (no form touched, no lock) | send (origin palette, generation captured from the open diagram) |

- **FM1.** Validation runs before any phase change.
- **FM2.** Forms belong to one collection (structural).
- **FM3.** An uncertain add stays `sent`, so Retry in the journal resends the same body.
- Validation and change building move out of `core/creation/records.ts` (296 lines; it takes `ActiveDiagram`, which holds live Canvas handles, and imports `captures.ts`, which M23 deletes) into `core/creation/validation.ts` (~120) and `core/creation/changes.ts` (~150). Both take the machine's own data: the document, the capture's base and the draft (M21). `records.ts` is deleted in M24.

---

## 7. Root: routing, cross-machine rules, view

### 7.1 Root state and events

```ts
// core/workspace/state.ts (~60 lines)
export interface Workspace {
  readonly lifecycle: Lifecycle;
  readonly link: Link;
  readonly catalogue: Catalogue;
  readonly journal: Journal;
  readonly history: History;
  readonly source: SourceEditor;
  readonly notices: Notices;
  readonly diagram: DiagramSession;
}

// contract/records/workflow/events.ts (~80 lines)
export type WorkspaceEvent =
  | LifecycleEvent | LinkEvent | CatalogueEvent | JournalEvent | HistoryEvent
  | SourceEvent | NoticesEvent | DiagramEvent; // DiagramEvent includes gesture, connection, forms
/** `to:kind` of any event. `kind` alone repeats across machines ('started', 'edited', 'settled', 'cancelled'). */
export type EventKey = WorkspaceEvent extends infer E ? (E extends { to: infer T extends string; kind: infer K extends string } ? `${T}:${K}` : never) : never;
/** Events a person starts (facade, keys, Canvas drops). F6 expires the status note on these. */
export const commandKeys = Object.freeze([
  'diagram:open-requested', 'diagram:chooser-opened', 'diagram:collection-chosen', 'diagram:chooser-retried',
  'diagram:chooser-closed', 'diagram:create-requested', 'diagram:inspect-requested',
  'history:requested', 'journal:check-requested', 'journal:retry-requested', 'journal:dismiss-requested',
  'journal:send-wanted', 'notices:problem-dismissed',
  'forms:edited', 'forms:submitted', 'forms:cancelled', 'forms:palette-dropped',
  'connection:begun', 'connection:edited', 'connection:applied', 'connection:cancelled',
  'gesture:intent-received', 'gesture:option-shown', 'gesture:choice-applied', 'gesture:move-cancelled',
  'source:shown', 'source:edited', 'source:apply-requested', 'source:close-decided',
] as const satisfies readonly EventKey[]);
export type CommandKey = (typeof commandKeys)[number];
```

Three command keys are also sent by lifts. They say who sent them, so F6 can tell a click from a lift:
- `diagram:open-requested` carries `by: 'person' | 'system'` (the lifecycle's URL open and background reopens are `system`).
- `journal:dismiss-requested` carries `by` (the forms-elsewhere lift sends `system`).
- `journal:send-wanted` counts as a command only for origin `editor`; every other origin comes from a lift.

`isCommand(event)` in `rules/note-expiry.ts` ≡ key ∈ `commandKeys` ∧ `by ≠ system` ∧ (key ≠ `journal:send-wanted` ∨ origin = editor).

### 7.2 Root transition: `core/workspace/machine.ts` (~110 lines)

```ts
/*
 * The workspace machine: hands each event to the machine it is addressed to, lifts that machine's
 * facts into queued events, then applies the cross-machine rules in the same step. Pure, given
 * the pure injected WorkflowDeps. The runner owns queueing and I/O; the journal owns request
 * recovery.
 */
export function createWorkspaceMachine(deps: WorkflowDeps): WorkflowMachine<Workspace> {
  return { initial: initialWorkspace, transition: (state, event) => transition(state, event, deps) };
}

/** One event. A disposed workspace ignores everything; otherwise route, then finalize. */
function transition(state: Workspace, event: WorkspaceEvent, deps: WorkflowDeps): RootStep<Workspace> {
  if (state.lifecycle.phase === 'disposed') return { state, effects: [], events: [] };
  return finalize(state, event, route(state, event, deps));
}

/** The machine an event is addressed to. A new machine does not compile until it is routed here. */
function route(state: Workspace, event: WorkspaceEvent, deps: WorkflowDeps): RootStep<Workspace> {
  switch (event.to) {
    case 'lifecycle':
      return liftLifecycle(state, updateLifecycle(state.lifecycle, event));
    case 'link':
      return liftLink(state, updateLink(state.link, event, linkContext(state)));
    case 'catalogue':
      return liftCatalogue(state, updateCatalogue(state.catalogue, event));
    case 'journal':
      return liftJournal(state, updateJournal(state.journal, event, journalContext(state)));
    case 'history':
      return liftHistory(state, updateHistory(state.history, event, historyContext(state), deps));
    case 'source':
      return liftSource(state, updateSource(state.source, event, sourceContext(state), deps));
    case 'notices':
      return liftNotices(state, updateNotices(state.notices, event));
    case 'diagram':
    case 'gesture':
    case 'connection':
    case 'forms':
      return liftDiagram(state, updateDiagram(state.diagram, event, diagramContext(state), deps));
    default:
      return unsupported(event);
  }
}
```

`core/workspace/contexts.ts` (~100 lines) builds each machine's read-only context from the root state: `LinkContext`, `GateContext` (§7.5), `HistoryContext`, `SourceContext` (§6.6), `DiagramContext` (§6.8). `DiagramContext.may` is `permissions(state)` for the state before the event, computed once per step. No machine writes another machine's slice.

### 7.3 Lift tables (one file per source machine; queued in the order listed)

| Source out | Delivered as | File |
|---|---|---|
| lifecycle read-wanted / watch-wanted / open-wanted c / report | catalogue read-wanted / link watch-wanted / diagram open-requested{c, system} / notices reported{action} | `lift/lifecycle.ts` |
| link reread-wanted | catalogue read-wanted | `lift/link.ts` |
| catalogue accepted | 1. lifecycle first-snapshot (when previous = none) → 2. link read-succeeded → 3. *workspace changed:* fx restore-panels, fx restore-editors, journal bind, source bind → 4. fx refresh-library → 5. source snapshot-accepted → 6. diagram snapshot-accepted → 7. history snapshot-seen, history status-wanted | `lift/catalogue.ts` |
| catalogue read-failed | notices reported{action}; lifecycle first-read-failed (first read only) | same |
| journal started | notices cleared keep=nothing; then, for gesture / move-choice origins, gesture started | `lift/journal.ts` |
| journal settled | **1. Owner, by `origin.kind` (exhaustive switch):** gesture / move-choice → gesture settled; connection → connection settled; add-form → forms settled if its collection is open, else (refused only) diagram forms-elsewhere + journal dismiss-requested{by: system}; palette → —; source → source settled; history → history settled; editor → fx answer-caller{receipt or refusal}; create-collection / restored → —. Until an owner's machine is wired, its row is fx `legacy-settled` instead (§8.5). **2.** fx settle-definition (confirmed, or released on a refusal) for every request; the store ignores unknown IDs, as today. **3.** Confirmed: catalogue carried (if carried) else catalogue read-wanted. Refused: notices refused{r} (except add-form elsewhere), catalogue read-wanted. **4.** create-collection confirmed: diagram created{c}, queued **after** `carried` (O2). | same |
| journal uncertain | notices reported{action}; catalogue read-wanted; editor origin → fx answer-caller{failure}; an owner still in the old session → fx legacy-settled{uncertain} (§8.5) | same |
| journal blocked | owner's `blocked`, by origin: gesture / move-choice → gesture blocked; connection → connection blocked; add-form → forms blocked; source → source blocked; history → history blocked; **editor → fx answer-caller{failure: the block}**, so the waiting store's `apply()` resolves and a definition key unlocks; palette / create-collection / restored → —; an owner still in the old session → fx legacy-settled{blocked} (§8.5). Then notices reported{action}; catalogue read-wanted for `wrong-workspace`, `collection-busy` and `journal-unsaved` only (as today) | same |
| journal dismissed | connection dismissed (connection origin); fx settle-definition released | same |
| journal no-receipt / restored-inverse / report | notices noted no-receipt / history restored-inverse / notices reported{action} | same |
| history send / report | journal send-wanted / notices reported | `lift/history.ts` |
| source send / report | journal send-wanted / notices reported | `lift/source.ts` |
| diagram send / report / cleared / noted / read-wanted | journal / notices / notices / notices / catalogue | `lift/diagram.ts` |
| diagram shown | source diagram-shown; gesture scene-changed (inside the parent) | same |
| diagram navigation-settled / history-status-wanted | lifecycle location-settled / history status-wanted | same |

Order guarantees (effects of a step run before its queued events are handled, R2):
- **O1.** The owner hears about a receipt before `carried` installs the snapshot, so the source records its receipt before it rebases. The definitions store settles in the journal's own step, earlier still.
- **O2.** `created` runs after `carried`, so the new collection is listed when its ticket is taken.
- **O3.** A move choice is committed to state before its Canvas preview effect runs.
- **O4.** The journal commits before any receipt reaction runs.

Termination: each lift maps one out to a fixed, finite list of events, and no machine answers its own lifted events with the out that caused them. Each after-rule is idempotent (running it twice changes nothing more), and the only events after-rules queue are the `dismissed` reactions for entries F2 and F3 remove; entries are finite, so every chain ends.

### 7.4 After-rules: `core/workspace/finalize.ts` (~80 lines), run after every routed event, in order

| # | Rule | File | Effect on the step |
|---|---|---|---|
| F1 | **Stale uncertainty:** problem is a failure with code `connection-uncertain` ∧ no entry is `uncertain` → problem none | `rules/stale-uncertainty.ts` | notices.problem = none |
| F2 | **One refusal shown:** a rejected entry r is removed when another entry started after `r.at`, or another entry was refused after `r.at`. A `refusal` problem slot whose entry is gone becomes none (N1) | `rules/refusals.ts` | journal − r; notices.problem = none if it named r; queued events as for `dismissed` |
| F3 | **Closing the problem dismisses refusals:** `notices.problem` was shown before this event and is none after it → remove every rejected entry | `rules/refusals.ts` | same as F2 |
| F4 | **History release:** gate caught-up ∧ status.navigationVersion = snapshot record version ∧ (library shown ∨ open revision = listed revision) ∧ navigation idle → gate idle | `rules/history-release.ts` | history.gate = idle |
| F5 | **Scene flags:** same scene and `sceneFlags` changed → emit `scene flags` | `rules/flags.ts` | fx scene flags |
| F6 | **Note expiry:** the event is a command ∧ note ≠ none → note none | `rules/note-expiry.ts` | notices.note = none |

```ts
/** Whether the scene accepts edits and whether the service is reachable. Pure. */
export function sceneFlags(state: Workspace): SceneFlags {
  return { editable: editable(state), link: connected(state.link) ? 'online' : 'offline' };
}
/* connected(link) ≡ link.stream = 'open' ∨ link.reach = 'reachable' (§6.2). */
/* editable: no move choosing/applying ∧ history gate idle ∧ no unrefused entry ∧ shown generation = latest. */
```

### 7.5 The one gated send: `core/workspace/rules/gated-send.ts` (~130 lines)

```ts
// contract/records/workflow/gate.ts: declared because events, effects and the view name them
export type SendBlock = 'not-restored' | 'wrong-workspace' | 'history-held' | 'inverse-unresolved' | 'collection-busy' | 'not-read' | 'journal-unsaved';
/** What a send will touch, known before any request is built. */
export type SendTarget =
  | { readonly kind: 'change'; readonly collection: CollectionId } // gesture, move-choice, connection, add-form, palette, source, inspector, wires, definitions
  | { readonly kind: 'library' } | { readonly kind: 'create' } | { readonly kind: 'history' };
/** A send the gate admitted, with the generation it is posted under. Only gatedSend builds one; post-apply carries it (J3). */
export interface AdmittedSend { readonly send: SendWanted; readonly generation: TransportGeneration }

// core/workspace/rules/gated-send.ts: GateContext names the core Gate, so it stays in core
export type SendMode = 'first' | 'resend';
export type ReadGeneration = { readonly kind: 'unread' } | { readonly kind: 'read'; readonly generation: TransportGeneration };
export interface GateContext { readonly gate: Gate; readonly generation: ReadGeneration }
/** What a send may use: its own captured generation, or the latest read one. */
export type Readiness = { readonly kind: 'captured' } | { readonly kind: 'current'; readonly generation: TransportGeneration };
```

```ts
/*
 * The one gate every request passes before it is posted: first sends and Retry resends alike.
 * Two layers: sendReadiness needs no request, so the view's `may` uses it too; gatedSend adds the
 * checks that need the built request. Pure. The journal owns recovery; a blocked send changes
 * nothing and its owner keeps its draft. gatedSend is called only by journal/send.ts and
 * journal/recovery.ts; sendReadiness also by rules/permissions.ts.
 */
/**
 * Whether a send to `target` may start now, checked in this order:
 * - `not-restored`: the journal is unbound or restoring.
 * - `history-held`: the undo gate is not idle and the target is not `history`.
 * - `inverse-unresolved`: an undo or redo is still unresolved in the journal.
 * - `collection-busy`: an unrefused entry targets the same collection (or the library).
 * - `not-read`: the target sends under the current generation (library, create, history) and nothing is read.
 * `skip` leaves one entry (the one being retried) out of the last three checks.
 */
export function sendReadiness(journal: Journal, context: GateContext, target: SendTarget, skip: RequestId | 'none'): Result<Readiness, SendBlock>;

/**
 * Admits `send`, or returns the first rule it breaks: sendReadiness for the send's target, then
 * - `wrong-workspace`: the request names a workspace other than the journal's;
 * - `collection-busy`: another unrefused entry writes one of the same records (J2).
 * In `resend` mode the entry being retried is skipped.
 */
export function gatedSend(journal: BoundJournal, context: GateContext, send: SendWanted, mode: SendMode): Result<AdmittedSend, SendBlock> {
  const ready = sendReadiness(journal, context, targetOf(send.origin), skipFor(send, mode));
  if (!ready.ok) return ready;
  const block = requestBlock(journal, send, mode);
  if (block !== 'pass') return { ok: false, error: block };
  return { ok: true, value: { send, generation: generationFor(send.generation, ready.value) } };
}
/* generationFor: captured → the send's own; current → the Readiness generation. No cast: the not-read check already resolved it. */
```

`targetOf(origin)` is total: every `Origin` names its collection, or is history, create-collection, the library editor, or `restored` (target of its request's scope). `journal-unsaved` comes from a journal phase and is not checked here; it shares the union so every owner handles one block type.

### 7.6 Permissions: `core/workspace/rules/permissions.ts` (~140 lines)

```ts
// contract/records/workflow/permissions.ts (~50 lines)
export type Permission = { readonly kind: 'allowed' } | { readonly kind: 'blocked'; readonly reason: BlockReason };
export type BlockReason =
  | SendBlock | 'offline' | 'saving' | 'uncertain' | 'retryable' | 'checking' | 'no-diagram'
  | 'nothing-to-undo' | 'nothing-to-redo' | 'status-unknown' | 'move-in-progress' | 'form-locked'
  | 'connection-sent' | 'diagram-changed' | 'stored-draft-kept' | 'not-refused';
export interface Permissions {
  readonly undo: Permission; readonly redo: Permission; readonly applyEdits: Permission;
  readonly applySource: Permission; readonly library: Permission; readonly createCollection: Permission;
  readonly addForms: Permission; readonly chooseMove: Permission; readonly applyMove: Permission;
  readonly cancelMove: Permission; readonly editConnection: Permission; readonly applyConnection: Permission;
}
/** What a person may do now, with the reason when not. Each send permission is sendReadiness for its target, then phase checks. */
export function permissions(state: Workspace): Permissions;
```

| Permission | `sendReadiness` target | Then blocked when |
|---|---|---|
| `undo`, `redo` | history | status unknown · nothing to undo / redo · canvas drafting |
| `applyEdits`, `addForms`, `applyConnection`, `applyMove` | change{open collection}; `no-diagram` in the library | forms locked (`addForms`) · connection sent · move request in a journal phase (below) |
| `applySource` | change{draft collection} | source not a draft · `blocked` → `stored-draft-kept` |
| `library` | library | — |
| `createCollection` | create | — |
| `chooseMove`, `cancelMove`, `editConnection` | none (no send) | move request in a journal phase · connection sent |

- `chooseMove`, `applyMove` and `cancelMove` are blocked with `saving`, `uncertain`, `retryable` or `checking` while the move's own request is in that journal phase, and with `history-held` while the gate is not idle (decision 1).
- `sendReadiness` on an unbound or restoring journal gives `not-restored`, so every send permission is blocked until recovery ends.
- M1 declares the whole `Permissions` type. M2's `permissions()` returns `allowed` for every row not yet written; each wire PR writes its own rows (M7 Check / Retry / Dismiss, M20 undo / redo, M23 addForms, M25 connection, M28 move, M30 applyEdits and library, M32 applySource, M17 createCollection). Nothing reads a row before the PR that writes it: React reads `may` for a feature only from that feature's wire PR, and the gesture machine only from M28.
- The gesture machine reads `may.applyMove` from its context, so the UI and the transition use one rule, and both call `sendReadiness`, the same code `gatedSend` runs first.
- Per-entry permissions (Check, Retry, Dismiss) live on each `PendingView` row (§7.7), from the entry's phase: Check and Retry only in `uncertain` / `retryable`; Dismiss only in `rejected` (else `not-refused`).

### 7.7 View: React reads only this. `core/workspace/view/*`

`project.ts` ~60, `diagram-view.ts` ~130, `editing-view.ts` ~110, `journal-view.ts` ~90, `status.ts` ~120. Each file is added by the PR that wires its machine (§13); M2 adds `project.ts` with an empty view.

```ts
// contract/records/workflow/view.ts (~150 lines)
export interface ProjectedView {
  readonly diagram: DiagramView; readonly journal: JournalView; readonly history: HistoryView;
  readonly editing: EditingView; readonly source: SourceView;
  readonly status: string; readonly may: Permissions;
}
export interface PendingView {
  readonly request: RequestId; readonly origin: Origin['kind']; readonly phase: EntryPhase['phase'];
  readonly check: Permission; readonly retry: Permission; readonly dismiss: Permission;
}
/** The React view. Pure; derived per state and cached by the runner per state reference. */
export function projectWorkspace(state: Workspace): ProjectedView;
/** ProjectedView plus the live Canvas handles; the facade attaches them from the scene executor. */
export interface WorkspaceView extends ProjectedView { readonly active: ActiveDiagram | null }
```

| View part and field | Derived from |
|---|---|
| `diagram.snapshot`, `diagram.generation`, `diagram.collections` | catalogue `latest` (null / 'unread' before the first read) |
| `diagram.connected` | `connected(link)` (§6.2) |
| `diagram.opening` | navigation opening, or installing{via navigation} → the collection; else null |
| `diagram.collectionSwitch` | choosing → `{phase: 'choosing', activeId}` (the open collection or null); switching, or installing{via chooser} → `{phase: 'loading', targetId}`; switch-failed → `{phase: 'failed', targetId, problem}`; idle or opening → `{phase: 'idle', activeId}` |
| `diagram.problem` | the notices slot; a `refusal` slot shows its entry's `Refusal` from the journal (N1); hidden while navigation is choosing, switching or switch-failed |
| `journal.pending[]` | journal entries as `PendingView` rows |
| `journal.newestRefusal` | the one rejected entry, shown in Recovery only while the bar is empty (behaviour 44) |
| `history.status` | status known, or null |
| `editing.creation` {drafts, note, adding} | forms phases; adding = the kind of the sent form, or null; note = the form note. A refusal shows only in the bar (change I32). |
| `editing.movementReview` | gesture choosing or applying: the choices, the shown kind, the cause, and the journal phase of `applying.request` |
| `editing.connection` + `requestState` | editing → `draft`; sent → the journal phase of `sent.request` |
| `source` {phase, panel, text, readout} | source phase and panel |
| `may` | `permissions(state)` |
| `status` | `view/status.ts` (table below) |
| `active.session`, `active.canvas` | attached by the facade from the scene executor; not state |

- Removed: `busy`, `history.busy`, `creation.busy`. React asks `may` instead (D6).
- Each React feature receives its own part: `LibraryBrowser` → `{connected, may.library}`; `CollectionChooser` → `diagram` + `may`; `HistoryControls` → `history` + `may.undo/redo`; `RequestRecovery` → `journal`; `MovementReview` → `editing.movementReview` + `may.chooseMove/applyMove/cancelMove`; `AddTools` (the registered feature) → `editing.creation` + `may.addForms`, and each `AddForms` form gets its own form view (M23); `SourceEditor` → `source` + `may.applySource`; `ObjectEditor`, `WireEditor`, `Definitions` → `may.applyEdits`. `contract/react-types.ts`, `library-react.ts`, `definitions-model.ts` and `creation-react.ts` stop building `Pick`s of one flat view (M33).
- `null` and `boolean` appear only in the view, as "nothing to draw" and derived flags kept for React. Stored state has none.

Status (`view/status.ts`). The first matching row wins. Wording unchanged.

| # | When | Text |
|---|---|---|
| 1 | navigation opening / installing (navigation) · switching / installing (chooser) · switch-failed | `Rendering diagram…` · `Opening {title}…` · `Could not open {title}` |
| 2 | problem shown | failure `open` ⇒ `problem.message`; otherwise `Action failed. See the error above.` |
| 3 | ∃ entry recording or sending | `Saving…` |
| 4 | gesture choosing | `Review movement options` |
| 5 | connection editing | `Review new connection` |
| 6 | note | `Movement cancelled` · `No receipt found — retry remains an explicit action` · `Collection is no longer available` · `Add to "{title}" was not applied: {message}` |
| 7 | resting | catalogue unread ⇒ `Connecting…`; library ⇒ `Ready`; source draft, or the open collection ∈ `notices.drafts` ⇒ `Draft not applied`; ∃ unrefused entry ⇒ `Edit awaiting confirmation`; otherwise `Saved` |

---

## 8. Runner, effects, executors, facade

### 8.1 Runner: `adapters/runner/runner.ts` (~140 lines)

```ts
/*
 * The one workspace runner. Every dispatch is queued. The queue drains one event at a time:
 * transition → commit → notify → queue that step's events → run its effects in order. An effect
 * never re-enters a transition; its result is dispatched, which only queues. After dispose, the
 * queue, listeners and later results are dropped. Not pure (adapter; this closure is the only
 * mutable workspace state). Recovery: transitions return values; executor failures come back as
 * events; a thrown bug becomes an `effect-failed` or `transition-failed` report.
 */
export interface RunnerParts<W, V> {
  readonly machine: WorkflowMachine<W>;
  readonly execute: Execute;                      // compose/executors.ts: routes each effect to its one executor
  readonly project: (state: W) => V;
  readonly close: () => void; // aborts renders, closes the stream
}
export interface Runner<V> {
  dispatch(event: WorkspaceEvent): void;
  subscribe(listener: () => void): () => void;
  getSnapshot(): V;
  dispose(): void;
}
export function createRunner<W, V>(parts: RunnerParts<W, V>): Runner<V>;
```

| Rule | Behaviour |
|---|---|
| R1 Queue | FIFO. If a drain is running, `dispatch` only pushes, so nothing re-enters. |
| R2 Per event | `step = transition(state, e)` → `state = step.state` → push `step.events` → run `step.effects` in order. Listeners are notified once, when the queue is empty and the state reference differs from the last notified one. |
| R3 Results | Sync executor results queue behind the current step's events. Async results dispatch later and start a new drain. |
| R4 Transition throws (a bug) | Keep the previous state, drop the event, dispatch notices reported{`transition-failed`}. A throw while handling a `transition-failed` report is dropped with no new report. |
| R5 Executor throws | Catch it, dispatch notices reported{`effect-failed`} |
| R6 Dispose | Dispatch lifecycle disposed, run its teardown effects, call `close()`, clear listeners, set `closed`. Every later dispatch is dropped. |
| R7 Cancellation | Tickets decide. `abort-render` only frees the network; a late answer is dropped by its ticket. Workspace and history reads are never aborted. |
| R8 Publish | `getSnapshot` returns `project(state)` for the last notified state, cached per state reference. After-rules run inside the transition and notification waits for an empty queue, so React never sees a half-applied rule or the middle of a lift chain. |

### 8.2 Effects: `contract/records/workflow/effects.ts` (~150 lines)

```ts
export type ServiceEffect =
  | { readonly family: 'service'; readonly kind: 'read-workspace'; readonly ticket: ReadTicket }
  | { readonly family: 'service'; readonly kind: 'read-render'; readonly ticket: RenderTicket }
  | { readonly family: 'service'; readonly kind: 'abort-render'; readonly render: RenderId }
  | { readonly family: 'service'; readonly kind: 'read-history'; readonly ticket: HistoryTicket }
  | { readonly family: 'service'; readonly kind: 'read-receipt'; readonly request: RequestId }
  | { readonly family: 'service'; readonly kind: 'watch-changes' }
  | { readonly family: 'service'; readonly kind: 'stop-watching' };
/** The one effect that posts a request. Its own family, so it has its own executor and only JournalEffect names it (J3). */
export type ApplyEffect = { readonly family: 'apply'; readonly kind: 'post-apply'; readonly admitted: AdmittedSend };
export type StorageEffect =
  | { readonly family: 'storage'; readonly kind: 'write-journal'; readonly workspace: WorkspaceId; readonly entries: readonly RetainedEntry[]; readonly purpose: JournalWrite }
  | { readonly family: 'storage'; readonly kind: 'read-journal'; readonly workspace: WorkspaceId }
  | { readonly family: 'storage'; readonly kind: 'write-source'; readonly workspace: WorkspaceId; readonly draft: SourceDraft }
  | { readonly family: 'storage'; readonly kind: 'remove-source'; readonly workspace: WorkspaceId }
  | { readonly family: 'storage'; readonly kind: 'read-source'; readonly workspace: WorkspaceId };
export interface SceneFlags { readonly editable: 'editable' | 'read-only'; readonly link: 'online' | 'offline' }
export type GestureSettle =
  | { readonly kind: 'confirmed' } | { readonly kind: 'discard' } | { readonly kind: 'reject'; readonly message: string };
export type SceneEffect =
  | { readonly family: 'scene'; readonly kind: 'open'; readonly render: RenderId; readonly document: RenderDocument; readonly camera: 'keep' | 'fit'; readonly flags: SceneFlags }
  | { readonly family: 'scene'; readonly kind: 'update'; readonly render: RenderId; readonly document: RenderDocument }
  | { readonly family: 'scene'; readonly kind: 'close' }
  | { readonly family: 'scene'; readonly kind: 'settle-gesture'; readonly gesture: GestureId; readonly settle: GestureSettle }
  | { readonly family: 'scene'; readonly kind: 'preview'; readonly gesture: GestureId; readonly ask: PreviewAsk; readonly preview: GeometryPreview }
  | { readonly family: 'scene'; readonly kind: 'flags'; readonly flags: SceneFlags };
export type LocationTarget = { readonly kind: 'library' } | { readonly kind: 'collection'; readonly collection: CollectionId };
export type BrowserEffect =
  | { readonly family: 'browser'; readonly kind: 'bind-keys' } | { readonly family: 'browser'; readonly kind: 'unbind-keys' }
  | { readonly family: 'browser'; readonly kind: 'read-location' }
  | { readonly family: 'browser'; readonly kind: 'write-location'; readonly target: LocationTarget };
export type StoreEffect =
  | { readonly family: 'stores'; readonly kind: 'restore-panels'; readonly workspace: WorkspaceId }
  | { readonly family: 'stores'; readonly kind: 'restore-editors'; readonly workspace: WorkspaceId }
  | { readonly family: 'stores'; readonly kind: 'refresh-library'; readonly latest: Latest }
  | { readonly family: 'stores'; readonly kind: 'record-visit'; readonly collection: CollectionId }
  | { readonly family: 'stores'; readonly kind: 'open-inspect' }
  | { readonly family: 'stores'; readonly kind: 'settle-definition'; readonly request: RequestId; readonly outcome: 'confirmed' | 'released' };
export type CallerEffect = { readonly family: 'callers'; readonly kind: 'answer-caller'; readonly request: RequestId; readonly answer: Result<Receipt> };
/** Temporary (§8.5): a settlement for an owner still inside the old session. Deleted with the bridge. */
export type BridgeEffect = { readonly family: 'bridge'; readonly kind: 'legacy-settled'; readonly origin: Origin; readonly request: RequestId; readonly answer: LegacyAnswer };
export type Effect = ServiceEffect | ApplyEffect | StorageEffect | SceneEffect | BrowserEffect | StoreEffect | CallerEffect | BridgeEffect;

/** One executor: runs one effect and answers only with its own answer events. */
export type Executor<E extends Effect, A extends WorkspaceEvent> = (effect: E, answer: (event: A) => void) => void;
/** What the runner calls: compose/executors.ts routes by `family` with an exhaustive switch. */
export type Execute = (effect: Effect, dispatch: (event: WorkspaceEvent) => void) => void;
```

### 8.3 Executors: one file per family, wired only in `contract/compose/executors.ts`

Adapters may not import adapters, so compose passes shared handles in. One signature per factory; the collection that owns the file draws it:

| Factory | Signature | Answers with (the `A` of `Executor<E, A>`) |
|---|---|---|
| `createServiceExecutor` | `(client: ServiceClient, decoders: WorkspaceDecoders) → Executor<ServiceEffect, ServiceAnswer>` | catalogue read-answered; diagram render-answered; history status-answered; journal receipt-answered; link stream-* / commit-seen |
| `createApplyExecutor` | `(client: ServiceClient, decode: ReceiptDecoder) → Executor<ApplyEffect, Extract<JournalEvent, {kind: 'apply-answered'}>>` | journal apply-answered |
| `createStorageExecutor` | `(retention: DraftRetention, readers: SubmissionReaders) → Executor<StorageEffect, StorageAnswer>` | journal written / loaded; source loaded |
| `createSceneExecutor` | `(canvas: CanvasHandles, intake: CanvasIntake) → Executor<SceneEffect, SceneAnswer>` | diagram scene-installed / scene-failed; gesture preview-answered |
| `createCanvasIntake` | `(ids: IdSource, legacy: LegacySession) → CanvasIntake` | gesture intent-received; connection begun; diagram inspect-requested |
| `createBrowserExecutor` | `(browser: BrowserHandles, navigation: WorkspaceNavigation, ids: IdSource) → Executor<BrowserEffect, BrowserAnswer>` | history requested; lifecycle location-read |
| `createStoresExecutor` | `(stores: StoreHandles) → Executor<StoreEffect, never>` | — (stores report through their own subscriptions) |
| `createWaiters` | `() → Waiters` (`Waiters.execute: Executor<CallerEffect, never>`) | — |
| `createBridgeExecutor` (temporary) | `(legacy: LegacySession) → Executor<BridgeEffect, never>` | — |

An executor failure that is not an answer event (a thrown bug) becomes notices reported{`effect-failed`} in the runner (R5), so no executor needs `notices` in its `A`.

| Effect kinds | Executor | I/O | Answer events |
|---|---|---|---|
| read-workspace, read-render, abort-render, read-history, read-receipt, watch-changes, stop-watching | `adapters/effects/service.ts` (~140) | GET workspace / render / history / receipt with decoders injected; one AbortController per render; SSE | catalogue read-answered; diagram render-answered; history status-answered; journal receipt-answered; link stream-opened / stream-failed / commit-seen |
| post-apply | `adapters/effects/apply.ts` (~100) | POST `/api/v1/authoring/apply`. A success must name this request's receipt and carry a readable snapshot, otherwise `unknown`. A failure is classified once, here, by `classifyApply` (§9): a refused code gives `refused{Refusal}`, anything else `unknown`. | journal apply-answered |
| write/read-journal, write/remove/read-source | `adapters/effects/storage.ts` (~120) | `draft-retention.ts` → localStorage; `RetainedEntry` ↔ stored shape and `restoredOrigin` in the reader | journal written / loaded; source loaded; notices reported |
| open, update, close, settle-gesture, preview, flags | `adapters/effects/scene.ts` (~150) | Canvas session handle; DOM viewport; camera carry-over (from `session-reuse.retainCamera`). The previous session is disposed after the new one installs. Canvas answers are read synchronously. `performance.measure` on purpose `released`. | diagram scene-installed / scene-failed; gesture preview-answered |
| *(Canvas effects drained after each dispatch)* | `adapters/effects/canvas-intake.ts` (~90) | Mints a RequestId for each edit intent. Ignores navigation-request, announce and recover-draft. Until M25 / M28, forwards connection / placement intents to the old session (§8.5). | gesture intent-received; connection begun; diagram inspect-requested |
| bind-keys, unbind-keys, read-location, write-location | `adapters/effects/browser.ts` (~110) | keydown handling moved from `core/workspace/history-keys.ts` (ignores editable targets, composition and repeats; mints the request); `location`; `history.replaceState` | history requested; lifecycle location-read; notices reported |
| restore-panels, restore-editors, refresh-library, record-visit, open-inspect, settle-definition | `adapters/effects/stores.ts` (~110) | Store calls. open-inspect also selects the Inspect tab and saves that preference, as today. | notices reported. Stores dispatch notices drafts-changed from their subscriptions. |
| answer-caller | `adapters/runner/waiters.ts` (~50) | Resolves the promise a store's `apply` is awaiting: a receipt, a refusal, an uncertain answer or a block | — |
| legacy-settled (temporary) | `adapters/runner/bridge.ts` | Calls `LegacySession.settled` (§8.5) | — |

Export stays outside the machines: `adapters/edge/export-artifact.ts`, called directly by the facade.

### 8.4 Facade: one small file per workflow in `adapters/facade/`, assembled in `contract/compose/workspace.ts`

Each command mints IDs, builds one event and dispatches it. If an ID cannot be minted, it dispatches notices reported{`id-unavailable`} and, for an editor apply, answers the caller with that failure. `showLibrary` and `refresh` are removed (no callers). Each file is added by the PR that wires its machine.

```ts
// contract/records/commands.ts (~110 lines): one command set per React feature
export interface NavigationCommands {
  open(collection: CollectionId): void;                  // diagram open-requested{by: person}
  create(title: string): void;                           // mints collection + request → diagram create-requested
  beginCollectionSwitch(): void; chooseCollection(collection: CollectionId): void;
  retryCollectionSwitch(): void; cancelCollectionSwitch(): void;
}
export interface JournalCommands {
  reconcileRequest(request: RequestId): void; retryRequest(request: RequestId): void; dismissRequest(request: RequestId): void; // by: person
  dismissProblem(): void;
  report(problem: Diagnostic): void;                     // notices reported{action}
  reportCanvas(problem: CanvasDiagnostic): void;         // Canvas onError → foreign canvas diagnostic, reported{action}
  reportPanel(problem: Diagnostic): void;                // panel controller → reported{panel-preferences} (N2)
}
export interface HistoryCommands { navigateHistory(direction: Direction): void }     // mints request
export interface FormCommands {                          // renamed from setDiagramDraft … addGroup; AddForms is rewired in M23 anyway
  setDraft<K extends FormKind>(form: K, draft: DraftOf[K]): void;
  add(form: FormKind): void;                             // mints IdOf[K] + request; returns nothing (today Promise<Result<Receipt>>)
  cancelCreation(form: FormKind): void;
  dropPalette(drop: PaletteDrop): void;                  // mints object + request
}
export interface ConnectionCommands {
  editConnection(edit: ConnectionEdit): void;
  applyConnection(): void;                               // mints relationship + request; returns nothing (today Promise<Result<Receipt>>)
  cancelConnection(): void;
}
export interface MovementCommands { chooseMoveOption(choice: ChoiceKind): void; applyMove(choice: ChoiceKind): void; cancelMove(): void }
export interface SourceCommands {
  showSource(panel: 'open' | 'closed'): void; editSource(text: string): void;
  applySource(): void; closeSource(decision: 'keep' | 'discard' | 'stay'): void;
}
/** Editor stores keep their own drafts and await the journal's answer. */
export interface EditorSends {
  apply(editor: EditorKind, build: (request: RequestId) => Result<SendWanted>): Promise<Result<Receipt>>;
}
// contract/records/workspace.ts (~90 lines)
export interface WorkspaceController extends NavigationCommands, JournalCommands, HistoryCommands, FormCommands,
  ConnectionCommands, MovementCommands, SourceCommands {
  start(): void; dispose(): void;
  subscribe(listener: () => void): () => void; getSnapshot(): WorkspaceView;
  exportArtifact(input: ExportInput): Promise<Result<BinaryResponse>>; // direct exporter call
}
```

| File | Commands | ~Lines | Added in |
|---|---|---|---|
| `facade/navigation.ts` | `NavigationCommands` | 80 | M17 (open, create), M18 (chooser) |
| `facade/journal.ts` | `JournalCommands` | 60 | M7 (Check, Retry, Dismiss), M8 (reports) |
| `facade/history.ts` | `HistoryCommands` (canvas `drafting` when the live Canvas session has a draft) | 40 | M20 |
| `facade/forms.ts` | `FormCommands` | 80 | M23 |
| `facade/connection.ts` | `ConnectionCommands` | 50 | M25 |
| `facade/movement.ts` | `MovementCommands` | 50 | M28 |
| `facade/source.ts` | `SourceCommands` | 50 | M32 |
| `facade/editor-sends.ts` | `EditorSends`: builds the request with a fresh ID (`definitions.bindRequest` first for a definition, so a reload can settle it; `unlockWithoutRequest` when the build fails), dispatches journal send-wanted{origin editor; generation captured for the three editors, current for the library}, and returns the waiter | 90 | M30 |
| `facade/view.ts` | `getSnapshot`: the projection plus `active.session` and `active.canvas`, memoised by the identities of the projection and the session handle | 40 | M17 |

React receives the command set of its feature (§7.7), not the whole controller. `contract/records/commands.ts` grows with the facade: each facade file's PR adds its command set, and `WorkspaceController` keeps today's methods through the session until then (the bridge merge rule, §8.5).

### 8.5 The bridge (temporary, M2 → M34)

The old session and the runner run side by side from M2 to M34. Adapters may not import adapters (`.dependency-cruiser.cjs`, `adapter-isolation`), so `contract/compose/workspace.ts` builds both and joins them through two ports.

```ts
// contract/ports/bridge.ts (~40 lines; deleted in M34)
/** What the old session may ask of the runner. */
export interface SessionBridge {
  dispatch(event: WorkspaceEvent): void;          // e.g. journal send-wanted for a send the session still builds
  view(): ProjectedView;                           // the runner's fields; the session copies the moved ones into its view
  active(): ActiveDiagram | null;                  // the open diagram with its live handles, once the scene executor owns it (M17)
  subscribe(listener: () => void): () => void;     // the session re-publishes when the runner changes
}
/** What the runner's executors may ask of the old session. The session implements it. */
export type LegacyAnswer = { readonly kind: 'settled'; readonly outcome: Settlement } | { readonly kind: 'uncertain' } | { readonly kind: 'blocked'; readonly block: SendBlock };
export interface LegacySession {
  settled(origin: Origin, request: RequestId, answer: LegacyAnswer): void; // bridge executor, for owners not yet moved
  canvasEffect(effect: CanvasEffect): void;                                // canvas-intake, for intents not yet moved
}
```

| Message | Direction | Added in | Removed in |
|---|---|---|---|
| `dispatch(journal send-wanted)` for sends the session still builds | session → runner | M7 | by origin, as each owner moves: add-form, palette M23; connection M25; gesture, move-choice M28; editor M30; source M32; create-collection M17; history M20 |
| fx `legacy-settled` → `LegacySession.settled` | runner → session | M7 | same origins, same PRs (the lift row switches to the machine event) |
| View copy: `pending`, `busy` (today's names) from `view().journal` | runner → session view | M7 | M33 |
| View copy: `problem`, status note | runner → session view | M8 | M33 |
| `dispatch(notices reported)` for the session's own `report()` | session → runner | M8 | M34 |
| View copy: `snapshot`, `generation`, `collections`, `connected` | runner → session view | M12 | M33 |
| Keys: compose passes `session.navigateHistory` as the browser executor's key handle | compose | M12 | M20 (handle becomes `facade.navigateHistory`) |
| History hold: the session keeps today's history-held check before it dispatches send-wanted; Retry keeps quirk 5 until then | session only | M7 | M20 (the runner's gate holds edits) |
| `active()` and view copy: `active`, `opening`, `collectionSwitch` | runner → session | M17 (`active`, `opening`), M18 (`collectionSwitch`) | M33 |
| `LegacySession.canvasEffect` for edit intents | canvas-intake → session | M17 | connection intents M25; placement and other intents M28 |

- **Budget.** `contract/ports/bridge.ts` ≤ 40 lines; `adapters/runner/bridge.ts` (bridge executor and the view-copy helper) ≤ 120 lines. Each wire PR lists the bridge rows it adds and removes.
- **Merge rule.** The session's `getSnapshot` returns its own view with the moved fields overwritten from `view()`. A field is owned by exactly one side in every PR (table above).
- **Shrink rule.** `wc -l workspace-session.ts` drops in every wire PR; the PR body gives both numbers.

### 8.6 Other types named in signatures

```ts
// contract/ports/executors.ts (~60 lines)
export interface CanvasHandles { readonly viewport: HTMLElement; openSession(input: SceneOpenInput): Result<CanvasSessionHandle>; }
/** Reuses the P3/P5 port (contract/ports/browser-globals.ts). Do not add a second window port. */
export interface BrowserHandles { readonly window: BrowserGlobals['window'] }
export interface StoreHandles {
  readonly panels: PanelController; readonly library: LibraryController;
  readonly editors: { readonly inspector: RetainedEditor; readonly wires: RetainedEditor; readonly definitions: DefinitionSession };
}
export interface Waiters { wait(request: RequestId): Promise<Result<Receipt>>; readonly execute: Executor<CallerEffect, never> }
export interface ExecutorHandles {
  readonly client: ServiceClient; readonly decoders: WorkspaceDecoders; readonly retention: DraftRetention;
  readonly readers: SubmissionReaders; readonly canvas: CanvasHandles; readonly browser: BrowserHandles;
  readonly navigation: WorkspaceNavigation; readonly stores: StoreHandles; readonly ids: IdSource;
  readonly waiters: Waiters; readonly legacy: LegacySession; // legacy: until M34
}
// contract/compose/workspace.ts (P3). random and now come from BrowserGlobals; only cli/main.ts reads the globals.
interface WorkspaceParts {
  readonly element: HTMLElement; readonly client: ServiceClient;
  readonly panels: Pick<PanelController, 'restore' | 'open' | 'selectTab'>;
  readonly retention: DraftRetention; readonly navigation: WorkspaceNavigation;
  readonly random: () => string; readonly now: () => number;
}

// core/workspace/journal/*.ts: internal
type EntryLookup = { readonly kind: 'found'; readonly entry: JournalEntry; readonly index: number } | { readonly kind: 'unknown' };
type RecoveryEvent = Extract<JournalEvent, { kind: 'check-requested' | 'retry-requested' | 'receipt-answered' | 'dismiss-requested' }>;
type RestoreEvent = Extract<JournalEvent, { kind: 'bind' | 'loaded' }>;
// core/workspace/source/editing.ts
type EditingEvent = Extract<SourceEvent, { kind: 'edited' | 'apply-requested' | 'settled' | 'blocked' }>;
// core/workspace/diagram/children.ts
type ChildEvent = GestureEvent | ConnectionEvent | FormsEvent;
// core/editing/connection/request.ts
interface ConnectionIds { readonly request: RequestId; readonly relationship: RelationshipId }
```

`JournalView`, `DiagramView`, `EditingView`, `SourceView`, `HistoryView` are the parts of `ProjectedView` in §7.7; their fields are the rows of that table.

---

## 9. Error codes

```ts
// contract/records/error-codes.ts (~90 lines). ER1 fixes the exact list with the compiler.
export type StartupCode = 'initialization-failed' | 'mount-failed' | 'invalid-location' | 'navigation-unavailable'
  | 'invalid-workspace' | 'invalid-preferences' | 'invalid-recovery' | 'recovery-unavailable';
export type RenderCode = 'invalid-diagram' | 'stale-diagram' | 'workspace-generation' | 'render-input-changed' | 'snapshot-mismatch';
export type JournalCode = SendBlock | 'unknown-request' | 'pending-request' | 'confirmation-required'
  | 'invalid-receipt' | 'invalid-response' | 'invalid-request' | 'connection-uncertain' | 'draft-retention-unavailable';
export type GestureCode = 'invalid-edit' | 'unsupported-edit' | 'stale-target' | 'stale-gesture' | 'movement-active'
  | 'preview-refused' | 'diagram-changed' | 'duplicate-selection' | 'connection-open' | 'tree-section-drop' | 'invalid-creation';
export type SourceCode = 'source-unavailable';
export type EditorCode = 'invalid-inspector-draft' | 'invalid-wire-draft' | 'invalid-definition-draft' | 'invalid-literal-draft'
  | 'invalid-folder-draft' | 'invalid-library' | 'invalid-library-request' | 'library-changed' | 'invalid-visits'
  | 'panel-preferences' | 'ui-preferences';
export type HistoryCode = 'invalid-history';
export type HostCode = 'unavailable' | 'export-unavailable' | 'id-unavailable' | 'effect-failed' | 'transition-failed';
export type WebErrorCode = StartupCode | RenderCode | JournalCode | GestureCode | SourceCode | EditorCode | HistoryCode | HostCode;

// contract/errors.ts (~130 lines)
import type { ErrorCode as AuthoringErrorCode } from '@novakai/canvas-authoring';
import type { ErrorCode as ServiceErrorCode, OperationSource } from '@novakai/canvas-service'; // OperationSource export added in ER1
import type { Diagnostic as CanvasDiagnostic } from '@novakai/canvas-canvas';
import type { Diagnostic as LibraryDiagnostic } from '@novakai/canvas-library';
import type { Diagnostic as LayoutDiagnostic } from '@novakai/canvas-layout';
import type { OwnerDiagnostic as LanguageDiagnostic } from '@novakai/canvas-language';
interface Text { readonly message: string; readonly recovery: string }
/** A failure from another owner, keyed by who sent it, with that owner's own closed code and record. */
export type ForeignDiagnostic = Text & (
  | { readonly origin: 'authoring'; readonly code: AuthoringErrorCode; readonly source: OperationSource }
  | { readonly origin: 'service'; readonly code: ServiceErrorCode; readonly source: OperationSource }
  | { readonly origin: 'canvas'; readonly code: CanvasDiagnostic['code']; readonly source: CanvasDiagnostic }
  | { readonly origin: 'library'; readonly code: LibraryDiagnostic['code']; readonly source: LibraryDiagnostic }
  | { readonly origin: 'layout'; readonly code: LayoutDiagnostic['code']; readonly source: LayoutDiagnostic }
  | { readonly origin: 'language'; readonly code: LanguageDiagnostic['code']; readonly source: LanguageDiagnostic }
  | { readonly origin: 'unrecognised'; readonly code: 'unrecognised-failure'; readonly source: OperationSource });
/** A web failure. `cause` keeps the typed foreign failure behind it, when there is one (key omitted otherwise). */
export type WebDiagnostic = Text & { readonly origin: 'web'; readonly code: WebErrorCode; readonly cause?: ForeignDiagnostic };
export type Diagnostic = WebDiagnostic | ForeignDiagnostic;
export type AuthoringDiagnostic = Extract<ForeignDiagnostic, { origin: 'authoring' }>;
/**
 * A service wire failure as a diagnostic. `owner` is the owner that answers this endpoint, decided
 * once by the executor that called it: `authoring` for apply and receipt, `service` for the rest.
 * The code is checked against that owner's closed union; a code outside it gives
 * `unrecognised-failure`, with the raw failure kept in `source`.
 */
export function foreignFailure(owner: 'authoring' | 'service', source: OperationSource): ForeignDiagnostic;
```

Where each foreign failure enters, and its branch:

| Enters at | Today | Branch |
|---|---|---|
| Apply and receipt answers (`effects/apply.ts`, `effects/service.ts` read-receipt) | `code: string` on the wire; `invalid-input` and `cancelled` exist in both Authoring and Service | `foreignFailure('authoring', …)` |
| Other service reads (`effects/service.ts`) | same | `foreignFailure('service', …)` |
| Canvas `onError` (`WorkspaceShell.tsx:151`) | passed to `controller.report` as is | `reportCanvas` → `origin: 'canvas'` |
| Library reader (`library-reader.ts:87`) | web code `invalid-library` with the Library diagnostic as `source` | web `invalid-library` with `cause: {origin: 'library', …}` |
| Library store edit on a changed library (`library-session.ts:184`) | local `revision-conflict`, a code in no web union | web `library-changed` |
| Route preview (`route-preview.ts:88`) | the Layout failure returned as is | `origin: 'layout'` |
| DSL print (`WorkflowDeps.print`) | Language failure | `origin: 'language'` |

- `owner` leaves `Diagnostic`. Where a problem is shown is now `ProblemSlot.shown`.
- `contract/records/failure-source.ts` (a hand copy of Service's type) is deleted in ER1.
- The apply executor reports an unknown answer as the web code `connection-uncertain`, so F1 can find it.
- **One classification.** `classifyApply(problem: ForeignDiagnostic): { kind: 'refused'; refusal: Refusal } | { kind: 'unknown' }` lives in `core/workspace/rules/refusal-classes.ts` and reaches the apply executor through `contract/api.ts`. The executor calls it once; the journal does not check the class again (§6.4). The tables are frozen and typed by closed unions: `answerClass: Readonly<Record<AuthoringErrorCode, 'refused' | 'unknown'>>`, `moveRefusal: Readonly<Record<RefusedCode, 'offer' | 'reject'>>`.

| Authoring code | `answerClass` | `moveRefusal` |
|---|---|---|
| invalid-input, unsupported-version, unknown-reference, invariant-violation, missing-asset, permission-denied | refused | reject |
| revision-conflict | refused | reject (the reread reinstalls; choices would be stale) |
| constraint-conflict | refused | **offer** |
| request-reused, storage-unavailable, corrupt-record, cancelled | unknown → uncertain | — |
| a service or unrecognised failure | unknown → uncertain | — |

Consumers branch only on `origin` and `code`. The one comparison of message text today (`creationWithout` / `core/creation/problem.ts`) is replaced by an identity rule: send failures appear only in the bar (change I32).

---

## 10. Target file tree (`apps/web`)

`N` new · `C` changed · `M` moved · `D` deleted. The number is the expected line count; P1–P8 give the real count. Nothing is over 300 after P7.

```
cli/main.ts C18 (P3: the one place that reads browser globals: window, storage, random, now)
contract/
  brands.ts N130 · errors.ts C130 · api.ts C234 (P8: header) · index.ts C40 · compose.ts C195 (P3: 271 → 184; P5, P6 wiring)
  compose/workspace.ts N140 (P3: controller() moved, 115; then deps, machine, runner, facade parts, handles; the bridge until M34)
  compose/executors.ts N120 · compose/panel-tabs.ts N37 (P3: side-panel tab text)
  compose/movement-review.ts D (→ core/editing/gesture-plan.ts) · compose/features.ts C130 (P6: takes `random`; B3b: IdSource)
  ports/ids.ts N40 · ports/workflow-deps.ts N70 · ports/connection-policy.ts M30 (from core/editing/connection/types.ts)
  ports/executors.ts N60 · ports/bridge.ts N40 (temporary, M1 → M34) · ports/workspace.ts C60 (WorkspaceBindings removed, M34)
  ports/browser-globals.ts N32 (P3; P5 widened `window`) · ports/draft-retention.ts N19 (P2a)
  ports/workspace-decoders.ts N19 (P2a) · ports/request-builders.ts N57 (P2a; M1 reshapes it to §6.0)
  records/error-codes.ts N90 · records/failure-source.ts D · records/source.ts D
  records/submission.ts C50 (StoredSubmission, CarriedSnapshot) · records/workspace.ts C90 (WorkspaceView, WorkspaceController)
  records/commands.ts N110 (the command sets, §8.4)
  records/movement.ts C35 (MoveReview, MoveOptionKind and MoveOption.id deleted; builder inputs stay)
  records/connection.ts C · records/creation.ts C (view types, PaletteDrop) · records/panels.ts C69 (P2a, B6b)
  records/active-diagram.ts N14 (P2a) · records/editor-recovery.ts C55 (P2a: RecoveredSource) · records/wire-editor.ts C83 (P2a: EndpointChoice)
  records/workflow/ machine.ts N40 · events.ts N80 · effects.ts N150 · gate.ts N30 · view.ts N150 · permissions.ts N50
                    lifecycle.ts N40 · link.ts N30 · catalogue.ts N40 · journal.ts N130 · history.ts N40
                    source.ts N60 · notices.ts N50 · diagram.ts N110 · gesture.ts N60 · connection.ts N40 · forms.ts N70
  panel-types.ts C66 (P2a: PanelController, PanelBindings only) · react-types.ts C134 (P5: shell slot and hook types)
  creation-react.ts N94 (P6) · library-react.ts C · definitions-model.ts C (M33: feature views, creation-react.ts too)
core/workspace/
  step.ts N30 · state.ts N60 · machine.ts N110 · contexts.ts N100 · finalize.ts N80
  lift/ lifecycle N50 · link N30 · catalogue N100 · journal N140 · history N30 · source N30 · diagram N110
  lifecycle/ state N30 · lifecycle N110          link/ state N25 · link N100
  catalogue/ state N30 · catalogue N110
  journal/ state N80 · journal N110 · send N110 · answers N110 · recovery N120 · restore N90 · entries N70
  history/ state N40 · history N130 · gate C80 (M20) · navigable M40
  source/ state N80 · source N130 · editing N110 · rebase N80
  notices/ state N40 · notices N110
  diagram/ state N110 · session N120 · children N110 · navigation N160 · render N140 · refresh N110
           create N70 · ticket M48 · admission M145 (P8, moved as-is)
  gesture/ state N70 · gesture N120 · intake N120 · choices N140 · settle N110 · failures M80
  connection/ state N30 · connection N130      forms/ state N70 · forms N120 · submit N130
  rules/ gated-send N130 · permissions N140 · flags N60 · refusals N100 · stale-uncertainty N40
         history-release N70 · note-expiry N40 · refusal-classes N70
  view/ project N60 · diagram-view N130 · editing-view N110 · journal-view N90 · status N120
  panel-state.ts C130 (P2a) · D: render/patches.ts, render/navigation.ts (→ diagram/), movement-review/{phases,types,outcome}.ts,
     status.ts, history-keys.ts (→ adapters/effects/browser.ts), history/journal.ts (→ rules/gated-send + history/navigable)
  C: session-reuse.ts (reusableSession and renderChanged stay; retainCamera → scene executor)
core/panels/preferences.ts C90 (P2a) · core/inspector/endpoints.ts C45 (P2a)
core/editing/  N: gesture-plan.ts 130, module-move.ts 50 · C: plan.ts (duplicate/ancestor check; one change builder
               from capture/settling/sections.ts), connection/request.ts (IDs in), definition-request.ts (RequestId in),
               movement.ts (plain-move builder only)
               connection/types.ts C (ConnectionPolicy, IdGrammar → contract/ports) · palette-drop.ts C (type → records)
               D: submissions.ts, connection/capture.ts · M: rearrange/materialize.ts → materialize 220 + acceptance 110 (P4)
core/creation/ N: validation.ts 120, changes.ts 150 (M21) · D: captures.ts, problem.ts, records.ts (M24) · C: drafts.ts, panel.ts
adapters/
  runner/ runner.ts N140 · waiters.ts N50 · bridge.ts N≤120 (temporary, M2 → M34)
  effects/ service N140 · apply N100 · storage N120 · scene N150 · canvas-intake N90 · browser N110 · stores N110
  facade/ navigation N80 · journal N60 · history N40 · forms N80 · connection N50 · movement N50 · source N50
          editor-sends N90 · view N40
  edge/ ids N90 · request-builders N219 · workspace-decoders N162 (P3; workspace-inputs.ts D) · export-artifact N40
        service-client C · browser-navigation C
  readers/submission-readers.ts C (RetainedEntry ↔ stored shape; restoredOrigin) · readers/{inspector,wire,definition,library}-reader.ts C (B2b, ER1)
  sessions/ D: workspace-session (1,746), submission-session, source-session, canvas-session
            kept: draft-retention, library-session C, panel-session, preference-session, retained-editor C, definition-session C
  react/ AddTools C129 · AddForms N184 · AddFields N89 (P6) · WorkspaceShell C224 · ShellAlerts N47 · shell-hooks N68 (P5)
         MovementReview, HistoryControls, RequestRecovery, SourceEditor, LibraryBrowser, ObjectEditor, WireEditor,
         CollectionChooser, Definitions C (feature views and `may`, CollectionId, ChoiceKind; drop await; Definitions stops minting)
capability/canvas/ (P7, B5)
  adapters/react-flow/ interaction-handlers.ts C 358 → 198 (selection, hover, connections, viewport) · geometry-gestures.ts N175
                       (drag, resize) · keyboard-commands.ts N60 · browser-bindings.ts N38 (from contract/compose.ts)
                       gesture-ids.ts N~25 (B5: parses the host's random text into GestureId)
  contract/interaction-parts.ts N67 (part types) · contract/compose.ts C 104 → 86
capability/design-system/adapters/react/Dialog.module.css C (P1, +23 / -7)
apps/service/contract/ brands.ts N25 · index.ts C · records/protocol.ts C · records/server.ts C (P2b)
capability/layout/{core, contract/records} C (P2b: 7 cycle reports) · capability/export/contract/records/artifact.ts C (P2b: 2)
```

**U-series (after ER3; §13.2 U1–U42).** The rest of `apps/web`, re-homed by seam or feature. Paths are after U7.

```
README.md C (find-it table: task → folder; U7)
contract/
  types.ts M (was records/owners.ts) · schemas/installation.ts M (was records/installation.ts)
  schemas/ editing-base M (was editor-recovery.ts) · lists N20 · object-draft N90 · wire-draft N80 · definition-draft N70
           source-draft N35 · panel-preferences N35 (U11, U12; each typed z.ZodType<Record>)
  records/ data only (U8): object-draft M (was inspector.ts) · wire-draft M (was wire-editor.ts)
           definition-draft M (was definitions.ts) · canvas-edits M (was editing.ts; EditContext only)
  records/workflow/ panels · preferences · library · drafts · definitions N (events; U32, U34, U36, U38, U40)
  ports/ service M (was client.ts) · panels M (was panel-types.ts; D in U33)
         object-inspector · wire-inspector · retained-editor · library · definitions · preferences N
         (U8: session interfaces out of records; each D in its machine's wire PR)
  react/ shell M (was react-types.ts) · library · creation · definitions · object-inspector · wire-inspector M (were *-react.ts)
         design · header · panels (RegisteredSection, PanelSlots) · settings · failures N (U9)
  api/ workspace · failures · panels · creation · object-inspector · wire-inspector · library · preferences · drafts N
       definitions M (was definitions-model.ts) (U10; api.ts D)
  compose/sessions.ts D (U39)
core/
  shared/results.ts M
  failures/ display M (was output/diagnostics.ts) · messages N30 (U31: text by origin + code; no regex)
  canvas-edits/ plan · targets · placements · regroup · routes M · capture/{boxes,pinning,scene} M
                settle/{grow,stop-short,sections,types} M (was capture/settling)
  movement/ movement · gesture-plan · module-move M · single-node N90 (U30)
            intent/* M (was movement-intent) · expand/* M · rearrange/* M
            preview/{completeness,geometry,indexing,measure,types} M · allowed N70 · grow-rules N75 · push-rules N95
            stop-rules N55 (U13; rules.ts D)
  connection/* M (was editing/connection)
  creation/ palette-drop · group-creation M
  definitions/ request M (was editing/definition-request) · state N · definitions N (machine, U40) · draft-lifecycle D (U42)
  drafts/ keys N45 (the 3 draft-key functions) · base N80 · encode N90 (was recovery/editor-records; U14)
          state N · drafts N (machine, U38)
  inspector/object/ edits · content-edits N90 (U15) · selection · retain N15 (U14)
  inspector/wire/ edits · changes N55 (U15) · selection · endpoints · retain N15 (U14; draft-commands D)
  panels/ preferences · geometry N70 · visibility N60 (was workspace/panel-state; U16) · shell-layout M (was workspace/)
          sections N30 (U18) · state N · panels N (machine, U32)
  preferences/ defaults C · themes N40 (U26) · state N · preferences N (machine, U34)
  library/ state N · library N · defaults N15 (machine, U36)
  workspace/ machine.ts C (routes 5 more machines) · lift/{panels,preferences,library,drafts,definitions} N
  D: editing/, output/, recovery/
adapters/
  browser/ host.tsx M · navigation M · environment M (was preferences/browser-preferences) · ids M (was edge/ids)
           token-dimensions N40 · theme-scope N30 (U26) · download N25 (U25)
  service/ client M · diagram-reader M · workspace-decoders M · export-artifact M · answers N (U2: receipt, applied answer)
  storage/ local-retention M (was sessions/draft-retention) · panel-preferences M · object-drafts · wire-drafts · definition-drafts M
           (were readers/{inspector,wire,definition}-reader) · journal-entries N · source-drafts N (U2)
  authoring/requests M (was edge/request-builders) · language/printer N40 (U2) · layout/route-preview M · library/catalog-reader M
  facade/ panels · preferences · library · drafts · definitions N · editor-sends D (U42)
  effects/stores.ts D · runner/waiters.ts D (U42)
  D: edge/, readers/, preferences/, sessions/ (panel, preference, library, retained-editor, definition sessions: U33–U41)
  react/ shell/ · header/ · panels/ · library/ · add/ · navigation/ · export/ · definitions/ · object-inspector/
         wire-inspector/ · connection/ · movement/ · requests/ · source/ · settings/ · failures/ · shared-styles/
         (U6; each .module.css beside its component)
         wire-inspector/ WireSection N45 · WireSelectionEditor N110 · connection/ConnectionForm N140 (U17; WireEditor D)
         panels/ WorkspaceSidePanel C120 · SectionCustomizer N85 (U18)
         definitions/ ExpressionEditor N160 · LiteralEditor N95 (U19; DefinitionExpression D)
         failures/ FailureNotice N30 (U20) · shell/ShellAlerts.module.css N25 (U21)
         library/LibrarySection N15 (U6: out of compose/features.ts)
         shared-styles/ form.module.css M (was ObjectEditor.module.css) · navigation.module.css M (was Navigation.module.css)
capability/model/contract/index.ts C (U23: objectKind, size, wire enums) · capability/layout/core/scene-in.ts C (U31)
capability/design-system/cli/audit-styles.ts N (U22) · package.json C (`styles:audit`)
```

- **Watch list (250–300 lines; no action unless touched):** `core/editing/preview/rules.ts` 285 (split U13), `react/WireEditor.tsx` 267 (split U17), `react/DefinitionExpression.tsx` 253 (split U19). (`core/creation/records.ts` 296 is split in M21 and deleted in M24.)
- **Over 300 and touched:** `capability/canvas/adapters/react-flow/interaction-handlers.ts` 358. P7 split it (moves only): 198 · 175 · 60. B5's 5 `nextGestureId` call sites now sit in 3 files (B5 row).
- **Import matrix:**
  - Core imports only `contract/records/*`, `contract/ports/*`, `brands.ts` and `errors.ts` (`types.ts` from U7).
  - Adapters reach core only through `contract/api.ts` (`contract/api/*` from U10) and compose.
  - Declaration files import no core type (§5).

---

## 11. Behaviour kept

"Driven in" names the wire PR whose headless drive shows the row. Each wire PR runs its rows (DoD8).

| # | Behaviour today | Lives in | Driven in |
|---|---|---|---|
| 1 | Start: keys → read → recovery once per workspace → `?collection=` → open → change stream | lifecycle; catalogue lift | M12 |
| 2 | Start continues after the first read fails | lifecycle `first-read-failed` | M12 |
| 3 | Nothing is sent before recovery | journal `unbound` / `restoring` → `not-restored` | M7 |
| 4 | Restored journal: refused and foreign entries dropped, the rest uncertain; restored undo/redo checked one at a time | journal `loaded`, `autoCheck` | M7 |
| 5 | Source draft restored dirty; a foreign or corrupt draft is reported and kept | source `loaded`; `blocked` (S4) | M32 |
| 6 | Latest read wins; an older sequence in the same generation is ignored | catalogue CT1, CT2 | M12 |
| 7 | Accept → library refresh, source rebase, active refresh, history read | catalogue lift | M12 (library), M17 (active), M20 (history), M32 (source) |
| 8 | Carried snapshot uses the current generation | catalogue `carried` | M12 |
| 9 | Rereads on connect, unseen commit, failed send, render mismatch, receipt without carried snapshot | link / journal / diagram outs | M12 |
| 10 | Commit notice: own sending request skipped, own uncertain request not skipped | link K1 | M12 |
| 11 | Stream error → offline; Canvas parks a drag in progress | link + F5 | M12; M17 (Canvas parks) |
| 12 | Reconnect never replays the journal | the journal does not hear link events | M12 |
| 13 | Ticket captures collection, listing, workspace, generation; navigation or chooser | `RenderTicket`, `Listing`; the navigation phase | M17 |
| 14 | Answer checks in order, rereading before failing | `diagram/render.ts`, `admission.ts` | M17 |
| 15 | Reuse vs new session; older revision fails `stale-diagram`; camera kept for the same workspace and collection | `diagram/render.ts`; scene executor | M17 |
| 16 | Visit and URL only on a new session; a URL failure keeps the diagram | diagram installing open; browser executor | M17 |
| 17 | Old session disposed after the new one installs | scene executor | M17 |
| 18 | Failure keeps the current diagram; separate navigation and chooser texts | DG5; status rows 1–2 | M17, M18 |
| 19 | No reopen when the render in flight already covers the change | `refresh.ts` `activeRefresh` | M17 |
| 20 | Chooser: ignored while loading; opening it cancels a render in flight; "Choose another collection" on the failure screen reopens the list; choosing the open collection cancels; newer target wins; retry only when failed; cancel → refresh active + history read; foreign snapshots never reopen while switching; an open or a confirmed create while it is open closes it | diagram navigation | M18 |
| 21 | Bar hidden while the chooser is open; panel-preference problems survive renders | view; `cleared keep=panel-preferences`; N2 | M18; M8 (panel preferences) |
| 22 | Collection gone → library + `Collection is no longer available` | `diagram/refresh.ts` | M17 |
| 23 | Every Canvas dispatch drains its effects | scene executor → canvas-intake → queued events (R1) | M17 |
| 24 | inspect-request → right panel on the Inspect tab (preference saved) | diagram → open-inspect | M17 |
| 25 | navigation-request, announce, recover-draft ignored | canvas-intake | M17 |
| 26 | An intent while a move review is held is refused | gesture `≠ idle` row; connection guard | M28 |
| 27 | Local refusal → choices at once; first preview shown; a refused preview → reject + report | gesture unplaceable / preview-answered rows | M28 |
| 28 | No-change drop → quiet discard | gesture no-change | M28 |
| 29 | Preview published after the send starts, with `performance.measure` | gesture started → preview `released` | M28 |
| 30 | Two intents in one Canvas dispatch: the second is refused | gesture `≠ idle`; J2 | M28 |
| 31 | A confirmed gesture keeps its preview until a newer scene is shown | `OpenDiagram.released` | M28 |
| 32 | Scene editable rule | F5 | M17 |
| 33 | A held gate refuses edits; an unresolved inverse refuses every request | `gatedSend` | M20 |
| 34 | `Saving…` and the problem cleared at send start | status row 3; journal `started` → cleared | M7 |
| 35 | Journal: wrong workspace, one request per collection, write before send, nothing sent if the write fails | gatedSend; J2, J3 | M7 |
| 36 | 8 refusal codes → rejected, others → uncertain; success needs its own receipt and a readable snapshot | `answerClass`; apply executor | M7 |
| 37 | Refused items never stored; a failed write after a send still publishes | J4; `written after-change` row | M7 |
| 38 | Check, Retry, Dismiss guards and outcomes; `No receipt found…` | journal rows; note | M7 |
| 39 | One refusal shown; an older one dismissed when a new request starts or a newer refusal arrives | F2 | M8 |
| 40 | Closing the problem dismisses refusals | F3 | M8 |
| 41 | Rejected or dismissed → definition released; receipt → definition confirmed | journal lift → settle-definition | M30 |
| 42 | The owner of a receipt and the definitions store hear it before the carried snapshot installs (source records its receipt before it rebases) | lift order + O1 | M30, M32 |
| 43 | Resting status follows editor drafts in the open collection | status row 7 + drafts-changed | M33 |
| 44 | Recovery shows the newest refusal only while the bar is empty | `view/journal-view.ts` | M8 |
| 45 | Undo/redo keys ignored in editable targets, during composition and on repeat | browser executor | M12, M20 |
| 46 | Undo/redo disabled reasons; `nothing` → nothing; invalid → report; send failure → settle at the current sequence | history rows; `may.undo` / `may.redo` | M20 |
| 47 | Release: snapshot ≥ sequence, version match, display current, render idle | F4 | M20 |
| 48 | A finished inverse holds the gate | history `restored-inverse` / sending | M20 |
| 49 | History reads use a ticket; a failed read is not reported | history rows | M20 |
| 50 | Create needs a snapshot; minted ID; opens after the receipt | diagram create / created; O2 | M17 |
| 51 | Add forms: capture at the last edit (I33), lock, refused frees, uncertain keeps body, confirmed empties, new revision keeps | forms rows | M23 |
| 52 | Add validation (name; reused object exists and is not shown; group) | `forms/submit.ts` → `core/creation/records.ts` | M23 |
| 53 | Palette: tree section refused; module added | forms `palette-dropped` | M23 |
| 54 | Connection: begin checks, Inspect opens, edit clears the problem, retry reuses the request, dismissed → editing, confirmed closes | connection rows | M25 |
| 55 | Inspector / wire / definition / library apply go through the gate with a fresh ID; stores keep their own draft rules and workspace checks | editor-sends + waiters | M30 |
| 56 | Source: show, edit, apply, close keep / discard / stay; reprint when clean (even when closed); rebase only across its own receipt; admission | source rows, S1–S3 | M32 |
| 57 | Library refresh on every accepted snapshot | catalogue lift | M12 |
| 58 | Export is stateless | facade → exporter | M34 |
| 59 | Dispose tears down keys, stream, render, Canvas | lifecycle disposed; R6 | M12, M34 |

---

## 12. Intentional changes and the 17 quirks

### 12.1 Intentional changes

| # | Change | Before → after |
|---|---|---|
| I1 | **Choices after a server refusal** | none → only for `constraint-conflict` (G6) |
| I2 | **Fresh RequestId per gesture send and per applied choice** | request ID = gesture ID → separate IDs; `request-reused` cannot happen. Lands early, in B4: the session mints the request ID and its three lookups (`workspace-session.ts:815, 850, 1489`) match on the stored `gesture` field, so no second RequestId parse is needed |
| I3 | Canvas reject deferred until the gesture ends | immediate → at the end (D4) |
| I4 | An uncertain plain move no longer snaps back | reject → waits in `sending` for Check or Retry |
| I5 | Move review needs **every** entry in modules | `some` → `every`; mixed selections take the plain path and Authoring decides |
| I6 | Duplicate and ancestor checks on every placement | modules path only → `planGesture` |
| I7 | Every local refusal (plan, build, gate) rejects the gesture on the Canvas | plan or build failure left it `submitted` → reject |
| I8 | Retry passes the gate and shows `Saving…` | bypassed → gated (resend mode leaves out its own entry) |
| I9 | The review shows its request's journal phase | "uncertain" while sending → "sending" |
| I10 | Choices, Apply and Cancel show a disabled reason | reported as errors → `may` reason |
| I11 | Status derived by fixed priority, same wording | startup failure no longer overwritten by `Ready`; a diagram opened at startup shows `Saved` |
| I12 | Palette drop is one-shot | took over the Object form → own send, no form touched, no lock |
| I13 | Validation before the lock; busy and adding derived | stored and stale after a refusal |
| I14 | Leaving or switching a collection drops the move review, connection draft and Add forms at once | kept; forms emptied later. A refused add for the old collection still leaves its note. |
| I15 | A gone collection clears the URL | dead `?collection=` kept → cleared. The source draft is kept. |
| I16 | Only user-started opens and chooser actions clear the problem bar | any render, including a background reopen, cleared it and dismissed refusals |
| I17 | A render overtaken by a newer snapshot restarts with a fresh ticket | navigation: failed then reopened; chooser: `Could not open` + Retry |
| I18 | The URL collection opens after a failed first read, once a snapshot arrives | opened against an empty generation |
| I19 | `could not be confirmed` clears whenever no request is uncertain | only after Check or Retry |
| I20 | After dispose every answer is dropped; the stored journal returns as uncertain on the next load | sends and reads kept running |
| I21 | Refusal dismissal happens in the same step as the problem change | React saw a view with the problem cleared and refusals still listed |
| I22 | Canvas `online` also follows a successful read | stream only |
| I23 | Check and Retry disabled while a lookup runs | second click → `pending-request` error |
| I24 | Confirmed connection gestures are not tracked | leaked in `confirmedGestures` |
| I25 | A send blocked by the journal no longer clears the problem bar first | `Saving…` + clear happened before the journal's own checks |
| I26 | `canvas:released-route-preview` times only the Canvas publish | also timed the preview calculation, which now runs in the transition |
| I27 | `showLibrary` and `refresh` removed from the controller | no callers |
| I28 | New relationship IDs come from `IdSource` | `relationship-<gesture ID>` → `relationship-<uuid>` |
| I29 | A snapshot accepted while a scene installs is applied after the install | could be missed until the next snapshot |
| I30 | A foreign or corrupt stored source draft makes the source editor read-only for the session, with the reason `stored-draft-kept` | typing was accepted, every save reported an error and Apply was refused (`source-session.ts:134-141, 212-223`) |
| I31 | Move Apply is held by a request for the same collection or by undo/redo | any unrefused request in any collection held it (`movement-review/phases.ts:66-75`) |
| I32 | The Add panel no longer repeats a refused add's text; the refusal shows in the problem bar only, and closing the bar clears it | the panel showed the refusal unless the bar showed the same text (`core/creation/problem.ts`, `AddTools.tsx:348-357`), so after the bar closed the panel still said why |
| I33 | An Add form takes its capture at each edit, not the first (quirk 17; M22, driven in M23) | Object or Group draft → add a diagram → pick it → Add → "Choose an existing diagram." and nothing added (`core/creation/records.ts:146-171`, `contextIn`) → it is added |
| I34 | With no diagram, the Group form shows its own note (U27) | Group showed the Object note: heading "Object", a second `id="add-object-title"` → heading "Group", `id="add-group-title"`, "Add a diagram before adding a group." |
| I35 | Library organisation acts on the collection shown now (U28) | read `workspace.getSnapshot()` during render, so after a switch the folder and archive controls could act on the previous collection |
| I36 | A definitions Apply answer for another workspace is ignored (U41) | a late answer acted on the new workspace's drafts |
| I37 | A failed definitions settle write keeps the draft locked and shows the problem (U41) | the draft kept its request but its key unlocked |
| I38 | A confirmed definitions Apply writes drafts once; a refused one reports once (U41; quirk 13) | written twice; reported twice |
| I39 | A failed definitions restore writes nothing (U41) | later discard, Apply or settle wrote to the key `definitions.` |

### 12.2 The 17 quirks

| # | Quirk | Decision |
|---|---|---|
| 1 | markReady overwrites the failure status | FIX (I11) |
| 2 | Review shows uncertain while sending | FIX (I9) |
| 3 | No choice after a server refusal | FIX (I1, I3) |
| 4 | A retryable move cannot be cancelled | KEEP, now with a reason (I10): cancelling while the request may still land is unsafe |
| 5 | Retry skips the gate | FIX (I8) |
| 6 | Palette takes over the Object form | FIX (I12) |
| 7 | Add-form busy and adding go stale | FIX (I13) |
| 8 | Plan or build failure leaves the gesture `submitted` | FIX (I7) |
| 9 | Gone keeps the URL; leaving keeps the connection draft | FIX (I14, I15); source draft kept |
| 10 | Gate stays settling while history reads fail | KEEP: the next accepted snapshot rereads history; releasing on unknown status could allow an edit against a stale history view |
| 11 | Any render clears the bar and dismisses refusals | FIX (I16) |
| 12 | Stale uncertainty cleared only after Check or Retry | FIX (I19) |
| 13 | Definition apply reports twice and writes twice | FIX in U41, the definitions machine (I38). Kept through the M-series (store unchanged). |
| 14 | `confirmedGestures` leaks connection IDs | FIX (I24) |
| 15 | Work continues after dispose | FIX (I20) |
| 16 | AddTools keeps a second copy of form state | FIX (M23 deletes `useLocalCreation`) |
| 17 | An Add draft keeps the collection from its first edit, so a diagram added later cannot be picked in it (#143; same on base) | FIX (I33): capture at each edit. The draft holds only names and choices, so a newer base loses nothing; Authoring still refuses a foreign conflict |

---

## 13. PRs

### 13.1 Rules for every PR

| Rule | Detail |
|---|---|
| Order | **One stack.** Every PR's base is the PR before it in §13.2, starting from `origin/owners/delete-apps-tests`. "Depends" names the code a PR needs; it is always earlier in the list. Nothing is rebased across branches. |
| Size | Changed lines = insertions + deletions (`git diff --shortstat`); a move counts both ways. Target ≤ 600. Estimates are written `+added / −removed`. The PR body gives the real numbers. An overage is accepted when the change cannot be split without breaking the app (lead, 28 Sep). A pure-rename PR (U1, U3–U7) is sized by `git diff -M --shortstat` (edited lines only); its estimate also gives the files and lines renamed, and the body gives both counts (P8 precedent). |
| Commands | `pnpm typecheck` · `pnpm architecture` · `pnpm exec eslint apps/web` (0 errors) · `pnpm exec prettier --check <touched>` · `wc -l <touched>` (report anything over 300) |
| Score | 16-principle score > 144/160 on every file a PR changes in substance, by the review ritual in `docs/standards/CODING-STANDARDS.md` ("Review ritual"; manual; scores go in the PR body). `workspace-session.ts` and the bridge files are exempt until M34; the shrink rule applies instead (§8.5, §16 Q2). **G1 (lead, 28 Sep):** a file a PR only moves, re-points imports in, or moves types into or out of keeps its baseline score and may stay ≤ 144 until its named fixing PR. The body lists each such file with its score and fixing PR. A file with no fixing PR in this plan is reported to the lead, who adds one. Known files and fixing PRs: §16 G1. |
| Capability PRs | When a capability is touched: `pnpm exec vitest run capability/<name>`; add no new failures. P1, U21, U22 design-system · P2b layout, export · U31 layout · P7, B5, M28b canvas · B1, B3a, B3b, U23 model · B3a library. `apps/service` has no tests: `pnpm dev` boots and `curl` answers (P2b, B1, B2b, ER1). |
| Headless smoke | `pnpm --filter @novakai/canvas-web build` → `pnpm dev --port <appPort> --workspace <scratch copy>` → `NVK_BROWSE_PORT=<port> node ~/.agents/browse/browse.mjs goto\|click\|type\|press\|shot\|text\|eval\|close`. Shot names start with the slug. Click every changed control, read the screenshots, then close the browser and stop the server. |
| Moves and splits (P and U PRs in `apps/`) | Body states: "Spec skipped: Chris approved skipping the spec for /apps re-homing and file splits (27 Sep)." P7 is a Canvas split: its body states "moves only" and gives the Canvas test result instead. |
| Core PRs (M and U `-core`) | Add new pure files next to the live ones. They do not change or delete any file the running session uses; the switch and the deletes happen in the wire PR. The app is unchanged; the smoke is "the app loads and opens a diagram". |
| Wire PRs | Drive the §11 rows marked "Driven in" this PR, and list in the body the core table rows the drive exercised. List the bridge rows added and removed (§8.5). Give `wc -l workspace-session.ts` before and after. U `-wire` PRs drive their row's headless check and give the deleted session's `wc -l`. |
| PR body | **What** / **Why** / **Decisions** / **Verified** (commands + results; UI as "click X → Y") / **Not verified**. Ends with the Claude Code line. Commits end with the Co-Authored-By line. |

### 13.2 PR list (in stack order)

| # | Slug | One change | Main files | +added / −removed | Depends | Headless check | Achieves |
|---|---|---|---|---|---|---|---|
| P1 · built #115 | web-css-tokens | Stylesheet token and layer fixes: 3 undefined tokens, AddTools in `@layer components`, raw sizes → tokens; chooser height owned by Dialog | web CSS (AddTools, CollectionChooser, MovementReview, SourceEditor, ExportPanel); `capability/design-system/adapters/react/Dialog.module.css` (+23 / −7); 1 line in CollectionChooser.tsx | real +112 / −57 | — | DS audit: 0 violations, tokenRatio ≥ 0.95 on touched sheets. Open chooser → pending strip visible; Add hints muted; Source focus ring. 4 untouched sheets still fail (CollectionLibrary, RequestRecovery, WorkspaceHeader, WorkspaceShell) → U21, U22 | DoD12 |
| P2a · built #131 | web-type-cycles | Fix the 14 web cycle reports and 3 core-direction breaks that type-only imports hide. `DraftRetention`, `WorkspaceDecoders`, `RequestBuilders` → own ports; `ActiveDiagram` → own record; panel records → records/panels.ts; `EndpointChoice` → records/wire-editor.ts; `panel-state.ts` reuses `sectionsOnSide`. Flag stays off. | ports/{workspace,draft-retention,workspace-decoders,request-builders}.ts, records/{active-diagram,panels,wire-editor,editor-recovery,…}.ts, panel-types.ts, core/workspace/panel-state.ts, core/panels/preferences.ts, core/inspector/endpoints.ts, ViewMenu.tsx; 46 files | real +289 / −194 | — | app loads; open a diagram; View → canvas tools, source editor; default Browse and Inspect sections | DoD6 |
| P2b | type-import-gate | Fix the other 11 cycle reports (2 service, 7 layout, 2 export), then set `tsPreCompilationDeps: true` | .dependency-cruiser.cjs, apps/service/contract/records/{server,protocol}.ts, capability/layout/{core,contract/records}, capability/export/contract/records/artifact.ts | +160 / −140 | P2a | app loads; `pnpm dev` boots | DoD6 |
| P3 · built #135 | web-compose-split | `controller()` → compose/workspace.ts; workspace-inputs → request-builders + workspace-decoders (one `browserRequest()`); `startWeb(element, globals)` takes the new `BrowserGlobals` port, so `cli/main.ts` is the one place that reads browser globals; tab text → compose/panel-tabs.ts | compose.ts, compose/{workspace,panel-tabs}.ts, ports/browser-globals.ts, edge/{request-builders,workspace-decoders}.ts (workspace-inputs.ts D), cli/main.ts | real +601 / −409 | — | open a diagram; Add module; Undo; Library folder; source draft survives reload; theme survives reload | DoD1 |
| P4 · built #138 | web-materialize-split | materialize.ts → materialize (first preview → placements, 220) + acceptance (second preview agrees, 110) | core/editing/rearrange/ | real +115 / −96 | — | drag a module to open space inside its section → choices appear → Apply → Saved | DoD1 |
| P5 · built #140 | web-shell-split | Hooks → shell-hooks.ts and ProblemBar, StatusBar → ShellAlerts.tsx, both reaching the shell as slots (adapters may not import adapters); hooks read `BrowserGlobals.window`; prop and hook types → react-types.ts. CSS stays in WorkspaceShell.module.css (follow-up U21) | react/{WorkspaceShell,ShellAlerts}.tsx, react/shell-hooks.ts, contract/{compose,react-types}.ts, ports/browser-globals.ts | real +177 / −110 | — | problem bar shows, Technical details, dismisses; status bar text; Hide interface → Escape reveals | DoD1 |
| P6 · built #143 | web-add-tools-split | AddTools → AddTools / AddForms / AddFields, as slots; AddTools takes `CreationCommands`, not the whole controller; compose/features.ts takes named parts incl. `random` | react/{AddTools,AddForms,AddFields}.tsx, contract/creation-react.ts (N), compose/features.ts, compose.ts, ports/browser-globals.ts | real +442 / −273 (overage: field helpers became components) | — | type in every Add field; Add diagram, object, group; lock while adding; refused add unlocks | DoD1 |
| P7 · built #151 | canvas-interactions-split | `interaction-handlers.ts` (358) by responsibility: geometry gestures and keyboard commands move out; part types → contract/interaction-parts.ts; browser helpers leave compose.ts (moves plus same-behaviour dedupes for the score gate) | capability/canvas/adapters/react-flow/{interaction-handlers,geometry-gestures,keyboard-commands,browser-bindings}.ts, contract/{interaction-parts,compose}.ts, tests/react-bindings.test.tsx | real +450 / −285 (overage) | — | drag a node → Saved; Escape mid-drag → nothing saved; arrow keys select; Alt+arrow moves → Saved; resize → Saved; hover highlights; Canvas tests 15 pass, 1 fails as on base | DoD1, DoD10 |
| P8 · built #154 | web-render-move | `render/ticket.ts`, `render/admission.ts` → `diagram/` (moves, imports updated; JSDoc names `render-input-changed`); api.ts header | core/workspace/{render,diagram}/, api.ts | real +204 / −198 (+13 / −7 rename-detected) | — | open a diagram; chooser switch; CLI replace → diagram updates; bundle byte-identical to P7 | DoD1 |
| B1 | web-brands-foundation | brands.ts (no GestureId), IdSource, edge/ids.ts, Service `TransportGeneration` brand and runtime schema, Model type exports; no consumers | contract/brands.ts, ports/ids.ts, edge/ids.ts, apps/service/contract/{brands,index}.ts, model index | +330 / −10 | P2b | app loads; `pnpm dev` boots | DoD4 |
| ER1 | web-error-codes | Closed `WebErrorCode`; owner-keyed `Diagnostic`; `foreignFailure(owner, source)`; `library-changed`; failure-source copy deleted; `owner` moves out; service index exports `OperationSource`; `admission.ts` returns `RenderCode` (G1 fix) | errors.ts, error-codes.ts, service index, service-client.ts, library-reader.ts, library-session.ts, core/workspace/diagram/admission.ts, panel-types.ts, ~40 non-literal call sites | +340 / −150 | B1 | refused add (duplicate name) → bar shows the same text; Library edit on a changed library → `library-changed` text | DoD4 |
| B2a | web-brand-workspace | WorkspaceId through records, readers and panel preferences; `''` placeholders → phases | ~22 files | +140 / −110 | ER1 | reload → panels and drafts restore | DoD4 |
| B2b | web-brand-generation | TransportGeneration through web and service; stored generations parsed with Service's schema by the 7 readers (§4.1 row 1); `''` → `'unread'` | ~25 files + service/cli literals | +200 / −170 | B2a | stop and restart the service → diagram rerenders; reload with an inspector draft → it restores | DoD4 |
| B3a | web-brand-collection | CollectionId, FolderId, cursor and time aliases; URL and recovery readers | ~25 | +160 / −140 | B2b | open by URL; Library new folder | DoD4 |
| B3b | web-brand-model-ids | Section, object, group, relationship, definition, content IDs; Definitions.tsx stops minting; features.ts takes `IdSource.descendantId()` instead of `random` (P6); api.ts loses `definitionDraftId` (G1 fix); `TargetSection` in creation-react.ts follows the form views' section type | ~22 incl. contract/creation-react.ts, contract/api.ts, compose/features.ts | +170 / −140 | B3a | Definitions → New → it appears; add a content block in the inspector | DoD4 |
| B4 | web-brand-request | RequestId, ActorId, PlannerId; `ReadVersion` as an owner record; delete unused editing types. The session mints each Canvas send's request ID (I2 early); the 3 lookups match on the stored `gesture` | ~16 + workspace-session.ts | +220 / −180 | B3b | stop the service → Add object → Recovery shows it uncertain → start the service → Check → `No receipt found…` → Retry → Saved; drag a node → Saved | DoD4, DoD9 |
| B5 | canvas-gesture-id | Canvas `GestureId` brand; Canvas parses at gesture begin in `gesture-ids.ts`; the web re-exports the type; canvas test fixtures compile. The 5 call sites (after P7): `geometry-gestures.ts` startDrag, beginResize; `keyboard-commands.ts` keyboard; `interaction-handlers.ts` connect, nextId. `moved.id` and `livePreview(id)` become `GestureId`. The parts get it through `Pick<InteractionOwners, 'nextGestureId'>`: no edit to interaction-parts.ts | capability/canvas contract, react-flow/{gesture-ids,interaction-handlers,geometry-gestures,keyboard-commands}.ts, fixtures; contract/brands.ts | +150 / −100 | B4, P7 | drag a node → Saved; drag a module off its edge → choices | DoD4, DoD10 |
| B6a | web-brand-draft-keys | Draft-key brands; RetentionSlot; readers reject a mismatched key | ~16 | +200 / −150 | B5 | inspector edit survives reload | DoD4 |
| B6b | web-brand-panels-source-edit | PanelSectionId union; SourceEdit brand | ~9 | +110 / −90 | B6a | Customize panels → hide / show; source edit survives reload | DoD4 |
| M1 | web-workflow-records | Records and ports only: machine, events (commandKeys), effects (lifecycle, browser, bridge families; `Executor`), view and permissions skeletons, lifecycle records; ports workflow-deps, bridge, connection-policy (moved); reshape `RequestBuilders` (P2a port) to §6.0 | records/workflow/{machine,events,effects,view,permissions,lifecycle}.ts, ports/{workflow-deps,bridge,connection-policy,request-builders}.ts, core/editing/connection/types.ts | +350 / −40 | B6b, P3 | app loads | DoD5 |
| M2 | web-runner | Runner; root machine with lifecycle `started` / `disposed`; step, state, contexts, finalize, `view/project.ts` and `rules/permissions.ts` with no rows yet; bridge adapter skeleton; compose builds runner and session side by side; core-purity lint (`no-restricted-globals`, `Date.now`) and ticket-import lint | adapters/runner/{runner,bridge}.ts, core/workspace/{machine,state,step,contexts,finalize}.ts, lifecycle/*, view/project.ts, rules/permissions.ts, compose/workspace.ts, eslint.config.js | +560 / −20 | M1 | app loads; open a diagram | DoD2 |
| M3 | web-journal-records | Journal and gate records; `RefusedCode`, `Refusal`; apply and journal-storage effects; `classifyApply` and the refusal tables | records/workflow/{journal,gate}.ts, effects.ts, rules/refusal-classes.ts | +270 / −0 | M2 | app unchanged | DoD3 |
| M4 | web-journal-core | Journal send path: state, update, send, entries; `sendReadiness` + `gatedSend`; J3 lint with the `syntax()` helper | journal/{state,journal,send,entries}.ts, rules/gated-send.ts, eslint.config.js | +520 / −0 | M3 | app unchanged | DoD3 |
| M5 | web-journal-recovery-core | Answers, Check, Retry, Dismiss, restore, autoCheck | journal/{answers,recovery,restore}.ts | +320 / −0 | M4 | app unchanged | DoD3 |
| M6 | web-journal-executors | Apply and storage (journal part) executors, reader `RetainedEntry` mapping and `restoredOrigin`, waiters, compose/executors.ts; unwired | effects/{apply,storage}.ts, readers/submission-readers.ts, runner/waiters.ts, compose/executors.ts, ports/executors.ts | +330 / −10 | M5 | app unchanged | DoD3 |
| M7 | web-journal-wire | lift/journal (owner rows as `legacy-settled`); the session sends through the runner; journal view part and Check / Retry / Dismiss permissions; facade/journal (Check, Retry, Dismiss); delete submission-session.ts | lift/journal.ts, bridge, view/journal-view.ts, facade/journal.ts, workspace-session.ts | +250 / −350 | M6 | Add object → Saved; stop the service → Add object → Recovery shows uncertain → start the service → Check → `No receipt found…` → Retry → Saved; refused add → bar → close → form unlocks | DoD3, DoD8 |
| M8 | web-notices | Notices machine; F1, F2, F3, F6; session `report` and panel reports → events (`PanelBindings.report` takes a `Diagnostic`; G1 fix of panel-types.ts with ER1); problem part of the view | notices/*, records/workflow/notices.ts, rules/{refusals,stale-uncertainty,note-expiry}.ts, finalize.ts, facade/journal.ts, compose.ts (panel `reportPanel`), panel-types.ts, workspace-session.ts | +430 / −70 | M7 | two refused adds → only the newer is listed; close bar → both gone; a panel-preference problem survives opening another diagram | DoD5, DoD8 |
| M9 | web-startup-core | Link (stream phase + reach), lifecycle rows, their records and lifts | link/*, lifecycle/lifecycle.ts, records/workflow/{link,catalogue}.ts, lift/{link,lifecycle}.ts | +350 / −0 | M8 | app unchanged | DoD8 |
| M10 | web-catalogue-core | Catalogue and its lift | catalogue/*, lift/catalogue.ts, contexts.ts | +250 / −0 | M9 | app unchanged | DoD8 |
| M11 | web-startup-executors | Service reads and stream, browser (location, keys), stores executors; unwired | effects/{service,browser,stores}.ts | +320 / −0 | M10 | app unchanged | DoD2 |
| M12 | web-startup-wire | Runner owns start, reads, stream, restore and library refresh; keys bound by the browser executor (handle → the session's `navigateHistory`); delete history-keys.ts | compose, bridge, view parts, workspace-session.ts, core/workspace/history-keys.ts | +80 / −290 | M11 | reload with `?collection=` → it opens; stop the service → offline; start it → rereads; commit via CLI → diagram updates; Cmd+Z → undo; Cmd+Z in a text field → nothing | DoD2, DoD8 |
| M13 | web-diagram-records | Diagram records and scene effects | records/workflow/diagram.ts, effects.ts | +160 / −0 | M12 | app unchanged | DoD8 |
| M14 | web-diagram-core | Diagram parent: state, update, navigation, render and install | diagram/{state,session,navigation,render}.ts | +530 / −0 | M13, P8 | app unchanged | DoD8 |
| M15 | web-diagram-refresh-core | Refresh (restart, gone, reopen, after-install), create, children pass-down skeleton, lift/diagram | diagram/{refresh,create,children}.ts, lift/diagram.ts | +400 / −0 | M14 | app unchanged | DoD8 |
| M16 | web-diagram-executors | Scene executor (open, update, close, flags), canvas-intake (inspect; forwards edit intents through `LegacySession`), F5 | effects/{scene,canvas-intake}.ts, rules/flags.ts | +240 / −0 | M15 | app unchanged | DoD8 |
| M17 | web-diagram-open-wire | Runner owns open, render, install, create and collection-gone; facade/navigation (open, create), facade/view; delete canvas-session.ts | facade/{navigation,view}.ts, view/diagram-view.ts, compose, bridge, workspace-session.ts | +230 / −330 | M16 | Library click → diagram; Create → it opens; delete a collection via CLI → library + note, URL cleared; drag a node → Saved; draw a connection → Inspect opens | DoD8 |
| M18 | web-chooser-wire | Chooser through the runner; delete render/patches.ts and render/navigation.ts | facade/navigation.ts, view/diagram-view.ts, workspace-session.ts, core/workspace/render/* | +80 / −400 | M17 | chooser: open, choose, cancel; open while a diagram renders → the render stops; failure → Retry; failure → "Choose another collection" → list | DoD8 |
| M19 | web-history-core | History machine (new files; `history/gate.ts` untouched); F4 | records/workflow/history.ts, history/{state,history,navigable}.ts, rules/history-release.ts, lift/history.ts | +350 / −0 | M18 | app unchanged | DoD8 |
| M20 | web-history-wire | read-history; keys handle → facade; Retry gated; history/gate.ts changes; history/journal.ts deleted; HistoryControls reads `may` | service part, facade/history.ts, permissions, HistoryControls.tsx, history/{gate,journal}.ts, workspace-session.ts | +160 / −290 | M19 | Undo / Redo buttons; Cmd+Z / Shift+Cmd+Z; buttons disabled with a reason while saving; Retry waits while an undo settles | DoD3, DoD8 |
| M21 | web-forms-prep | Forms records; `PaletteDrop` type → records; `core/creation/validation.ts` and `changes.ts` next to the live `records.ts` | records/workflow/forms.ts, records/creation.ts, core/editing/palette-drop.ts, core/creation/{validation,changes}.ts | +370 / −10 | M20 | app unchanged | DoD1 |
| M22 | web-forms-core | Forms child; palette one-shot; pass-down; capture at each edit (I33) | forms/*, diagram/children.ts | +340 / −0 | M21 | app unchanged | DoD5 |
| M23 | web-forms-wire | facade/forms; **AddTools** reads the view (`editing.creation` + `may.addForms`); each AddForms form gets its form view; delete `useLocalCreation`; `CreationCommands` → `FormCommands`; add-form and palette origins leave the bridge | facade/forms.ts, view/editing-view.ts, permissions, react/{AddTools,AddForms}.tsx, contract/creation-react.ts, lift/journal.ts, workspace-session.ts | +230 / −360 | M22 | Add diagram, object, group; drop a module on the canvas; refused add → form unlocks; switch collection → forms empty; add while locked → disabled with reason; Object draft → add a diagram → pick it → Add module → Saved (I33) | DoD5, DoD8 |
| M24 | web-forms-cleanup | Delete the now-unimported `captures.ts`, `problem.ts`, `records.ts` | core/creation/* | +0 / −484 | M23 | Add object → Saved | DoD1 |
| M25 | web-connection | Connection child and wiring; request.ts takes IDs; delete connection/capture.ts | records/workflow/connection.ts, connection/*, core/editing/connection/request.ts, facade/connection.ts, view, permissions, workspace-session.ts | +330 / −250 | M24 | draw a connection → edit label → Apply → wire appears; Cancel; draw a second while one is open → refused | DoD8 |
| M26 | web-gesture-plan | `planGesture`, `choicesAfterRefusal`, `placementCapture`, `moduleMove` as new files (plan.ts and route-preview.ts untouched); gesture records | core/editing/{gesture-plan,module-move}.ts, records/workflow/gesture.ts | +250 / −0 | M25 | app unchanged | DoD9 |
| M27 | web-gesture-core | Gesture child: send, settle, choices, release (decision 1) | gesture/{state,gesture,intake,choices,settle}.ts | +560 / −0 | M26 | app unchanged | DoD9 |
| M28 | web-gesture-wire | Full canvas-intake, settle and preview effects, measure; MovementReview reads its view and `may`; plan.ts duplicate check and route-preview `moduleMove` switch on (I5, I6); legacy canvas forward removed | effects/{scene,canvas-intake}.ts, facade/movement.ts, view, permissions, react/MovementReview.tsx, core/editing/plan.ts, readers/route-preview.ts, workspace-session.ts | +300 / −300 | M27 | drag in modules → Saved; drop in place → nothing; overlap drag → choices at once → Expand preview → Apply → Saved (request ID ≠ gesture ID in Recovery); Cancel; buttons show reasons while saving. Server-refusal choices: see M28 note | DoD9 |
| M28b | canvas-refused-preview (only if needed) | Only if the M28 drive shows the preview lost: Canvas accepts `preview-routes` on a `rejected` entry at the same stamp | capability/canvas/core/interaction/draft-events.ts, core/drafts/reconcile.ts | +130 / −20 | M28 | repeat the M28 drive | DoD9, DoD10 |
| M29 | web-gesture-cleanup | Delete compose/movement-review.ts, movement-review/{phases,types,outcome}.ts; failures.ts → gesture/; records/movement.ts shrinks | those files, core/editing/movement.ts | +90 / −500 | M28 | drag in modules → Saved; overlap drag → choices | DoD1 |
| M30 | web-editor-sends | Inspector, wire, definition and library sends through the journal; waiters; settle-definition; blocked editor sends answer the caller | facade/editor-sends.ts, stores, retained-editor, definition-session, library-session, lift/journal.ts, workspace-session.ts | +200 / −210 | M29 | Inspector edit → Apply → Saved; Wire editor → Apply → Saved; Definitions apply / refuse; Library new folder; Apply during an undo → the store unlocks with a reason | DoD3, DoD8 |
| M31 | web-source-core | Source machine (with `blocked`) and records | records/workflow/source.ts, source/*, lift/source.ts | +490 / −0 | M30 | app unchanged | DoD8 |
| M32 | web-source-wire | Source storage part; facade/source; SourceEditor reads its view; delete source-session.ts and records/source.ts | effects/storage.ts, facade/source.ts, view, permissions, react/SourceEditor.tsx, workspace-session.ts | +190 / −390 | M31 | Show source → type → Apply → Saved; close dirty → keep / discard / stay; after discard, reopen → text reprinted; reload → dirty draft back | DoD8 |
| M33 | web-status-and-views | Status; React features read their own view part and command set; busy flags removed; delete core/workspace/status.ts; records/workspace.ts fixed (G1) | view/status.ts, react-types.ts, library-react.ts, definitions-model.ts, creation-react.ts, react/*, records/workspace.ts | +345 / −245 | M32 | status texts: Connecting, Ready, Saving, Saved, Draft not applied; each panel's disabled reasons | DoD5, DoD8 |
| M34 | web-remove-session | Delete the bridge and the rest of workspace-session.ts; export through the facade; ports/workspace.ts loses `WorkspaceBindings` (G1 fix) | adapters/runner/bridge.ts, ports/bridge.ts, ports/workspace.ts, workspace-session.ts, compose, edge/export-artifact.ts | +60 / −530 | M33 | full pass: start, open, add, move, connect, undo, source, chooser, recovery, export, reload | DoD1, DoD8 |
| ER2 | web-error-codes-core | Remaining core call sites use area codes | core/** | +200 / −200 | M34 | one refused move; one invalid Add | DoD4 |
| ER3 | web-error-codes-adapters | Readers, stores, React | adapters/** | +175 / −175 | ER2 | one refused add, one offline add | DoD4 |
| U1 | web-move-adapters | Rename non-React adapters into folders named by seam; import paths only: edge/{browser-host,browser-navigation,ids} → browser/{host,navigation,ids}; preferences/browser-preferences → browser/environment; edge/{service-client,workspace-decoders,export-artifact}, readers/diagram-reader → service/; edge/request-builders → authoring/requests; sessions/draft-retention → storage/local-retention; preferences/panel-preferences, readers/{inspector,wire,definition}-reader → storage/{panel-preferences,object-drafts,wire-drafts,definition-drafts}; readers/route-preview → layout/; readers/library-reader → library/catalog-reader | adapters/{edge,preferences,readers,sessions}/*, contract/compose.ts, compose/{workspace,executors,sessions}.ts | +70 / −70 (16 renames, ~2,000 lines) | ER3 | open a diagram; drag a node → Saved; View → Show source editor → text; reload with `?collection=` → reopens; inspector draft survives reload; Export PNG → downloads | DoD13 |
| U2 | web-adapter-seams | Split files that hold two seams (no logic change): readers/submission-readers → service/answers.ts (receipt, applied answer) + storage/journal-entries.ts (stored entries, `restoredOrigin`); the source-recovery decoder → storage/source-drafts.ts; DSL print and new-collection source → language/printer.ts. Delete `readers/` | adapters/{readers,service,storage,authoring,language}/*, compose/{workspace,executors}.ts | +280 / −240 | U1 | stop the service → Add object → reload → Recovery shows it uncertain → start → Check → `No receipt found…`; Source edit → reload → restored; New collection → opens with Start → Step → Done | DoD1, DoD13 |
| U3 | web-move-core-edits | Rename core/editing's gesture planning: {plan,targets,placements,regroup,routes}.ts, capture/{boxes,pinning,scene} → core/canvas-edits/; capture/settling/* → canvas-edits/settle/; results.ts → core/shared/results.ts. api.ts paths only | core/editing/*, core/canvas-edits/*, contract/api.ts | +45 / −45 (13 renames, ~1,160 lines) | ER3 | drag a node → Saved; drag a node into another group → regrouped; select a wire → change its route → Saved | DoD13 |
| U4 | web-move-core-movement | Rename move review: editing/{movement,gesture-plan,module-move}.ts → core/movement/; movement-intent/* → movement/intent/; {preview,expand,rearrange}/* → movement/{preview,expand,rearrange}/ | core/editing/*, core/movement/*, contract/{api,workspace-model}.ts | +80 / −80 (28 renames, ~3,000 lines) | U3 | drag in modules → Saved; overlap drag → choices → Apply → Saved | DoD13 |
| U5 | web-move-core-features | Rename the rest by feature: editing/connection/* → core/connection/; editing/{palette-drop,group-creation} → core/creation/; editing/definition-request → definitions/request; output/diagnostics → failures/display; recovery/editor-records → drafts/; workspace/{panel-state,shell-layout} → panels/{layout,shell-layout}; inspector/* → inspector/object/, inspector/wire/. Delete editing/, output/, recovery/ | core/**, contract/api.ts | +70 / −70 (19 renames, ~1,850 lines) | U4 | draw a connection → Apply → wire; Add object; Definitions → Apply; resize to 700px → panels overlay | DoD13 |
| U6 | web-move-react | Rename adapters/react/* into feature folders (shell, header, panels, library, add, navigation, export, definitions, object-inspector, wire-inspector, movement, requests, source, settings), each `.module.css` beside its component; ObjectEditor.module.css → shared-styles/form.module.css (used by 11); Navigation.module.css → shared-styles/navigation.module.css; `LibrarySection` leaves compose/features.ts for library/LibrarySection.tsx | adapters/react/**, contract/compose.ts, compose/features.ts | +280 / −270 (~60 renames, ~4,800 lines) | ER3 | Add, Browse, Inspect, Settings → same content as base; chooser, New collection, View menu, Undo / Redo, Source, Export → each opens; shots equal base | DoD13 |
| U7 | web-move-contract | Rename loose contract files: records/owners → types.ts; records/installation → schemas/; schemas/editor-recovery → schemas/editing-base; ports/client → ports/service; panel-types → ports/panels; react-types, *-react → contract/react/{shell,library,creation,definitions,object-inspector,wire-inspector}; definitions-model → api/definitions; records/{inspector,wire-editor,definitions,editing} → records/{object-draft,wire-draft,definition-draft,canvas-edits}. README becomes a find-it table (task → folder) | contract/** (16 renames), ~90 importers, apps/web/README.md | +300 / −290 (16 renames, ~850 lines) | U6 | load → library; Settings → theme applies; Definitions → edit → Apply → Saved | DoD13 |
| U8 | web-contract-ports | Records hold data only: every Session / Controller / Bindings / Factory / Reader interface in records/{object-draft,wire-draft,definition-draft,library,preferences,retained-editor,canvas-edits} → ports/{object-inspector,wire-inspector,definitions,library,preferences,retained-editor,canvas-edits}.ts; the inspector and wire sessions become aliases of `RetainedEditor<…>` (no restatement). Fixes records/inspector.ts (G1, 142) | contract/records/*, contract/ports/* (7 new), importers in adapters/sessions, adapters/storage, compose | +300 / −240 | U7 | edit an object title → reload → draft restored; Library → new folder; Settings → theme | DoD1, DoD7 |
| U9 | web-contract-react | react/shell.ts (was react-types.ts) → react/{design,shell,header,panels,settings,failures}.ts; `RegisteredSection` and `PanelSlots` leave WorkspaceSidePanel.tsx for react/panels.ts, so compose stops importing an adapter type | contract/react/*, adapters/react/panels/WorkspaceSidePanel.tsx, compose/{features,panel-tabs}.ts | +260 / −230 | U8 | Customize panels → move Export to the right → reload → stays; each tab shows its label | DoD1 |
| U10 | web-api-split | contract/api.ts → contract/api/{workspace,failures,panels,creation,object-inspector,wire-inspector,definitions,library,preferences}.ts, one per feature; unused exports deleted; index.ts keeps `startWeb`, `Result`, `Diagnostic` and the §14 entries; the eslint `contract/api.ts` adapter rule also covers `contract/api/**` | contract/api.ts (D), contract/api/*, contract/index.ts, eslint.config.js, importers | +300 / −250 | U9 | Add, Browse, Inspect, Settings; refused move → problem bar → Technical details → Dismiss | DoD1 |
| U11 | web-schemas-object-wire | Object and wire draft schemas leave storage/{object,wire}-drafts.ts for contract/schemas/{lists,object-draft,wire-draft}.ts, each typed `z.ZodType<Record>`; the 3 copied captured-base checks (object, wire, source) become one `admitCapturedBase` in api/drafts.ts. Stored formats unchanged | contract/schemas/*, contract/api/drafts.ts, adapters/storage/{object,wire,source}-drafts.ts | +260 / −230 | U10 | object and wire drafts made on the U10 build → this build → reload → restored | DoD1, DoD4 |
| U12 | web-schemas-definition-source-panels | Definition, source and panel-preference schemas leave storage/* for contract/schemas/{definition-draft,source-draft,panel-preferences}.ts, each typed `z.ZodType<Record>`. Stored formats unchanged | contract/schemas/*, adapters/storage/{definition-drafts,source-drafts,panel-preferences}.ts | +190 / −160 | U11 | definition and source drafts made on the U11 build → this build → reload → restored; panel layout kept | DoD1, DoD4 |
| U13 | web-split-preview-rules | core/movement/preview/rules.ts (285) → allowed.ts, grow-rules.ts, push-rules.ts, stop-rules.ts. No logic change | core/movement/preview/* | +250 / −215 | U4 | drag a child past its group edge → group grows; drag into a row → siblings pushed; drag between two nodes → stops short | DoD1 |
| U14 | web-split-drafts | drafts/editor-records (186) → drafts/{base,encode}.ts; the 3 draft-key functions (B6a) → drafts/keys.ts; inspector/draft-commands → inspector/{object,wire}/retain.ts. No logic change | core/drafts/*, core/inspector/{object,wire}/*, contract/api/* | +230 / −190 | U5, U10 | edit an object and a wire without Apply → reload → both restored → Apply → Saved | DoD1 |
| U15 | web-split-inspector-edits | inspector/object/edits.ts (235) → edits + content-edits; inspector/wire/edits.ts → edits + changes. No logic change | core/inspector/{object,wire}/*, contract/api/{object-inspector,wire-inspector}.ts | +190 / −160 | U14 | object: size and a content row → Apply → Saved; wire: kind and route → Apply → Saved | DoD1 |
| U16 | web-split-panel-layout | core/panels/layout.ts (was workspace/panel-state) → geometry.ts (mode, geometry, resize) + visibility.ts (open, tab side, defaults). No logic change | core/panels/*, contract/api/panels.ts | +80 / −65 | U5 | 1400px: toggle both panels; drag an edge → reload → width kept; 700px: open left, then right → one overlay | DoD1 |
| U17 | web-split-wire-editor | react/wire-inspector/WireEditor.tsx (267) → WireSection.tsx (picks the form) + WireSelectionEditor.tsx + react/connection/ConnectionForm.tsx; slots in compose/features.ts | adapters/react/{wire-inspector,connection}/*, contract/react/wire-inspector.ts, compose/features.ts | +230 / −170 | U9 | draw a connection → form → kind and cardinality → Apply → wire drawn; select a wire → meaning, endpoints, routing → Apply → Saved | DoD1 |
| U18 | web-split-side-panel | react/panels/WorkspaceSidePanel.tsx → WorkspaceSidePanel.tsx + SectionCustomizer.tsx; visible-section filtering → core/panels/sections.ts. Fixes WorkspaceSidePanel.tsx (G1, 127) | adapters/react/panels/*, core/panels/sections.ts, contract/{react,api}/panels.ts, compose/features.ts | +230 / −170 | U16, U9 | Customize → hide, move, collapse, Reset; hide every Browse section → "All Browse sections are hidden…" | DoD1, DoD7 |
| U19 | web-split-definition-expression | react/definitions/DefinitionExpression.tsx (253) → ExpressionEditor.tsx + LiteralEditor.tsx; slots in compose/features.ts | adapters/react/definitions/*, contract/react/definitions.ts, compose/features.ts | +160 / −120 | U9 | Definitions → add a union alternative, edit literal text, switch literal kind → Apply → Saved | DoD1 |
| U20 | web-shared-failure-notice | The identical "summary + Technical details" blocks in ObjectEditor, WireSelectionEditor and Definitions → react/failures/FailureNotice.tsx, passed as a slot. Same markup | adapters/react/{failures,object-inspector,wire-inspector,definitions}/*, contract/react/failures.ts, compose/features.ts | +120 / −90 | U17, U19 | refused object, wire and definition Apply (stale tab) → notice + Technical details; `browse text` equals base | DoD1 |
| U21 | web-shell-alerts-css | P5 follow-up: a token for `.alerts max-height: 40%` in WorkspaceShell.module.css; `.problem`, `.problemText`, `.status` → ShellAlerts.module.css | adapters/react/shell/{WorkspaceShell,ShellAlerts}.module.css, ShellAlerts.tsx, capability/design-system tokens | +60 / −40 | U6 | DoD12 audit on both sheets; problem bar and status bar look the same | DoD12, DoD10 |
| U22 | web-css-audit | `pnpm styles:audit <folder>`: a Design System CLI over every `.module.css` (exit 1 on a violation or tokenRatio < 0.95), so DoD12 needs no scratch script. Fix the 3 failing sheets: CollectionLibrary (unused rules; 600 → font token), RequestRecovery (multiplier 5), WorkspaceHeader (700 / 600 / −0.08em → type tokens). Same computed values; any difference listed with before / after shots | capability/design-system/cli/audit-styles.ts, package.json, adapters/react/{library,requests,header}/*.module.css | +230 / −120 | U6 | `pnpm styles:audit apps/web/adapters/react` → 0 violations, tokenRatio ≥ 0.95; Library, header and Recovery row shots equal base | DoD12, DoD10 |
| U23 | web-model-vocabulary | Model exports `objectKind`, `size` and the wire route / side / multiplicity enums; web schemas, core/connection/endpoints and the selects (WireSemantics, WireRouting, ObjectEditor, ConnectionForm) read them through frozen `Readonly<Record<Kind, Label>>` tables. Option order and labels unchanged | capability/model/contract/{index,records/section,records/object}.ts, contract/schemas/*, core/connection/endpoints.ts, adapters/react/{wire-inspector,object-inspector,connection}/* | +330 / −250 | U12, U17 | open every select (object size, relationship kind, cardinality, route, side) → options equal base; old drafts restore | DoD4, DoD10 |
| U24 | web-checked-inputs | Inputs read back by lookup or guard, never `as`: InterfacePreferences number inputs checked; wire endpoint `<option>` values get an `EndpointChoiceKey` brand minted in core/inspector/wire/endpoints.ts; `FilterLayout 'compact' \| 'full'` replaces `compact` booleans | adapters/react/{settings,wire-inspector,library}/*, core/inspector/wire/endpoints.ts, contract/{brands,react/library}.ts | +200 / −120 | U17 | Settings number inputs accept and clamp as base; endpoint selects keep their choices; chooser compact filters vs Library full | DoD4 |
| U25 | web-export-io | ExportPanel: format and scope read by frozen lookup (no `as`); the Blob / anchor download → adapters/browser/download.ts, passed as a slot | adapters/react/export/ExportPanel.tsx, adapters/browser/download.ts, contract/react/shell.ts, compose | +110 / −50 | U6 | Export each format and one section → `<collection>.<ext>` downloads | DoD4 |
| U26 | web-startup-result | compose/startup.ts stops throwing: each step returns a `Result`; `getComputedStyle` → adapters/browser/token-dimensions.ts; theme scope → adapters/browser/theme-scope.ts; `themeChoices` → core/preferences/themes.ts; the duplicate preference literal → core/preferences/defaults.ts. Same failure text. Fixes compose/startup.ts (G1, 129) | contract/compose/startup.ts, contract/compose.ts, adapters/browser/{token-dimensions,theme-scope}.ts, core/preferences/{themes,defaults}.ts | +260 / −150 | U1 | app boots; Settings → each theme applies; serve a bad workspace path → same startup failure text as base | DoD1, DoD7 |
| U27 | web-fix-add-group-empty | Bug fix I34: with no diagram, the Group form shows its own note | adapters/react/add/AddForms.tsx | +20 / −10 | U6 | empty collection → Add → Object note says Object, Group note says Group; `#add-object-title` count = 1 | DoD8 |
| U28 | web-fix-library-active-collection | Bug fix I35: LibraryOrganisation gets the shown collection as a prop, not from `getSnapshot()` during render | adapters/react/library/{LibraryOrganisation,LibraryBrowser}.tsx, contract/react/library.ts, compose | +40 / −20 | U9 | open A → Browse → Collections shows A's folder; chooser → B → B's folder at once; move B → only B moves | DoD8 |
| U29 | web-canvas-edits-results | Errors as values: canvas-edits/targets.ts lookups return `Result` (no `missing()` throw); placements, regroup, routes and plan.ts chain Results; `EditRejected` and its try / catch deleted; `plannedIntent` returns a union, not null. Same outcomes and codes | core/canvas-edits/*, core/movement/intent/admission.ts | +300 / −240 | U3 | move, regroup, route change → Saved; delete a node in tab 2 → drag it in tab 1 → same `stale-target` text as base | DoD4, DoD7 |
| U30 | web-movement-dedupe | expand/prepare.ts and rearrange/prepare.ts share a new movement/single-node.ts; rearrange/release.ts drops the `''` parent sentinel and sets no `undefined` keys. Same options | core/movement/{single-node,expand/prepare,rearrange/prepare,rearrange/release}.ts | +200 / −230 | U4 | crowded drop in a group → Expand and Rearrange offered; multi-select drop → as base | DoD1, DoD4 |
| U31 | web-wiring-failure-codes | Layout's scene-in.ts rejects with its wiring failure as a typed source (`unroutable-leg`, `infeasible-embedding`), not JSON in the message; core/failures/messages.ts picks today's text by origin + code; the `plainMessage` regex is deleted. First trace that Authoring and the service pass the source; if not, the body says where it stops | capability/layout/core/scene-in.ts, core/failures/{messages,display}.ts, contract/api/failures.ts | +220 / −90 | U5 | drop a node where wires cannot route → "Couldn't route a wire for that position. Nothing was changed." as base | DoD4, DoD10 |
| U32 | web-panels-machine-core | Panels machine, unwired: events in records/workflow/panels.ts (unions for open, expand, hide, customize; no booleans); `PanelState` unrestored \| restored{workspace}; `PanelLayout` by mode; `InterfaceVisibility` shown \| hidden{restore}; read / write panel-preference effects | contract/records/workflow/panels.ts, core/panels/{state,panels}.ts | +480 / −0 | U16, U18 | app unchanged | DoD2, DoD5 |
| U33 | web-panels-machine-wire | Route `panels` in the root; lift/panels.ts (the diagram's open-inspect becomes a panels event); the storage executor runs its effects; problems → notices `panel-preferences`; facade/panels.ts; side panels, ViewMenu and the shell read the panels view; delete sessions/panel-session.ts and ports/panels.ts. Fixes panel-session.ts (G1, 129) | core/workspace/{machine,lift/panels}.ts, effects/{storage,stores}.ts, facade/panels.ts, adapters/react/{panels,header,shell}/*, compose | +250 / −340 | U32 | 1400px and 700px: toggle, resize, tab select, Customize hide / move / collapse / Reset, Hide interface → Escape; reload → kept; draw a connection with the right panel closed → opens on Inspect | DoD2, DoD8, DoD14 |
| U34 | web-preferences-machine-core | Preferences machine, unwired: restore, change, reset, environment change; `unrestored` phase instead of a sentinel; storage and theme-scope effects | records/workflow/preferences.ts, core/preferences/{state,preferences}.ts | +230 / −0 | U26 | app unchanged | DoD2, DoD5 |
| U35 | web-preferences-machine-wire | Route `preferences`; lift/preferences.ts; Settings reads its view; facade/preferences.ts; delete sessions/preference-session.ts and ports/preferences.ts | core/workspace/{machine,lift/preferences}.ts, effects/*, facade/preferences.ts, adapters/react/settings/*, compose | +150 / −240 | U34 | Settings → theme, density, text size, motion apply; Reset → defaults; reload → kept; emulate `prefers-color-scheme: dark` → system theme follows | DoD2, DoD8, DoD14 |
| U36 | web-library-machine-core | Library machine, unwired: `LibraryView` loading \| failed \| ready; `FolderDraftState` none \| editing \| creating{request}; busy derived; folder filter `FolderId \| 'all'`; effects read catalog, query, visits, folder draft; organisation changes leave as `send` (origin editor library) | records/workflow/library.ts, core/library/{state,library,defaults}.ts | +480 / −0 | U8 | app unchanged | DoD2, DoD5 |
| U37 | web-library-machine-wire | Route `library`; lift/library.ts: an accepted snapshot refreshes, a journal settle or block answers it, `record-visit` becomes an event; library executor part; LibraryBrowser, Filters, Results, Organisation read the view; delete sessions/library-session.ts and ports/library.ts | core/workspace/{machine,lift/library,lift/journal}.ts, effects/*, facade/library.ts, adapters/react/library/* | +240 / −310 | U36, U28 | search, folder filter, archived, sort, next page; folder title → reload → kept → Create folder; move a collection; archive; open a collection → in recent | DoD3, DoD8, DoD14 |
| U38 | web-drafts-machine-core | Object and wire draft machine, unwired, generic over the draft: `RetainedDrafts<D>` unrestored \| restored{workspace}; edit, discard, apply (`send`, origin editor inspector / wires), settled, blocked; read / write draft effects | records/workflow/drafts.ts, core/drafts/{state,drafts}.ts | +420 / −0 | U14 | app unchanged | DoD2, DoD5 |
| U39 | web-drafts-machine-wire | Route `drafts`; the storage executor runs object and wire draft effects; ObjectEditor and WireSection read their view (selection and draft key resolved in core); delete sessions/retained-editor.ts, compose/sessions.ts, ports/{object-inspector,wire-inspector,retained-editor}.ts | core/workspace/{machine,lift/drafts,lift/journal}.ts, effects/storage.ts, facade/drafts.ts, adapters/react/{object-inspector,wire-inspector}/* | +240 / −295 | U38 | edit an object → Discard; edit → Apply → Saved; edit a wire → reload → restored → Apply → Saved; select another object → its own draft; camera does not move | DoD3, DoD8, DoD14 |
| U40 | web-definitions-machine-core | Definitions machine, unwired: `DefinitionDraftPhase` editing \| applying \| submitted{request}; pending keys derived; apply leaves as `send` (origin editor definitions); settled and released come from the journal; takes over draft-lifecycle.ts's rules | records/workflow/definitions.ts, core/definitions/{state,definitions}.ts | +450 / −0 | U14 | app unchanged | DoD2, DoD5 |
| U41 | web-definitions-machine-wire | Route `definitions`; `settle-definition` becomes journal-lift events; definition storage effects; Definitions reads its view; delete sessions/definition-session.ts and ports/definitions.ts. Fixes I36–I39 and quirk 13; finishes records/definitions.ts (stored busy flags) | core/workspace/{machine,lift/definitions,lift/journal}.ts, effects/storage.ts, facade/definitions.ts, adapters/react/definitions/* | +230 / −250 | U40 | edit → Apply → Saved with one `localStorage.setItem` (eval spy); Apply, then switch collection before the answer → the new collection's drafts untouched; refused Apply (stale tab) → one problem, draft unlocks; reload with a submitted draft → locked until settled | DoD3, DoD8, DoD14 |
| U42 | web-remove-stores | Delete what no machine uses now: core/definitions/draft-lifecycle.ts, facade/editor-sends.ts, runner/waiters.ts, effects/stores.ts, `CallerEffect`, `StoreEffect`, `StoreHandles`, `Waiters`; lift/journal.ts's `answer-caller` rows. `adapters/sessions/` is gone | core/definitions/draft-lifecycle.ts, adapters/{facade,runner,effects}/*, records/workflow/effects.ts, ports/executors.ts, lift/journal.ts, compose | +40 / −480 | U37, U39, U41 | full pass: start, open, add, move, connect, undo, source, chooser, recovery, export, inspector / wire / definition / library applies, panels, settings, reload | DoD1, DoD14 |

**M28 note (decision 1, server half).** A second browser committing first cannot force `constraint-conflict`: Authoring checks read versions before layout feasibility, so it gives `revision-conflict`, which snaps back (§3). `constraint-conflict` needs a move the local preview accepts and the service's layout refuses. M28 looks for a repeatable one in a scratch workspace; if none is found, the PR lists "choices after a server refusal" under **Not verified**, and M28b is decided on the local-refusal drive only. The Canvas side is expected to work: `preview-routes` needs the entry still `submitted` at the same stamp (`draft-events.ts:31-35`), D4 keeps it `submitted`, and a refusal with no foreign commit rereads without a reopen, so the stamp is unchanged.

- **Not scheduled (needs Chris's decision, §16 Q4):** `layout-owns-settling` (drop settling and expand geometry → capability/layout) and `layout-owns-preview-rules` (Layout's preview returns the grew / pushed / stopped verdict). Until then `core/canvas-edits/settle/` and `core/movement/preview/*-rules.ts` stay in web with that written reason.
- **Totals.** 97 PRs (plus M28b if needed): 8 built (P1–P8, real +2,390 / −1,622), 47 more plan PRs (+12,490 / −6,834 by estimate) and 42 U PRs (+9,105 / −6,590; renames sized by `git diff -M`). Sum +23,985 / −15,046 = 39,031 changed lines. Over 600: P3, P6, P7 (built; overages accepted). P1–P8 ran 0.6–2.7× their estimates (house-style headers and JSDoc, score-gate fixes); expect the same spread later.

### 13.3 Order

One stack, in this order (lead's revision, 27 Sep; U-series 28 Sep): P1 · P2a · P3 · P4 · P5 · P6 · P7 · P8 (built) · **SYNC** · P2b · B1 · ER1 · B2a · B2b · B3a · B3b · B4 · B5 · B6a · B6b · M1 … M28 · (M28b) · M29 … M34 · ER2 · ER3 · **U1 … U42** · **OB1 … OB3**.

- **SYNC** (merge only, no new code): merges the finished `apps/service` and `apps/cli` re-engineering stacks into this stack, so P2b, B1, B2b and ER1 edit service and cli files in their new homes. The body lists the already-reviewed PRs it brings in.
- **P2b moves after SYNC** because it edits `apps/service/contract/records/*`, which the service stack re-homes.
- **U1 … U42** (the rest of `apps/web`, after the machines): moves U1–U7 · contract splits U8–U12 · file splits U13–U20 · CSS U21–U22 · types and boundaries U23–U26 · bug fixes and errors-as-values U27–U31 · store machines U32–U42 (panels, preferences, library, object / wire drafts, definitions; after M34 they are the only workflow state outside the runner, so D8 ends here). Source: a separate web-UI design, minus what this plan already does.
- **OB1 … OB3** (owner brands, §16 Q1 decided yes): brand workspace sequence (Authoring), collection revision (Model), Canvas target ID and scene key, Library cursor and visit time in their owning capabilities; the web picks them up with no web edits.

### 13.4 Definition of done (the story canvas shows the same table)

| # | Check | Command | Pass |
|---|---|---|---|
| DoD1 | The god file is gone and no new one exists | `test ! -e apps/web/adapters/sessions/workspace-session.ts`; `wc -l` on every changed file | file absent; every changed file ≤ 300 lines, or a written reason in §10 |
| DoD2 | Core is pure | `pnpm exec eslint apps/web/core` with M2's rule: `no-restricted-globals` (window, document, localStorage, sessionStorage, fetch, crypto, performance, setTimeout, setInterval) and `no-restricted-properties` (`Date.now`) scoped to `apps/*/core/**` | 0 errors. (A text grep for `document` matches 285 lines of `RenderDocument` today, so grep is not the check.) |
| DoD3 | Every request passes one gate, Retry included | `pnpm exec eslint apps/web/core` (J3 rules); `grep -rn "gatedSend(" apps/web/core`; `grep -rn "sendReadiness(" apps/web/core` | 0 errors; `gatedSend` called only in `journal/send.ts`, `journal/recovery.ts`; `sendReadiness` only in `rules/gated-send.ts`, `rules/permissions.ts`. The `'post-apply'` literal outside core (`effects.ts`, `effects/apply.ts`) is expected |
| DoD4 | No bare string or number for an ID or domain value | `grep -rnE "\b(id\|[a-z]+Id\|workspace\|collection\|request\|gesture\|generation\|revision\|sequence)\??: (string\|number)\b" apps/web/core apps/web/contract`; `grep -rnE "(=\|:) ''\|=== ''\|\?\? -1" apps/web/core/workspace` | 0 matches each (the named aliases of §4.1 are types, not `string`) |
| DoD5 | No stored busy flags or status text | `grep -rnE "busy\|status: string" apps/web/core/workspace/*/state.ts apps/web/core/workspace/state.ts` | 0 matches |
| DoD6 | Build gates pass | `pnpm typecheck`; `pnpm architecture` (type-only imports checked from P2b); `pnpm exec eslint apps/web`; `pnpm exec prettier --check <touched>` | 0 errors each |
| DoD7 | Standards score | Review ritual, `docs/standards/CODING-STANDARDS.md` ("Review ritual"), per changed file; scores in the PR body | each > 144 / 160 (exemption: §16 Q2) |
| DoD8 | Behaviour kept | Headless drive of the §11 rows marked "Driven in" this PR | 0 rows failing |
| DoD9 | Decision 1 | Headless: overlap drag → choices at once → Apply → Saved; Recovery shows a request ID different from the gesture ID. Server half: M28 note | choices after a completed move = 0; applied request ID ≠ gesture ID; server half verified or listed under Not verified |
| DoD10 | Touched capabilities do not regress | `pnpm exec vitest run capability/<name>` for each touched capability (§13.1 "Capability PRs") | new failures vs baseline = 0 |
| DoD11 | Every quirk decided | §12.2 | undecided = 0 |
| DoD12 | Stylesheets | The `auditStyles` call from `capability/design-system/tests/artifacts.test.ts:108-115`, run on the touched `.module.css` files by a scratch script (not committed); from U22, `pnpm styles:audit <folder>`; `pnpm exec vitest run capability/design-system` for `Dialog.module.css`; headless look | violations = 0; tokenRatio ≥ 0.95 |
| DoD13 | Folders by responsibility (U1–U7) | `ls apps/web/adapters apps/web/core apps/web/adapters/react apps/web/contract` | no `adapters/{edge,readers,preferences}/`, no `core/{editing,output,recovery}/`; no loose `*-react.ts` in contract; every React file in a feature folder; README find-it table names every folder |
| DoD14 | No store sessions (U33–U42) | `test ! -d apps/web/adapters/sessions`; `grep -rnE "answer-caller\|createWaiters" apps/web` | folder absent; 0 matches |

---

## 14. Tests (later, not scheduled: Chris, 27 Sep)

Fast table tests, written when Chris re-enables apps tests. They go through `contract/index.ts` (`createWorkspaceMachine`, `projectWorkspace`) and `adapters/` (runner).

| File | Rows | Guards |
|---|---|---|
| runner | 7 | FIFO; no re-entry; effects after commit; late answers dropped after dispose |
| gated-send | 16 | nothing sent around the gate, including Retry |
| journal | 20 | lost or double requests; refusal classes; restore |
| catalogue-link-lifecycle | 15 | stale snapshots; start order; K1 |
| diagram | 18 | stale render installed; chooser; restart; O2 create-open |
| gesture | 18 | decision 1; request ≠ gesture; one Canvas settle per gesture |
| forms, connection, source | 10, 8, 10 | stuck locks; rebase across a foreign edit |
| notices-status-permissions | 25 | F1–F3, F6; the status priority table; `may` reasons |

---

## 15. Corrections made while writing this plan

Each was checked in the code at `5571c7e`.

| # | Design text | This plan | Evidence |
|---|---|---|---|
| C1 | "Type-only imports hide 23 web cycles" | 25 cycle reports repo-wide (14 web, 2 service, 7 layout, 2 export) + 3 web core-direction. The 23 was the `web-tests-public` count; tests are now deleted. | depcruise run, §3 |
| C2 | P2: one PR turns the flag on; service cycles in P2b "if over 600" | P2a fixes web; P2b fixes service, layout and export, then turns the flag on. `pnpm architecture` is repo-wide, so the flag cannot go on earlier. | `package.json` `architecture` script |
| C3 | `GateContext` (names core `Gate`) in `contract/records/workflow/gate.ts` | `GateContext`, `SendMode` in core; `SendBlock`, `SendTarget`, `AdmittedSend` declared (effects and the view name them) | `declarations-no-policy` rule |
| C4 | `SourceDraft`, `Latest`, stored journal entries shown beside core state | Declared in `contract/records/workflow/*`: events and effects carry them (§5) | same rule |
| C5 | `WorkflowDeps.connection: ConnectionPolicy` with the type in core | `ConnectionPolicy`, `IdGrammar` move to `contract/ports/connection-policy.ts` (M1) | `core/editing/connection/types.ts`; `contract/api.ts:103` |
| C6 | `FormsEvent` names `PaletteDrop` (declared in core) | `PaletteDrop` type → `contract/records/creation.ts` (M21) | `core/editing/palette-drop.ts:8` |
| C7 | `ConnectionIntent` imported from Canvas | `Extract<EditIntent, {kind: 'connection'}>` | not in `capability/canvas/contract/index.ts` |
| C8 | `IdSource` has no content ID | adds `descendantId()`; `compose/features.ts` takes `random` since P6 and `IdSource.descendantId()` from B3b | `compose/features.ts:79` at `5571c7e` |
| C9 | `nextCount(schema: z.ZodType<T, z.ZodTypeDef, number>, …)` | `z.ZodType<T, number>` | zod 4.6.2 has no `ZodTypeDef` |
| C10 | `write-journal` carries `StoredSubmission[]`; "the writer maps Origin" | carries `RetainedEntry[]` (Origin-based); the storage executor maps both ways (table in §6.4) | `adapters/readers/submission-readers.ts:8-14` |
| C11 | `read-receipt` carries the whole `Request` | carries `RequestId`; the reader only compares IDs | `submission-readers.ts:72-78` |
| C12 | autoCheck lookup leaves the entry `uncertain` | the autoCheck entry enters `checking{after: uncertain}` so its answer has a row | journal table |
| C13 | No row for a snapshot accepted while `installing` | after `scene-installed`, `activeRefresh` runs against the current latest (I29) | R3 lets queued events run between install and its answer |
| C14 | `forms-elsewhere` only while a diagram is open | also notes the status when the library is shown | today's `reportRefusedElsewhere` notes status in either case |
| C15 | Source `edited` from any readout | needs a printed readout (a base to edit against); else `source-unavailable` | `SourceDraft` needs base and collection |
| C16 | Pass-down: every child event must name the open collection | only events that name a collection are checked (`edited`, `applied`, `cancelled` do not) | event types in §6.9–6.11 |
| C17 | R4 could loop if the notices update throws | a throw while handling `transition-failed` is dropped | — |
| C18 | Receipt order "source → definitions → gesture → … → snapshot" | one owner per receipt; definitions settle in the journal step; owner before snapshot | R2 runs a step's effects before its queued events |
| C19 | Relationship ID `relationship-` + gesture ID | minted by `IdSource` (I28) | `core/editing/connection/request.ts:69` |
| C20 | Source-origin test cited at `source-session.ts:65-72` | `source-session.ts:75-81` | file at `5571c7e` |
| C21 | Smoke omits the web build | `pnpm --filter @novakai/canvas-web build` before `pnpm dev` | `apps/service/cli/serve.ts:39` serves `apps/web/dist` |
| C22 | The design refers to a §9 list of fixes that was not in its text | this section | — |

---

## 16. Decisions (decided by the lead, 27–28 Sep; Q4 open)

| # | Question | Decision |
|---|---|---|
| Q1 | Owner brands for values that are named aliases today (workspace sequence, collection revision, Canvas target ID and scene key, Library cursor and visit time) | **Yes — brand them in their owning capabilities.** Chris's rule: no bare string/number for identities or domain values. Scheduled last as OB1–OB3, after ER3 and the U-series, so they do not collide with the service/cli stacks. |
| Q2 | Score gate for `workspace-session.ts` and the temporary bridge while they are being removed | **Exempt both until M34.** Instead `wc -l workspace-session.ts` must drop in every wire PR, and the bridge stays within its §8.5 budget. |
| Q3 | Choices after a server refusal: which refusal codes | **`constraint-conflict` only.** The other 7 codes snap back. |
| Q4 | Should capability/layout own drop settling, expand geometry and the preview rules that web re-derives today (`core/canvas-edits/settle/`, `core/movement/expand/geometry.ts`, `core/movement/preview/*-rules.ts`)? | **Open (Chris).** Default: not scheduled; web keeps them with that written reason (§13.2 "Not scheduled"). |

Decided by default, no question needed:
- Run M28b (Canvas change) only if the M28 drive shows the Canvas drops the preview.
- Keep quirk 13 (definition apply reports twice and writes twice) through the M-series; U41 fixes it.

### G1 score-gate rule (lead, 28 Sep)

A file a PR only moves, re-points imports in, or moves types into or out of keeps its baseline score and may stay ≤ 144 until its named fixing PR. The PR body lists each such file with its score and fixing PR. A file with no fixing PR is reported to the lead, who adds one. Files a PR changes in substance must pass (> 144), except `workspace-session.ts` and the bridge until M34 (Q2).

| File | Baseline | Fixing PR |
|---|---|---|
| `contract/ports/workspace.ts` | 142 (SRP 5, Deep 5: `WorkspaceBindings`) | M34 |
| `contract/panel-types.ts` | 141 (Errors 5: `report(message: string)`) | ER1, M8 |
| `contract/records/workspace.ts` | 137 (SRP 5, ISP 5: flat view, 38-member controller) | M33 |
| `contract/api.ts` | 141 (Errors 5: `definitionDraftId` throws) | B3b |
| `core/workspace/diagram/admission.ts` | 141 (Errors 5: open `string` codes) | ER1 |
| `contract/records/inspector.ts` | 142 (DRY 7: restates `RetainedEditor<…>`) | U8 |
| `adapters/sessions/panel-session.ts` | 129 (Errors 5, Imm 5, DRY 6) | U33 (deleted) |
| `contract/compose/startup.ts` | 129 (SRP 6, ISP 5, throws as control flow, ambient `getComputedStyle`) | U26 |
| `adapters/react/WorkspaceSidePanel.tsx` | 127 (KISS 5, Cog 5, SRP 6) | U18 |

Other files at or below 144 in #131's score table keep the fixing PR named there; `contract/records/definitions.ts` is finished by U41.

---

## Appendix: where the design came from

| Taken from | What |
|---|---|
| Design B | Two parents; `to` routing and lift files; `Origin`; `SendGeneration`; gatedSend with resend mode; lifecycle waits for the first snapshot; `autoCheck` one at a time; Canvas `GestureId`; typed effect families; `ProblemSlot` with a refusal variant; source machine |
| Design A | Pure preview injection (no review effects or extra phases); derived status table and `StatusNote`; faithful supersede and close-dismisses rules; record-then-post; `PreviewPlan`; `preview-answered` handling; `IdOf` mapped types; waiters for store applies; unchanged storage shape; Canvas fallback PR; complete behaviour table |
| New | Machine state types in core behind an opaque runner; render restart on invalidation; O2 ordering for create; scene key plus stamp in gesture captures; journal ticks instead of a growing log; initial scene flags on open; type-only import gate first; the corrections in §15 |
