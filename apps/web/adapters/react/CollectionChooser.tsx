import type { ComponentType, ReactElement } from 'react';
import { formatFailure } from '../../contract/api.js';
import type { CollectionChooserProps, DesignSlots } from '../../contract/react-types.js';
import type { LibraryBrowserProps } from '../../contract/library-react.js';
import styles from './CollectionChooser.module.css';

/** The chooser owns presentation and recovery actions; navigation and admission remain controller-owned. */
export function createCollectionChooser({
  Dialog,
  Button,
  Browser,
}: Pick<DesignSlots, 'Dialog' | 'Button'> & {
  readonly Browser: ComponentType<LibraryBrowserProps>;
}): ComponentType<CollectionChooserProps> {
  function CollectionChooser({
    controller,
    view,
    onCreate,
    portal,
  }: CollectionChooserProps): ReactElement {
    const selection = view.collectionSwitch;
    const open = selection.phase !== 'idle';

    return (
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) controller.cancelCollectionSwitch();
        }}
        title="Choose a collection"
        description="Switch collections while keeping your current canvas available until the new one is ready."
        portal={portal}
        placement={chooserPlacement(portal)}
      >
        <ChooserBody
          controller={controller}
          view={view}
          onCreate={onCreate}
          Button={Button}
          Browser={Browser}
        />
      </Dialog>
    );
  }
  return CollectionChooser;
}

/** Small viewports use the Design System sheet token so the chooser actions stay reachable. */
function chooserPlacement(portal: HTMLElement): 'center' | 'bottom' {
  const window = portal.ownerDocument.defaultView;
  const breakpoint = Number.parseFloat(
    window?.getComputedStyle(portal).getPropertyValue('--nv-breakpoint-medium') ?? '',
  );
  return window !== null && Number.isFinite(breakpoint) && window.innerWidth < breakpoint
    ? 'bottom'
    : 'center';
}

function ChooserBody({
  controller,
  view,
  onCreate,
  Button,
  Browser,
}: Pick<CollectionChooserProps, 'controller' | 'view' | 'onCreate'> & {
  readonly Button: DesignSlots['Button'];
  readonly Browser: ComponentType<LibraryBrowserProps>;
}): ReactElement {
  const selection = view.collectionSwitch;
  if (selection.phase === 'failed')
    return (
      <FailureState
        title={collectionTitle(view, selection.targetId)}
        activeTitle={view.active?.document.collection.title}
        problem={selection.problem}
        onReturn={controller.cancelCollectionSwitch}
        onRetry={controller.retryCollectionSwitch}
        onChoose={controller.beginCollectionSwitch}
        Button={Button}
      />
    );
  const pendingId = selection.phase === 'loading' ? selection.targetId : null;
  return (
    <div className={styles.content}>
      {selection.phase === 'loading' && (
        <p className={styles.pending} role="status" aria-live="polite">
          Opening {collectionTitle(view, selection.targetId)}… Your current canvas remains open.
        </p>
      )}
      <Browser
        controller={controller}
        view={view}
        className={styles.browser ?? ''}
        onSelect={controller.chooseCollection}
        currentId={selection.activeId}
        pendingId={pendingId}
      />
      <div className={styles.actions}>
        <Button label="Return to canvas" onClick={controller.cancelCollectionSwitch} />
        <Button label="New collection" variant="primary" onClick={onCreate} />
      </div>
    </div>
  );
}

function FailureState({
  title,
  activeTitle,
  problem,
  onReturn,
  onRetry,
  onChoose,
  Button,
}: {
  readonly title: string;
  readonly activeTitle: string | undefined;
  readonly problem: NonNullable<CollectionChooserProps['view']['problem']>;
  readonly onReturn: () => void;
  readonly onRetry: () => void;
  readonly onChoose: () => void;
  readonly Button: DesignSlots['Button'];
}): ReactElement {
  const details = formatFailure(problem).join(' · ');
  return (
    <section className={styles.failure} aria-labelledby="collection-chooser-failure">
      <h2 id="collection-chooser-failure">Could not open {title}</h2>
      <p className={styles.error}>{problem.message}</p>
      {activeTitle && <p role="status">{activeTitle} is still open.</p>}
      <details>
        <summary>Technical details</summary>
        <code>{details}</code>
      </details>
      <div className={styles.actions}>
        <Button label="Return to canvas" onClick={onReturn} />
        <Button label="Try again" variant="primary" onClick={onRetry} />
        <Button label="Choose another collection" onClick={onChoose} />
      </div>
    </section>
  );
}

function collectionTitle(
  view: CollectionChooserProps['view'],
  id: string,
): string {
  return view.collections.find((item) => item.id === id)?.title ?? 'this collection';
}
