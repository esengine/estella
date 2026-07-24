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
import { t } from '@/i18n';

interface MenuDef {
  title: string;
  items: MenuItem[];
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

  // Build a menu item from a registered command — one source for label, shortcut
  // hint, action, enablement, and checked state.
  const cmdItem = (id: string): MenuItem => {
    const c = commands.get(id)!;
    return {
      label: c.label,
      shortcut: c.keybinding ? formatKeybinding(c.keybinding) : undefined,
      onClick: () => commands.run(id),
      disabled: !commands.isEnabled(id),
      checked: commands.isChecked(id),
    };
  };

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

  const menus: MenuDef[] = [
    {
      title: t('menu.file'),
      items: [
        cmdItem('scene.new'),
        { sep: true },
        cmdItem('project.open'),
        { sep: true },
        cmdItem('project.save'),
        cmdItem('project.saveAs'),
        { sep: true },
        cmdItem('project.close'),
      ],
    },
    {
      title: t('menu.edit'),
      items: [
        cmdItem('edit.undo'),
        cmdItem('edit.redo'),
        { sep: true },
        cmdItem('entity.cut'),
        cmdItem('entity.copy'),
        cmdItem('entity.paste'),
        cmdItem('entity.delete'),
        { sep: true },
        cmdItem('edit.selectAll'),
        cmdItem('entity.deselect'),
      ],
    },
    {
      title: t('menu.entity'),
      items: [
        cmdItem('entity.add'),
        cmdItem('tilemap.new'),
        cmdItem('tilemap.newCollisionLayer'),
        { sep: true },
        cmdItem('entity.duplicate'),
        cmdItem('entity.delete'),
        { sep: true },
        cmdItem('entity.deselect'),
      ],
    },
    {
      title: t('menu.view'),
      items: [
        cmdItem('view.toggleGrid'),
        cmdItem('view.toggleGizmos'),
        cmdItem('view.toggleColliders'),
        cmdItem('view.toggleTileCollision'),
        cmdItem('view.togglePreviewFx'),
        { sep: true },
        cmdItem('view.toggleMinimap'),
        cmdItem('view.toggleStats'),
        cmdItem('view.toggleCoords'),
        cmdItem('view.togglePerf'),
        { sep: true },
        cmdItem('view.toggleCoordSpace'),
        cmdItem('view.togglePivotMode'),
        cmdItem('view.toggleSnapping'),
      ],
    },
    {
      title: t('menu.build'),
      items: [
        cmdItem('project.export'),
        { sep: true },
        cmdItem('build.scripts'),
        cmdItem('project.extractSchemas'),
      ],
    },
    {
      title: t('menu.window'),
      items: [
        // Reset only the dock layout — rebuild in place (keeps scene/engine/undo),
        // guarded so a wedged dirty asset-editor tab can't vanish unwarned. A real
        // command, so it's in the palette + rebindable.
        cmdItem('view.resetLayout'),
        { sep: true },
        // Same destination as File ▸ Close Project — run the guarded command so
        // leaving a project can't silently drop unsaved scene + asset edits.
        { label: t('menu.backToLauncher'), onClick: () => commands.run('project.close') },
      ],
    },
    {
      title: t('menu.help'),
      items: [
        cmdItem('help.about'),
        cmdItem('help.checkUpdates'),
        { sep: true },
        cmdItem('palette.open'),
        cmdItem('help.shortcuts'),
        { sep: true },
        cmdItem('help.openLogs'),
      ],
    },
  ];

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
            key={m.title}
            className="menubar__menu"
            style={{ position: 'relative', display: 'flex' }}
            onKeyDown={(e) => {
              if (open !== m.title) return;
              // ←/→ walk the menubar while a menu is open; ↓/↑ and typeahead
              // navigate the open dropdown (the shared menu-list handler).
              if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                e.preventDefault();
                const i = menus.findIndex((mm) => mm.title === open);
                const next = menus[(i + (e.key === 'ArrowRight' ? 1 : -1) + menus.length) % menus.length].title;
                setOpen(next);
                btnRefs.current.get(next)?.focus();
                return;
              }
              handleMenuListKey(e, e.currentTarget.querySelector<HTMLElement>('.menu-dropdown'));
            }}
          >
            <button
              ref={(el) => {
                if (el) btnRefs.current.set(m.title, el);
                else btnRefs.current.delete(m.title);
              }}
              className={`menu${open === m.title ? ' is-open' : ''}`}
              type="button"
              aria-haspopup="menu"
              aria-expanded={open === m.title}
              onClick={() => setOpen((o) => (o === m.title ? null : m.title))}
              onMouseEnter={() => setOpen((o) => (o ? m.title : o))}
            >
              {m.title}
            </button>
            {open === m.title && (
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
