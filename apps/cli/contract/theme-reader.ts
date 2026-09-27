import type { ResourceRequest } from '@novakai/canvas-language';
import type { Result } from './errors.js';
/** Raw UTF-8 theme text is checked by the core theme grammar (core/themes/grammar.ts); network and headless preparation share this system edge. */
export type readThemeConfig = (source: string) => Result<{
  readonly admission: unknown;
  readonly resources: readonly ResourceRequest[];
}>;
