// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
// Top menu bar — functional dropdowns wired to the real editor commands
// (project open/save, history, entity ops, view toggles), in a classic menu idiom.
// The window is frameless (macOS: hiddenInset with native traffic lights;
// Windows/Linux: our own WindowControls), so this strip doubles as the drag
// region; the menus, dropdowns, and window controls opt out of dragging.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { WindowControls } from '@/layout/WindowControls';
import { DirtyDot } from '@/components/DirtyDot';
import { ProjectStore } from '@/project/ProjectStore';
import { EditorHistory } from '@/engine/EditorHistory';
import { MenuItems, handleMenuListKey, type MenuItem } from '@/components/Menu';
import { commands, formatKeybinding } from '@/commands';
import { menuBarMenus, menuItemGroups, menuRegistry, menuItemRegistry } from '@/layout/menus';
import { t } from '@/i18n';

/**
 * One menu's rows, built from the menu registry at render time — so enablement and
 * checked state read fresh from the domain stores every time a menu opens, exactly
 * as the hand-written array's cmdItem() calls did.
 *
 * Separators are derived from the item groups, never authored: a gated or retracted
 * row can't leave a dangling separator behind.
 */
function menuItemsFor(location: string): MenuItem[] {
  const out: MenuItem[] = [];
  for (const group of menuItemGroups(location)) {
    const rows: MenuItem[] = [];
    for (const item of group) {
      if (!item.command) {
        if (item.label && item.run) rows.push({ label: item.label(), onClick: item.run });
        continue;
      }
      const command = commands.get(item.command);
      if (!command) continue; // the command went away with its plugin
      const chord = commands.keybindingFor(item.command);
      rows.push({
        label: item.label?.() ?? command.label,
        shortcut: chord ? formatKeybinding(chord) : undefined,
        onClick: () => commands.run(item.command!),
        disabled: !commands.isEnabled(item.command),
        checked: commands.isChecked(item.command),
      });
    }
    if (!rows.length) continue;
    if (out.length) out.push({ sep: true });
    out.push(...rows);
  }
  return out;
}

function Mark() {
  // The signature: Estella's four-point star ("Estella" = star). The faceted brand
  // mark, flattened to a single azure silhouette so it stays crisp at chrome scale.
  return (
    <svg width="16" height="16" viewBox="0 0 100 100" aria-hidden="true">
      <path
        d="M50 6 L58 42 L94 50 L58 58 L50 94 L42 58 L6 50 L42 42 Z"
        fill="var(--star)"
      />
    </svg>
  );
}

export function MenuBar() {
  const [open, setOpen] = useState<string | null>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const btnRefs = useRef(new Map<string, HTMLButtonElement>());

  // Only the always-visible project label needs a live subscription. Menu items
  // are rebuilt from the command registry each time a menu opens (a re-render),
  // so their enabled / checked state reads fresh from the domain stores then.
  const project = useSyncExternalStore(ProjectStore.subscribe, ProjectStore.getSnapshot);
  // Unsaved-changes star next to the scene name (UE's modified-document indicator).
  const dirty = useSyncExternalStore(EditorHistory.subscribe, EditorHistory.isDirty);
  // Re-render when the menu set changes, so a contributed row appears (and a
  // retracted one disappears) without waiting for some other store to tick.
  useSyncExternalStore(menuItemRegistry.subscribe.bind(menuItemRegistry), menuItemRegistry.getRevision.bind(menuItemRegistry));
  useSyncExternalStore(menuRegistry.subscribe.bind(menuRegistry), menuRegistry.getRevision.bind(menuRegistry));

  // Close the open menu on an outside click or Escape (Escape hands focus back
  // to the menu's own button so keyboard flow continues at the menubar).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) setOpen(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(null);
        btnRefs.current.get(open)?.focus();
      }
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Menus and their rows both come from the registry; a menu holding no visible
  // rows is dropped, so an empty dropdown can never open.
  const menus = menuBarMenus()
    .map((m) => ({ id: m.id, title: m.title(), items: menuItemsFor(m.id) }))
    .filter((m) => m.items.length > 0);

  return (
    <div className="menubar" ref={barRef}>
      <div className="brand">
        <span className="brand-mark">
          <Mark />
        </span>
        <span className="brand-name">Estella</span>
      </div>
      <nav className="menus">
        {menus.map((m) => (
          <div
            key={m.id}
            className="menubar__menu"
            style={{ position: 'relative', display: 'flex' }}
            onKeyDown={(e) => {
              if (open !== m.id) return;
              // ←/→ walk the menubar while a menu is open; ↓/↑ and typeahead
              // navigate the open dropdown (the shared menu-list handler).
              if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                e.preventDefault();
                const i = menus.findIndex((mm) => mm.id === open);
                const next = menus[(i + (e.key === 'ArrowRight' ? 1 : -1) + menus.length) % menus.length].id;
                setOpen(next);
                btnRefs.current.get(next)?.focus();
                return;
              }
              handleMenuListKey(e, e.currentTarget.querySelector<HTMLElement>('.menu-dropdown'));
            }}
          >
            <button
              ref={(el) => {
                if (el) btnRefs.current.set(m.id, el);
                else btnRefs.current.delete(m.id);
              }}
              className={`menu${open === m.id ? ' is-open' : ''}`}
              type="button"
              aria-haspopup="menu"
              aria-expanded={open === m.id}
              onClick={() => setOpen((o) => (o === m.id ? null : m.id))}
              onMouseEnter={() => setOpen((o) => (o ? m.id : o))}
            >
              {m.title}
            </button>
            {open === m.id && (
              <div className="menu-dropdown" role="menu">
                <MenuItems items={m.items} onSelect={() => setOpen(null)} />
              </div>
            )}
          </div>
        ))}
      </nav>
      <div className="menubar-spacer" />
      {project ? (
        <div className="menubar-title">
          <strong>{project.name}</strong>
          {project.prefabEdit ? (
            <>
              <span className="sep">/</span>
              <span className="mono">{project.prefabEdit.name}</span>
              <span className="prefab-crumb-tag">{t('proj.prefabBadge')}</span>
            </>
          ) : project.currentScene ? (
            <>
              <span className="sep">/</span>
              <span className="mono">{project.currentScene.split('/').pop()}</span>
            </>
          ) : (
            <>
              <span className="sep">/</span>
              <span className="mono">{t('ui.untitled')}</span>
            </>
          )}
          {dirty && <DirtyDot />}
        </div>
      ) : null}
      <WindowControls />
    </div>
  );
}
