/**
 * @file    Menu.tsx
 * @brief   Shared menu primitives — one implementation behind the menu-bar
 *          dropdowns and every right-click context menu, so item rendering
 *          (labels, shortcuts, checkmarks, disabled state, separators) and the
 *          context-menu dismiss behaviour live in a single place.
 */
import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Check } from 'lucide-react';

export type MenuItem =
  | { sep: true }
  | { label: string; shortcut?: string; onClick: () => void; disabled?: boolean; checked?: boolean };

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
 * cursor, dismissed on an outside press, a scroll, or Escape.
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
      className="menu-dropdown menu-dropdown--ctx"
      role="menu"
      style={{ left: x, top: y }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <MenuItems items={items} onSelect={onClose} />
    </div>,
    document.body,
  );
}
