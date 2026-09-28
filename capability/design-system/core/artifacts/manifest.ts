import type { ArtifactSet } from '../../contract/records/artifacts.js';
import type { Identity } from '../../contract/ports/identity.js';
import { artifactSet } from '../../contract/records/artifact-schema.js';
import { parsed } from '../validation/input.js';
import { accepted, reject } from '../validation/outcomes.js';
import { canonical } from '../validation/canonical.js';
/** Validate every byte/path/hash before publication; filesystem adapter owns atomic activation/recovery. */
export function validateArtifacts(
  input: unknown,
  identity: Identity,
): ArtifactSet {
  const artifacts = parsed(artifactSet, input, 'artifacts');
  if (new Set(artifacts.files.map((file) => file.path)).size !== 7)
    return reject(
      'unsafe-artifact',
      'files',
      'all seven unique outputs',
      'Incomplete artifact set',
    );
  artifacts.files.forEach((file) => {
    if (accepted(identity.hash(file.content)) !== file.hash)
      reject('unsafe-artifact', file.path, 'matching hash', 'Artifact bytes differ');
  });
  const files = artifacts.files.map((file) => ({ path: file.path, hash: file.hash }));
  const expected = accepted(identity.hash(canonical({ version: artifacts.version, files })));
  const manifest = { generation: expected, version: artifacts.version, files };
  if (artifacts.digest !== expected || canonical(artifacts.manifest) !== canonical(manifest))
    return reject(
      'unsafe-artifact',
      'manifest',
      'matching complete generation',
      'Manifest differs',
    );
  return artifacts;
}
