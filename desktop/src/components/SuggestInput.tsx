// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    SuggestInput.tsx
 * @brief   A free-text input with a grouped suggestion popover — the upgrade
 *          path from a bare <datalist>: candidates group by their `namespace.`
 *          prefix (un-namespaced project names first, no header), each may
 *          carry a description (builtins say what they do), and the list is
 *          keyboard-operable (arrows move, Enter picks or commits the raw
 *          text, Escape closes). Free text stays legal — the registry only
 *          knows names registered in the edit realm; a game can register more
 *          at runtime. List styling reuses the `.dd-*` popover vocabulary.
 */
import { useMemo, useRef, useState } from 'react';
import { Popover, usePopover } from './Popover';

export interface SuggestItem {
  value: string;
  /** One-line "what it does" (shown dimmed under the name; builtins carry these). */
  desc?: string;
}

export type SuggestRow = { kind: 'header'; label: string } | { kind: 'item'; item: SuggestItem; index: number };
type Row = SuggestRow;

// Group by the `namespace.` prefix: un-namespaced names first (no header — a
// project's own vocabulary), then each namespace under a header, alphabetically.
// Pure and exported so the grouping/filter contract is unit-testable.
export function buildSuggestRows(items: SuggestItem[], query: string): { rows: Row[]; flat: SuggestItem[] } {
  const q = query.trim().toLowerCase();
  const hits = q ? items.filter((i) => i.value.toLowerCase().includes(q)) : items;
  const groups = new Map<string, SuggestItem[]>();
  for (const it of hits) {
    const dot = it.value.indexOf('.');
    const g = dot > 0 ? it.value.slice(0, dot) : '';
    const list = groups.get(g);
    if (list) list.push(it);
    else groups.set(g, [it]);
  }
  const names = [...groups.keys()].sort((a, b) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b)));
  const rows: Row[] = [];
  const flat: SuggestItem[] = [];
  for (const g of names) {
    if (g !== '') rows.push({ kind: 'header', label: g });
    for (const item of groups.get(g)!) {
      rows.push({ kind: 'item', item, index: flat.length });
      flat.push(item);
    }
  }
  return { rows, flat };
}

export function SuggestInput({
  defaultValue,
  items,
  placeholder,
  ariaLabel,
  onCommit,
}: {
  /** Initial text; callers remount via `key` on external change (defaultValue pattern). */
  defaultValue: string;
  items: SuggestItem[];
  placeholder?: string;
  ariaLabel?: string;
  /** Fired on blur/Enter/pick with the final text (caller decides if it changed). */
  onCommit: (v: string) => void;
}) {
  const pop = usePopover();
  const input = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(defaultValue);
  const [active, setActive] = useState(-1);
  // A mousedown pick commits via click while keeping input focus — the blur
  // that follows must not double-commit the stale raw text.
  const picked = useRef(false);

  const { rows, flat } = useMemo(() => buildSuggestRows(items, text), [items, text]);

  const openList = () => {
    if (!pop.isOpen && items.length > 0) pop.open(input.current);
  };
  const commit = (v: string) => {
    pop.close();
    setActive(-1);
    onCommit(v.trim());
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!pop.isOpen) return openList();
      if (!flat.length) return;
      const d = e.key === 'ArrowDown' ? 1 : -1;
      setActive((a) => (a + d + flat.length) % flat.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const chosen = active >= 0 && active < flat.length ? flat[active].value : text;
      setText(chosen);
      commit(chosen);
    } else if (e.key === 'Escape' && pop.isOpen) {
      e.stopPropagation(); // just close the list; a second Escape can bubble
      pop.close();
      setActive(-1);
    }
  };

  return (
    <>
      <input
        ref={input}
        className="ng-input"
        value={text}
        placeholder={placeholder}
        aria-label={ariaLabel}
        aria-expanded={pop.isOpen}
        role="combobox"
        onChange={(e) => {
          setText(e.target.value);
          setActive(-1);
          openList();
        }}
        onFocus={openList}
        onKeyDown={onKeyDown}
        onBlur={() => {
          if (picked.current) {
            picked.current = false;
            return;
          }
          commit(text);
        }}
      />
      {pop.anchor && rows.length > 0 && (
        <Popover anchor={pop.anchor} width={Math.max(pop.anchor.width, 180)} onClose={() => pop.close()}>
          <div className="dd-list" role="listbox">
            {rows.map((r) =>
              r.kind === 'header' ? (
                <div key={`h:${r.label}`} className="dd-grp">{r.label}</div>
              ) : (
                <button
                  key={r.item.value}
                  type="button"
                  role="option"
                  aria-selected={r.index === active}
                  className={`dd-opt${r.index === active ? ' on' : ''}`}
                  // Commit on mousedown-then-click without surrendering input focus,
                  // so the input's blur never fires a stale raw-text commit.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    picked.current = true;
                  }}
                  onClick={() => {
                    setText(r.item.value);
                    commit(r.item.value);
                    picked.current = false;
                  }}
                >
                  <span className="dd-opt-label">
                    {r.item.value}
                    {r.item.desc && <span className="dd-opt-desc">{r.item.desc}</span>}
                  </span>
                </button>
              ),
            )}
          </div>
        </Popover>
      )}
    </>
  );
}
