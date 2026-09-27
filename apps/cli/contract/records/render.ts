/*
 * Render vocabulary: the capability records the headless render speaks in. Type-only re-exports
 * keep core/render and the render factories inside every capability's public entry.
 */
export type { Collection } from '@novakai/canvas-model';
export type { Language, ResolvedResources } from '@novakai/canvas-language';
export type { RenderDocument } from '@novakai/canvas-service';
export type { Assets } from '@novakai/canvas-assets';
export type { Catalog, ThemePreset } from '@novakai/canvas-templates';
export type { Documents, Resource, Resources } from '@novakai/canvas-export';
