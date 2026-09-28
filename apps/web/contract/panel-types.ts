/*
 * Panel seams: the panel controller React drives and the bindings composition hands it.
 * Declarations only; `adapters/sessions/panel-session.ts` implements the controller. The panel
 * records it names live in `records/panels.ts`, so Web core can read them.
 */
import type { PanelSectionId, WorkspaceId } from './brands.js';
import type { Diagnostic, Result } from './errors.js';
import type { DraftRetention } from './ports/draft-retention.js';
import type {
  InterfaceControl,
  PanelId,
  StoredPanelPreferences,
  PanelSectionDefinition,
  PanelSizing,
  PanelState,
  PanelTab,
} from './records/panels.js';

/** The shell's panel store: React reads its state and sends every panel change through it. */
export interface PanelController {
  getSnapshot(): PanelState;
  subscribe(listener: () => void): () => void;
  restore(workspace: WorkspaceId): void;
  open(
    side: PanelId,
    open: boolean,
  ): void;
  selectTab(tab: PanelTab): void;
  viewport(width: number): void;
  resize(
    side: PanelId,
    width: number,
  ): void;
  expand(
    id: PanelSectionId,
    expanded: boolean,
  ): void;
  hide(
    id: PanelSectionId,
    hidden: boolean,
  ): void;
  move(
    id: PanelSectionId,
    side: PanelId,
    index: number,
  ): void;
  customize(open: boolean): void;
  reset(): void;
  setInterfaceVisibility(
    control: InterfaceControl,
    visible: boolean,
  ): void;
  hideInterface(): void;
  revealInterface(): void;
}
/** What composition hands the panel store: section definitions, sizing, storage and the problem report. */
export interface PanelBindings {
  readonly definitions: readonly PanelSectionDefinition[];
  readonly sizing: PanelSizing;
  readonly initialWidth: number;
  readonly retention: DraftRetention;
  read(
    input: unknown,
    workspace: WorkspaceId,
  ): Result<StoredPanelPreferences>;
  /** Show a panel-layout failure (`panel-preferences`); it stays shown across renders. */
  report(problem: Diagnostic): void;
}
