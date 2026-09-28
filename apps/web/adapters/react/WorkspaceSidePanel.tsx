import { useSyncExternalStore } from 'react';
import type { ComponentType, ReactElement } from 'react';
import type {
  PanelProps,
  FeatureProps,
  DesignSlots,
  PanelTabsProps,
} from '../../contract/react-types.js';
import type { PanelController } from '../../contract/panel-types.js';
import type { PanelSectionId } from '../../contract/brands.js';
import type { PanelSizing, PanelMode, PanelId, PanelTab } from '../../contract/records/panels.js';
import { panelGeometry } from '../../contract/api.js';
import styles from './WorkspaceSidePanel.module.css';
/** Definitions and renderers are trusted registration data; user preferences can arrange IDs but cannot supply code. */
export interface RegisteredSection {
  readonly tab: PanelTab;
  readonly id: PanelSectionId;
  readonly title: string;
  readonly Content: ComponentType<FeatureProps>;
}
export interface PanelSlots extends DesignSlots {
  readonly sections: readonly RegisteredSection[];
  readonly Tabs: ComponentType<PanelTabsProps>;
  readonly tabs: Readonly<
    Record<
      PanelId,
      readonly {
        readonly id: PanelTab;
        readonly label: string;
        readonly scope: string;
        readonly empty: string;
      }[]
    >
  >;
  readonly panels: PanelController;
  readonly sizing: PanelSizing;
  readonly portal: HTMLElement;
}
/** One composition serves docked panels, modal side overlays and bottom sheets. Drafts live in feature controllers across remounts. */
export function createWorkspaceSidePanel(slots: PanelSlots): ComponentType<PanelProps> {
  const {
    SidePanel,
    PanelHeader,
    PanelBody,
    PanelBodyHeader,
    PanelSection,
    PanelSectionHeader,
    Dialog,
    Button,
    Tabs,
  } = slots;
  /** Panel preferences own order, visibility and collapse; changing the body requires registration data only. */
  function WorkspaceSidePanel(props: PanelProps): ReactElement {
    const state = useSyncExternalStore(slots.panels.subscribe, slots.panels.getSnapshot);
    const preferences = state.preferences;
    const title = { left: 'Add & Browse', right: 'Inspect & Settings' }[props.side];
    const geometry = panelGeometry(state, slots.sizing, props.side);
    const registered = preferences.sections[props.side].flatMap((id) =>
      slots.sections.filter((item) => item.id === id),
    );
    const sections = registered.filter(
      (item) => state.customize || !preferences.hidden.includes(item.id),
    );
    const actions = (
      <Button
        label="Customize panels"
        icon="⚙"
        iconOnly
        selected={state.customize}
        onClick={() => slots.panels.customize(!state.customize)}
      />
    );
    const body = (
      <div className={styles.tabs}>
        <Tabs
          label={title}
          value={preferences.tabs[props.side]}
          onSelect={slots.panels.selectTab}
          items={slots.tabs[props.side].map((tab) => ({
            id: tab.id,
            label: tab.label,
            content: (
              <PanelBody
                header={
                  <PanelBodyHeader
                    title={props.view.active?.document.collection.title ?? 'Workspace'}
                    scope={tab.scope}
                    actions={actions}
                  />
                }
              >
                {state.customize && (
                  <div className={styles.customize}>
                    <p>Hide or reorder sections within their role. Diagram content is unchanged.</p>
                    <Button label="Reset panel layout" onClick={slots.panels.reset} />
                  </div>
                )}
                {sections.filter((section) => section.tab === tab.id).length === 0 && (
                  <p className={styles.empty}>{tab.empty}</p>
                )}
                {sections
                  .filter((section) => section.tab === tab.id)
                  .map((section) => {
                    const index = preferences.sections[props.side].indexOf(section.id);
                    const Content = section.Content;
                    const expanded = !preferences.collapsed.includes(section.id);
                    return (
                      <div key={section.id}>
                        {state.customize && (
                          <div
                            className={styles.customize}
                            aria-label={`Customize ${section.title}`}
                          >
                            <Button
                              label={`Move ${section.title} up`}
                              icon="↑"
                              iconOnly
                              disabled={index === 0}
                              onClick={() => slots.panels.move(section.id, props.side, index - 1)}
                            />
                            <Button
                              label={`Move ${section.title} down`}
                              icon="↓"
                              iconOnly
                              disabled={index === preferences.sections[props.side].length - 1}
                              onClick={() => slots.panels.move(section.id, props.side, index + 1)}
                            />
                            <Button
                              label={`${preferences.hidden.includes(section.id) ? 'Show' : 'Hide'} ${section.title}`}
                              selected={preferences.hidden.includes(section.id)}
                              onClick={() =>
                                slots.panels.hide(
                                  section.id,
                                  !preferences.hidden.includes(section.id),
                                )
                              }
                            />
                          </div>
                        )}
                        <PanelSection
                          id={section.id}
                          expanded={expanded}
                          header={
                            <PanelSectionHeader
                              id={section.id}
                              title={section.title}
                              expanded={expanded}
                              onExpandedChange={(open) => slots.panels.expand(section.id, open)}
                            />
                          }
                        >
                          <Content {...props} />
                        </PanelSection>
                      </div>
                    );
                  })}
              </PanelBody>
            ),
          }))}
        />
      </div>
    );
    if (state.mode !== 'docked')
      return (
        <Dialog
          open
          title={title}
          description="Workspace tools"
          placement={placement(state.mode, props.side)}
          portal={slots.portal}
          onOpenChange={(open) => slots.panels.open(props.side, open)}
        >
          {body}
        </Dialog>
      );
    return (
      <SidePanel
        id={`panel-${props.side}`}
        side={props.side}
        label={title}
        width={geometry.width}
        minimum={geometry.minimum}
        maximum={geometry.maximum}
        onResize={(width) => slots.panels.resize(props.side, width)}
        header={<PanelHeader title={title} onClose={() => slots.panels.open(props.side, false)} />}
        body={body}
      />
    );
  }
  return WorkspaceSidePanel;
}

/** Modal geometry is chosen from shell mode; the shared Dialog owns its token styling and focus behavior. */
function placement(
  mode: PanelMode,
  side: PanelId,
): 'left' | 'right' | 'bottom' {
  if (mode === 'sheet') return 'bottom';
  return side;
}
