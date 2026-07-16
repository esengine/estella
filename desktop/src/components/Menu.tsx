// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    Menu.tsx
 * @brief   Shared menu primitives — one implementation behind the menu-bar
 *          dropdowns and every right-click context menu, so item rendering
 *          (labels, shortcuts, checkmarks, disabled state, separators) and the
 *          context-menu dismiss behaviour live in a single place.
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronRight } from 'lucide-react';
import { usePanelWindow } from '@/components/PanelWindow';

export type MenuItem =
  | { sep: true }
  | {
      label: string;
      shortcut?: string;
      onClick?: () => void;
      /** Submenu — the item opens a flyout on hover (ContextMenu only); onClick is ignored. */
      children?: MenuItem[];
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
              it.onClick?.();
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

/** Direct items of a menu container — nested submenu flyouts are their own
 *  `[role="menu"]` containers with their own handler, so they're excluded. */
function ownMenuItems(container: HTMLElement): HTMLButtonElement[] {
  return [...container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')].filter(
    (el) => el.closest('[role="menu"]') === container,
  );
}

/**
 * Keyboard navigation for one menu container: ↑/↓ move (wrapping), Home/End
 * jump, and a printable character jumps to the next item starting with it.
 * Returns true when the key was handled (consumed + propagation stopped).
 * Enter/Space activate natively — items are real buttons.
 */
export function handleMenuListKey(e: React.KeyboardEvent, container: HTMLElement | null): boolean {
  if (!container) return false;
  const items = ownMenuItems(container);
  if (items.length === 0) return false;
  // The focused item lives in the container's own document — which is the popout
  // window's document when this menu was summoned there, not the main window's.
  const idx = items.indexOf(container.ownerDocument.activeElement as HTMLButtonElement);
  const focusAt = (i: number) => items[((i % items.length) + items.length) % items.length].focus();
  if (e.key === 'ArrowDown') focusAt(idx + 1);
  else if (e.key === 'ArrowUp') focusAt(idx < 0 ? -1 : idx - 1);
  else if (e.key === 'Home') focusAt(0);
  else if (e.key === 'End') focusAt(-1);
  else if (e.key.length === 1 && e.key !== ' ' && !e.ctrlKey && !e.metaKey && !e.altKey) {
    const q = e.key.toLowerCase();
    const order = [...items.slice(idx + 1), ...items.slice(0, idx + 1)];
    const hit = order.find((b) => (b.textContent ?? '').trim().toLowerCase().startsWith(q));
    if (!hit) return false;
    hit.focus();
  } else return false;
  e.preventDefault();
  e.stopPropagation();
  return true;
}

/** Margin kept between any floating menu and the window edge. */
const VIEWPORT_PAD = 8;

/** Pull a measured floating rect fully inside `win`'s viewport on both axes. */
function clampToViewport(left: number, top: number, width: number, height: number, win: Window) {
  return {
    left: Math.max(VIEWPORT_PAD, Math.min(left, win.innerWidth - width - VIEWPORT_PAD)),
    top: Math.max(VIEWPORT_PAD, Math.min(top, win.innerHeight - height - VIEWPORT_PAD)),
  };
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
  const win = usePanelWindow();
  const doc = win.document;
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  // Who had focus when the menu opened (captured at first render, before the
  // seed-focus effect steals it) — keyboard focus returns there on close.
  const opener = useRef<HTMLElement | null>(doc.activeElement as HTMLElement | null);

  // Restore focus to the opener — unless the dismissal itself moved focus
  // somewhere real (outside-press on another control must keep that focus).
  useEffect(
    () => () => {
      const cur = doc.activeElement;
      const stillOurs = cur == null || cur === doc.body || (ref.current?.contains(cur) ?? false);
      const el = opener.current;
      if (stillOurs && el && doc.contains(el)) el.focus();
    },
    [doc],
  );

  // Measure the rendered menu and pull it back inside the viewport (runs before
  // paint, so the clamped position is the first thing shown — no flash off-edge).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos(clampToViewport(x, y, r.width, r.height, win));
  }, [x, y, win]);

  // Seed focus on the first item so arrow keys work immediately (a mouse-opened
  // menu shows no ring — :focus-visible only matches keyboard focus).
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('.ctx-item:not(:disabled)')?.focus();
  }, []);

  useEffect(() => {
    const close = () => onClose();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    win.addEventListener('mousedown', close);
    win.addEventListener('scroll', close, true);
    win.addEventListener('keydown', onKey);
    return () => {
      win.removeEventListener('mousedown', close);
      win.removeEventListener('scroll', close, true);
      win.removeEventListener('keydown', onKey);
    };
  }, [onClose, win]);

  return createPortal(
    <div
      ref={ref}
      className="ctx"
      role="menu"
      style={{ left: pos.left, top: pos.top }}
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => handleMenuListKey(e, ref.current)}
    >
      <CtxItems items={items} onClose={onClose} />
    </div>,
    doc.body,
  );
}

// Context-menu item list; an item with `children` opens a hover flyout beside it.
function CtxItems({ items, onClose }: { items: MenuItem[]; onClose: () => void }) {
  const [open, setOpen] = useState<{ i: number; anchor: HTMLElement } | null>(null);
  return (
    <>
      {items.map((it, i) =>
        'sep' in it ? (
          <div key={i} className="ctx-sep" />
        ) : it.children ? (
          <div
            key={i}
            className="ctx-sub"
            onMouseEnter={(e) => setOpen({ i, anchor: e.currentTarget })}
            onMouseLeave={() => setOpen((o) => (o?.i === i ? null : o))}
          >
            <button
              type="button"
              role="menuitem"
              className="ctx-item"
              aria-haspopup="menu"
              aria-expanded={open?.i === i}
              disabled={it.disabled}
              onKeyDown={(e) => {
                if (e.key !== 'ArrowRight' && e.key !== 'Enter' && e.key !== ' ') return;
                e.preventDefault();
                e.stopPropagation();
                setOpen({ i, anchor: e.currentTarget.parentElement as HTMLElement });
              }}
            >
              <span className="ci">{it.icon}</span>
              <span className="cl">{it.label}</span>
              <span className="ck"><ChevronRight size={12} /></span>
            </button>
            {open?.i === i ? (
              <CtxFlyout
                anchor={open.anchor}
                items={it.children}
                onClose={onClose}
                onBack={() => {
                  const item = open.anchor.querySelector<HTMLButtonElement>('.ctx-item');
                  setOpen(null);
                  item?.focus();
                }}
              />
            ) : null}
          </div>
        ) : (
          <button
            key={i}
            type="button"
            role="menuitem"
            className={`ctx-item${it.danger ? ' danger' : ''}`}
            disabled={it.disabled}
            onClick={() => {
              onClose();
              it.onClick?.();
            }}
          >
            <span className="ci">{it.checked ? <Check size={13} strokeWidth={2.4} /> : it.icon}</span>
            <span className="cl">{it.label}</span>
            {it.shortcut ? <span className="ck">{it.shortcut}</span> : null}
          </button>
        ),
      )}
    </>
  );
}

/**
 * A submenu flyout, positioned in viewport coordinates the same way the root
 * menu is: render beside the anchor item, measure before paint, flip to the
 * left when the right edge won't fit, and clamp both axes into the viewport —
 * so a tall submenu summoned near the bottom shifts up instead of getting
 * clipped by the window. Stays a DOM child of `.ctx-sub` so the hover
 * open/close chain keeps working at any nesting depth.
 */
function CtxFlyout({
  anchor,
  items,
  onClose,
  onBack,
}: {
  anchor: HTMLElement;
  items: MenuItem[];
  onClose: () => void;
  /** ← pressed inside the flyout: close it and refocus the parent item. */
  onBack?: () => void;
}) {
  const win = usePanelWindow();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: 0, top: 0 });

  // A keyboard-opened flyout should be immediately navigable.
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('.ctx-item:not(:disabled)')?.focus();
  }, []);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const a = anchor.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    // Prefer the right side; the 4px overlap keeps the pointer's path from the
    // parent item into the flyout unbroken. -5px lines the first flyout item up
    // with the anchor row (menu padding + border).
    let left = a.right - 4;
    if (left + r.width > win.innerWidth - VIEWPORT_PAD) left = a.left - r.width + 4;
    setPos(clampToViewport(left, a.top - 5, r.width, r.height, win));
  }, [anchor, win]);

  return (
    <div
      ref={ref}
      className="ctx ctx-flyout"
      role="menu"
      style={{ left: pos.left, top: pos.top }}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          e.stopPropagation();
          onBack?.();
          return;
        }
        handleMenuListKey(e, ref.current);
      }}
    >
      <CtxItems items={items} onClose={onClose} />
    </div>
  );
}
