import type { ComponentType, ReactElement } from 'react';
import type { OutlineProps, RenderSlots } from '../../contract/react-types.js';
import type { OutlineEntry } from '../../contract/records/view.js';
import styles from './DiagramOutline.module.css';
/** Structured outline is an accessible alternative to spatial navigation, never a second graph editor. */
export function createDiagramOutline(
  slots: Pick<RenderSlots, 'Button'>,
): ComponentType<OutlineProps> {
  const Button = slots.Button;
  /** Every row preserves measured text, relationships and explicit target identity; host opens requested editors. */
  function entry(
    item: OutlineEntry,
    props: OutlineProps,
  ): ReactElement {
    return (
      <li key={JSON.stringify(item.target)}>
        <strong>{item.label}</strong>
        <p>{item.description.join('; ')}</p>
        <Button
          label={`Select ${item.label}`}
          onClick={() =>
            props.actions.dispatch({ kind: 'select', targets: [item.target], mode: 'replace' })
          }
        />
        <Button
          label={`Locate ${item.label}`}
          onClick={() => props.actions.dispatch({ kind: 'locate', target: item.target })}
        />
        <Button
          label={`Edit ${item.label}`}
          disabled={!props.editable}
          onClick={() => props.actions.dispatch({ kind: 'inspect', target: item.target })}
        />
        {item.endpoints.map((endpoint) => (
          <div key={endpoint.member}>
            <span>
              {endpoint.label} · {endpoint.direction}
            </span>
            <Button
              label={`Connect ${item.label} ${endpoint.label}`}
              disabled={!props.editable}
              onClick={() => connectMember(item, endpoint.member, props)}
            />
          </div>
        ))}
      </li>
    );
  }
  /** Node member selection starts/completes the same typed connection intent as pointer handles. */
  function connectMember(
    item: OutlineEntry,
    member: string,
    props: OutlineProps,
  ): void {
    if (item.target.kind !== 'node') return;
    const issued = props.actions.nextGestureId();
    if (!issued.ok) return;
    props.actions.dispatch({
      kind: 'connect',
      id: issued.value,
      endpoint: { section: item.target.section, node: item.target.id, member },
    });
  }
  /** Native headings/lists/buttons expose contents without depending on pan/zoom or color recognition. */
  function DiagramOutline(props: OutlineProps): ReactElement {
    return (
      <nav
        className={`nodrag nopan nowheel ${styles.outline}`}
        aria-label="Diagram contents"
        data-canvas-controls
      >
        {props.sections.map((section) => (
          <section key={JSON.stringify(section.target)}>
            <h2>{section.title}</h2>
            <Button
              label={`Fit ${section.title}`}
              onClick={() => props.actions.dispatch({ kind: 'fit', target: section.target })}
            />
            <ul>{section.entries.map((item) => entry(item, props))}</ul>
          </section>
        ))}
      </nav>
    );
  }
  return DiagramOutline;
}
