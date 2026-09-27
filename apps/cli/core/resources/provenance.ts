/*
 * What a font or image declaration says about its bytes: alt text, source, license and
 * attribution. Pure. Staging turns it into the Assets stage input; render:png copies the alt text
 * and credit into the Model asset record. Nothing can fail here.
 */
import type { ResourceRequest, StageInput } from '../../contract/records/foreign.js';
import type { LocalBytes } from '../../contract/records/staged-resource.js';

/** A declaration's license and attribution; a field it does not write is absent. */
export interface Credit {
  readonly license?: string;
  readonly attribution?: string;
}

/** The Assets stage input for a declaration's local bytes: alt text, then where the bytes came from. */
export function stageInput(
  request: ResourceRequest,
  bytes: LocalBytes,
): StageInput {
  return {
    base64: bytes.base64,
    mediaType: bytes.mediaType,
    alt: altText(request),
    provenance: { source: request.source, ...credit(request) },
  };
}

/** The declaration's alt text; its alias when it writes none. */
export function altText(request: ResourceRequest): string {
  return request.alt ?? request.alias;
}

/** The declaration's license and attribution, present ones only. */
export function credit(request: ResourceRequest): Credit {
  return { ...licensed(request), ...attributed(request) };
}

/** The declaration's license, or nothing when it names none. */
function licensed(request: ResourceRequest): Credit {
  if (request.license === undefined) return {};
  return { license: request.license };
}

/** The declaration's attribution, or nothing when it names none. */
function attributed(request: ResourceRequest): Credit {
  if (request.attribution === undefined) return {};
  return { attribution: request.attribution };
}
