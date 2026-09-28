/*
 * Why this file exists
 *
 * Service rules often check a value with a capability's own schema. For example, a route checks
 * that `my-diagram` in `?id=my-diagram` is a valid collection ID with Model's `collectionId`. But
 * service core may not import a capability package.
 *
 * So this file passes those schemas through unchanged, and core imports them from here. Where
 * several capabilities call theirs `digest`, each is renamed after its owner (`assetDigest`). It
 * adds one schema of its own, `json`. Each capability keeps its own rules and mistakes.
 */
import { z } from 'zod';

/** Authoring's request, proposal and receipt records and its ID checks. */
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

/** Model's collection, section and object ID checks. */
export { collectionId, sectionId, objectId } from '@novakai/canvas-model';

/** Templates' preset ID, preset version and bare preset digest checks. */
export {
  presetId,
  version as presetVersion,
  digest as presetDigest,
} from '@novakai/canvas-templates';

/** Assets' bare file digest check. */
export { digest as assetDigest } from '@novakai/canvas-assets';

/** Presentation's font, image and resolved style records. */
export { fontSource, fontSet, visualAsset, resolvedStyle } from '@novakai/canvas-presentation';

/** Layout's options record. */
export { options as layoutOptions } from '@novakai/canvas-layout';

/** Design System's check for a chrome name: the frame style drawn around a node, such as `card`. */
export { chromeName } from '@novakai/canvas-design-system';

/** Checks any JSON value. */
export const json = z.json();
