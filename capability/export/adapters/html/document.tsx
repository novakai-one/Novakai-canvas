/*
 * HTML export: one self-contained offline reader page. It has no script and loads nothing
 * remote; navigation uses plain links and each section's text is in a native `<details>` list.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';
import type { FormatHandler, RenderInput } from '../../contract/ports/formats.js';
import type { RenderDependencies, PlacedSection } from '../../contract/render-types.js';
import type { Encoding } from '../../contract/ports/encoding.js';
import type { Result } from '../../contract/errors.js';
import { success } from '../../contract/errors.js';
import type { Encoded } from '../../contract/records/artifact.js';

/** What the HTML encoder uses: the shared SVG renderer and UTF-8 encoding. */
type HtmlDependencies = Pick<RenderDependencies, 'renderer'> & {
  readonly encoding: Pick<Encoding, 'utf8'>;
};

/**
 * Creates the HTML format handler.
 *
 * `encode` renders every selected section as its own SVG first, then returns the first failure,
 * if any, unchanged. Otherwise it builds the page: the collection title, the reader CSS inline,
 * a header with the title, "Revision <n>" and a link to each section (`#section-<index>`, the
 * section's position in the selection, so authored IDs never become link syntax), then one
 * `<section>` per selected section with its title, its SVG inserted as markup, and a "Read
 * diagram contents" list: node text, each wire's label text and "<source marker> → <target
 * marker>", and message text. The page starts with `<!doctype html>` and is encoded as UTF-8.
 *
 * The SVG is inserted without escaping. That is safe only because it comes from the shared
 * renderer, which has already escaped all authored content.
 *
 * @param deps - The shared SVG renderer and `encoding.utf8`.
 * @param css - The reader stylesheet.
 * @returns The handler. `encode` rejects only if the renderer, React serialization,
 * `encoding.utf8` or a getter on the input throws; Export's `produce` turns that into
 * `encoding-failed`.
 * @throws Never.
 */
export function createHtmlEncoder(
  deps: HtmlDependencies,
  css: string,
): FormatHandler {
  /** Renders every section, then builds and encodes the page; see {@link createHtmlEncoder}. */
  async function encode(input: RenderInput): Promise<Result<Encoded>> {
    const rendered = input.selection.sections.map(
      /** Renders one section. */ (section) => renderSection(section, input),
    );
    const failed = rendered.find(/** Whether the section failed to render. */ (item) => !item.ok);
    if (failed && !failed.ok) return failed;
    const sections = rendered.flatMap(
      /** The rendered section element; nothing for a failure. */ (item) =>
        item.ok ? [item.value] : [],
    );
    const markup = renderToStaticMarkup(
      <html lang="en">
        <head>
          <meta charSet="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>{input.snapshot.identity.title}</title>
          <style>{css}</style>
        </head>
        <body>
          <header>
            <h1>{input.snapshot.identity.title}</h1>
            <p>{`Revision ${input.snapshot.identity.revision}`}</p>
            <nav aria-label="Sections">
              {input.selection.sections.map(
                /** The navigation link to one section. */ (section, index) => (
                  <a key={section.id} href={`#${sectionAnchor(index)}`}>
                    {sectionTitle(section)}
                  </a>
                ),
              )}
            </nav>
          </header>
          <main>{sections}</main>
        </body>
      </html>,
    );
    return success({
      bytes: deps.encoding.utf8(`<!doctype html>${markup}`),
      pages: [],
      warnings: [],
    });
  }

  /**
   * Renders one section's SVG (the selection narrowed to that section and its box), and builds
   * its `<section>` element with the heading, the SVG and the text list. Its anchor is
   * `section-<index>`, where `<index>` is the section's first position in the selection.
   */
  function renderSection(
    section: PlacedSection,
    input: RenderInput,
  ): Result<ReactElement> {
    const result = deps.renderer.render({
      ...input,
      selection: { sections: [section], bounds: section.box },
    });
    if (!result.ok) return result;
    const index = input.selection.sections.indexOf(section);
    const lines = [
      ...section.nodes.flatMap(
        /** The node's text lines. */ (node) => node.measured.content.outline,
      ),
      ...section.wires.flatMap(
        /** The wire's label lines, then its `<source marker> → <target marker>` line. */
        (wire) => [...wire.measuredLabel.outline, `${wire.sourceMarker} → ${wire.targetMarker}`],
      ),
      ...section.sequence.events.flatMap(
        /** The message's text lines. */ (event) => event.content.outline,
      ),
    ];
    return success(
      <section key={section.id} id={sectionAnchor(index)}>
        <h2>{sectionTitle(section)}</h2>
        <div className="diagram" dangerouslySetInnerHTML={{ __html: result.value }} />
        <details>
          <summary>Read diagram contents</summary>
          <ul>
            {lines.map(
              /** One text line as a list item. */ (line, lineIndex) => (
                <li key={lineIndex}>{line}</li>
              ),
            )}
          </ul>
        </details>
      </section>,
    );
  }

  return { encode };
}

/** The anchor ID for the section at `index` in the selection: `section-<index>`. */
function sectionAnchor(index: number): string {
  return `section-${index}`;
}

/** The section title as one line: its outline lines joined with spaces. */
function sectionTitle(section: PlacedSection): string {
  return section.title.content.outline.join(' ');
}
