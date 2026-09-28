import { memo, useSyncExternalStore } from 'react';
import type { ComponentType, CSSProperties, ReactElement } from 'react';
import { Handle, Position, NodeResizer } from '@xyflow/react';
import type { SceneNodeProps, RenderSlots, TreeRowProps } from '../../contract/react-types.js';
import type { Anchor } from '@novakai/canvas-presentation';
import styles from './SceneNode.module.css';
import boundary from './GroupBoundary.module.css';
/** Measured member handles use exact row positions, with separate source/target handles for bidirectional members. */
function anchorHandles(
  anchor: Anchor,
  isConnectable: boolean,
): ReactElement {
  return (
    <span key={anchor.member}>
      {anchor.direction !== 'out' && (
        <Handle
          id={anchor.member}
          isConnectable={isConnectable}
          type="target"
          position={Position.Left}
          style={{ top: anchor.y }}
          aria-label={`Connect to ${anchor.label}`}
        />
      )}
      {anchor.direction !== 'in' && (
        <Handle
          id={anchor.member}
          isConnectable={isConnectable}
          type="source"
          position={Position.Right}
          style={{ top: anchor.y }}
          aria-label={`Connect from ${anchor.label}`}
        />
      )}
    </span>
  );
}
/** CSS offset while this node (or an ancestor) is dragged; other nodes never re-render per frame. */
function useDragShift(data: SceneNodeProps['data']): string | undefined {
  return useSyncExternalStore(data.actions.subscribePreview, () => {
    const preview = data.actions.readPreview();
    if (preview === null || !preview.moved.has(data.view.id)) return undefined;
    return `translate(${preview.delta.x}px, ${preview.delta.y}px)`;
  });
}
/** Bind shared measured content once; React Flow owns actual node interaction and Canvas owns typed intent translation. */
export function createSceneNode(
  slots: Pick<RenderSlots, 'NodeContent'> & { readonly TreeRow: ComponentType<TreeRowProps> },
): ComponentType<SceneNodeProps> {
  const Content = slots.NodeContent;
  const TreeRow = slots.TreeRow;
  /** Render a real custom node with explicit minimum resize dimensions; host handles rendering failures. */
  function SceneNode({ data, selected, isConnectable }: SceneNodeProps): ReactElement {
    const { view, actions, editable } = data;
    const shift = useDragShift(data);
    const node = { ...view.placed.measured, width: view.box.width, height: view.box.height };
    /** Mount choreography: cards rise in column order, left to right, capped past ~8 columns. */
    const mountDelay = Math.min(8, Math.max(0, Math.floor(view.position.x / 300))) * 45;
    return (
      <div
        className={styles.node}
        data-preview={view.draft || shift !== undefined}
        data-tree={view.tree !== undefined}
        data-emphasis={view.emphasis}
        data-hovered={view.hovered}
        data-depth={Math.min(data.depth ?? 0, 3)}
        style={{ '--nv-mount-delay': `${mountDelay}ms`, transform: shift } as CSSProperties}
      >
        {view.tree ? (
          <TreeRow view={view} actions={actions} />
        ) : (
          <Content
            embedFonts={false}
            node={node}
            surface="canvas"
            detail={view.detail}
            emphasis={view.emphasis}
            hovered={view.hovered}
          />
        )}
        {node.groupId !== null && (
          <svg className={boundary.hit} aria-hidden="true">
            <rect width="100%" height="100%" vectorEffect="non-scaling-stroke" />
            <rect className={boundary.title} width="100%" height={node.headerHeight} />
          </svg>
        )}
        <Handle
          isConnectable={isConnectable}
          type="target"
          position={Position.Left}
          aria-label="Connect to object"
        />
        <Handle
          isConnectable={isConnectable}
          type="source"
          position={Position.Right}
          aria-label="Connect from object"
        />
        {node.content.anchors.map((anchor) => anchorHandles(anchor, isConnectable))}
        <NodeResizer
          isVisible={selected && editable}
          minWidth={view.placed.measured.width}
          minHeight={view.placed.measured.height}
          onResizeStart={() => actions.beginResize(view.target)}
          onResize={(_event, box) => actions.resize(view.target, box)}
          onResizeEnd={actions.finishGeometry}
        />
      </div>
    );
  }
  return memo(SceneNode);
}
