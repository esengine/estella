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
import { allEntitySources, matchSources, CREATE_CATEGORY_ORDER, type EntitySource } from '@/engine/entitySources';
import { SearchField } from '@/components/SearchField';
import { useDialogFocus } from '@/components/dialogFocus';
import { useHoverSelect } from '@/components/hoverSelect';
import { usePanelWindow } from '@/components/PanelWindow';
import { t } from '@/i18n';

/** Group sources by category, ordered by CREATE_CATEGORY_ORDER — sources arrive in
 *  mixed category order now that anchors are auto-generated and dynamic sources
 *  (user components, prefabs) are appended. Unknown categories trail at the end. */
function groupByCategory(items: EntitySource[]) {
  const byCat = new Map<string, EntitySource[]>();
  for (const it of items) {
    const arr = byCat.get(it.category);
    if (arr) arr.push(it);
    else byCat.set(it.category, [it]);
  }
  const rank = (c: string) => {
    const i = CREATE_CATEGORY_ORDER.indexOf(c);
    return i < 0 ? CREATE_CATEGORY_ORDER.length : i;
  };
  return [...byCat.entries()]
    .sort((a, b) => rank(a[0]) - rank(b[0]))
    .map(([category, items]) => ({ category, items }));
}

export function CreatePopover({
  onPick,
  onClose,
}: {
  onPick: (s: EntitySource) => void;
  onClose: () => void;
}) {
  const win = usePanelWindow();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  useDialogFocus(shellRef);
  const hoverSelect = useHoverSelect();

  // Static builtins + the project's own components + its prefab assets. Computed
  // once per open, which is once per mount — the popover is unmounted when closed.
  const all = useMemo(() => allEntitySources(), []);
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
    win.addEventListener('mousedown', close);
    win.addEventListener('keydown', onKey);
    return () => {
      win.removeEventListener('mousedown', close);
      win.removeEventListener('keydown', onKey);
    };
  }, [onClose, win]);

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
      <div ref={shellRef} className="ac" role="dialog" aria-modal="true" aria-label={t('cb.createEntity')} tabIndex={-1} onMouseDown={(e) => e.stopPropagation()}>
        <SearchField
          flush
          className="ac-search"
          iconSize={15}
          inputRef={inputRef}
          placeholder={t('cb.createEntityPlaceholder')}
          value={query}
          onChange={setQuery}
          onKeyDown={onKeyDown}
        >
          <kbd className="esc">Esc</kbd>
        </SearchField>

        <div className="ac-body">
          {results.length === 0 ? (
            <div className="empty-line">{t('cb.noMatchingTemplates')}</div>
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
                      {...hoverSelect(() => setActive(idx))}
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
    win.document.body,
  );
}
