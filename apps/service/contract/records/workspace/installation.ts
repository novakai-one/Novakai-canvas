import type { Catalog } from '@novakai/canvas-templates';
/** Trusted startup input is fixed before registering its private planner; request payloads cannot replace these records. */
export interface Installation {
  readonly workspace: string;
  readonly title: string;
  readonly createdAt: number;
  readonly presets: Catalog;
}
