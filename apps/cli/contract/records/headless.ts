/*
 * The headless render's request, report and failure records, plus nativeFault: the constructor that
 * turns a thrown native error into `provider-failed` evidence. All pure. The render adapters catch
 * their own native throws and call nativeFault.
 */
import { z } from 'zod';
import type { CliFailure } from '../errors.js';
import type { FailureSource } from './foreign.js';
import {
  collectionName,
  filePath,
  themeName,
  type FilePath,
  type PresetDigest,
  type PresetId,
} from '../brands.js';

/** Read-only render request with checked selectors and native paths; no canonical workspace mutation. */
export const headlessOptions = z
  .strictObject({
    collection: collectionName,
    theme: themeName.optional(),
    themeFile: filePath.optional(),
    out: filePath,
    format: z.enum(['svg', 'png']),
    labels: z.boolean().optional(),
    root: filePath,
  })
  .readonly();
/** Immutable request inferred from the CLI boundary schema. */
export type HeadlessOptions = z.infer<typeof headlessOptions>;
/** Native provider evidence: preserve the failing path, raw OS code (e.g. ENOENT) and syscall (e.g. open) when supplied. */
const providerDetail = z
  .strictObject({
    path: filePath.optional(),
    systemCode: z.string().optional(),
    syscall: z.string().optional(),
  })
  .readonly();
/** Untrusted native error evidence before checking; only data fields are read, never methods. */
const nativeErrorDetail = z
  .object({
    path: filePath.optional(),
    code: z.string().optional(),
    syscall: z.string().optional(),
  })
  .readonly();
/** A native filesystem or wasm failure: the error's message, and its path, OS code and syscall. */
const providerFault = z
  .strictObject({
    code: z.literal('provider-failed'),
    message: z.string(),
    detail: providerDetail,
  })
  .readonly();
/** A thrown native error after conversion; render file and temp-directory steps fail with it. */
export type ProviderFault = z.infer<typeof providerFault>;
/** Local selection/provider failures are distinct from unchanged originating owner records. */
export const headlessFault = z.discriminatedUnion('code', [
  z.strictObject({ code: z.literal('missing-theme'), theme: themeName }).readonly(),
  z
    .strictObject({
      code: z.literal('collection-selection'),
      id: collectionName,
      matches: z.number().int().nonnegative(),
    })
    .readonly(),
  z.strictObject({ code: z.literal('collection-required') }).readonly(),
  z
    .strictObject({
      code: z.literal('invalid-theme'),
      message: z.string(),
      recovery: z.string(),
    })
    .readonly(),
  z.strictObject({ code: z.literal('collection-title-required') }).readonly(),
  providerFault,
]);
/** Consumer-owned source union retains owner paths, diagnostic tuples and recursive source/cleanup chains. */
export type HeadlessSource = FailureSource | CliFailure | z.infer<typeof headlessFault>;
/** Every adapter rejection carries structured evidence in the existing CLI error channel. */
export interface HeadlessFailure {
  readonly code: 'render-failed';
  readonly message: string;
  readonly recovery: string;
  readonly source: HeadlessSource;
}
/** Machine-readable export evidence; Layout validates scenes before they reach this report. */
export interface HeadlessReport {
  readonly files: readonly FilePath[];
  readonly theme: import('@novakai/canvas-model').Collection['theme'];
  readonly inspection: import('@novakai/canvas-service').InspectionReport;
  readonly digests: readonly { readonly id: PresetId; readonly digest: PresetDigest }[];
}

/** A thrown native error as `provider-failed` evidence: message, path, OS code and syscall. */
export function nativeFault(error: unknown): ProviderFault {
  return providerFault.parse({
    code: 'provider-failed',
    message: providerMessage(error),
    detail: nativeDetail(error),
  });
}

/** The error's message as human context; no machine-readable fields are invented. */
function providerMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The fault schema checks and freezes these renamed fields; absent OS evidence stays absent. */
function nativeDetail(error: unknown): {
  readonly path: string | undefined;
  readonly systemCode: string | undefined;
  readonly syscall: string | undefined;
} {
  const native = nativeErrorDetail.safeParse(error);
  return {
    path: native.data?.path,
    systemCode: native.data?.code,
    syscall: native.data?.syscall,
  };
}
