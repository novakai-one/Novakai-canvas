/*
 * Declarative feature registration: the side-panel sections each tab offers, and the panel
 * definitions that give each section its default placement. Feature components do not import
 * each other; adding a feature registers its renderer and default ID placement here.
 */
import { createElement, type ComponentType, type ReactElement } from 'react';
import type { FeatureProps, ThemeSelectorProps } from '../react-types.js';
import type { LibraryBrowserProps } from '../library-react.js';
import type { PreferenceController } from '../records/preferences.js';
import type { PanelController } from '../panel-types.js';
import type { PanelSectionDefinition } from '../records/panels.js';
import type { RegisteredSection } from '../../adapters/react/WorkspaceSidePanel.js';
import type { ReactBindings as DesignBindings } from '@novakai/canvas-design-system';
import { descendantId } from '@novakai/canvas-model';
import panelDefaults from '../../../../resources/ui/panels.default.json' with { type: 'json' };
import { createAddTools } from '../../adapters/react/AddTools.js';
import { createSectionNavigator } from '../../adapters/react/SectionNavigator.js';
import { ObjectOutline } from '../../adapters/react/ObjectOutline.js';
import { createExportPanel } from '../../adapters/react/ExportPanel.js';
import { createDefinitionsEditor } from '../../adapters/react/Definitions.js';
import { createExpressionEditor } from '../../adapters/react/DefinitionExpression.js';
import { createWireEditor } from '../../adapters/react/WireEditor.js';
import { createWireSemantics } from '../../adapters/react/WireSemantics.js';
import { createWireEndpoints } from '../../adapters/react/WireEndpoints.js';
import { createWireRouting } from '../../adapters/react/WireRouting.js';
import { createInterfacePreferences } from '../../adapters/react/InterfacePreferences.js';
import { createObjectEditor } from '../../adapters/react/ObjectEditor.js';
import { createContentEditor } from '../../adapters/react/ContentEditor.js';
import { createEngineeringFields } from '../../adapters/react/EngineeringFields.js';

/** Concrete side-panel registration is declarative; individual feature components do not import each other. */
export function featureSections(
  design: DesignBindings,
  preferences: PreferenceController,
  ThemeSelector: ComponentType<ThemeSelectorProps>,
  Browser: ComponentType<LibraryBrowserProps>,
  roadVisibility: Pick<PanelController, 'subscribe' | 'getSnapshot' | 'setInterfaceVisibility'>,
): readonly RegisteredSection[] {
  function LibrarySection(props: FeatureProps): ReactElement {
    return createElement(Browser, { controller: props.controller, view: props.view });
  }
  return [
    { tab: 'add', id: 'creation', title: 'Create', Content: createAddTools(design) },
    { tab: 'browse', id: 'collections', title: 'Collections', Content: LibrarySection },
    { tab: 'browse', id: 'sections', title: 'Diagrams', Content: createSectionNavigator(design) },
    { tab: 'browse', id: 'objects', title: 'Objects', Content: ObjectOutline },
    { tab: 'browse', id: 'export', title: 'Export', Content: createExportPanel(design) },
    {
      tab: 'browse',
      id: 'definitions',
      title: 'Definitions',
      Content: createDefinitionsEditor({ ...design, Expression: createExpressionEditor(design) }),
    },
    {
      tab: 'inspect',
      id: 'connection',
      title: 'Connection',
      Content: createWireEditor({
        ...design,
        fields: [
          { id: 'meaning', Content: createWireSemantics(design) },
          { id: 'endpoints', Content: createWireEndpoints(design) },
          { id: 'routing', Content: createWireRouting(design) },
        ],
      }),
    },
    {
      tab: 'settings',
      id: 'interface',
      title: 'Interface',
      Content: createInterfacePreferences(design, preferences, ThemeSelector, roadVisibility),
    },
    {
      tab: 'inspect',
      id: 'shared-content',
      title: 'Selection',
      Content: createObjectEditor({
        ...design,
        Content: createContentEditor({ ...design, Engineering: createEngineeringFields(design) }),
        nextContentId: () => descendantId.parse(`content-${crypto.randomUUID()}`),
      }),
    },
  ];
}

/** Declarative resource order is authoritative; adding a feature registers its renderer and default ID placement. */
export function panelDefinitions(
  sections: readonly RegisteredSection[],
): readonly PanelSectionDefinition[] {
  const sides = ['left', 'right'] as const;
  return sides.flatMap((side) =>
    panelDefaults.panels[side].sectionIds.flatMap((id) =>
      sections
        .filter((item) => item.id === id)
        .map((item) => ({
          id,
          title: item.title,
          defaultSide: side,
          defaultExpanded: !panelDefaults.collapsedSectionIds.includes(id),
        })),
    ),
  );
}
