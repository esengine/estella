// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  CreatePopover.tsx — the "Create entity" picker.
 *
 * One anchored popover (search box + grouped, keyboard-navigable list) in place
 * of cascading Create submenus: no flyout geometry, so nothing zigzags or folds
 * over an earlier level near the window edge, and it scales as the template
 * catalog grows. Mirrors Godot's "Create Node" / Unity's "Add Component".
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Search } from 'lucide-react';
import { flattenCatalog, matchCatalog, type EntityTemplate } from '@/engine/entityTemplates';

export function CreatePopover({
  x,
  y,
  onPick,
  onClose,
}: {
  x: number;
  y: number;
  onPick: (t: EntityTemplate) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);

  const all = useMemo(() => flattenCatalog(), []);
  const results = useMemo(() => matchCatalog(all, query), [all, query]);

  // Keep the active row in range as the filter narrows.
  useEffect(() => setActive((i) => Math.min(i, Math.max(0, results.length - 1))), [results.length]);

  // Clamp to the viewport once, before paint (as the context menu does).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const pad = 8;
    const left = x + r.width > window.innerWidth - pad ? Math.max(pad, window.innerWidth - r.width - pad) : x;
    const top = y + r.height > window.innerHeight - pad ? Math.max(pad, window.innerHeight - r.height - pad) : y;
    setPos({ left, top });
  }, [x, y]);

  useEffect(() => {
    const close = () => onClose();
    const onEsc = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('mousedown', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('keydown', onEsc);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('keydown', onEsc);
    };
  }, [onClose]);

  const pick = (i: number) => {
    const e = results[i];
    if (!e) return;
    onClose();
    onPick(e.template);
  };

  const onKey = (ev: KeyboardEvent<HTMLDivElement>) => {
    if (ev.key === 'ArrowDown') { ev.preventDefault(); setActive((i) => Math.min(i + 1, results.length - 1)); }
    else if (ev.key === 'ArrowUp') { ev.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
    else if (ev.key === 'Enter') { ev.preventDefault(); pick(active); }
  };

  // `results` is already in display order, so the flat `active` index lines up
  // with the rendered rows; category headers are drawn on each change.
  let lastCategory = '';

  return createPortal(
    <div
      ref={ref}
      className="ctx"
      role="dialog"
      style={{ left: pos.left, top: pos.top, width: 240, maxHeight: 320, display: 'flex', flexDirection: 'column' }}
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={onKey}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
        <Search size={13} style={{ opacity: 0.5, flex: '0 0 auto' }} />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Create…"
          style={{ flex: 1, minWidth: 0, background: 'transparent', border: 0, outline: 'none', color: 'inherit', font: 'inherit' }}
        />
      </div>
      <div style={{ overflowY: 'auto', padding: '4px 0' }}>
        {results.length === 0 ? (
          <div style={{ padding: '6px 10px', opacity: 0.5 }}>No matches</div>
        ) : (
          results.map((e, idx) => {
            const header = e.category !== lastCategory ? e.category : null;
            lastCategory = e.category;
            return (
              <div key={`${e.category}/${e.template.label}`}>
                {header ? (
                  <div style={{ padding: '4px 10px 2px', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4, opacity: 0.45 }}>{header}</div>
                ) : null}
                <button
                  type="button"
                  role="menuitem"
                  className="ctx-item"
                  style={idx === active ? { background: 'rgba(255,255,255,0.10)' } : undefined}
                  onMouseEnter={() => setActive(idx)}
                  onClick={() => pick(idx)}
                >
                  <span className="cl">{e.template.label}</span>
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>,
    document.body,
  );
}
