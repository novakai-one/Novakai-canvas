/*
 * Foreign vocabulary: the capability and service records the CLI speaks in. Type-only re-exports
 * keep CLI core, contract ports and the render factories inside every capability's public entry.
 */
export type { Collection } from '@novakai/canvas-model';
export type { Language, ResolvedResources } from '@novakai/canvas-language';
export type { RenderDocument } from '@novakai/canvas-service';
export type { Assets } from '@novakai/canvas-assets';
export type { Catalog, ThemePreset } from '@novakai/canvas-templates';
export type { Documents, Resource, Resources } from '@novakai/canvas-export';
/** Owner records: CLI core imports only these local aliases. */
export type { Snapshot, Request, Receipt, StoredRecord } from '@novakai/canvas-authoring';
export type { TransportResponse } from '@novakai/canvas-service';
export type { PortableToken } from '@novakai/canvas-design-system';
