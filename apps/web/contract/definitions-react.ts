/*
 * React slots for the Definitions panel. The panel receives the expression editor as a slot, so
 * the two adapters never import each other; compose.ts builds both once.
 */
import type { ComponentType } from 'react';
import type { DesignSlots } from './react-types.js';
import type {
  Definition,
  ExpressionPath,
  LiteralDraft,
  TypeExpression,
} from './records/definitions.js';

/** The design controls the expression editor draws with. */
export type ExpressionSlots = Pick<DesignSlots, 'Button' | 'Field'>;

/** The design controls and the expression editor the Definitions panel draws with. */
export interface DefinitionsSlots extends ExpressionSlots {
  readonly Expression: ComponentType<ExpressionEditorProps>;
}

/**
 * Edits one expression node. `onChange` receives the whole expression this node belongs to, and
 * the path of the node the user edited (null when a union gained or lost an alternative).
 * `definitions` are the saved definitions a reference may name.
 */
export interface ExpressionEditorProps {
  readonly expression: TypeExpression;
  readonly path: ExpressionPath;
  readonly literalDrafts: readonly LiteralDraft[];
  readonly definitions: readonly Definition[];
  readonly disabled: boolean;
  readonly onChange: (expression: TypeExpression, editedPath: ExpressionPath | null) => void;
  readonly onLiteralDraft: (literalDraft: LiteralDraft) => void;
}
