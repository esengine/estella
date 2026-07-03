// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    Menu.tsx
 * @brief   Shared menu primitives — one implementation behind the menu-bar
 *          dropdowns and every right-click context menu, so item rendering
 *          (labels, shortcuts, checkmarks, disabled state, separators, nested
 *          submenus) and the context-menu dismiss behaviour live in one place.
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronRight } from 'lucide-react';

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
    }
  | { label: string; submenu: MenuItem[]; icon?: ReactNode; disabled?: boolean };

type Variant = 'bar' | 'ctx';
const cls = (v: Variant, ctx: string, bar: string) => (v === 'ctx' ? ctx : bar);

/** One menu row: separator, a flyout submenu, or a leaf action. */
function MenuNode({ item, variant, close }: { item: MenuItem; variant: Variant; close: () => void }) {
  const [open, setOpen] = useState(false);

  if ('sep' in item) return <div className={cls(variant, 'ctx-sep', 'menu-dropdown__sep')} />;

  const itemClass = cls(variant, 'ctx-item', 'menu-dropdown__item');
  const leadClass = cls(variant, 'ci', 'menu-dropdown__check');
  const labelClass = cls(variant, 'cl', 'menu-dropdown__label');
  const trailClass = cls(variant, 'ck', 'menu-dropdown__shortcut');

  if ('submenu' in item) {
    return (
      <div
        style={{ position: 'relative' }}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
      >
        <button type="button" role="menuitem" className={itemClass} disabled={item.disabled} aria-haspopup="true" aria-expanded={open}>
          <span className={leadClass}>{item.icon}</span>
          <span className={labelClass}>{item.label}</span>
          <span className={trailClass}><ChevronRight size={13} strokeWidth={2.2} /></span>
        </button>
        {open ? (
          <div
            className={cls(variant, 'ctx', 'menu-dropdown')}
            role="menu"
            style={{ position: 'absolute', left: '100%', top: 0 }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            {item.submenu.map((sub, j) => <MenuNode key={j} item={sub} variant={variant} close={close} />)}
          </div>
        ) : null}
      </div>
    );
  }

  const danger = variant === 'ctx' && item.danger ? ' danger' : '';
  const checkSize = variant === 'ctx' ? 2.4 : 2.2;
  return (
    <button
      type="button"
      role="menuitem"
      className={itemClass + danger}
      disabled={item.disabled}
      onClick={() => {
        close();
        item.onClick();
      }}
    >
      <span className={leadClass}>{item.checked ? <Check size={13} strokeWidth={checkSize} /> : item.icon}</span>
      <span className={labelClass}>{item.label}</span>
      {item.shortcut ? <span className={trailClass}>{item.shortcut}</span> : null}
    </button>
  );
}

/**
 * The contents of a menu — separators, submenus and item buttons. Renders inside a
 * positioned `.menu-dropdown` container (the menu-bar provides one; ContextMenu
 * provides its own). Closes the menu via `onSelect` before running the action.
 */
export function MenuItems({ items, onSelect }: { items: MenuItem[]; onSelect: () => void }) {
  return (
    <>
      {items.map((it, i) => <MenuNode key={i} item={it} variant="bar" close={onSelect} />)}
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
      {items.map((it, i) => <MenuNode key={i} item={it} variant="ctx" close={onClose} />)}
    </div>,
    document.body,
  );
}
