// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  OutlinerRow.tsx — the ONE outliner row, shared by the editor + PIE trees.
 *
 * Purely presentational: selection / rename / drop / prefab state arrive as props
 * (it does NOT subscribe to any store), so with virtualization only the ~window of
 * visible rows ever renders or re-renders. Editor-only affordances (visibility
 * toggle, rename, drag-drop) are gated on their handlers being present — the PIE
 * tree passes none and gets a click-to-select read-only row.
 */
import type React from 'react';
import { ChevronRight, Eye, EyeOff, Lock } from 'lucide-react';
import { NodeIcon } from '@/components/icons';
import type { EntityId, NodeKind } from '@/types';
import type { OutlinerItem } from './OutlinerModel';

/** Entity kind → the label shown in the outliner's right-hand "Type" column. */
const KIND_TYPE: Record<NodeKind, string> = {
  camera: 'Camera',
  sprite: 'Sprite',
  spine: 'Spine',
  physics: 'Physics',
  ui: 'UI',
  audio: 'Audio',
  group: 'Group',
  light: 'Light',
  empty: 'Entity',
};

export interface OutlinerRowProps {
  item: OutlinerItem;
  selected: boolean;
  renaming?: boolean;
  isDrop?: boolean;
  /** Prefab-instance member — warm icon tint (editor only). */
  prefab?: boolean;
  /** When false, the twist is hidden + non-interactive (the always-expanded PIE tree). */
  collapsible?: boolean;
  onToggle: (id: EntityId) => void;
  onClick: (id: EntityId, e: React.MouseEvent) => void;
  onContextMenu?: (e: React.MouseEvent, id: EntityId) => void;
  onStartRename?: (id: EntityId) => void;
  onCommitRename?: (id: EntityId, name: string) => void;
  onToggleVisible?: (id: EntityId, visible: boolean) => void;
  draggable?: boolean;
  onDragStart?: (id: EntityId, e: React.DragEvent) => void;
  onDragOver?: (id: EntityId, e: React.DragEvent) => void;
  onDrop?: (id: EntityId, e: React.DragEvent) => void;
}

export function OutlinerRow(props: OutlinerRowProps) {
  const { item, selected, renaming, isDrop, prefab } = props;
  const { node, depth, hasChildren, expanded } = item;

  // Right-column type: prefab instances read "Prefab", others by kind, suffixed
  // with the child count when it has any.
  const childCount = node.children?.length ?? 0;
  const baseType = prefab ? 'Prefab' : (KIND_TYPE[node.kind] ?? 'Entity');
  const typeLabel = childCount > 0 ? `${baseType} · ${childCount}` : baseType;

  const canRename = !!props.onCommitRename;
  const showVis = !!props.onToggleVisible;
  const collapsible = props.collapsible !== false;
  const showTwist = hasChildren && collapsible;

  return (
    <div
      className={
        `row${selected ? ' sel' : ''}` +
        `${expanded ? ' open' : ''}` +
        `${node.visible ? '' : ' hidden'}` +
        `${prefab ? ' prefab' : ''}` +
        `${isDrop ? ' drop' : ''}`
      }
      style={{ paddingLeft: depth * 14 }}
      draggable={props.draggable && !renaming}
      onClick={(e) => props.onClick(node.id, e)}
      onContextMenu={props.onContextMenu ? (e) => props.onContextMenu!(e, node.id) : undefined}
      onDragStart={props.onDragStart ? (e) => props.onDragStart!(node.id, e) : undefined}
      onDragOver={props.onDragOver ? (e) => props.onDragOver!(node.id, e) : undefined}
      onDrop={props.onDrop ? (e) => props.onDrop!(node.id, e) : undefined}
    >
      <span
        className={`twist${showTwist ? '' : ' leaf'}`}
        onClick={(e) => {
          e.stopPropagation();
          if (showTwist) props.onToggle(node.id);
        }}
      >
        <ChevronRight size={9} strokeWidth={3} />
      </span>

      <span className="ricon">
        <NodeIcon kind={node.kind} />
      </span>

      {renaming && canRename ? (
        <input
          className="rname-edit"
          defaultValue={node.name}
          autoFocus
          spellCheck={false}
          onClick={(e) => e.stopPropagation()}
          onFocus={(e) => e.target.select()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            else if (e.key === 'Escape') {
              e.currentTarget.value = node.name;
              e.currentTarget.blur();
            }
          }}
          onBlur={(e) => props.onCommitRename!(node.id, e.target.value)}
        />
      ) : (
        <span
          className="rname"
          onDoubleClick={canRename && props.onStartRename ? () => props.onStartRename!(node.id) : undefined}
        >
          {node.name}
        </span>
      )}

      <span className="rtype">{typeLabel}</span>

      {showVis && (
        <span
          className="rvis"
          title="Toggle visibility"
          onClick={(e) => {
            e.stopPropagation();
            props.onToggleVisible!(node.id, !node.visible);
          }}
        >
          {node.locked ? (
            <Lock size={12} strokeWidth={1.85} />
          ) : node.visible ? (
            <Eye size={13} strokeWidth={1.85} />
          ) : (
            <EyeOff size={13} strokeWidth={1.85} />
          )}
        </span>
      )}
    </div>
  );
}
