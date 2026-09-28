/*
 * Why this file exists
 *
 * `POST /api/v1/export` sends its body as JSON, and anything can arrive. For example, a body with
 * `"format": "pdf"` or `"scale": 9` must be refused before any collection is read.
 *
 * This file checks the body and answers one checked `ExportRequest`, or the first mistake it finds
 * (see `contract/errors.ts`). The shape itself is described in contract/records/export/request.ts.
 * Extra keys are ignored. It never reads the workspace.
 */
import { failure, success, type Result } from '../../contract/errors.js';
import {
  exportRequest,
  exportSelection,
  type ExportRequest,
} from '../../contract/records/export/request.js';

/**
 * Checks an export request body as sent, and answers the checked request.
 * Mistakes, all `invalid-input`: at `export` for a body that isn't an object or names an
 * unsupported collection, format or scope; at `export.scale` for a scale outside 1 to 4.
 */
export function readExportRequest(body: unknown): Result<ExportRequest> {
  if (!isObject(body)) {
    return notAnObjectFailure();
  }
  if (!hasSupportedSelection(body)) {
    return unsupportedSelectionFailure();
  }
  return checkScale(body);
}

/** Whether the body is an object, and not `null`, text or a number. */
function isObject(body: unknown): body is object {
  return typeof body === 'object' && body !== null;
}

/** Whether the body names a collection, format and scope the export supports. */
function hasSupportedSelection(body: object): boolean {
  const selection = exportSelection.safeParse(body);
  return selection.success;
}

/** Checks the scale, the one part still unchecked, and answers the checked request. */
function checkScale(body: object): Result<ExportRequest> {
  const request = exportRequest.safeParse(body);
  if (!request.success) {
    return scaleOutOfRangeFailure();
  }
  return success(request.data);
}

/** Makes the mistake for a body that isn't an object: `invalid-input` at `export`. */
function notAnObjectFailure(): Result<never> {
  return failure('invalid-input', 'export', 'Export request is invalid');
}

/** Makes the mistake for an unsupported collection, format or scope: `invalid-input`. */
function unsupportedSelectionFailure(): Result<never> {
  return failure(
    'invalid-input',
    'export',
    'Export request contains an unsupported identity, format or scope',
  );
}

/** Makes the mistake for a scale outside 1 to 4: `invalid-input` at `export.scale`. */
function scaleOutOfRangeFailure(): Result<never> {
  return failure('invalid-input', 'export.scale', 'Export scale must be between 1 and 4');
}
