/*
 * Validating one complete Library snapshot: its shape, then the rules across records. Writes
 * nothing; the caller corrects the input, and Authoring owns admission, commit and recovery.
 */
import { snapshotSchema, type LibrarySnapshot } from '../../contract/records/snapshot.js';
import type { LibraryResult } from '../../contract/errors.js';
import { parse, protect, success, rejected } from '../shared/outcomes.js';
import { validateRecords } from './rules.js';

/**
 * Validates one complete Library snapshot.
 *
 * Steps: parse the snapshot's shape (defaults filled in; every schema issue reported), then check
 * the rules across records (see `validateRecords`): unique IDs, existing references, no folder
 * cycles, and exactly one organisation entry per collection. All rule violations are reported together.
 *
 * Returns a detached, frozen copy of the snapshot. Writes nothing and reads no clock. A throw
 * while reading the input becomes an `invalid-input` failure.
 */
export function validateLibrarySnapshot(input: unknown): LibraryResult<LibrarySnapshot> {
  return protect(() => validateInput(input));
}

/** Parses the snapshot, then checks the rules across records on the parsed copy. */
function validateInput(input: unknown): LibraryResult<LibrarySnapshot> {
  const parsed = parse(snapshotSchema(), input);
  if (!parsed.ok) {
    return parsed;
  }
  const diagnostics = validateRecords(parsed.value);
  if (diagnostics.length > 0) {
    return rejected(diagnostics);
  }
  return success(parsed.value);
}
