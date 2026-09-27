/*
 * The parsed `pnpm canvas` command: its name, operand, flags and service options. Pure
 * declarations. The argument adapter builds it; commands read it.
 */
import { z } from 'zod';
import type { Scope } from '@novakai/canvas-language';
import type { CollectionRevision } from '../brands.js';
/** Replacement and patch commands require an explicit read revision; omission cannot become a blind latest-version overwrite. */
export const commandName = z.enum([
  'help',
  'describe',
  'list',
  'read',
  'create',
  'replace',
  'patch',
  'preview',
  'receipt',
  'retry',
  'apply',
  'inspect',
  'theme-admit',
  'recipe-admit',
  'recipe-instantiate',
  'profile-describe',
  'profile-scaffold',
  'profile-lint',
]);
export type CommandName = z.infer<typeof commandName>;
export interface Command {
  readonly name: CommandName;
  readonly target: string;
  readonly revision: CollectionRevision | null;
  readonly mode: 'create' | 'replace' | 'patch';
  readonly request: string | null;
  readonly output: string | null;
  /** Read-only source context; omitted means the complete collection for legacy callers. */
  readonly scope?: Scope;
  readonly preset?:
    | {
        readonly id?: string;
        readonly version?: string;
        readonly family?: string;
        readonly title?: string;
        readonly namespace?: string;
      }
    | undefined;
  readonly profile?: string | undefined;
}
export interface CliOptions {
  readonly command: Command;
  readonly server: string;
  readonly workspaceDirectory: string;
}
