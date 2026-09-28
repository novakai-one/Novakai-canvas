/*
 * The collection profiles Language knows, by ID: each profile's descriptor, its starter source and
 * its structural lint. Pure; nothing is read or written. The host checks the profile ID against
 * `profileIds`, writes the starter, and prints the descriptor and the findings.
 */
import type { ParsedSource } from '../../contract/records/syntax.js';
import type {
  ProfileDescriptor,
  ProfileId,
  ProfileLintResult,
  ProfileStarter,
} from '../../contract/records/profiles.js';
import { buildSpecProfile } from './build-spec/descriptor.js';
import { scaffoldBuildSpec } from './build-spec/starter.js';
import { lintBuildSpec } from './lint/lint.js';

/** One collection profile: its descriptor, how its starter is named, and its lint. */
interface CollectionProfile {
  readonly descriptor: ProfileDescriptor;
  readonly scaffold: (starter: ProfileStarter) => string;
  readonly lint: (source: ParsedSource) => ProfileLintResult;
}

/** Every profile Language knows, by ID. */
const profiles: Readonly<Record<ProfileId, CollectionProfile>> = Object.freeze({
  'build-spec@1': Object.freeze({
    descriptor: buildSpecProfile,
    scaffold: scaffoldBuildSpec,
    lint: lintBuildSpec,
  }),
});

/** The profile's frozen descriptor: its required slots, appendix rule, conventions and notes. */
export function describeProfile(profile: ProfileId): ProfileDescriptor {
  return profiles[profile].descriptor;
}

/** The profile's starter source, named with the starter's collection ID and title. */
export function scaffoldProfile(
  profile: ProfileId,
  starter: ProfileStarter,
): string {
  return profiles[profile].scaffold(starter);
}

/**
 * Parsed source checked against the profile's structure. `unsupported-source` when the source is
 * a patch, not a full canvas document; otherwise `passed`, or `failed` with every finding.
 */
export function lintProfile(
  profile: ProfileId,
  source: ParsedSource,
): ProfileLintResult {
  return profiles[profile].lint(source);
}
