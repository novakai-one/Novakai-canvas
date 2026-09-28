/*
 * Why this file exists
 *
 * A font or image declaration can say more than where its file is: alt text, a license, and who
 * to credit. `asset @logo image source="./logo.png" alt="Company logo" license="CC-BY-4.0"`.
 * Storing the bytes and `pnpm render:png` (which draws a diagram to a PNG) both need these, and
 * must read them the same way.
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

/** A credit with nothing in it, for a part the declaration leaves out. */
const noCredit: Credit = Object.freeze({});

/**
 * Builds what Assets needs to store one font or image: its bytes and type, its alt text, and
 * where it came from (source, license and attribution).
 */
export function buildStageInput(
  declaration: ResourceRequest,
  bytes: LocalBytes,
): StageInput {
  const alt = chooseAltText(declaration);
  const provenance = describeProvenance(declaration);
  return { base64: bytes.base64, mediaType: bytes.mediaType, alt, provenance };
}

/** Chooses a declaration's alt text: its `alt`, or its name (such as `logo`) when it has none. */
export function chooseAltText(declaration: ResourceRequest): string {
  return declaration.alt ?? declaration.alias;
}

/** Collects a declaration's license and attribution, leaving out any it doesn't give. */
export function collectCredit(declaration: ResourceRequest): Credit {
  const licenseCredit = pickLicense(declaration);
  const attributionCredit = pickAttribution(declaration);
  return { ...licenseCredit, ...attributionCredit };
}

/** Says where the bytes came from: the declaration's source, then its license and attribution. */
function describeProvenance(declaration: ResourceRequest): StageInput['provenance'] {
  const credit = collectCredit(declaration);
  return { source: declaration.source, ...credit };
}

/** Picks the declaration's license, or no credit when it names none. */
function pickLicense(declaration: ResourceRequest): Credit {
  if (declaration.license === undefined) {
    return noCredit;
  }
  return { license: declaration.license };
}

/** Picks the declaration's attribution, or no credit when it names none. */
function pickAttribution(declaration: ResourceRequest): Credit {
  if (declaration.attribution === undefined) {
    return noCredit;
  }
  return { attribution: declaration.attribution };
}
