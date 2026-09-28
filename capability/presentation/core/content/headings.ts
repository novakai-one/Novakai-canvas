import type { DiagramObject } from '../../contract/records/input.js';
import type { DiagramTypography } from '../../contract/records/style.js';
import type { MeasuredContent } from '../../contract/records/visual.js';
import type { ContentContext } from '../../contract/records/content-context.js';
import { moduleChrome } from './chrome.js';
import { measureText, stack } from './text.js';
/** Measure a semantic text role; public project owns provider failure and retains the prior scene. */
export function labelContent(
  text: string,
  context: ContentContext,
  role: keyof DiagramTypography = 'body',
): MeasuredContent {
  return measureText(
    {
      text,
      width: context.width,
      ...context.style.typography[role],
      fill: context.style.text,
    },
    context.metrics,
  );
}

/** Kind labels express domain identity independently of chosen frame, role or media composition. */
const engineeringKinds: Readonly<Partial<Record<DiagramObject['kind'], string>>> = {
  entity: 'ENTITY',
  interface: 'INTERFACE',
  function: 'FUNCTION',
};
/** Measure kind and title together so body separators and member anchors start below both. Public project owns failure; Authoring retains the prior scene. */
export function nodeHeading(
  object: DiagramObject,
  context: ContentContext,
): MeasuredContent {
  const title = labelContent(displayHeading(object), context, 'nodeHeading');
  const kind = kindLabel(object, context);
  if (kind === undefined) return title;
  const category = labelContent(kind, context, 'annotation');
  return stack([category, title], context.style.gap / 2);
}

/** Module filenames keep their canonical identity while the display heading drops terminal TypeScript noise. */
function displayHeading(object: DiagramObject): string {
  if (object.kind !== 'module') return object.label;
  return object.label.endsWith('.ts') ? object.label.slice(0, -3) : object.label;
}

/** Chrome policy controls the kicker before measurement, preserving accurate header bounds. */
function kindLabel(
  object: DiagramObject,
  context: ContentContext,
): DiagramObject['label'] | undefined {
  if (moduleChrome(object, context)?.showKind === false) return undefined;
  return engineeringKinds[object.kind];
}
