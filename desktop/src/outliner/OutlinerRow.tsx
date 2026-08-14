// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  OutlinerRow.tsx — the ONE outliner row, shared by the editor + live-game trees.
 *
 * Purely presentational: selection / rename / drop / prefab state arrive as props
 * (it does NOT subscribe to any store), so with virtualization only the ~window of
 * visible rows ever renders or re-renders. The Name/tree part (twist + icon +
 * name) is fixed; the trailing cells come from the {@link OutlinerColumn} registry
 * — a column renders its cell, or an aligned spacer where it doesn't apply, so
 * columns line up across entity + folder rows. The live-game tree passes a
 * read-only column set and no edit handlers.
 */
import type React from 'react';
import { Fragment, memo } from 'react';
import { ChevronRight, Folder, FolderOpen } from 'lucide-react';
import { NodeIcon } from '@/components/icons';
import { t } from '@/i18n';
import type { ReactNode } from 'react';
import type { OutlinerItem } from './OutlinerModel';
import type { OutlinerColumn, OutlinerColumnContext } from './columns';

/** Wrap the first case-insensitive match of `hl` in the name with a highlight. */
function highlightName(name: string, hl?: string): ReactNode {
  if (!hl) return name;
  const i = name.toLowerCase().indexOf(hl);
  if (i < 0) return name;
  return (
    <>
      {name.slice(0, i)}
      <mark>{name.slice(i, i + hl.length)}</mark>
      {name.slice(i + hl.length)}
    </>
  );
}

export interface OutlinerRowProps {
  item: OutlinerItem;
  /** Entity selection highlight (folders highlight via the folder selection). */
  selected: boolean;
  /** The built-in agent changed this entity in the open conversation. */
  agentTouched?: boolean;
  /** …and it happened just now, rather than at some point in the conversation. */
  agentFresh?: boolean;
  /** The pointer is over a transcript row that names this entity. */
  agentPeeked?: boolean;
  /** The running game made this entity; no document row corresponds to it, and
   *  it is gone on Stop. */
  spawned?: boolean;
  /** The document has this entity, the running world no longer does. */
  gone?: boolean;
  /** Keyboard-focus row (shows a focus ring; distinct from selection). */
  cursored?: boolean;
  /** Lowercased substring to highlight in the name (the search bare text). */
  highlight?: string;
  renaming?: boolean;
  /** Active drop indicator: `on` (full row) or a between-rows insertion line. */
  dropPos?: 'before' | 'on' | 'after';
  /** Prefab-instance role (entity rows): `root` = the instance's top entity
   *  (warm name + icon), `member` = an entity inside the prefab (warm icon tint).
   *  Absent = not part of a prefab instance. */
  prefabRole?: 'root' | 'member';
  /** When false, the twist is hidden + non-interactive (the always-expanded live-game tree). */
  collapsible?: boolean;
  /** Trailing columns to render after the name (the column registry). */
  columns: OutlinerColumn[];
  /** Per-cell callbacks/queries for the columns. */
  columnCtx: OutlinerColumnContext;
  onToggle: (key: string) => void;
  onClick: (item: OutlinerItem, e: React.MouseEvent) => void;
  onContextMenu?: (e: React.MouseEvent, item: OutlinerItem) => void;
  onStartRename?: (item: OutlinerItem) => void;
  onCommitRename?: (item: OutlinerItem, name: string) => void;
  draggable?: boolean;
  onDragStart?: (item: OutlinerItem, e: React.DragEvent) => void;
  onDragOver?: (item: OutlinerItem, e: React.DragEvent) => void;
  onDrop?: (item: OutlinerItem, e: React.DragEvent) => void;
  onDragEnd?: (e: React.DragEvent) => void;
}

// Memoized: shared by the virtualized editor + game trees. A selection change
// re-renders only the rows whose props actually changed (the old/new selected
// row), not the whole visible window — provided the parent passes stable handlers.
function OutlinerRowInner(props: OutlinerRowProps) {
  const { item, selected, renaming, dropPos, prefabRole, columns, columnCtx } = props;
  const isFolder = item.kind === 'folder';
  const { depth, hasChildren, expanded } = item;

  const name = item.kind === 'folder' ? item.name : item.node.name;
  const visible = item.kind === 'entity' ? item.node.visible : true;
  // Dimmed the same way, because it IS the same fact on screen — the row is not
  // being drawn. The eye still reads this row's own flag, so clicking it is not
  // a no-op that quietly does nothing.
  const hiddenByAncestor = item.kind === 'entity' && !!item.node.hiddenByAncestor;
  const locked = item.kind === 'entity' ? item.node.locked : false;

  const canRename = !!props.onCommitRename;
  const collapsible = props.collapsible !== false;
  const showTwist = hasChildren && collapsible;
  const childCount = item.kind === 'folder' ? item.count : (item.node.children?.length ?? 0);
  // Both halves of "this row and the running game disagree" say so, not just the
  // destroyed one: a row nothing in the scene document explains is the one most
  // worth hovering.
  const runtimeTip = props.gone ? t('out.goneTip') : props.spawned ? t('out.spawnedTip') : undefined;

  return (
    <div
      className={
        `row${selected ? ' sel' : ''}` +
        `${props.cursored ? ' cursor' : ''}` +
        `${expanded ? ' open' : ''}` +
        `${visible && !hiddenByAncestor ? '' : ' hidden'}` +
        `${locked ? ' locked' : ''}` +
        `${prefabRole ? ' prefab' : ''}` +
        `${prefabRole === 'root' ? ' prefab-root' : ''}` +
        `${isFolder ? ' folder' : ''}` +
        `${dropPos === 'on' ? ' drop' : ''}` +
        `${dropPos === 'before' ? ' drop-before' : ''}` +
        `${dropPos === 'after' ? ' drop-after' : ''}` +
        `${props.agentTouched ? ' agent-touched' : ''}` +
        `${props.agentFresh ? ' agent-fresh' : ''}` +
        `${props.agentPeeked ? ' agent-peek' : ''}` +
        `${props.spawned ? ' spawned' : ''}` +
        `${props.gone ? ' gone' : ''}`
      }
      title={runtimeTip}
      style={{ paddingLeft: depth * 14 }}
      role="treeitem"
      aria-selected={selected}
      aria-expanded={hasChildren ? expanded : undefined}
      aria-level={depth + 1}
      draggable={props.draggable && !renaming}
      onClick={(e) => props.onClick(item, e)}
      onContextMenu={props.onContextMenu ? (e) => props.onContextMenu!(e, item) : undefined}
      onDragStart={props.onDragStart ? (e) => props.onDragStart!(item, e) : undefined}
      onDragOver={props.onDragOver ? (e) => props.onDragOver!(item, e) : undefined}
      onDrop={props.onDrop ? (e) => props.onDrop!(item, e) : undefined}
      onDragEnd={props.onDragEnd}
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
          {highlightName(name, props.highlight)}
          {/* "How many are inside me" — one fact, so a folder's items and an
              entity's children read the same way. Inside the name so it hugs the
              text; as a sibling it drifted to the far edge and collided with the
              Type column. */}
          {childCount > 0 && <span className="rcount">{childCount}</span>}
        </span>
      )}

      {columns.map((col) =>
        col.applies(item, columnCtx) ? (
          <Fragment key={col.id}>{col.render(item, columnCtx)}</Fragment>
        ) : (
          <span key={col.id} className="rcol-spacer" data-col={col.id} style={{ width: col.width }} />
        ),
      )}
    </div>
  );
}

export const OutlinerRow = memo(OutlinerRowInner);
