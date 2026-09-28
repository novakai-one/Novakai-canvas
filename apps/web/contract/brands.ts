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

export type {
  WorkspaceId,
  RequestId,
  RecordId,
  ActorId,
  PlannerId,
} from '@novakai/canvas-authoring';
export type {
  CollectionId,
  SectionId,
  ObjectId,
  GroupId,
  RelationshipId,
  DefinitionId,
  DescendantId,
} from '@novakai/canvas-model';
export type { FolderId } from '@novakai/canvas-library';
export type { TransportGeneration } from '@novakai/canvas-service';

/** A workspace's commit count (Authoring). An alias, so a later Authoring brand arrives unchanged. */
export type WorkspaceSequence = Snapshot['sequence'];

/** A collection's revision (Model). An alias, so a later Model brand arrives unchanged. */
export type CollectionRevision = Collection['revision'];

/**
 * A Canvas target ID. Canvas target and drop text becomes a Model ID only in
 * `core/editing/targets.ts`, `placements.ts` and `palette-drop.ts`, by matching collection records.
 */
export type TargetId = Target['id'];

/** A Canvas scene index key. */
export type SceneKey = TargetInfo['key'];

/** A Library page cursor. The web passes it back unread. */
export type LibraryCursor = NonNullable<QueryRequest['cursor']>;

/** When a collection was last opened, in epoch milliseconds (Library). */
export type VisitTime = RecentVisit['openedAt'];

/** A whole number from 0 to `Number.MAX_SAFE_INTEGER`, so it survives a JSON round trip exactly. */
const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

/**
 * Source-editor keystrokes. Advanced only by the source machine; parsed from storage only by the
 * source and journal readers (from B6b).
 */
export const sourceEdit = count.brand<'SourceEdit'>();

/** A source-editor keystroke count checked by {@link sourceEdit}. */
export type SourceEdit = z.infer<typeof sourceEdit>;

/**
 * Latest-answer tickets and the journal's clock. Each is advanced only by its own machine folder
 * (`catalogue/`, `history/`, `diagram/`, `journal/`); from M2 an ESLint `no-restricted-imports`
 * rule (`importNames`) enforces that. Kept in machine state; never written to storage.
 */
export const readTicket = count.brand<'ReadTicket'>();
export const historyTicket = count.brand<'HistoryTicket'>();
export const renderId = count.brand<'RenderId'>();
export const journalTick = count.brand<'JournalTick'>();

/** The ticket of the newest workspace read; an older read's answer is dropped. */
export type ReadTicket = z.infer<typeof readTicket>;

/** The ticket of the newest history status read; an older read's answer is dropped. */
export type HistoryTicket = z.infer<typeof historyTicket>;

/** The ticket of the newest diagram render; an older render's answer is dropped. */
export type RenderId = z.infer<typeof renderId>;

/** The journal's clock. Entries keep the tick they started, or were refused, at. */
export type JournalTick = z.infer<typeof journalTick>;

/** The first value of each count brand. `parse(0)` cannot throw: 0 is in range. */
export const firstSourceEdit: SourceEdit = sourceEdit.parse(0);
export const firstReadTicket: ReadTicket = readTicket.parse(0);
export const firstHistoryTicket: HistoryTicket = historyTicket.parse(0);
export const firstRender: RenderId = renderId.parse(0);
export const firstTick: JournalTick = journalTick.parse(0);

/**
 * The value after `current` in the same brand. At `Number.MAX_SAFE_INTEGER` (about 9e15 steps;
 * not reachable in one browser session) it returns `current` unchanged. Never fails. The brand is
 * taken from `schema`, so `current` must carry the same brand.
 */
export function nextCount<S extends z.ZodType<number, number>>(
  schema: S,
  current: z.output<S>,
): z.output<S> {
  const next = schema.safeParse(current + 1);
  if (!next.success) return current;
  return next.data;
}

/** The two layout choices offered after a refused move. */
export type ChoiceKind = 'expand' | 'rearrange';

/** The three Add panel forms. */
export type FormKind = 'diagram' | 'object' | 'group';

/** Which way a history step goes. */
export type Direction = 'undo' | 'redo';

/** The editor stores that send through the journal. */
export type EditorKind = 'inspector' | 'wires' | 'definitions' | 'library';

/** The browser storage slots. From B6a only `draft-retention.ts` builds key text from a slot. */
export type RetentionSlot =
  | 'pending'
  | 'source-draft'
  | 'inspector'
  | 'wire-inspector'
  | 'definitions'
  | 'panels'
  | 'folder-draft'
  | 'visits'
  | 'ui-preferences';

/**
 * Every side-panel section, in the default order. From B6b the panel defaults file and stored
 * preferences are parsed with `z.enum(panelSectionIds)`.
 */
export const panelSectionIds = [
  'creation',
  'collections',
  'sections',
  'objects',
  'export',
  'definitions',
  'shared-content',
  'connection',
  'interface',
] as const;

/** One side-panel section ID from {@link panelSectionIds}. */
export type PanelSectionId = (typeof panelSectionIds)[number];

/* ObjectDraftKey, WireDraftKey, DefinitionDraftKey: string brands added in B6a. */
/* GestureId: a Canvas brand, re-exported here from B5. */
