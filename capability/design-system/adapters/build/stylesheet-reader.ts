import postcss, { type Container, type Document, type Declaration, type AtRule } from 'postcss';
import type { Result } from '../../contract/errors.js';
import type { StylesheetReader, StylesheetSource } from '../../contract/ports/styles.js';
import type { StyleDeclaration } from '../../contract/records/artifacts.js';
/** Parse actual CSS syntax; Design System style gate owns correction, build host owns rerun. */
export function createStylesheetReader(): StylesheetReader {
  return { read };
}
/** No stylesheet is applied here; parse failures return a typed outcome without partial declarations. */
function read(sources: readonly StylesheetSource[]): Result<readonly StyleDeclaration[]> {
  try {
    return { ok: true, value: sources.flatMap(readSource) };
  } catch {
    return {
      ok: false,
      error: {
        code: 'invalid-style',
        path: 'styles',
        targets: [],
        expected: 'valid CSS syntax',
        message: 'Stylesheet could not be parsed',
        recovery: 'Build host retains prior styles/scope; correct CSS and rerun.',
      },
    };
  }
}
/** Preserve selector/state identity and effective ancestor layer for every authored declaration. */
function readSource(source: StylesheetSource): readonly StyleDeclaration[] {
  const root = postcss.parse(source.css, { from: source.file });
  const declarations: StyleDeclaration[] = [];
  root.walkDecls((declaration) => {
    declarations.push(readDeclaration(source.file, declaration));
  });
  root.walkAtRules('import', (rule) => {
    declarations.push(importDeclaration(source.file, rule));
  });
  return declarations;
}
/** A rule's local declarations are not multiplied by generated aliases or selector fragments. */
function readDeclaration(
  file: string,
  declaration: Declaration,
): StyleDeclaration {
  return {
    file,
    selector: selector(declaration.parent),
    layer: layer(declaration.parent),
    property: declaration.prop,
    value: declaration.value,
    important: declaration.important,
  };
}
/** Nested media/support queries retain their containing cascade layer. */
function layer(parent: Container | Document | undefined): string {
  if (!parent) return '';
  const found = ownLayer(parent);
  if (found) return found;
  return layer(parent.parent);
}
/** Read only the declared layer at this ancestor; no unchecked PostCSS downcast. */
function ownLayer(parent: Container | Document): string {
  if (!('name' in parent) || !('params' in parent)) return '';
  return parent.name === 'layer' ? String(parent.params) : '';
}
/** Locate an owning rule selector; documents and media rules delegate to their parent. */
function selector(parent: Container | Document | undefined): string {
  if (!parent) return '';
  if ('selector' in parent) return String(parent.selector);
  return selector(parent.parent);
}
/** Unlayered imports outrank layered controls, so the style gate receives them as explicit policy inputs. */
function importDeclaration(
  file: string,
  rule: AtRule,
): StyleDeclaration {
  const match = /\blayer\(([a-z]+)\)/.exec(rule.params);
  return {
    file,
    selector: '@import',
    layer: match?.[1] ?? '',
    property: '@import',
    value: rule.params,
    important: false,
  };
}
