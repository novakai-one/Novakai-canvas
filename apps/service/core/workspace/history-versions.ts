import type { Snapshot } from '../../contract/records/owners.js';
/** The browser needs history versions, not history contents (which grow with every edit). */
export function historyVersionsOnly(snapshot: Snapshot): Snapshot {
  return {
    ...snapshot,
    records: snapshot.records.map((record) =>
      record.key.kind === 'history' && record.key.id !== 'navigation'
        ? { ...record, value: null }
        : record,
    ),
  };
}
