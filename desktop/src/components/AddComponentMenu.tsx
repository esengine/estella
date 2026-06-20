/**
 * @file    AddComponentMenu.tsx
 * @brief   UE5-style "Add Component" picker — a portaled popover with a search
 *          box, category-grouped entries, per-component icons, and full keyboard
 *          navigation (type to filter, ↑/↓ to move, Enter to add, Esc to close).
 *          Replaces the flat ContextMenu list the inspector used before.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Search } from 'lucide-react';
import { ComponentIcon } from '@/components/icons';
import { CATEGORY_ORDER } from '@/engine/schema';

export interface AddComponentEntry {
  name: string;
  label: string;
  category: string;
}

const WIDTH = 248;
const MAX_H = 380;

function groupByCategory(entries: AddComponentEntry[]) {
  const byCat = new Map<string, AddComponentEntry[]>();
  for (const e of entries) {
    const list = byCat.get(e.category) ?? [];
    list.push(e);
    byCat.set(e.category, list);
  }
  const groups: { category: string; items: AddComponentEntry[] }[] = [];
  for (const cat of CATEGORY_ORDER) {
    const items = byCat.get(cat);
    if (items?.length) groups.push({ category: cat, items });
  }
  // Any category not in the canonical order (defensive) trails at the end.
  for (const [cat, items] of byCat) {
    if (!CATEGORY_ORDER.includes(cat as (typeof CATEGORY_ORDER)[number])) {
      groups.push({ category: cat, items });
    }
  }
  return groups;
}

export function AddComponentMenu({
  x,
  y,
  entries,
  onAdd,
  onClose,
}: {
  x: number;
  y: number;
  entries: AddComponentEntry[];
  onAdd: (name: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);

  // Focus the search on open (type-to-filter immediately, like UE5).
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Dismiss on an outside press (clicks inside stopPropagation below) or Esc.
  // Deliberately NOT on scroll: the picker owns a scrollable list (the wheel
  // scrolls it), and the popover is position:fixed so it stays put even if the
  // inspector behind scrolls — UE5 keeps the dropdown open while you scroll it.
  useEffect(() => {
    const close = () => onClose();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter(
      (e) => e.label.toLowerCase().includes(q) || e.name.toLowerCase().includes(q),
    );
  }, [entries, query]);

  const groups = useMemo(() => groupByCategory(filtered), [filtered]);
  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);

  // Reset the highlight whenever the result set changes.
  useEffect(() => {
    setActive(0);
  }, [query]);
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const commit = (name: string) => {
    onAdd(name);
    onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(flat.length - 1, a + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = flat[active];
      if (item) commit(item.name);
    }
  };

  // Keep the popover on-screen near the trigger.
  const left = Math.max(8, Math.min(x, window.innerWidth - WIDTH - 8));
  const top = Math.max(8, Math.min(y, window.innerHeight - MAX_H - 8));

  return createPortal(
    <div
      className="addcomp"
      role="menu"
      style={{ left, top, width: WIDTH, maxHeight: MAX_H }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="addcomp__search">
        <Search size={13} strokeWidth={1.9} />
        <input
          ref={inputRef}
          className="addcomp__input"
          placeholder="Search Components"
          value={query}
          spellCheck={false}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
        />
      </div>

      <div className="addcomp__list">
        {flat.length === 0 ? (
          <p className="addcomp__empty">
            {entries.length === 0 ? 'All components added' : 'No matching components'}
          </p>
        ) : (
          groups.map((g) => (
            <div key={g.category} className="addcomp__group">
              <div className="addcomp__cat">{g.category}</div>
              {g.items.map((it) => {
                const idx = flat.indexOf(it);
                const isActive = idx === active;
                return (
                  <button
                    key={it.name}
                    ref={isActive ? activeRef : undefined}
                    type="button"
                    role="menuitem"
                    className={`addcomp__item${isActive ? ' is-active' : ''}`}
                    onMouseEnter={() => setActive(idx)}
                    onClick={() => commit(it.name)}
                  >
                    <span className="addcomp__icon">
                      <ComponentIcon name={it.name} />
                    </span>
                    <span className="addcomp__label">{it.label}</span>
                  </button>
                );
              })}
            </div>
          ))
        )}
      </div>
    </div>,
    document.body,
  );
}
