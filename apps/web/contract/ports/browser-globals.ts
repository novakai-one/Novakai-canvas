/*
 * Browser globals seam: the page globals the web reads, handed in once by the browser entry
 * (`cli/main.ts`), so composition reads no global itself. Declarations only.
 */

/** The page globals composition binds: window parts, draft storage, random text and the clock. */
export interface BrowserGlobals {
  /** Media queries for the environment, and the location and history that navigation writes. */
  readonly window: Pick<Window, 'matchMedia' | 'location' | 'history'>;
  /**
   * The page's local storage, where drafts, pending requests and preferences are kept. Reading it
   * throws where the browser blocks storage; `startWeb` reports that as `initialization-failed`.
   */
  readonly storage: () => Storage;
  /** Fresh random text (a UUID) for new IDs. */
  readonly random: () => string;
  /** The current time in epoch milliseconds. */
  readonly now: () => number;
}
