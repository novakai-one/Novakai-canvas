/*
 * The expression editor inside a definition card. A union shows one editor per alternative, then
 * Add and Remove buttons; a primitive or reference is a select; a literal has a kind select and a
 * value control. The literal editor keeps the typed text in local state, so unfinished number
 * text such as `1e` stays visible; that text is sent as a literal draft until it parses. Select
 * values are checked in core; a value outside the listed options does nothing.
 */
import { useEffect, useState } from 'react';
import type { ComponentType, ReactElement } from 'react';
import type { ExpressionEditorProps, ExpressionSlots } from '../../contract/definitions-react.js';
import type {
  ExpressionPath,
  LiteralCommit,
  LiteralDraft,
  LiteralValue,
  TypeExpression,
} from '../../contract/records/definitions.js';
import { primitiveNames } from '../../contract/definitions-model.js';
import {
  addAlternative,
  canRemoveAlternative,
  chosenLiteralKind,
  chosenPrimitive,
  chosenReference,
  literalBooleanChange,
  literalDraftAt,
  literalKindChange,
  literalKindOf,
  literalKinds,
  literalTextChange,
  removeLastAlternative,
  replaceAlternative,
} from '../../contract/api.js';

/** Builds the expression editor once over the shared design controls. */
export function createExpressionEditor({
  Button,
  Field,
}: ExpressionSlots): ComponentType<ExpressionEditorProps> {
  /** Draws the editor for one expression node, by kind. */
  function ExpressionEditor({
    expression,
    path,
    literalDrafts,
    definitions,
    disabled,
    onChange,
    onLiteralDraft,
  }: ExpressionEditorProps): ReactElement {
    switch (expression.kind) {
      case 'union':
        return (
          <>
            {expression.items.map((item, index) => (
              <ExpressionEditor
                key={index}
                expression={item}
                path={[...path, index]}
                literalDrafts={literalDrafts}
                definitions={definitions}
                disabled={disabled}
                onChange={(next, editedPath) =>
                  onChange(replaceAlternative(expression, index, next), editedPath)
                }
                onLiteralDraft={onLiteralDraft}
              />
            ))}
            <Button
              label="Add union alternative"
              disabled={disabled}
              onClick={() => onChange(addAlternative(expression), null)}
            />
            <Button
              label="Remove last alternative"
              disabled={disabled || !canRemoveAlternative(expression)}
              onClick={() => onChange(removeLastAlternative(expression), null)}
            />
          </>
        );
      case 'primitive':
        return (
          <Field
            label="Primitive"
            control={(props) => (
              <select
                {...props}
                disabled={disabled}
                value={expression.name}
                onChange={(event) =>
                  sendChoice(chosenPrimitive(primitiveNames, event.target.value), path, onChange)
                }
              >
                {primitiveNames.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            )}
          />
        );
      case 'reference':
        return (
          <Field
            label="Reference"
            control={(props) => (
              <select
                {...props}
                disabled={disabled}
                value={expression.id}
                onChange={(event) =>
                  sendChoice(chosenReference(definitions, event.target.value), path, onChange)
                }
              >
                {definitions.map((definition) => (
                  <option key={definition.id} value={definition.id}>
                    {definition.label} · @{definition.id}
                  </option>
                ))}
              </select>
            )}
          />
        );
      case 'literal':
        return (
          <LiteralEditor
            value={expression.value}
            raw={literalDraftAt(literalDrafts, path)}
            path={path}
            disabled={disabled}
            onChange={onChange}
            onLiteralDraft={onLiteralDraft}
          />
        );
      default:
        return unavailableExpression(expression);
    }
  }

  /** A literal's kind select and value control; `raw` is its retained draft, if any. */
  function LiteralEditor({
    value,
    raw,
    path,
    disabled,
    onChange,
    onLiteralDraft,
  }: LiteralEditorProps): ReactElement {
    const kind = literalKindOf(value);
    const [kindDraft, setKindDraft] = useState(raw?.kind ?? kind);
    const [draft, setDraft] = useState(raw?.text ?? String(value));
    useEffect(() => {
      setDraft(raw?.text ?? String(value));
      setKindDraft(raw?.kind ?? kind);
    }, [value, kind, raw]);
    return (
      <Field
        label="Literal kind and value"
        control={(props) => (
          <div>
            <select
              id={props.id + '-kind'}
              aria-label="Literal kind"
              aria-invalid={props['aria-invalid']}
              aria-describedby={props['aria-describedby']}
              required={props.required}
              disabled={disabled}
              value={kindDraft}
              onChange={(event) => {
                const next = chosenLiteralKind(event.target.value);
                if (next === null) return;
                setKindDraft(next);
                commit(literalKindChange(next, draft, path), onChange, onLiteralDraft);
              }}
            >
              {literalKinds.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
            {kindDraft === 'boolean' ? (
              <select
                id={props.id + '-value'}
                aria-label="Literal value"
                disabled={disabled}
                value={draft}
                onChange={(event) =>
                  commit(literalBooleanChange(event.target.value, path), onChange, onLiteralDraft)
                }
              >
                <option value="true">true</option>
                <option value="false">false</option>
              </select>
            ) : (
              <input
                id={props.id + '-value'}
                aria-label="Literal value"
                disabled={disabled}
                value={draft}
                onChange={(event) => {
                  setDraft(event.target.value);
                  commit(
                    literalTextChange(kindDraft, event.target.value, path),
                    onChange,
                    onLiteralDraft,
                  );
                }}
              />
            )}
          </div>
        )}
      />
    );
  }

  return ExpressionEditor;
}

/** The literal editor's inputs: the committed value, its retained draft, and where it sits. */
interface LiteralEditorProps {
  readonly value: LiteralValue;
  readonly raw: LiteralDraft | null;
  readonly path: ExpressionPath;
  readonly disabled: boolean;
  readonly onChange: ExpressionEditorProps['onChange'];
  readonly onLiteralDraft: ExpressionEditorProps['onLiteralDraft'];
}

/** Sends a checked select choice at its path; an unlisted value (null) does nothing. */
function sendChoice(
  next: TypeExpression | null,
  path: ExpressionPath,
  onChange: ExpressionEditorProps['onChange'],
): void {
  if (next !== null) onChange(next, path);
}

/** Sends a literal outcome: a parsed value at its path, or unparsed number text as a draft. */
function commit(
  outcome: LiteralCommit,
  onChange: ExpressionEditorProps['onChange'],
  onLiteralDraft: ExpressionEditorProps['onLiteralDraft'],
): void {
  if (outcome.kind === 'draft') onLiteralDraft(outcome.draft);
  else onChange(outcome.expression, outcome.path);
}

/** An expression kind this editor does not know; typing it `never` makes a new kind a compile error. */
function unavailableExpression(expression: never): ReactElement {
  void expression;
  return <p>Expression unavailable</p>;
}
