/*
 * The Add panel's problem line. The form keeps its own problem unless the error bar already shows
 * the same text, so one failure is never shown twice.
 */
import type { WorkspaceView } from '../../contract/records/workspace.js';
import { failureSummary, plainMessage } from '../output/diagnostics.js';

/** The problem the Add panel shows: null when there is none or the error bar already shows it. */
export function shownProblem(view: Pick<WorkspaceView, 'problem' | 'creation'>): string | null {
  return barShowsSame(view) ? null : view.creation.problem;
}

/** The form keeps its own error unless the error bar already says the same thing. */
function barShowsSame(view: Pick<WorkspaceView, 'problem' | 'creation'>): boolean {
  if (view.problem === null) return false;
  const shown = [failureSummary(view.problem), plainMessage(view.problem.message)];
  return shown.includes(view.creation.problem ?? '');
}
