/**
 * Public entry point of Templates. It exports the facade, the `.theme` grammar (`readThemeSource`),
 * its schemas and its types only; internal parsers, token resolvers and helpers stay private.
 */
export { themeInput } from './records/preset.js';
export { createTemplates, readThemeSource } from './api.js';
export { composeTemplates } from './compose.js';
export { presetId, version, digest } from './brands.js';
export type { PresetId, Version, Digest, ChromeName, TokenName, BaseTheme } from './brands.js';
export type {
  Result,
  Diagnostic,
  ErrorCode,
  ThemeSourceCode,
  ThemeSourceFailure,
} from './errors.js';
export type {
  Pin,
  Preset,
  ThemePreset,
  RecipePayload,
  ThemePayload,
  Catalog,
  Admission,
  Selection,
  Query,
  ExpansionRequest,
} from './records/preset.js';
export type {
  ThemeSource,
  ThemeAdmission,
  ThemeRaw,
  FontRequest,
  FontRole,
  FontTriple,
  TokenOverride,
  OverrideValue,
  PixelDimension,
  SourcePosition,
  SourceSpan,
} from './records/theme-source.js';
export type { Templates, Dependencies, PresetPlan, Expansion, Summary } from './types.js';
export type { RecipePort, ThemePort } from './ports/codecs.js';
export type { IdentityPort } from './ports/identity.js';
