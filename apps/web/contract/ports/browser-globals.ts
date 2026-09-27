/*
 * Browser globals seam: the page globals the web reads, handed in once by the browser entry
 * (`cli/main.ts`), so `compose.ts` and `compose/workspace.ts` read none themselves. Two reads
 * remain elsewhere in composition: `compose/features.ts` mints content IDs with
 * `crypto.randomUUID()` (plan B3b), and `compose/startup.ts` reads panel sizes with
 * `getComputedStyle`. Declarations only.
 */

/** The page globals composition binds: window parts, draft storage, random text and the clock. */
export interface BrowserGlobals {
  /**
   * Media queries for the environment, the location and history that navigation writes, and the
   * key events and size observer the shell's hooks use.
   */
  readonly window: Pick<
    Window & typeof globalThis,
    | 'matchMedia'
    | 'location'
    | 'history'
    | 'addEventListener'
    | 'removeEventListener'
    | 'ResizeObserver'
  >;
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
