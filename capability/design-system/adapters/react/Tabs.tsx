import { Tabs as Primitive } from 'radix-ui';
import type { ReactElement } from 'react';
import type { TabsProps, TabItem } from '../../contract/react-types.js';
import styles from './Tabs.module.css';
/** Stable IDs keep stateful panels alive when requested; host owns selection and draft recovery. */
export function Tabs({
  label,
  value,
  onValueChange,
  items,
  keepMounted = false,
}: TabsProps): ReactElement {
  return (
    <Primitive.Root value={value} onValueChange={onValueChange} className={styles.tabs}>
      <Primitive.List aria-label={label} className={styles.list}>
        {items.map((item) => (
          <Primitive.Trigger
            key={item.id}
            value={item.id}
            disabled={item.disabled}
            className={styles.trigger}
          >
            {item.label}
          </Primitive.Trigger>
        ))}
      </Primitive.List>
      {items.map((item) => renderPanel(item, value, keepMounted))}
    </Primitive.Root>
  );
}

/** Forced mounting is explicit; inactive panels retain state without becoming visible or focusable. */
function renderPanel(
  item: TabItem,
  value: string,
  keepMounted: boolean,
): ReactElement {
  const props = {
    key: item.id,
    value: item.id,
    hidden: item.id !== value,
    className: styles.content,
  };
  if (keepMounted)
    return (
      <Primitive.Content {...props} forceMount>
        {item.content}
      </Primitive.Content>
    );
  return <Primitive.Content {...props}>{item.content}</Primitive.Content>;
}
