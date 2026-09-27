/*
 * The build-spec profile vocabulary: the profiles the CLI knows, the descriptor `profile describe`
 * prints, and the lint result. Pure declarations; core builds and reads them.
 */
import { z } from 'zod';
import type { Declaration, ParsedSource, Span } from '@novakai/canvas-language';
export type {
  Declaration as ProfileDeclaration,
  ParsedSource as ProfileSource,
  Span as ProfileSpan,
} from '@novakai/canvas-language';

/** Every profile the CLI knows. `profile describe|scaffold|lint` accept only these (`unknown-profile`). */
export const profileId = z.enum(['build-spec@1']);

/** A profile that passed {@link profileId}. */
export type ProfileId = z.infer<typeof profileId>;

export interface ProfileSlotDescriptor {
  readonly id: string;
  readonly order: number;
  readonly required: boolean;
  readonly modes: readonly string[];
  readonly description: string;
}

export interface ProfileDescriptor {
  readonly id: ProfileId;
  readonly name: string;
  readonly description: string;
  readonly commands: Readonly<Record<'describe' | 'scaffold' | 'lint', string>>;
  readonly slots: readonly ProfileSlotDescriptor[];
  readonly appendix: {
    readonly idPattern: string;
    readonly modes: readonly string[];
    readonly description: string;
  };
  readonly conventions: readonly string[];
  readonly notes: readonly string[];
}

export interface ProfileDeclarationIndex {
  readonly source: ParsedSource;
  readonly declaration: Declaration;
  readonly sections: readonly Declaration[];
  readonly nodes: readonly Declaration[];
  readonly wires: readonly Declaration[];
}

export interface ProfileFinding {
  readonly path: string;
  readonly message: string;
  readonly span: Span;
}

export interface ProfileLintResult {
  readonly profile: ProfileDescriptor['id'];
  readonly valid: boolean;
  readonly findings: readonly ProfileFinding[];
  readonly summary: string;
}
