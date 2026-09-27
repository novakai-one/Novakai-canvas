/*
 * The capability schemas service rules parse with. Core cannot import a capability package, so
 * the schemas it needs are re-exported here unchanged; each owner keeps its grammar and its
 * failure codes. Pure declarations: a rejected parse is the caller's to report.
 */
import { z } from 'zod';

/** Authoring's request, proposal and receipt records and its identity brands. */
export {
  requestSchema,
  proposalSchema,
  receiptSchema,
  plannerId,
  recordId,
  actorId,
  workspaceId,
  timestamp,
  digest as authoringDigest,
} from '@novakai/canvas-authoring';

/** Model's collection, section and object IDs. */
export { collectionId, sectionId, objectId } from '@novakai/canvas-model';

/** Templates' preset ID, preset version and bare preset digest. */
export {
  presetId,
  version as presetVersion,
  digest as presetDigest,
} from '@novakai/canvas-templates';

/** Assets' bare content digest. */
export { digest as assetDigest } from '@novakai/canvas-assets';

/** Presentation's font, asset and resolved style records. */
export { fontSource, fontSet, visualAsset, resolvedStyle } from '@novakai/canvas-presentation';

/** Layout's options record. */
export { options as layoutOptions } from '@novakai/canvas-layout';

/** Design System's chrome name. */
export { chromeName } from '@novakai/canvas-design-system';

/** Any JSON value. */
export const json = z.json();
