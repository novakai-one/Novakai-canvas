import type { FunctionComponent, ReactElement } from 'react';
import type { DesignSlots } from '../../contract/react-types.js';
import type { LibraryFeatureProps } from '../../contract/library-react.js';
import styles from './Navigation.module.css';
/** Results require navigation and pagination only, not the full workspace or editor commands. */
interface LibraryResultsProps {
  readonly state: LibraryFeatureProps['state'];
  readonly library: Pick<LibraryFeatureProps['library'], 'next'>;
  readonly workspace: Pick<LibraryFeatureProps['workspace'], 'open'>;
  readonly onSelect?: LibraryFeatureProps['onSelect'];
  readonly currentId?: LibraryFeatureProps['currentId'];
  readonly pendingId?: LibraryFeatureProps['pendingId'];
}
/** Search results expose their scope; selection opens its collection. LibraryBrowser reports failures; reload retries discovery without changing stored diagrams. */
export function createLibraryResults({
  Button,
}: Pick<DesignSlots, 'Button'>): FunctionComponent<LibraryResultsProps> {
  /** Exact Library pagination tokens stay inside the controller. */
  function LibraryResults({
    library,
    state,
    workspace,
    onSelect,
    currentId = null,
    pendingId = null,
  }: LibraryResultsProps): ReactElement {
    const page = state.page;
    if (page === null) return unavailable(state.problem);
    return (
      <div>
        <p role="status">{page.total} collections</p>
        <ul className={styles.list}>
          {page.hits.map((hit) => (
            <li key={JSON.stringify([hit.collection, hit.kind, hit.id])}>
              <button
                type="button"
                className={styles.row}
                aria-current={hit.collection === currentId ? 'page' : undefined}
                aria-busy={hit.collection === pendingId}
                onClick={() => {
                  if (onSelect) onSelect(hit.collection);
                  else void workspace.open(hit.collection);
                }}
              >
                <strong>{hit.label}</strong>
                <small>
                  {hit.kind} ·{' '}
                  {state.source?.collections.find((item) => item.id === hit.collection)?.title}
                </small>
                {hit.collection === currentId && <span>Current</span>}
                {hit.collection === pendingId && <span>Opening…</span>}
              </button>
            </li>
          ))}
        </ul>
        {page.hits.length === 0 && (
          <p>No matching items. Try a broader query or include archived collections.</p>
        )}
        {page.nextCursor && <Button label="Next results" onClick={library.next} />}
      </div>
    );
  }
  return LibraryResults;
}

/** The enclosing browser displays structured errors; this slot distinguishes failed loading from pending work. Reload owns recovery. */
function unavailable(problem: LibraryResultsProps['state']['problem']): ReactElement {
  if (problem !== null)
    return <p>Library could not be loaded. See the error above; reload to try again.</p>;
  return <p>Library is loading…</p>;
}
