/*
 * The web's own failure codes: closed unions grouped by the area that reports them. A code names a
 * failure the web detects itself; another owner's failure keeps that owner's code (`errors.ts`).
 * Consumers branch on the code, never on the message. Declarations only; nothing to recover.
 */

/** Starting the page, reading its address and restoring what the browser kept. */
export type StartupCode =
  | 'initialization-failed'
  | 'mount-failed'
  | 'invalid-location'
  | 'navigation-unavailable'
  | 'invalid-workspace'
  | 'invalid-preferences'
  | 'invalid-recovery'
  | 'recovery-unavailable';

/** Opening a diagram: the delivered render does not fit what was asked for. */
export type RenderCode =
  | 'invalid-diagram'
  | 'stale-diagram'
  | 'workspace-generation'
  | 'render-input-changed'
  | 'snapshot-mismatch';

/**
 * Sending requests and settling their answers. `wrong-workspace` also refuses a retained editor
 * draft or source draft that belongs to another workspace.
 */
export type JournalCode =
  | 'wrong-workspace'
  | 'unknown-request'
  | 'pending-request'
  | 'confirmation-required'
  | 'invalid-receipt'
  | 'invalid-response'
  | 'invalid-request'
  | 'connection-uncertain'
  | 'draft-retention-unavailable';

/** Canvas gestures, movement choices, connections and the Add forms. */
export type GestureCode =
  | 'invalid-edit'
  | 'unsupported-edit'
  | 'stale-target'
  | 'stale-gesture'
  | 'tree-section-drop'
  | 'invalid-creation';

/** The Source editor. */
export type SourceCode = 'source-unavailable';

/** The inspector, wire, definition and Library editors, and the panel and interface preferences. */
export type EditorCode =
  | 'invalid-inspector-draft'
  | 'invalid-wire-draft'
  | 'invalid-definition-draft'
  | 'invalid-literal-draft'
  | 'invalid-folder-draft'
  | 'invalid-library'
  | 'invalid-library-request'
  | 'library-changed'
  | 'invalid-visits'
  | 'panel-preferences'
  | 'ui-preferences';

/** Undo and redo. */
export type HistoryCode = 'invalid-history';

/** The browser host: a missing capability, an export the service cannot make, or no new ID. */
export type HostCode = 'unavailable' | 'export-unavailable' | 'id-unavailable';

/** Every failure the web reports as its own. */
export type WebErrorCode =
  | StartupCode
  | RenderCode
  | JournalCode
  | GestureCode
  | SourceCode
  | EditorCode
  | HistoryCode
  | HostCode;
