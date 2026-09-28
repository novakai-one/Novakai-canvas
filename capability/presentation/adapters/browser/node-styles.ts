import type { NodeRenderClasses } from '../../contract/react-types.js';
import styles from '../react/NodeContent.module.css';

/** A missing build-generated class rejects browser composition instead of silently losing treatment. */
function requiredClass(
  name: string,
  value: string | undefined,
): string {
  if (value === undefined) throw new TypeError(`Missing Presentation class ${name}`);
  return value;
}

/** Export one checked browser class map; renderers receive roles without importing CSS. */
export const nodeRenderClasses: NodeRenderClasses = {
  root: requiredClass('root', styles.root),
  frame: requiredClass('frame', styles.frame),
  rim: requiredClass('rim', styles.rim),
  ring: requiredClass('ring', styles.ring),
  header: requiredClass('header', styles.header),
  separator: requiredClass('separator', styles.separator),
  heading: requiredClass('heading', styles.heading),
  body: requiredClass('body', styles.body),
};
