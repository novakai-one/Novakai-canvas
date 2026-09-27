/*
 * Export request reading: unknown route input becomes one checked request or one refusal.
 * Refusals keep the boundary's three messages in their order: a body that is not an object;
 * then any unsupported identity, format or scope (an array body lands here); then a scale
 * outside 1–4. Extra keys are ignored.
 */
import { failure, type Result } from '../../contract/errors.js';
import {
  exportRequest,
  exportSelection,
  type ExportRequest,
} from '../../contract/records/export/export.js';

/** The checked request, or the first refusal in boundary order. */
export function readExportRequest(input: unknown): Result<ExportRequest> {
  if (typeof input !== 'object' || input === null)
    return failure('invalid-input', 'export', 'Export request is invalid');
  return selectedRequest(input);
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
