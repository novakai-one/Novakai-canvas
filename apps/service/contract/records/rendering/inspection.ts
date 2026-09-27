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
/**
 * Quality report for one committed collection. A freshly arranged scene is inspection-valid by
 * construction (arrange runs the independent inspector and rejects mismatches), so the report's
 * value is the scene's own warning record plus counted budgets an agent can gate on.
 */
export const inspectionReport = z
  .strictObject({
    valid: z.boolean(),
    diagnostics: z.array(failureSource).readonly(),
    warnings: z.array(warning).readonly(),
    crossings: z.number().int().nonnegative(),
    relaxed: z.number().int().nonnegative(),
    sections: z.number().int().nonnegative(),
    engineVersions: z.array(z.string()).readonly(),
  })
  .readonly();
export type InspectionReport = z.infer<typeof inspectionReport>;
