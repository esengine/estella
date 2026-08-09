// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  columns.tsx — the outliner's pluggable column registry.
 *
 * The Name/tree column is fixed (twist + icon + name, owned by OutlinerRow); every
 * TRAILING column — Type, Lock, Visibility — is a descriptor here, so the row +
 * header strip render from data and columns can be shown/hidden (and new ones
 * added) without touching the row. A column renders a cell per item, or an aligned
 * spacer where it doesn't apply, so the columns line up across entity/folder rows.
 */
import type { ReactNode } from 'react';
import { Eye, EyeOff, Lock, LockOpen } from 'lucide-react';
import { t } from '@/i18n';
import type { EntityId, NodeKind } from '@/types';
import type { OutlinerItem } from './OutlinerModel';

/** Per-render callbacks/queries a column cell may need (entity-scoped). */
export interface OutlinerColumnContext {
  onToggleVisible?: (id: EntityId, visible: boolean) => void;
  onToggleLock?: (id: EntityId, locked: boolean) => void;
  /** Whether an entity is a prefab instance (drives the Type column's "Prefab"). */
  isPrefab?: (id: EntityId) => boolean;
  /** Whether hiding this entity would do anything. Absent ⇒ always (an edited
   *  scene hides any entity, the flag being the editor's own). The running world
   *  answers false for a bare transform — its children draw, it doesn't — and
   *  that row gets no eye rather than one that quietly does nothing. */
  canToggleVisible?: (id: EntityId) => boolean;
}

export interface OutlinerColumn {
  id: string;
  /** Header label ('' = icon-only column, no header text). */
  header: string;
  width: number;
  /** Whether this column shows a cell for `item` (else an aligned spacer). Takes
   *  the same context `render` does, so "no cell here" can depend on the tree —
   *  the running world has rows with nothing to hide. */
  applies: (item: OutlinerItem, ctx: OutlinerColumnContext) => boolean;
  render: (item: OutlinerItem, ctx: OutlinerColumnContext) => ReactNode;
}

/**
 * Entity kind → the Type column's label, or '' for a kind that tells the reader
 * nothing. `empty` is every entity the classifier found no distinguishing
 * component on, so labelling it "Entity" set most of a scene's rows to a word
 * that is true of all of them; blank says the same thing without the noise.
 */
const KIND_TYPE: Record<NodeKind, string> = {
  camera: t('out.kindCamera'),
  sprite: t('out.kindSprite'),
  skeletal: t('out.kindSkeletal'),
  physics: t('out.kindPhysics'),
  ui: t('out.kindUi'),
  audio: t('out.kindAudio'),
  group: t('out.kindGroup'),
  light: t('out.kindLight'),
  empty: '',
};

/** Type column — what this row IS. Prefab instances read "Prefab", which the
 *  row's icon cannot say; everything else reads its kind. Counts are not a type
 *  and live next to the name (see OutlinerRow). */
export const TYPE_COLUMN: OutlinerColumn = {
  id: 'type',
  header: t('out.colType'),
  width: 78,
  applies: (item) => item.kind === 'entity',
  render: (item, ctx) => {
    if (item.kind !== 'entity') return null;
    const label = ctx.isPrefab?.(item.id) ? t('out.prefab') : KIND_TYPE[item.node.kind];
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
        title={locked ? t('out.unlock') : t('out.lock')}
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
  applies: (item, ctx) => item.kind === 'entity' && (ctx.canToggleVisible?.(item.id) ?? true),
  render: (item, ctx) => {
    if (item.kind !== 'entity') return null;
    const visible = item.node.visible;
    return (
      <span
        className="rvis"
        title={t('out.toggleVisibility')}
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
