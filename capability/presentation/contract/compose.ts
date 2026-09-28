import { moduleEnvelopes } from '../core/projection/module-envelopes.js';
import type { Projection } from './records/visual.js';
import type { ResolvedStyle } from './records/style.js';
import type { Dependencies, Presentation } from './types.js';
import type {
  ReactBindings,
  StaticRenderer,
  NodeChromeRegistry,
  NodeRenderClasses,
} from './react-types.js';
import type { Result } from './errors.js';
import { fail } from './errors.js';
import { chromeName, sectionLabel } from './records/chrome.js';
import { fontSet } from './records/style.js';
import type { FontSet } from './records/style.js';
import { createPresentation } from './api.js';
import { folderPath } from '../core/notation/chrome.js';
import { markerDrawing } from '../core/notation/markers.js';
import { protect, parse, requireValue } from '../core/validation/outcomes.js';
export type Owners = Pick<Dependencies, 'domain' | 'themes' | 'assets'>;
export interface ComposedPresentation {
  readonly presentation: Presentation;
  readonly react: ReactBindings;
}
/** Shared SVG bindings load without Node/fontkit; caller restores rejected font resources before mounting. */
export async function createReactBindings(
  fonts: unknown,
  chromes?: NodeChromeRegistry,
): Promise<Result<ReactBindings>> {
  try {
    const pinned = parse(fontSet, fonts);
    return { ok: true, value: await bindReact(pinned, chromes) };
  } catch {
    return fail('missing-resource', 'fonts', 'Presentation React bindings could not be loaded');
  }
}
/** Browser composition is the sole owner of Presentation stylesheet loading. */
export async function createBrowserReactBindings(
  fonts: unknown,
  chromes?: NodeChromeRegistry,
): Promise<Result<ReactBindings>> {
  try {
    const pinned = parse(fontSet, fonts);
    const styles = await import('../adapters/browser/node-styles.js');
    return { ok: true, value: await bindReact(pinned, chromes, styles.nodeRenderClasses) };
  } catch {
    return fail('missing-resource', 'styles', 'Presentation browser bindings could not be loaded');
  }
}
/** Resolve concrete React adapters once; render operations share the exact same pinned font definitions. */
async function bindReact(
  pinned: FontSet,
  injected?: NodeChromeRegistry,
  classes?: NodeRenderClasses,
): Promise<ReactBindings> {
  const [content, nodes, card, folder, accent] = await reactModules();
  const chromes: NodeChromeRegistry = injected ?? {
    card: { Component: card.CardChrome, showKind: true },
    [chromeName.parse('folder-tab')]: {
      Component: folder.createFolderTabChrome(folderPath),
      showKind: false,
      separateHeading: true,
    },
    [chromeName.parse('accent-stripe')]: {
      Component: accent.AccentStripeChrome,
      showKind: false,
      separateHeading: true,
      sectionLabel: sectionLabel.parse('EXPORTS'),
    },
  };
  const slots = { ContentBlocks: content.ContentBlocks, chromes, classes };
  return {
    chromePolicies: Object.fromEntries(
      Object.entries(chromes)
        .filter(([name]) => name !== 'card')
        .map(([name, chrome]) => [
          chromeName.parse(name),
          { showKind: chrome.showKind, sectionLabel: chrome.sectionLabel },
        ]),
    ),
    NodeContent: nodes.createContentRenderer(pinned, slots),
    MeasuredContent: nodes.createMeasuredRenderer(pinned, slots),
    Marker: nodes.createMarkerRenderer(markerDrawing),
    fonts: pinned,
    FontDefinitions: nodes.createFontDefinitions(pinned),
  };
}
/** Native measurement is loaded only by service/worker composition; host retains prior session if initialization fails. */
export async function composePresentation(
  owners: Owners,
  fonts: unknown,
  nativeRender?: StaticRenderer,
  chromes?: NodeChromeRegistry,
): Promise<Result<ComposedPresentation>> {
  try {
    const [metrics, markup] = await nativeModules();
    const react = requireValue(await createReactBindings(fonts, chromes));
    return protect(() => {
      const measurement = requireValue(metrics.createFontMetrics(react.fonts));
      const renderer = markup.createMarkupRenderer(react, nativeRender);
      return {
        presentation: createPresentation({
          ...owners,
          chromePolicies: react.chromePolicies,
          measurement,
          renderer,
        }),
        react,
      };
    });
  } catch {
    return fail(
      'provider-failed',
      'composition',
      'Native Presentation dependencies could not be loaded',
    );
  }
}

/** Import immutable renderer code separately from font binding and diagram measurement. */
function reactModules() {
  return Promise.all([
    import('../adapters/react/ContentBlocks.js'),
    import('../adapters/react/NodeContent.js'),
    import('../adapters/react/CardChrome.js'),
    import('../adapters/react/FolderTabChrome.js'),
    import('../adapters/react/AccentStripeChrome.js'),
  ]);
}
/** Service-only providers stay behind explicit native preparation; browser imports remain portable. */
function nativeModules() {
  return Promise.all([import('../adapters/fontkit.js'), import('../adapters/static-markup.js')]);
}
/** Worker readiness includes provider code loading, without parsing fonts or deriving any diagram geometry. */
export async function prepareNativePresentation(): Promise<Result<void>> {
  try {
    await Promise.all([nativeModules(), reactModules()]);
    return { ok: true, value: undefined };
  } catch {
    return fail(
      'provider-failed',
      'composition',
      'Native Presentation dependencies could not be loaded',
    );
  }
}

/** Recalculate owner envelopes after placement edits using already measured content; no fonts or routing run. */
export function remeasureModuleEnvelopes(
  projection: Projection,
  style: ResolvedStyle,
): Projection {
  return {
    ...projection,
    sections: projection.sections.map((section) => moduleEnvelopes(section, { style })),
  };
}
