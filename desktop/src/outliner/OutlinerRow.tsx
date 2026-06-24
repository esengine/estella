// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  OutlinerRow.tsx — the ONE outliner row, shared by the editor + PIE trees.
 *
 * Purely presentational: selection / rename / drop / prefab state arrive as props
 * (it does NOT subscribe to any store), so with virtualization only the ~window of
 * visible rows ever renders or re-renders. Renders both row kinds (entity / folder);
 * editor-only affordances (visibility toggle, rename, drag-drop) are gated on their
 * handlers — the PIE tree passes none and gets a click-to-select read-only row.
 */
import type React from 'react';
import { ChevronRight, Eye, EyeOff, Lock, Folder, FolderOpen } from 'lucide-react';
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
  /** Entity selection highlight (folders never carry entity selection). */
  selected: boolean;
  renaming?: boolean;
  isDrop?: boolean;
  /** Prefab-instance member — warm icon tint (entity rows only). */
  prefab?: boolean;
  /** When false, the twist is hidden + non-interactive (the always-expanded PIE tree). */
  collapsible?: boolean;
  onToggle: (key: string) => void;
  onClick: (item: OutlinerItem, e: React.MouseEvent) => void;
  onContextMenu?: (e: React.MouseEvent, item: OutlinerItem) => void;
  onStartRename?: (item: OutlinerItem) => void;
  onCommitRename?: (item: OutlinerItem, name: string) => void;
  onToggleVisible?: (id: EntityId, visible: boolean) => void;
  draggable?: boolean;
  onDragStart?: (item: OutlinerItem, e: React.DragEvent) => void;
  onDragOver?: (item: OutlinerItem, e: React.DragEvent) => void;
  onDrop?: (item: OutlinerItem, e: React.DragEvent) => void;
}

export function OutlinerRow(props: OutlinerRowProps) {
  const { item, selected, renaming, isDrop, prefab } = props;
  const isFolder = item.kind === 'folder';
  const { depth, hasChildren, expanded } = item;

  const name = item.kind === 'folder' ? item.name : item.node.name;
  const visible = item.kind === 'entity' ? item.node.visible : true;
  const locked = item.kind === 'entity' ? item.node.locked : false;

  // Right column: entity type (prefab/kind + child count), or a folder's item count.
  let typeLabel: string;
  if (item.kind === 'folder') {
    typeLabel = item.count > 0 ? String(item.count) : '';
  } else {
    const childCount = item.node.children?.length ?? 0;
    const baseType = prefab ? 'Prefab' : (KIND_TYPE[item.node.kind] ?? 'Entity');
    typeLabel = childCount > 0 ? `${baseType} · ${childCount}` : baseType;
  }

  const canRename = !!props.onCommitRename;
  const showVis = !!props.onToggleVisible && item.kind === 'entity';
  const collapsible = props.collapsible !== false;
  const showTwist = hasChildren && collapsible;

  return (
    <div
      className={
        `row${selected ? ' sel' : ''}` +
        `${expanded ? ' open' : ''}` +
        `${visible ? '' : ' hidden'}` +
        `${prefab ? ' prefab' : ''}` +
        `${isFolder ? ' folder' : ''}` +
        `${isDrop ? ' drop' : ''}`
      }
      style={{ paddingLeft: depth * 14 }}
      draggable={props.draggable && !renaming}
      onClick={(e) => props.onClick(item, e)}
      onContextMenu={props.onContextMenu ? (e) => props.onContextMenu!(e, item) : undefined}
      onDragStart={props.onDragStart ? (e) => props.onDragStart!(item, e) : undefined}
      onDragOver={props.onDragOver ? (e) => props.onDragOver!(item, e) : undefined}
      onDrop={props.onDrop ? (e) => props.onDrop!(item, e) : undefined}
    >
      <span
        className={`twist${showTwist ? '' : ' leaf'}`}
        onClick={(e) => {
          e.stopPropagation();
          if (showTwist) props.onToggle(item.key);
        }}
      >
        <ChevronRight size={9} strokeWidth={3} />
      </span>

      <span className="ricon">
        {item.kind === 'folder' ? (
          expanded ? <FolderOpen size={14} strokeWidth={1.85} /> : <Folder size={14} strokeWidth={1.85} />
        ) : (
          <NodeIcon kind={item.node.kind} />
        )}
      </span>

      {renaming && canRename ? (
        <input
          className="rname-edit"
          defaultValue={name}
          autoFocus
          spellCheck={false}
          onClick={(e) => e.stopPropagation()}
          onFocus={(e) => e.target.select()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            else if (e.key === 'Escape') {
              e.currentTarget.value = name;
              e.currentTarget.blur();
            }
          }}
          onBlur={(e) => props.onCommitRename!(item, e.target.value)}
        />
      ) : (
        <span
          className="rname"
          onDoubleClick={canRename && props.onStartRename ? () => props.onStartRename!(item) : undefined}
        >
          {name}
        </span>
      )}

      <span className="rtype">{typeLabel}</span>

      {showVis && (
        <span
          className="rvis"
          title="Toggle visibility"
          onClick={(e) => {
            e.stopPropagation();
            props.onToggleVisible!((item as { id: EntityId }).id, !visible);
          }}
        >
          {locked ? (
            <Lock size={12} strokeWidth={1.85} />
          ) : visible ? (
            <Eye size={13} strokeWidth={1.85} />
          ) : (
            <EyeOff size={13} strokeWidth={1.85} />
          )}
        </span>
      )}
    </div>
  );
}
