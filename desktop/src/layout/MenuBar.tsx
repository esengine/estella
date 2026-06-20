// Top menu bar — functional dropdowns wired to the real editor commands
// (project open/save, history, entity ops, view toggles), in the UE5 menu idiom.
// The window is frameless (titleBarStyle: hiddenInset) so this strip doubles as
// the drag region; the menus + dropdowns opt out of dragging.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Check } from 'lucide-react';
import { useEditorStore } from '@/store/editorStore';
import { EditorHistory } from '@/engine/EditorHistory';
import { SceneCommands } from '@/engine/SceneCommands';
import { ProjectStore } from '@/project/ProjectStore';

const LAYOUT_KEY = 'estella.editor.layout.v1';

type MenuItem =
  | { sep: true }
  | { label: string; shortcut?: string; onClick: () => void; disabled?: boolean; checked?: boolean };

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

  // Re-render on history changes so undo/redo enabled state stays live.
  useSyncExternalStore(EditorHistory.subscribe, EditorHistory.getVersion);
  const project = useSyncExternalStore(ProjectStore.subscribe, ProjectStore.getSnapshot);
  const {
    selectedId, select,
    showGrid, showGizmos, snapping, toggleGrid, toggleGizmos, toggleSnapping,
    openLauncher,
  } = useEditorStore();

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

  // Run an item's action, then close the menu.
  const run = (fn: () => void) => () => {
    setOpen(null);
    fn();
  };

  const save = () => void ProjectStore.save().catch(() => ProjectStore.saveAsViaDialog());
  const duplicate = () => {
    if (selectedId == null) return;
    const dup = SceneCommands.duplicateEntity(selectedId);
    if (dup != null) select(dup);
  };
  const remove = () => {
    if (selectedId == null) return;
    SceneCommands.deleteEntity(selectedId);
    select(null);
  };
  const addEntity = () => {
    const e = SceneCommands.addEntity();
    if (e != null) select(e);
  };

  const menus: MenuDef[] = [
    {
      title: 'File',
      items: [
        { label: 'Open Project…', shortcut: '⌘O', onClick: () => void ProjectStore.openViaDialog().then((ok) => ok && select(null)) },
        { sep: true },
        { label: 'Save Scene', shortcut: '⌘S', onClick: save, disabled: !project?.currentScene },
        { label: 'Save Scene As…', shortcut: '⇧⌘S', onClick: () => void ProjectStore.saveAsViaDialog(), disabled: !project },
        { sep: true },
        { label: 'Close Project', onClick: openLauncher, disabled: !project },
      ],
    },
    {
      title: 'Edit',
      items: [
        { label: 'Undo', shortcut: '⌘Z', onClick: () => EditorHistory.undo(), disabled: !EditorHistory.canUndo() },
        { label: 'Redo', shortcut: '⇧⌘Z', onClick: () => EditorHistory.redo(), disabled: !EditorHistory.canRedo() },
      ],
    },
    {
      title: 'Entity',
      items: [
        { label: 'Add Entity', onClick: addEntity },
        { sep: true },
        { label: 'Duplicate', shortcut: '⌘D', onClick: duplicate, disabled: selectedId == null },
        { label: 'Delete', shortcut: '⌫', onClick: remove, disabled: selectedId == null },
        { sep: true },
        { label: 'Deselect', onClick: () => select(null), disabled: selectedId == null },
      ],
    },
    {
      title: 'View',
      items: [
        { label: 'Show Grid', onClick: toggleGrid, checked: showGrid },
        { label: 'Show Gizmos', onClick: toggleGizmos, checked: showGizmos },
        { label: 'Snapping', onClick: toggleSnapping, checked: snapping },
      ],
    },
    {
      title: 'Build',
      items: [
        { label: 'Build Project Scripts', onClick: () => void window.estella?.project?.buildScripts?.().catch(() => {}), disabled: !project },
        { label: 'Extract Component Schemas', onClick: () => void window.estella?.project?.extractSchemas?.().catch(() => {}), disabled: !project },
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
            .then((v) => window.alert(`Estella Editor${v ? ' · ' + v : ''}\nA UE5-style editor for the Estella 2D engine.`))
            .catch(() => window.alert('Estella Editor')),
        },
      ],
    },
  ];

  return (
    <div className="menubar" ref={barRef}>
      <div className="menubar__brand">
        <Mark />
        <span className="menubar__title">Estella</span>
      </div>
      <nav className="menubar__menus">
        {menus.map((m) => (
          <div key={m.title} className="menubar__menu">
            <button
              className={`menubar__item${open === m.title ? ' is-open' : ''}`}
              type="button"
              onClick={() => setOpen((o) => (o === m.title ? null : m.title))}
              onMouseEnter={() => setOpen((o) => (o ? m.title : o))}
            >
              {m.title}
            </button>
            {open === m.title && (
              <div className="menu-dropdown" role="menu">
                {m.items.map((it, i) =>
                  'sep' in it ? (
                    <div key={i} className="menu-dropdown__sep" />
                  ) : (
                    <button
                      key={i}
                      type="button"
                      role="menuitem"
                      className="menu-dropdown__item"
                      disabled={it.disabled}
                      onClick={run(it.onClick)}
                    >
                      <span className="menu-dropdown__check">
                        {it.checked ? <Check size={13} strokeWidth={2.2} /> : null}
                      </span>
                      <span className="menu-dropdown__label">{it.label}</span>
                      {it.shortcut ? <span className="menu-dropdown__shortcut">{it.shortcut}</span> : null}
                    </button>
                  ),
                )}
              </div>
            )}
          </div>
        ))}
      </nav>
      {project ? (
        <div className="menubar__project">
          <span className="menubar__project-name">{project.name}</span>
          {project.currentScene ? (
            <>
              <span className="menubar__sep">/</span>
              <span className="menubar__scene mono">{project.currentScene.split('/').pop()}</span>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
