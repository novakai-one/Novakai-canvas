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
import { failure, type Result } from '../../contract/errors.js';
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
  if (typeof body !== 'object' || body === null)
    return failure('invalid-input', 'export', 'Export request is invalid');
  return selectedRequest(body);
}

/** An unsupported identity, format or scope refuses the whole request. */
function selectedRequest(input: object): Result<ExportRequest> {
  if (!exportSelection.safeParse(input).success)
    return failure(
      'invalid-input',
      'export',
      'Export request contains an unsupported identity, format or scope',
    );
  return scaledRequest(input);
}

/** With the selection accepted, only the scale can still refuse the request. */
function scaledRequest(input: object): Result<ExportRequest> {
  const request = exportRequest.safeParse(input);
  if (!request.success)
    return failure('invalid-input', 'export.scale', 'Export scale must be between 1 and 4');
  return { ok: true, value: request.data };
}
