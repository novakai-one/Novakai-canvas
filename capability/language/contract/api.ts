/*
 * Builds the Language service from its Model roles. Each operation runs inside `protect`, which
 * turns any throw into a `validation-failed` result and deep-freezes the successful value.
 * Requests are copied with `structuredClone` before use, so a caller's later changes cannot
 * reach the compiler.
 */
import { expandRecipe } from '../core/lowering/expansion.js';
import type { Language, Dependencies } from './types.js';
import type { Result } from './errors.js';
import type { ParsedSource } from './records/syntax.js';
import type { Description } from './records/vocabulary.js';
import {
  compatibleLayouts,
  compatibleWires,
  memberEndpoints,
  genericMemberEndpoints,
  sourceEndpoints,
  targetEndpoints,
} from '@novakai/canvas-model';
import type {
  LowerRequest,
  LoweredIntent,
  PrintRequest,
  Readout,
  ExpansionRequest,
} from './records/requests.js';
import { accepted, protect } from '../core/validation/outcomes.js';
import { parseSource } from '../core/parsing/document.js';
import { lowerDocument } from '../core/lowering/document.js';
import { lowerPatch } from '../core/patching/compile.js';
import { printCollection } from '../core/printing/document.js';
import { describeLanguage } from '../core/vocabulary/description.js';

/**
 * Collection profiles (build-spec@1): a profile's descriptor, its named starter source and its
 * structural lint over parsed source. Pure; they need no Model role and never throw.
 */
export { describeProfile, lintProfile, scaffoldProfile } from '../core/profiles/catalog.js';

/**
 * Model's own acceptance tables (which layouts and wires fit which sections, and which endpoints
 * are allowed), published by `describe` as Model defines them. Language does not edit them;
 * `describe` returns a structured clone of them.
 */
const policies: Description['policies'] = {
  layouts: compatibleLayouts,
  wires: compatibleWires,
  endpoints: {
    members: memberEndpoints,
    genericMembers: genericMemberEndpoints,
    sources: sourceEndpoints,
    targets: targetEndpoints,
  },
};

/**
 * Creates the Language service. It does no I/O and keeps no state, so an operation retried with
 * the same input gives the same result, as long as Model's policy tables and `deps` also behave
 * the same.
 *
 * - `describe(version = 1)`: the grammar description (constructs, operations, patch targets and
 *   forms, defaults, examples, Model's policies). A version other than 1 fails with
 *   `unsupported-version`.
 * - `parse(source)`: the parsed `canvas 1` document or `patch 1`, its resource requests and
 *   source mappings. A scoped `view` fails with `display-only`.
 * - `lower(request)`: copies the request and parses its source. A `canvas` document is checked
 *   against the mode and snapshot, lowered to a raw record, validated, staged as one
 *   `replace-document` change and planned through Model. A `patch` needs `patch` mode; each
 *   operation is staged through Model in order, then the whole change list is planned.
 * - `print(request)`: copies the request, validates the collection through `deps.reader`, then
 *   prints full source or the requested scoped view.
 * - `expand(request)`: copies the request and compiles the recipe source as a new collection
 *   whose ID is the request's namespace.
 *
 * Every operation returns a deep-frozen value or `validation-failed`; any other throw becomes one
 * `provider-failure` diagnostic.
 */
export function createLanguage(deps: Dependencies): Language {
  /** The grammar description for `version`; see {@link createLanguage}. */
  function describe(version = 1): Result<Description> {
    return protect(() => describeLanguage(version, policies));
  }

  /** The parsed source; nothing is read from files or the network. */
  function parse(source: string): Result<ParsedSource> {
    return protect(() => parseSource(source));
  }

  /** The source compiled against a copy of the request; no partial result on failure. */
  function lower(input: LowerRequest): Result<LoweredIntent> {
    return protect(() => {
      const request = structuredClone(input);
      const parsed = parseSource(request.source);
      if (parsed.kind === 'canvas') return accepted(lowerDocument(parsed, request, deps));
      return lowerPatch(parsed, request, deps);
    });
  }

  /** The collection printed as full source or a scoped view that cannot be applied. */
  function print(input: PrintRequest): Result<Readout> {
    return protect(() => printCollection(structuredClone(input), deps.reader));
  }

  /** The recipe compiled under the request's namespace; Authoring checks that it is unused. */
  function expand(input: ExpansionRequest): Result<LoweredIntent> {
    return protect(() => accepted(expandRecipe(structuredClone(input), deps)));
  }

  return Object.freeze({ describe, parse, lower, print, expand });
}
