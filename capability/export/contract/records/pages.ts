/*
 * One planned PDF page. Page planning creates the list (PDF only; other formats get an empty
 * list), the PDF encoder draws it, and the finished artifact returns it to the caller.
 */
import type { Box } from '@novakai/canvas-layout';

/**
 * One printed page: which part of which section it shows, and how it is placed on paper.
 * `crop` is in collection (scene) coordinates; `paperWidth`, `paperHeight`, `margin` and
 * `overlap` are in PDF points.
 */
export interface Page {
  /** Position of this page in the whole document, starting at 1. */
  readonly ordinal: number;

  /** ID of the section this page shows. */
  readonly section: string;

  /** The part of the section drawn on this page, in collection coordinates. */
  readonly crop: Box;

  /** Page width in PDF points, after orientation. */
  readonly paperWidth: number;

  /** Page height in PDF points, after orientation. */
  readonly paperHeight: number;

  /** PDF points per collection unit, used to size the drawn crop. */
  readonly scale: number;

  /** Blank border around the drawing and footer, in PDF points. */
  readonly margin: number;

  /**
   * How much of each tile is repeated on the next tile, in PDF points. Page planning already
   * applies it to each `crop`; the PDF encoder does not read it.
   */
  readonly overlap: number;

  /** Footer text: collection title, revision and page number ("n/total"). */
  readonly footer: string;
}
