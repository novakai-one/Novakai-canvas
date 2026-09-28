/*
 * The shell's two message bars: the problem bar (the current problem, its technical details and
 * Dismiss) and the status bar (the status line and the connection state). No effects: each bar
 * draws only what it is given; Dismiss is the one intent. The workspace session owns recovery.
 * Composition hands both to the shell as slots. Styles come from the shell's sheet, whose
 * `.alerts > *` rule also rounds the problem bar.
 */
import type { ComponentType, ReactElement } from 'react';
import { failureSummary, formatFailure } from '../../contract/api.js';
import type { DesignSlots, ProblemBarProps, StatusBarProps } from '../../contract/react-types.js';
import styles from './WorkspaceShell.module.css';

/** Builds the problem bar; its Dismiss uses the injected design-system Button. */
export function createProblemBar({
  Button,
}: Pick<DesignSlots, 'Button'>): ComponentType<ProblemBarProps> {
  /** The problem bar: the summary, the technical details and Dismiss; nothing when there is no problem. */
  function ProblemBar({ problem, onDismiss }: ProblemBarProps): ReactElement | null {
    if (problem === null) return null;
    return (
      <div className={styles.problem} role="alert">
        <div className={styles.problemText}>
          <strong>{failureSummary(problem)}</strong>
          <details>
            <summary>Technical details</summary>
            {formatFailure(problem).map((line, index) => (
              <p key={index}>{line}</p>
            ))}
          </details>
        </div>
        <Button label="Dismiss error" icon="×" iconOnly onClick={onDismiss} />
      </div>
    );
  }

  return ProblemBar;
}

/** The status bar: the controller's status line and whether the service is connected. */
export function StatusBar({ view }: StatusBarProps): ReactElement {
  return (
    <footer className={styles.status}>
      <span role="status">{view.status}</span>
      <span>{view.connected ? 'Connected to local workspace' : 'Service disconnected'}</span>
    </footer>
  );
}
