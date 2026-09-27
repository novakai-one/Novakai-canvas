import type { WorkspaceReader } from '../records/workspace/contents.js';
import type { ResourceSelector } from '../records/planning/planning.js';
import type { Assets } from '@novakai/canvas-assets';
/** Candidate validation composes canonical and byte owners; no validator can commit or alter the candidate it inspects. */
export interface AdmissionOwners {
  readonly workspace: WorkspaceReader;
  readonly resources: ResourceSelector;
  readonly assets: Pick<Assets, 'resolve'>;
}
