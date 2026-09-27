import { useState, useSyncExternalStore } from 'react';
import { panelVisible } from '../../contract/api.js';
import type { ComponentType, ReactElement } from 'react';
import type { ViewMenuProps, DesignSlots } from '../../contract/react-types.js';
import type { PanelController } from '../../contract/panel-types.js';
import type { InterfaceControl, PanelId, PanelState } from '../../contract/records/panels.js';

/** View owns temporary interface visibility while the workspace retains diagram and draft state. */
export function createViewMenu(
  { Button, Menu }: Pick<DesignSlots, 'Button' | 'Menu'>,
  panels: PanelController,
  portal: HTMLElement,
): ComponentType<ViewMenuProps> {
  function ViewMenu({ controller, view }: ViewMenuProps): ReactElement {
    const [open, setOpen] = useState(false);
    const state = useSyncExternalStore(panels.subscribe, panels.getSnapshot);
    const items = viewItems(view, state, controller, panels);
    return (
      <Menu
        label="View options"
        trigger={<Button label="View" selected={open} />}
        items={items}
        portal={portal}
        open={open}
        onOpenChange={setOpen}
      />
    );
  }
  return ViewMenu;
}

function viewItems(
  view: ViewMenuProps['view'],
  state: PanelState,
  controller: ViewMenuProps['controller'],
  panels: PanelController,
) {
  const visibility = state.interfaceVisibility;
  return [
    panelItem('left', panelVisible(state, 'left'), 'Browse', panels, view.active === null),
    panelItem('right', panelVisible(state, 'right'), 'Details', panels, view.active === null),
    {
      id: 'source',
      label: sourceLabel(view.sourceOpen),
      disabled: view.active === null,
      onSelect: () => void controller.showSource(!view.sourceOpen),
    },
    controlItem('tools', visibility.tools, 'canvas tools', panels),
    controlItem('zoom', visibility.zoom, 'zoom controls', panels),
    controlItem('minimap', visibility.minimap, 'minimap', panels),
    controlItem('outline', visibility.outline, 'diagram outline', panels),
    controlItem('labels', visibility.labels, 'wire labels', panels),
    {
      id: 'hide-all',
      label: 'Hide all interface',
      disabled: view.active === null,
      onSelect: () => panels.hideInterface(),
    },
  ];
}

function sourceLabel(open: boolean): string {
  return open ? 'Hide source editor' : 'Show source editor';
}

function controlItem(
  control: InterfaceControl,
  visible: boolean,
  label: string,
  panels: PanelController,
) {
  return {
    id: control,
    label: `${visible ? 'Hide' : 'Show'} ${label}`,
    onSelect: () => panels.setInterfaceVisibility(control, !visible),
  };
}

function panelItem(
  side: PanelId,
  visible: boolean,
  label: string,
  panels: Pick<PanelController, 'open'>,
  disabled: boolean,
) {
  return {
    id: `${side}-panel`,
    label: `${visible ? 'Hide' : 'Show'} ${label} panel`,
    disabled,
    onSelect: () => panels.open(side, !visible),
  };
}
