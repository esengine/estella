// Top menu bar — functional dropdowns wired to the real editor commands
// (project open/save, history, entity ops, view toggles), in a classic menu idiom.
// The window is frameless (titleBarStyle: hiddenInset) so this strip doubles as
// the drag region; the menus + dropdowns opt out of dragging.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useEditorStore } from '@/store/editorStore';
import { ProjectStore } from '@/project/ProjectStore';
import { Toasts } from '@/store/Toasts';
import { MenuItems, type MenuItem } from '@/components/Menu';
import { commands, formatKeybinding } from '@/commands';

const LAYOUT_KEY = 'estella.editor.layout.v1';

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

  // Only the always-visible project label needs a live subscription. Menu items
  // are rebuilt from the command registry each time a menu opens (a re-render),
  // so their enabled / checked state reads fresh from the domain stores then.
  const project = useSyncExternalStore(ProjectStore.subscribe, ProjectStore.getSnapshot);

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

  // Close the open menu on an outside click or Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) setOpen(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(null);
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
        cmdItem('project.open'),
        { sep: true },
        cmdItem('project.save'),
        cmdItem('project.saveAs'),
        { sep: true },
        cmdItem('project.close'),
      ],
    },
    {
      title: 'Edit',
      items: [cmdItem('edit.undo'), cmdItem('edit.redo')],
    },
    {
      title: 'Entity',
      items: [
        cmdItem('entity.add'),
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
        cmdItem('view.toggleSnapping'),
      ],
    },
    {
      title: 'Build',
      items: [
        cmdItem('build.scripts'),
        {
          label: 'Extract Component Schemas',
          onClick: () => void window.estella?.project?.extractSchemas?.()
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
          <div key={m.title} className="menubar__menu" style={{ position: 'relative', display: 'flex' }}>
            <button
              className={`menu${open === m.title ? ' is-open' : ''}`}
              type="button"
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
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
