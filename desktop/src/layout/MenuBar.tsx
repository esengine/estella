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
import { Toasts } from '@/store/Toasts';
import { MenuItems, handleMenuListKey, type MenuItem } from '@/components/Menu';
import { commands, formatKeybinding } from '@/commands';

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
      title: 'File',
      items: [
        cmdItem('scene.new'),
        { sep: true },
        cmdItem('project.open'),
        { sep: true },
        cmdItem('project.save'),
        cmdItem('project.saveAs'),
        { sep: true },
        cmdItem('project.export'),
        { sep: true },
        cmdItem('project.close'),
      ],
    },
    {
      title: 'Edit',
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
      title: 'Entity',
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
      title: 'View',
      items: [
        cmdItem('view.toggleGrid'),
        cmdItem('view.toggleGizmos'),
        cmdItem('view.toggleColliders'),
        cmdItem('view.togglePreviewFx'),
        { sep: true },
        cmdItem('view.toggleCoordSpace'),
        cmdItem('view.togglePivotMode'),
        cmdItem('view.toggleSnapping'),
      ],
    },
    {
      title: 'Build',
      items: [
        cmdItem('build.scripts'),
        {
          label: 'Extract Component Schemas',
          // refreshUserSchemas extracts AND reloads into the editor (so the
          // inspector updates), unlike a bare extract that only writes the file.
          onClick: () => void ProjectStore.refreshUserSchemas()
            .then(() => Toasts.push('Extracted component schemas', 'success'))
            .catch(() => Toasts.push('Extract failed', 'error')),
          disabled: !project,
        },
      ],
    },
    {
      title: 'Window',
      items: [
        { label: 'Reset Layout', onClick: () => { localStorage.removeItem(LAYOUT_KEY); location.reload(); } },
        { sep: true },
        { label: 'Back to Launcher', onClick: openLauncher },
      ],
    },
    {
      title: 'Help',
      items: [
        {
          label: 'About Estella',
          onClick: () => void window.estella?.getVersion?.()
            .then((v) => window.alert(`Estella Editor${v ? ' · ' + v : ''}\nA modern editor for the Estella 2D engine.`))
            .catch(() => window.alert('Estella Editor')),
        },
        {
          label: 'Check for Updates…',
          onClick: () => void window.estella?.app?.checkUpdates?.().then((release) => {
            if (release) {
              Toasts.push(`Estella ${release.version} is available`, 'info', 0, {
                label: 'Download',
                run: () => window.open(release.url),
              });
            } else {
              Toasts.push('Estella is up to date', 'success');
            }
          }),
        },
        { sep: true },
        {
          label: 'Open Log Folder',
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
          {project.currentScene ? (
            <>
              <span className="sep">/</span>
              <span className="mono">{project.currentScene.split('/').pop()}</span>
            </>
          ) : (
            <>
              <span className="sep">/</span>
              <span className="mono">untitled</span>
            </>
          )}
          {dirty && <DirtyDot />}
        </div>
      ) : null}
      <WindowControls />
    </div>
  );
}
