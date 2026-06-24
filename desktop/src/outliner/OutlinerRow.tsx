// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
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
import { Fragment } from 'react';
import { ChevronRight, Folder, FolderOpen } from 'lucide-react';
import { NodeIcon } from '@/components/icons';
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
  /** Keyboard-focus row (shows a focus ring; distinct from selection). */
  cursored?: boolean;
  /** Lowercased substring to highlight in the name (the search bare text). */
  highlight?: string;
  renaming?: boolean;
  /** Active drop indicator: `on` (full row) or a between-rows insertion line. */
  dropPos?: 'before' | 'on' | 'after';
  /** Prefab-instance member — warm icon tint (entity rows only). */
  prefab?: boolean;
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

export function OutlinerRow(props: OutlinerRowProps) {
  const { item, selected, renaming, dropPos, prefab, columns, columnCtx } = props;
  const isFolder = item.kind === 'folder';
  const { depth, hasChildren, expanded } = item;

  const name = item.kind === 'folder' ? item.name : item.node.name;
  const visible = item.kind === 'entity' ? item.node.visible : true;
  const locked = item.kind === 'entity' ? item.node.locked : false;

  const canRename = !!props.onCommitRename;
  const collapsible = props.collapsible !== false;
  const showTwist = hasChildren && collapsible;

  return (
    <div
      className={
        `row${selected ? ' sel' : ''}` +
        `${props.cursored ? ' cursor' : ''}` +
        `${expanded ? ' open' : ''}` +
        `${visible ? '' : ' hidden'}` +
        `${locked ? ' locked' : ''}` +
        `${prefab ? ' prefab' : ''}` +
        `${isFolder ? ' folder' : ''}` +
        `${dropPos === 'on' ? ' drop' : ''}` +
        `${dropPos === 'before' ? ' drop-before' : ''}` +
        `${dropPos === 'after' ? ' drop-after' : ''}`
      }
      style={{ paddingLeft: depth * 14 }}
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
        </span>
      )}

      {columns.map((col) =>
        col.applies(item) ? (
          <Fragment key={col.id}>{col.render(item, columnCtx)}</Fragment>
        ) : (
          <span key={col.id} className="rcol-spacer" style={{ width: col.width }} />
        ),
      )}
    </div>
  );
}
