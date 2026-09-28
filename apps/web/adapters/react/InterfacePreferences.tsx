import { formatFailure } from '../../contract/api.js';
import { useSyncExternalStore } from 'react';
import type { ComponentType, ReactElement } from 'react';
import type { PreferenceController } from '../../contract/records/preferences.js';
import type { FeatureProps, DesignSlots, ThemeSelectorProps } from '../../contract/react-types.js';
import styles from './InterfacePreferences.module.css';
import type { PanelController } from '../../contract/panel-types.js';
import type { InterfaceVisibility } from '../../contract/records/panels.js';
/** The panel controls the Interface section reads and sets, plus the panel session's default visibility, which Reset restores. */
export type RoadVisibility = Pick<
  PanelController,
  'subscribe' | 'getSnapshot' | 'setInterfaceVisibility'
> & {
  readonly defaultInterfaceVisibility: () => InterfaceVisibility;
};
/** Personal controls consume one preference session, so panel movement or collapse never resets them. */
export function createInterfacePreferences(
  { Button, Field }: Pick<DesignSlots, 'Button' | 'Field'>,
  preferences: PreferenceController,
  ThemeSelector: ComponentType<ThemeSelectorProps>,
  panels: RoadVisibility,
): ComponentType<FeatureProps> {
  /** Diagram themes are separate authored data; these controls affect this browser's interface only. */
  function InterfacePreferences(): ReactElement {
    const view = useSyncExternalStore(preferences.subscribe, preferences.getSnapshot);
    const value = view.preferences;
    const panel = useSyncExternalStore(panels.subscribe, panels.getSnapshot);
    return (
      <div className={styles.preferences}>
        <p>Personal to this browser</p>
        <ThemeSelector />
        <fieldset>
          <legend>Routing diagnostics</legend>
          <label className={styles.toggle}>
            <input
              type="checkbox"
              checked={panel.interfaceVisibility.roads}
              onChange={(event) => panels.setInterfaceVisibility('roads', event.target.checked)}
            />{' '}
            Show routing roads and lanes
          </label>
          <p>Module diagrams only. Display only; does not change routing.</p>
        </fieldset>
        <Field
          label="Interface text size"
          help="12–20 px; diagram text is unchanged"
          control={(props) => (
            <input
              {...props}
              type="number"
              value={value.textSize}
              onChange={(event) =>
                preferences.change({ ...value, textSize: event.target.valueAsNumber })
              }
            />
          )}
        />
        <fieldset>
          <legend>Density</legend>
          <div className={styles.choices}>
            {(['compact', 'comfortable', 'spacious'] as const).map((density) => (
              <Button
                key={density}
                label={density}
                selected={value.density === density}
                onClick={() => preferences.change({ ...value, density })}
              />
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend>Motion</legend>
          <div className={styles.choices}>
            {(['system', 'reduced', 'full'] as const).map((motion) => (
              <Button
                key={motion}
                label={motion}
                selected={value.motion === motion}
                onClick={() => preferences.change({ ...value, motion })}
              />
            ))}
          </div>
        </fieldset>
        {view.problem && <p role="alert">{formatFailure(view.problem).join(' · ')}</p>}
        <Button
          label="Reset interface preferences"
          onClick={() => resetInterface(preferences, panels)}
        />
      </div>
    );
  }
  return InterfacePreferences;
}
/** Resets this browser's interface preferences and turns the routing-roads toggle back to its default. */
function resetInterface(
  preferences: Pick<PreferenceController, 'reset'>,
  panels: Pick<RoadVisibility, 'setInterfaceVisibility' | 'defaultInterfaceVisibility'>,
): void {
  preferences.reset();
  panels.setInterfaceVisibility('roads', panels.defaultInterfaceVisibility().roads);
}
