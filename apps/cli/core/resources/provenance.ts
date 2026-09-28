/*
 * Why this file exists
 *
 * A font or image declaration can say more than where its file is: alt text, a license, and who
 * to credit. `asset @logo image source="./logo.png" alt="Company logo" license="CC-BY-4.0"`.
 * Storing the bytes and render:png both need these, and must read them the same way.
 *
 * This file reads them from one declaration. A declaration with no alt text uses its name
 * instead. Nothing here can fail, and it never reads a file.
 */
import type { ResourceRequest, StageInput } from '../../contract/records/foreign.js';
import type { LocalBytes } from '../../contract/records/staged-resource.js';

/** A declaration's license and attribution. One the declaration leaves out is left out here. */
export interface Credit {
  readonly license?: string;
  readonly attribution?: string;
}

/**
 * Builds what Assets needs to store one font or image: its bytes and type, its alt text, and
 * where it came from (source, license and attribution).
 */
export function buildStageInput(
  declaration: ResourceRequest,
  bytes: LocalBytes,
): StageInput {
  return {
    base64: bytes.base64,
    mediaType: bytes.mediaType,
    alt: chooseAltText(declaration),
    provenance: { source: declaration.source, ...collectCredit(declaration) },
  };
}

/** Chooses a declaration's alt text: its `alt`, or its name (such as `logo`) when it has none. */
export function chooseAltText(declaration: ResourceRequest): string {
  return declaration.alt ?? declaration.alias;
}

/** Collects a declaration's license and attribution, leaving out any it doesn't give. */
export function collectCredit(declaration: ResourceRequest): Credit {
  return { ...licensed(declaration), ...attributed(declaration) };
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
