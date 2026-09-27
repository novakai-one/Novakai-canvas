import type { Assets } from '@novakai/canvas-assets';
import type { Catalog, Templates } from '@novakai/canvas-templates';
import type { Language, LoweredIntent } from '@novakai/canvas-language';
/** Resource selection reads exact preset/byte owners against one immutable Authoring snapshot. */
export interface ResourceOwners {
  readonly assets: Pick<Assets, 'resolve'>;
  readonly templates: Pick<Templates<LoweredIntent>, 'readCatalog' | 'read'>;
  readonly language: Pick<Language, 'parse'>;
  readonly installation: Catalog;
}
