/*
 * PDF page planning. Each section is cut into tiles that fit the paper; tiles overlap slightly
 * so nothing is lost at a cut. Planning runs before any PDF document exists.
 *
 * Fixed layout, in PDF points unless noted: 24 margin on every side, 18 more at the bottom for
 * the footer (so 48 across and 66 down are not drawable), drawing scale 0.75 points per
 * collection unit, and 16 collection units (12 points) of overlap between neighbouring tiles.
 * The constants below hold these numbers; every derived value is exact in floating point.
 */
import { PDF_PAGE_LIMIT } from '../../contract/records/limits.js';
import type { Page } from '../../contract/records/pages.js';
import type { Selection, Identity, PlacedSection } from '../../contract/records/artifact.js';
import type { ExportRequest } from '../../contract/records/input.js';
import type { Result } from '../../contract/errors.js';
import { failure } from '../../contract/errors.js';
import { success } from '../validation/outcomes.js';

/** Margin on every side of the page, in PDF points. */
const MARGIN = 24;

/** Extra space at the bottom of the page for the footer, in PDF points. */
const FOOTER = 18;

/** PDF points per collection unit. */
const SCALE = 0.75;

/** Overlap between neighbouring tiles, in collection units. */
const OVERLAP = 16;

/** Page width that cannot be drawn on (both side margins): 48 points. */
const UNDRAWABLE_WIDTH = 2 * MARGIN;

/** Page height that cannot be drawn on (both margins and the footer): 66 points. */
const UNDRAWABLE_HEIGHT = 2 * MARGIN + FOOTER;

/** A paper size in PDF points. */
interface Paper {
  /** Width in PDF points. */
  readonly width: number;

  /** Height in PDF points. */
  readonly height: number;
}

/** Portrait paper sizes in PDF points. */
const papers: Readonly<Record<ExportRequest['paper'], Paper>> = {
  A4: { width: 595.276, height: 841.89 },
  Letter: { width: 612, height: 792 },
};

/**
 * Plans the PDF pages for a selection: every section is tiled at a fixed readable scale, then
 * the pages are numbered across the whole document and given their footers.
 *
 * @param selection - The sections to print.
 * @param request - The parsed request (paper and orientation are used).
 * @param identity - The revision; its title and revision go into each footer.
 * @returns The pages, or `limit-exceeded` when more than 512 pages would be needed.
 * @throws Never for plain snapshot data. A throwing getter or proxy in the snapshot propagates;
 * `produce` runs this inside `protect`, which turns it into `encoding-failed`.
 */
export function planPages(
  selection: Selection,
  request: ExportRequest,
  identity: Identity,
): Result<readonly Page[]> {
  const paper = orient(papers[request.paper], request.orientation);
  const pages = selection.sections.flatMap(
    /** The section's pages on the chosen paper. */ (section) => tileSection(section, paper),
  );
  if (pages.length > PDF_PAGE_LIMIT)
    return failure('limit-exceeded', 'pages', 'Print requires more than 512 pages');
  return success(
    pages.map(
      /** The page with its 1-based number and its footer text. */ (page, index) => ({
        ...page,
        ordinal: index + 1,
        footer: `${identity.title} · revision ${identity.revision} · ${index + 1}/${pages.length}`,
      }),
    ),
  );
}

/** Swaps width and height for landscape. Diagram coordinates are not affected. */
function orient(paper: Paper, orientation: ExportRequest['orientation']): Paper {
  if (orientation === 'portrait') return paper;
  return { width: paper.height, height: paper.width };
}

/**
 * Cuts one section's box into a grid of tiles. Each tile covers the drawable area; tiles
 * advance by the tile size minus the 16-unit overlap. When the grid would exceed the page
 * limit, returns one more than the limit of placeholder pages, so the caller's limit check fails
 * without building a huge list.
 */
function tileSection(section: PlacedSection, paper: Paper): readonly Page[] {
  const width = (paper.width - UNDRAWABLE_WIDTH) / SCALE;
  const height = (paper.height - UNDRAWABLE_HEIGHT) / SCALE;
  const columns = Math.max(1, Math.ceil((section.box.width - OVERLAP) / (width - OVERLAP)));
  const rows = Math.max(1, Math.ceil((section.box.height - OVERLAP) / (height - OVERLAP)));
  if (columns * rows > PDF_PAGE_LIMIT)
    return Array.from(
      { length: PDF_PAGE_LIMIT + 1 },
      /** The first tile again; only the count matters, which is over the page limit. */ () =>
        pageAt(section, paper, 0, 0, width, height),
    );
  return Array.from(
    { length: columns * rows },
    /** The page at this column and row. */ (_, index) =>
      pageAt(section, paper, index % columns, Math.floor(index / columns), width, height),
  );
}

/**
 * Builds the page for one tile. Every tile keeps the full crop size, so the last row and column
 * may include empty space past the content. `ordinal` and `footer` are filled in by
 * `planPages`.
 */
function pageAt(
  section: PlacedSection,
  paper: Paper,
  column: number,
  row: number,
  width: number,
  height: number,
): Page {
  return {
    ordinal: 0,
    section: section.id,
    crop: {
      x: section.box.x + column * (width - OVERLAP),
      y: section.box.y + row * (height - OVERLAP),
      width,
      height,
    },
    paperWidth: paper.width,
    paperHeight: paper.height,
    scale: SCALE,
    margin: MARGIN,
    overlap: OVERLAP * SCALE,
    footer: '',
  };
}
