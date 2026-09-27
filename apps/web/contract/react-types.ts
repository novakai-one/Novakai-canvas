import type { PanelController } from './panel-types.js';
import type { PanelTab } from './records/panels.js';
import type { ComponentType, ReactElement, ReactNode } from 'react';
import type { ReactBindings as DesignBindings } from '@novakai/canvas-design-system';
import type { SurfaceProps } from '@novakai/canvas-canvas';
import type { FontDefinitionsProps } from '@novakai/canvas-presentation';
import type { CollectionSwitch, WorkspaceController, WorkspaceView } from './records/workspace.js';
import type { LibraryWorkspace, LibraryWorkspaceView } from './library-react.js';
/** Feature views receive readonly presentation and intent callbacks. No component owns canonical diagram state. */
export interface WorkspaceProps {
  readonly controller: WorkspaceController;
}
export interface FeatureProps {
  readonly controller: WorkspaceController;
  readonly view: WorkspaceView;
}
export interface HeaderProps extends FeatureProps {
  readonly onCreate: () => void;
  readonly onOpenChooser: () => void;
}
export interface ViewMenuProps {
  readonly controller: Pick<WorkspaceController, 'showSource'>;
  readonly view: Pick<WorkspaceView, 'active' | 'sourceOpen'>;
}
export interface RevealInterfaceProps {
  readonly onReveal: () => void;
}
export interface ThemeSelectorProps {
  readonly compact?: boolean;
}
export interface LibraryProps extends FeatureProps {
  readonly onCreate: () => void;
}
export interface PanelProps extends FeatureProps {
  readonly side: 'left' | 'right';
}
export interface CreateDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onCreate: (title: string) => void;
  readonly portal: HTMLElement;
}
export type CollectionChooserController = Pick<
  WorkspaceController,
  'beginCollectionSwitch' | 'cancelCollectionSwitch' | 'chooseCollection' | 'retryCollectionSwitch'
> &
  LibraryWorkspace;
export interface CollectionChooserView extends LibraryWorkspaceView {
  readonly active: WorkspaceView['active'];
  readonly collections: WorkspaceView['collections'];
  readonly collectionSwitch: CollectionSwitch;
  readonly problem: WorkspaceView['problem'];
}
export interface CollectionChooserProps {
  readonly controller: CollectionChooserController;
  readonly view: CollectionChooserView;
  readonly onCreate: () => void;
  readonly portal: HTMLElement;
}
export interface ChromeSlots {
  readonly panels: Pick<PanelController, 'subscribe' | 'getSnapshot' | 'revealInterface'>;
  readonly Header: ComponentType<HeaderProps>;
  readonly Library: ComponentType<LibraryProps>;
  readonly Panel: ComponentType<PanelProps>;
  readonly Recovery: ComponentType<FeatureProps>;
  readonly Button: DesignBindings['Button'];
  readonly MovementReview: ComponentType<FeatureProps>;
  readonly Reveal: ComponentType<RevealInterfaceProps>;
  readonly Source: ComponentType<FeatureProps>;
  readonly CreateDialog: ComponentType<CreateDialogProps>;
  readonly Chooser: ComponentType<CollectionChooserProps>;
  readonly CanvasSurface: ComponentType<SurfaceProps>;
  readonly FontDefinitions: ComponentType<FontDefinitionsProps>;
  readonly portal: HTMLElement;
  nextGestureId(): string;
}
export type DesignSlots = Pick<
  DesignBindings,
  | 'Button'
  | 'Field'
  | 'Dialog'
  | 'Menu'
  | 'PanelHeader'
  | 'PanelBody'
  | 'PanelBodyHeader'
  | 'PanelSection'
  | 'PanelSectionHeader'
  | 'SidePanel'
>;
export type WorkspaceComponent = ComponentType<WorkspaceProps>;
export type WorkspaceElement = (props: WorkspaceProps) => ReactElement;

/** The shared tab strip receives content slots, never feature implementations. */
export interface PanelTabsProps {
  readonly label: string;
  readonly value: PanelTab;
  readonly onSelect: (tab: PanelTab) => void;
  readonly items: readonly {
    readonly id: PanelTab;
    readonly label: string;
    readonly content: ReactNode;
  }[];
}
