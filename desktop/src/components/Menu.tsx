/**
 * @file    Menu.tsx
 * @brief   Shared menu primitives — one implementation behind the menu-bar
 *          dropdowns and every right-click context menu, so item rendering
 *          (labels, shortcuts, checkmarks, disabled state, separators) and the
 *          context-menu dismiss behaviour live in a single place.
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check } from 'lucide-react';

export type MenuItem =
  | { sep: true }
  | {
      label: string;
      shortcut?: string;
      onClick: () => void;
      disabled?: boolean;
      checked?: boolean;
      icon?: ReactNode;
      danger?: boolean;
    };

/**
 * The contents of a menu — separators and item buttons. Renders inside a
 * positioned `.menu-dropdown` container (the menu-bar provides one; ContextMenu
 * provides its own). Closes the menu via `onSelect` before running the action.
 */
export function MenuItems({ items, onSelect }: { items: MenuItem[]; onSelect: () => void }) {
  return (
    <>
      {items.map((it, i) =>
        'sep' in it ? (
          <div key={i} className="menu-dropdown__sep" />
        ) : (
          <button
            key={i}
            type="button"
            role="menuitem"
            className="menu-dropdown__item"
            disabled={it.disabled}
            onClick={() => {
              onSelect();
              it.onClick();
            }}
          >
            <span className="menu-dropdown__check">
              {it.checked ? <Check size={13} strokeWidth={2.2} /> : null}
            </span>
            <span className="menu-dropdown__label">{it.label}</span>
            {it.shortcut ? <span className="menu-dropdown__shortcut">{it.shortcut}</span> : null}
          </button>
        ),
      )}
    </>
  );
}

/**
 * A right-click context menu: portaled to the document body, positioned at the
 * cursor, dismissed on an outside press, a scroll, or Escape. The position is
 * clamped to the viewport after measuring — so a menu summoned near the right or
 * bottom edge (e.g. the inspector's component "⋯") flips back on-screen instead
 * of overflowing the window and getting clipped.
 */
export function ContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  // Measure the rendered menu and pull it back inside the viewport (runs before
  // paint, so the clamped position is the first thing shown — no flash off-edge).
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
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={ref}
      className="ctx"
      role="menu"
      style={{ left: pos.left, top: pos.top }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {items.map((it, i) =>
        'sep' in it ? (
          <div key={i} className="ctx-sep" />
        ) : (
          <button
            key={i}
            type="button"
            role="menuitem"
            className={`ctx-item${it.danger ? ' danger' : ''}`}
            disabled={it.disabled}
            onClick={() => {
              onClose();
              it.onClick();
            }}
          >
            <span className="ci">{it.checked ? <Check size={13} strokeWidth={2.4} /> : it.icon}</span>
            <span className="cl">{it.label}</span>
            {it.shortcut ? <span className="ck">{it.shortcut}</span> : null}
          </button>
        ),
      )}
    </div>,
    document.body,
  );
}
