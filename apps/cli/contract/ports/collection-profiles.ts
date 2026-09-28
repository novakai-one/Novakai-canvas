/*
 * Why this file exists
 *
 * The `profile` commands help an agent write a collection that follows a profile, such as
 * `build-spec@1`. `profile scaffold build-spec@1 --id my-spec --title "My spec"` prints a starter
 * source to fill in. Language owns the profiles and does that work.
 *
 * This file names the three things the profile commands ask Language for: describe a profile,
 * start a source from it, and check a source against it. None touches a file or returns an error;
 * `lint` reports whether the source passed.
 */
import type { ProfileId } from '../brands.js';
import type {
  ParsedSource,
  ProfileDescriptor,
  ProfileLintResult,
  ProfileStarter,
} from '../records/foreign.js';

/** What Language does for the `profile` commands. */
export interface CollectionProfiles {
  /** What the profile asks for: the parts a source must have, and its rules and notes. */
  describe(profile: ProfileId): ProfileDescriptor;

  /** A starter source for the profile, as text, using the starter's collection ID and title. */
  scaffold(
    profile: ProfileId,
    starter: ProfileStarter,
  ): string;

  /**
   * Checks a parsed source against the profile: `passed`, `failed` (with findings), or
   * `unsupported-source` (a patch, not a whole collection, so no rule ran).
   */
  lint(
    profile: ProfileId,
    source: ParsedSource,
  ): ProfileLintResult;
}
