// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  CreatePopover.tsx — the "Create entity" picker.
 *
 * A centered command-palette modal (search + category-grouped, keyboard-navigable
 * list) for creating entities from the source registry. Each row's icon comes from
 * the source itself — the picker holds no icon knowledge. Shares the `.ac` picker
 * shell + behaviour with AddComponentMenu, so the two read as one design and the
 * scrim/scroll dismissal is consistent: clicks inside stay open, the wheel scrolls
 * the list (never dismisses), only the scrim / Esc close it.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ENTITY_SOURCES, userComponentSources, matchSources, type EntitySource } from '@/engine/entitySources';
import { ProjectStore } from '@/project/ProjectStore';
import { SearchField } from '@/components/SearchField';
import { useDialogFocus } from '@/components/dialogFocus';

/** Group consecutive sources by category (the registry is already category-ordered). */
function groupByCategory(items: EntitySource[]) {
  const groups: { category: string; items: EntitySource[] }[] = [];
  for (const it of items) {
    let g = groups[groups.length - 1];
    if (!g || g.category !== it.category) {
      g = { category: it.category, items: [] };
      groups.push(g);
    }
    g.items.push(it);
  }
  return groups;
}

export function CreatePopover({
  onPick,
  onClose,
}: {
  onPick: (s: EntitySource) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  useDialogFocus(shellRef);

  // Static builtins + the user's own components + the project's prefab assets;
  // computed once when the popover opens.
  const all = useMemo(() => [...ENTITY_SOURCES, ...userComponentSources(), ...ProjectStore.prefabSources()], []);
  const results = useMemo(() => matchSources(all, query), [all, query]);
  const groups = useMemo(() => groupByCategory(results), [results]);

  useEffect(() => inputRef.current?.focus(), []);
  useEffect(() => setActive(0), [query]);
  useEffect(() => activeRef.current?.scrollIntoView({ block: 'nearest' }), [active]);

  // Dismiss on an outside press (inside clicks stopPropagation below) or Esc.
  // Deliberately NOT on scroll — the picker owns a scrollable list.
  useEffect(() => {
    const close = () => onClose();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const commit = (s: EntitySource) => {
    onClose();
    onPick(s);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(results.length - 1, a + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); const it = results[active]; if (it) commit(it); }
    else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
  };

  return createPortal(
    <div className="ac-scrim open" onMouseDown={onClose}>
      <div ref={shellRef} className="ac" role="dialog" aria-modal="true" aria-label="Create entity" tabIndex={-1} onMouseDown={(e) => e.stopPropagation()}>
        <SearchField
          flush
          className="ac-search"
          iconSize={15}
          inputRef={inputRef}
          placeholder="Create entity…"
          value={query}
          onChange={setQuery}
          onKeyDown={onKeyDown}
        >
          <kbd className="esc">Esc</kbd>
        </SearchField>

        <div className="ac-body">
          {results.length === 0 ? (
            <div className="empty-line">No matching templates</div>
          ) : (
            groups.map((g) => (
              <div key={g.category}>
                <div className="ac-sec">{g.category}</div>
                {g.items.map((it) => {
                  const idx = results.indexOf(it);
                  const isActive = idx === active;
                  const Icon = it.icon;
                  return (
                    <button
                      key={it.id}
                      ref={isActive ? activeRef : undefined}
                      type="button"
                      className={`ac-item${isActive ? ' sel' : ''}`}
                      onMouseEnter={() => setActive(idx)}
                      onClick={() => commit(it)}
                    >
                      <span className="ai"><Icon size={16} /></span>
                      <span className="at">
                        <div className="an">{it.label}</div>
                      </span>
                      <span className="ak">↵</span>
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
