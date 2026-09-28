/*
 * The collection profiles the profile commands answer with: Language's `describeProfile`,
 * `scaffoldProfile` and `lintProfile`. Declaration only; compose binds them in
 * `compose/profiles.ts`. Pure: nothing is read or written, and nothing fails.
 */
import type { ProfileId } from '../brands.js';
import type {
  ParsedSource,
  ProfileDescriptor,
  ProfileLintResult,
  ProfileStarter,
} from '../records/foreign.js';

/** Language's collection profiles. */
export interface CollectionProfiles {
  /** The profile's descriptor: its required slots, appendix rule, conventions and notes. */
  describe(profile: ProfileId): ProfileDescriptor;

  /** The profile's starter source, named with the starter's collection ID and title. */
  scaffold(
    profile: ProfileId,
    starter: ProfileStarter,
  ): string;

  /** The parsed source checked against the profile: `passed`, `failed` or `unsupported-source`. */
  lint(
    profile: ProfileId,
    source: ParsedSource,
  ): ProfileLintResult;
}
