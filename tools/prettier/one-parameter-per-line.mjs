// Prettier plugin: a function declaration, method, constructor or interface method with two or
// more parameters prints one parameter per line. Prettier has no option for this, so the plugin
// wraps Prettier's own estree printer. Callbacks and arrow functions keep Prettier's layout.
import * as estree from 'prettier/plugins/estree';
import { doc } from 'prettier';

const { breakParent } = doc.builders;
const base = estree.printers.estree;

/** Node types whose parameters are split one per line. */
const declarations = new Set([
  'FunctionDeclaration',
  'TSDeclareFunction',
  'FunctionExpression',
  'TSDeclareMethod',
  'TSMethodSignature',
  'TSAbstractMethodDefinition',
]);

export const printers = {
  estree: {
    ...base,
    print(path, options, print, args) {
      const printed = base.print(path, options, print, args);
      return isSplitParameter(path) ? [printed, breakParent] : printed;
    },
  },
};

/** Whether the node being printed is one parameter of a declaration that has two or more. */
function isSplitParameter(path) {
  return isParameterKey(path.key) && isDeclaration(path) && parameterCount(path.parent) >= 2;
}

/** Whether the node sits in a parameter list. */
function isParameterKey(key) {
  return key === 'params' || key === 'parameters';
}

/** Whether the parent is a declaration; a function expression counts only as a method's body. */
function isDeclaration(path) {
  const type = path.parent.type;
  return declarations.has(type) && (type !== 'FunctionExpression' || isMethodValue(path));
}

/** Whether a function expression is a class method's value. */
function isMethodValue(path) {
  return path.grandparent?.type === 'MethodDefinition';
}

/** How many parameters the declaration has. */
function parameterCount(node) {
  return (node.params ?? node.parameters).length;
}
