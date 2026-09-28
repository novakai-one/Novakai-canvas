/*
 * The quality report of one committed collection: a valid report with the scene's warnings and
 * counted budgets, or an invalid report with the render refusal. Schemas and their types;
 * core/rendering/inspection.ts builds the report. The JSON is unchanged: the union only removes
 * shapes the service never sent (a valid report with diagnostics, an invalid one with counts).
 */
import { z } from 'zod';
import { failureSource } from '../transport/failure-source.js';

/** Scene warnings arrive owner-defined; consumers retain codes without reinterpreting message text. */
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
 * A freshly arranged scene is inspection-valid by construction (arrange runs the independent
 * inspector and rejects mismatches), so a valid report is the scene's own warning record plus
 * counted budgets an agent can gate on. It carries no diagnostics.
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
 * A render refused as `invalid-input`: at least one diagnostic (the refusal, its source kept
 * typed), no warnings and every count 0.
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

/** The quality report of one committed collection, told apart by `valid`. */
export const inspectionReport = z
  .discriminatedUnion('valid', [validReport, invalidReport])
  .readonly();
export type InspectionReport = z.infer<typeof inspectionReport>;
