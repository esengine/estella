// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  columns.tsx — the outliner's pluggable column registry (UE5
 *        ISceneOutlinerColumn). The Name/tree column is fixed (twist + icon +
 *        name, owned by OutlinerRow); every TRAILING column — Type, Lock,
 *        Visibility — is a descriptor here, so the row + header strip render from
 *        data and columns can be shown/hidden (and new ones added) without
 *        touching the row. A column renders a cell per item, or an aligned spacer
 *        where it doesn't apply (so the columns line up across entity/folder rows).
 */
import type { ReactNode } from 'react';
import { Eye, EyeOff, Lock, LockOpen } from 'lucide-react';
import type { EntityId, NodeKind } from '@/types';
import type { OutlinerItem } from './OutlinerModel';

/** Per-render callbacks/queries a column cell may need (entity-scoped). */
export interface OutlinerColumnContext {
  onToggleVisible?: (id: EntityId, visible: boolean) => void;
  onToggleLock?: (id: EntityId, locked: boolean) => void;
  /** Whether an entity is a prefab instance (drives the Type column's "Prefab"). */
  isPrefab?: (id: EntityId) => boolean;
}

export interface OutlinerColumn {
  id: string;
  /** Header label ('' = icon-only column, no header text). */
  header: string;
  width: number;
  /** Whether this column shows a cell for `item` (else an aligned spacer). */
  applies: (item: OutlinerItem) => boolean;
  render: (item: OutlinerItem, ctx: OutlinerColumnContext) => ReactNode;
}

/** Entity kind → the label shown in the Type column. */
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

/** Type / count column — prefab instances read "Prefab", others by kind + child count. */
export const TYPE_COLUMN: OutlinerColumn = {
  id: 'type',
  header: 'Type',
  width: 78,
  applies: () => true,
  render: (item, ctx) => {
    let label: string;
    if (item.kind === 'folder') {
      label = item.count > 0 ? String(item.count) : '';
    } else {
      const childCount = item.node.children?.length ?? 0;
      const base = ctx.isPrefab?.(item.id) ? 'Prefab' : (KIND_TYPE[item.node.kind] ?? 'Entity');
      label = childCount > 0 ? `${base} · ${childCount}` : base;
    }
    return <span className="rtype">{label}</span>;
  },
};

/** Lock toggle (entity rows). */
export const LOCK_COLUMN: OutlinerColumn = {
  id: 'lock',
  header: '',
  width: 24,
  applies: (item) => item.kind === 'entity',
  render: (item, ctx) => {
    if (item.kind !== 'entity') return null;
    const locked = item.node.locked;
    return (
      <span
        className="rlock"
        title={locked ? 'Unlock' : 'Lock'}
        onClick={(e) => {
          e.stopPropagation();
          ctx.onToggleLock?.(item.id, !locked);
        }}
      >
        {locked ? <Lock size={12} strokeWidth={1.85} /> : <LockOpen size={12} strokeWidth={1.85} />}
      </span>
    );
  },
};

/** Visibility (editor-hidden) toggle (entity rows). */
export const VIS_COLUMN: OutlinerColumn = {
  id: 'vis',
  header: '',
  width: 24,
  applies: (item) => item.kind === 'entity',
  render: (item, ctx) => {
    if (item.kind !== 'entity') return null;
    const visible = item.node.visible;
    return (
      <span
        className="rvis"
        title="Toggle visibility"
        onClick={(e) => {
          e.stopPropagation();
          ctx.onToggleVisible?.(item.id, !visible);
        }}
      >
        {visible ? <Eye size={13} strokeWidth={1.85} /> : <EyeOff size={13} strokeWidth={1.85} />}
      </span>
    );
  },
};

/** The built-in column registry, in display order (after the Name/tree column). */
export const OUTLINER_COLUMNS: OutlinerColumn[] = [TYPE_COLUMN, LOCK_COLUMN, VIS_COLUMN];
