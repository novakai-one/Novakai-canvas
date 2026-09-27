import { loadBrowserStyles } from '@novakai/canvas-design-system';
/** The browser owns its mount target. Failure is visible before React exists and never implies diagram data was lost. */
async function main(): Promise<void> {
  const element = document.getElementById('app');
  if (element === null) return;
  await loadBrowserStyles();
  const { startWeb } = await import('../contract/index.js');
  const started = await startWeb(element, {
    window,
    storage: () => localStorage,
    random: () => crypto.randomUUID(),
    now: () => Date.now(),
  });
  if (!started.ok) element.textContent = `${started.error.message}. ${started.error.recovery}`;
}
void main().catch(() => {
  document.body.textContent = 'Canvas failed to start. Reload the local workspace to reconnect.';
});
