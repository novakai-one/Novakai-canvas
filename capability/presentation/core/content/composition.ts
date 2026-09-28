import type { DiagramObject, ContentBlock } from '../../contract/records/input.js';
import type { ContentContext } from '../../contract/records/content-context.js';
import type { LodRole, MeasuredContent } from '../../contract/records/visual.js';
import type { BodySelection } from './node-body.js';
import { measureNodeBody } from './node-body.js';
import { moduleChrome } from './chrome.js';
import { labelContent } from './headings.js';
import { nodeHeading } from './headings.js';
import { measureMedia } from './media.js';
import { measureFigure } from './figures.js';
import { offset, stack } from './text.js';
import { reject } from '../validation/outcomes.js';

/** Local composition returns measured geometry; Layout still owns every global position. */
export interface ComposedNodeContent {
  readonly content: MeasuredContent;
  readonly headerHeight: number;
}

/** Selected canonical blocks retain their identities when a figure moves ahead of the heading. */
interface CompositionRequest {
  readonly object: DiagramObject;
  readonly selection: BodySelection;
  readonly headingGap: number;
  readonly context: ContentContext;
}

type MediaBlock = Extract<ContentBlock, { kind: 'image' | 'icon' | 'figure' }>;

/** The first visible media block is the designated figure; later media remain ordered body content. */
function isMedia(block: ContentBlock): block is MediaBlock {
  return block.kind === 'image' || block.kind === 'icon' || block.kind === 'figure';
}

/** Model normally prevents this rejection; a broken injected reader still cannot erase missing media. */
function requireFigure(request: CompositionRequest): MediaBlock {
  const figure = request.selection.content.find(isMedia);
  if (figure === undefined)
    return reject(
      'invalid-input',
      request.object.id,
      'Media-led composition has no visible figure',
    );
  return figure;
}

/** Remove only the designated figure from visible content; all ports and other blocks survive. */
function bodyWithoutFigure(
  request: CompositionRequest,
  figure: MediaBlock,
): BodySelection {
  return {
    ...request.selection,
    content: request.selection.content.filter((block) => block.id !== figure.id),
  };
}

/** Heading and body reuse the same measurements for stacked and side-by-side arrangements. */
function textColumn(request: CompositionRequest): ComposedNodeContent {
  const heading = tagged(nodeHeading(request.object, request.context), request.object, 'heading');
  const body = labelledBody(request);
  return {
    content: stack([heading, body], request.headingGap),
    headerHeight: heading.height,
  };
}

/** Prominent media uses token-owned figure bands rather than the inline icon size. */
function figureContent(
  figure: MediaBlock,
  context: ContentContext,
): MeasuredContent {
  if (figure.kind === 'figure')
    return measureFigure(figure, context.width, context.style, 'figure');
  return measureMedia(
    figure,
    context.collection,
    context.width,
    context.style,
    context.assets,
    'figure',
  );
}

/** Engineering node roles are assigned before offsets and composition so geometry never becomes policy. */
function tagged(
  content: MeasuredContent,
  object: DiagramObject,
  lodRole: LodRole,
): MeasuredContent {
  if (!['module', 'entity', 'function', 'interface'].includes(object.kind)) return content;
  return {
    ...content,
    primitives: content.primitives.map((primitive) => ({ ...primitive, lodRole })),
  };
}

/** Narrow text columns center under the media band; the infographic idiom is figure-led, not left-hung. */
function centered(
  content: MeasuredContent,
  width: number,
): MeasuredContent {
  const slack = Math.max(0, width - content.width);
  if (slack === 0) return content;
  return { ...offset(content, slack / 2, 0), width };
}
/** Media sits above the heading; engineering title separators follow that complete heading region. */
function mediaAbove(request: CompositionRequest): ComposedNodeContent {
  const figure = requireFigure(request);
  const media = tagged(figureContent(figure, request.context), request.object, 'detail');
  const text = textColumn({ ...request, selection: bodyWithoutFigure(request, figure) });
  return {
    content: stack([media, centered(text.content, media.width)], request.context.style.gap),
    headerHeight: media.height + request.context.style.gap + text.headerHeight,
  };
}

/** Measured columns retain their own anchors and full extents; no CSS wrapping or clipping is introduced. */
function columns(
  media: MeasuredContent,
  text: MeasuredContent,
  gap: number,
): MeasuredContent {
  const right = offset(text, media.width + gap, 0);
  return {
    width: media.width + gap + text.width,
    height: Math.max(media.height, text.height),
    primitives: [...media.primitives, ...right.primitives],
    anchors: [...media.anchors, ...right.anchors],
    outline: [...media.outline, ...text.outline],
  };
}

/** A figure reserves at most half the interior; text can grow the measured node for indivisible atoms. */
function mediaBeside(request: CompositionRequest): ComposedNodeContent {
  const figure = requireFigure(request);
  const context = request.context;
  const width = Math.min(context.style.contentSizing.figureBox[figure.size], context.width / 2);
  const media = tagged(figureContent(figure, { ...context, width }), request.object, 'detail');
  const text = textColumn({
    ...request,
    selection: bodyWithoutFigure(request, figure),
    context: { ...context, width: Math.max(1, context.width - width - context.style.gap) },
  });
  const content = columns(media, text.content, context.style.gap);
  return { content, headerHeight: content.height };
}

/** Closed composition dispatch stays independent of diagram family and asset subject. */
const composers: Readonly<
  Record<DiagramObject['composition'], (request: CompositionRequest) => ComposedNodeContent>
> = {
  stack: textColumn,
  'media-top': mediaAbove,
  'media-left': mediaBeside,
};

/** Compose admitted visible content once. Public project converts failures; Authoring retains its last committed scene. */
export function composeNodeContent(
  object: DiagramObject,
  selection: BodySelection,
  composition: DiagramObject['composition'],
  headingGap: number,
  context: ContentContext,
): ComposedNodeContent {
  return composers[composition]({ object, selection, headingGap, context });
}

/** Optional compartment caption belongs to the chrome policy and is measured with shared pinned fonts. */
function labelledBody(request: CompositionRequest): MeasuredContent {
  const body = tagged(
    measureNodeBody(request.object, request.selection, bodyContext(request)),
    request.object,
    'detail',
  );
  const label = moduleChrome(request.object, request.context)?.sectionLabel;
  if (label === undefined) return body;
  return stack(
    [tagged(labelContent(label, request.context, 'annotation'), request.object, 'detail'), body],
    request.context.style.gap,
  );
}

/** Module chrome uses resolved secondary ink; heading foreground and shared body measurement remain independent. */
function bodyContext(request: CompositionRequest): ContentContext {
  if (moduleChrome(request.object, request.context) === undefined) return request.context;
  return {
    ...request.context,
    style: { ...request.context.style, text: request.context.style.secondary },
  };
}
