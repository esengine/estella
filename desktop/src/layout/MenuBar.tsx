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
import { LAYOUT_KEY } from '@/layout/DockLayout';
import { useEditorStore } from '@/store/editorStore';
import { ProjectStore } from '@/project/ProjectStore';
import { EditorHistory } from '@/engine/EditorHistory';
import { PerfMonitor } from '@/engine/PerfMonitor';
import { Toasts } from '@/store/Toasts';
import { MenuItems, handleMenuListKey, type MenuItem } from '@/components/Menu';
import { commands, formatKeybinding } from '@/commands';
import { t } from '@/i18n';

interface MenuDef {
  title: string;
  items: MenuItem[];
}

function Mark() {
  // The signature: a four-point starlight glyph — "Estella" = star.
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M8 0.5 L9.4 6.6 L15.5 8 L9.4 9.4 L8 15.5 L6.6 9.4 L0.5 8 L6.6 6.6 Z"
        fill="var(--star)"
      />
      <circle cx="8" cy="8" r="1.1" fill="var(--void)" />
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
  const openLauncher = () => useEditorStore.getState().openLauncher();

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
        { label: t('vp.flag.perf'), checked: PerfMonitor.getSnapshot().visible, onClick: () => PerfMonitor.toggleOverlay() },
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
        {
          label: t('menu.extractSchemas'),
          // refreshUserSchemas extracts AND reloads into the editor (so the
          // inspector updates), unlike a bare extract that only writes the file.
          onClick: () => void ProjectStore.refreshUserSchemas()
            .then(() => Toasts.push(t('toast.extractedSchemas'), 'success'))
            .catch(() => Toasts.push(t('toast.extractFailed'), 'error')),
          disabled: !project,
        },
      ],
    },
    {
      title: t('menu.window'),
      items: [
        { label: t('menu.resetLayout'), onClick: () => { localStorage.removeItem(LAYOUT_KEY); location.reload(); } },
        { sep: true },
        { label: t('menu.backToLauncher'), onClick: openLauncher },
      ],
    },
    {
      title: t('menu.help'),
      items: [
        {
          label: t('menu.about'),
          onClick: () => void window.estella?.getVersion?.()
            .then((v) => window.alert(`Estella Editor${v ? ' · ' + v : ''}\n${t('menu.aboutTagline')}`))
            .catch(() => window.alert('Estella Editor')),
        },
        {
          label: t('menu.checkUpdates'),
          onClick: () => void window.estella?.app?.checkUpdates?.().then((release) => {
            if (release) {
              Toasts.push(t('toast.updateAvailable', { version: release.version }), 'info', 0, {
                label: t('ui.download'),
                run: () => window.open(release.url),
              });
            } else {
              Toasts.push(t('toast.upToDate'), 'success');
            }
          }),
        },
        { sep: true },
        cmdItem('palette.open'),
        {
          label: t('menu.keyboardShortcuts'),
          onClick: () => useEditorStore.getState().openSettings('shortcuts'),
        },
        { sep: true },
        {
          label: t('menu.openLogs'),
          onClick: () => void window.estella?.app?.openLogs?.(),
        },
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
