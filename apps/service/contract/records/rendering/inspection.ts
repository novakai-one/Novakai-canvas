/*
 * Why this file exists
 *
 * An agent that writes a diagram wants to know if it came out well, without looking at it.
 * `pnpm canvas inspect my-diagram` answers with a quality report. For example, it may say the
 * layout is valid with 2 wire crossings, or that the diagram could not be laid out, and why.
 *
 * This file holds the check for that report, `inspectionReport`, and its type. A report is either
 * valid (the layout's warnings and counts) or invalid (why the render was refused, and every count
 * 0). core/rendering/inspection.ts builds it.
 *
 * Declarations only.
 */
import { z } from 'zod';
import { failureSource } from '../transport/failure-source.js';

/**
 * One layout warning, as Layout wrote it. Callers keep its code and never branch on its message.
 */
const warning = z
  .strictObject({
    code: z.string(),
    targets: z.array(z.string()).readonly(),
    message: z.string(),
  })
  .readonly();

/** A whole number, 0 or more. */
const count = z.number().int().nonnegative();

/**
 * A layout that worked. Layout checks every layout it makes, so a new one is always valid. The
 * report is its warnings plus counts an agent can test: wire crossings, layout rules it had to
 * relax, sections. It carries no diagnostics.
 */
const validReport = z.strictObject({
  valid: z.literal(true),
  diagnostics: z.tuple([]).readonly(),
  warnings: z.array(warning).readonly(),
  crossings: count,
  relaxed: count,
  sections: count,
  engineVersions: z.array(z.string()).readonly(),
});

/**
 * A render refused as `invalid-input`: at least one diagnostic (why it was refused), no warnings,
 * and every count 0.
 */
const invalidReport = z.strictObject({
  valid: z.literal(false),
  diagnostics: z.tuple([failureSource]).rest(failureSource).readonly(),
  warnings: z.tuple([]).readonly(),
  crossings: z.literal(0),
  relaxed: z.literal(0),
  sections: z.literal(0),
  engineVersions: z.tuple([]).readonly(),
});

/**
 * Checks the quality report of one saved collection. Its fields: `valid`, `diagnostics`,
 * `warnings`, `crossings`, `relaxed` (layout rules loosened), `sections`, `engineVersions`.
 */
export const inspectionReport = z
  .discriminatedUnion('valid', [validReport, invalidReport])
  .readonly();
/** A quality report that passed {@link inspectionReport}. */
export type InspectionReport = z.infer<typeof inspectionReport>;
