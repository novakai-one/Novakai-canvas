import type {
  DesignSystem,
  Environment,
  UiPreferences,
  UiThemePin,
  ScopeInstaller,
  ScopeLease,
} from '@novakai/canvas-design-system';
import type { DraftRetention } from '../ports/draft-retention.js';
import type { Result, Diagnostic } from '../errors.js';
/** Personal preferences are browser-local. Collection styling remains part of the authored diagram. */
export interface PreferenceView {
  readonly preferences: UiPreferences;
  readonly problem: Diagnostic | null;
}
export interface PreferenceController {
  getSnapshot(): PreferenceView;
  subscribe(listener: () => void): () => void;
  change(preferences: UiPreferences): void;
  environment(environment: Environment): void;
  reset(): void;
  dispose(): Result<{ readonly restored: boolean }>;
}
/** Design System alone checks preference bounds, theme provenance and visual contrast. */
export interface PreferenceBindings {
  readonly tokens: Pick<DesignSystem, 'readPreferences' | 'resolve'>;
  readonly sources: unknown;
  readonly installer: ScopeInstaller;
  readonly retention: DraftRetention;
  readonly environment: Environment;
  readonly themes?: readonly UiThemePin[];
}
export interface PreferenceInstallation {
  readonly lease: ScopeLease;
  readonly preferences: UiPreferences;
}
export interface ThemeChoice {
  readonly label: string;
  readonly pin: UiThemePin;
}
