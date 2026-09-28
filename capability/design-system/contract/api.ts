import { compileArtifacts } from '../core/artifacts/compile.js';
import { auditStyles } from '../core/styles/coverage.js';
import { validateResolved } from '../core/tokens/scope.js';
import type { DesignSystem, DesignSystemDependencies } from './types.js';
import type { ResolvedTokenSet } from './records/resolved.js';
import { uiPreferences, environment } from './records/preferences.js';
import { presetPin } from './records/theme.js';
import { protect, reject } from '../core/validation/outcomes.js';
import { record, keys, parsed, text } from '../core/validation/input.js';
import { readSources } from '../core/tokens/read.js';
import { resolveUi } from '../core/themes/resolve.js';
import { resolveDiagram, projectDiagram } from '../core/themes/diagram.js';
import { resolveThemeData } from '../core/themes/admit-data.js';
import { readFonts } from '../core/themes/fonts.js';
/** Resolve detached visual data without I/O. Host retains last valid scope; Templates owns theme admission. */
export function createDesignSystem(dependencies: DesignSystemDependencies): DesignSystem {
  return {
    readPreferences: (input) => protect(() => parsed(uiPreferences, input, 'preferences')),
    compile: (input) => protect(() => compileArtifacts(readSources(input), dependencies.identity)),
    auditStyles: (styles, resolved) =>
      protect(() => auditStyles(styles, validateResolved(resolved))),
    readSources: (input) => protect(() => readSources(input)),
    resolve: (input) => protect(() => resolveRequest(input, dependencies)),
    resolveTheme: (input) =>
      protect(() => {
        const data = record(input, 'request');
        keys(data, ['sources', 'theme'], 'request');
        return resolveThemeData(readSources(data.sources), data.theme, dependencies.identity);
      }),
    projectDiagram: (resolved) => protect(() => projectDiagram(validateResolved(resolved))),
  };
}
/** Scope-specific closed shapes reject preferences smuggled into a diagram request. */
function resolveRequest(
  input: unknown,
  dependencies: DesignSystemDependencies,
): ResolvedTokenSet {
  const data = record(input, 'request');
  const scope = text(data.scope, 'scope');
  if (scope === 'ui') return uiRequest(data, dependencies);
  if (scope === 'diagram' || scope === 'export') return diagramRequest(data, scope, dependencies);
  return reject('invalid-input', 'scope', 'ui, diagram or export', 'Unknown token scope');
}
/** UI preference failure returns no scope; host owns the separate safe-session fallback decision. */
function uiRequest(
  data: Readonly<Record<string, unknown>>,
  dependencies: DesignSystemDependencies,
): ResolvedTokenSet {
  keys(data, ['scope', 'sources', 'preferences', 'environment'], 'request');
  return resolveUi(
    readSources(data.sources),
    parsed(uiPreferences, data.preferences, 'preferences'),
    parsed(environment, data.environment, 'environment'),
    dependencies.identity,
  );
}
/** Canonical diagram styling requires exact portable data, admitted fonts and source provenance. */
function diagramRequest(
  data: Readonly<Record<string, unknown>>,
  scope: 'diagram' | 'export',
  dependencies: DesignSystemDependencies,
): ResolvedTokenSet {
  keys(data, ['scope', 'sources', 'theme', 'fonts', 'pin'], 'request');
  return resolveDiagram(
    readSources(data.sources),
    data.theme,
    readFonts(data.fonts),
    parsed(presetPin, data.pin, 'pin'),
    scope,
    dependencies.identity,
  );
}
