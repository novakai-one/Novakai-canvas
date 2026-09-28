import type { Environment } from '@novakai/canvas-design-system';
/** Capture actual platform preferences at the browser boundary; capability code never reads ambient media queries. */
export function readEnvironment(browser: Pick<Window, 'matchMedia'>): Environment {
  return {
    scheme: browser.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
    pointer: browser.matchMedia('(pointer: coarse)').matches ? 'coarse' : 'fine',
    reducedMotion: browser.matchMedia('(prefers-reduced-motion: reduce)').matches,
    forcedColors: browser.matchMedia('(forced-colors: active)').matches,
  };
}
/** Subscribe to the same platform signals used at startup. Unmount releases every listener. */
export function observeEnvironment(
  browser: Pick<Window, 'matchMedia'>,
  changed: (environment: Environment) => void,
): () => void {
  const queries = [
    '(prefers-color-scheme: dark)',
    '(pointer: coarse)',
    '(prefers-reduced-motion: reduce)',
    '(forced-colors: active)',
  ].map((query) => browser.matchMedia(query));
  const notify = (): void => changed(readEnvironment(browser));
  queries.forEach((query) => query.addEventListener('change', notify));
  return () => queries.forEach((query) => query.removeEventListener('change', notify));
}
