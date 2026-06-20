import { useEffect } from 'react';
import { MenuBar } from '@/layout/MenuBar';
import { Toolbar } from '@/layout/Toolbar';
import { StatusBar } from '@/layout/StatusBar';
import { DockLayout } from '@/layout/DockLayout';
import { EditorHistory } from '@/engine/EditorHistory';
import { SceneCommands } from '@/engine/SceneCommands';
import { EngineHost } from '@/engine/EngineHost';
import { ProjectStore } from '@/project/ProjectStore';
import { Launcher } from '@/launcher/Launcher';
import { useEditorStore } from '@/store/editorStore';

// The editor shell: fixed menu + toolbar on top, dockable workspace in the
// middle, status strip at the bottom.
export function App() {
  // Global editor shortcuts — skipped while a text field is focused so typing,
  // native text undo, and backspace-to-delete-text aren't hijacked.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) {
        return;
      }
      const store = useEditorStore.getState();
      const sel = store.selectedId;
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();

      if (mod && key === 'o') {
        // Open a project folder; loads its scene into the live world (E7-3).
        e.preventDefault();
        void ProjectStore.openViaDialog().then((ok) => {
          if (ok) store.select(null); // entity ids change on load — drop stale selection
        });
      } else if (mod && key === 's') {
        // Save (E7-4): ⌘S overwrites the current scene (lossless, JSON-first);
        // ⇧⌘S is Save-As. ⌘S falls back to Save-As when there's no current scene.
        e.preventDefault();
        if (e.shiftKey) void ProjectStore.saveAsViaDialog();
        else void ProjectStore.save().catch(() => ProjectStore.saveAsViaDialog());
      } else if (mod && key === 'z' && !e.shiftKey) {
        e.preventDefault();
        EditorHistory.undo();
      } else if (mod && ((key === 'z' && e.shiftKey) || key === 'y')) {
        e.preventDefault();
        EditorHistory.redo();
      } else if (mod && key === 'd') {
        e.preventDefault();
        if (sel != null) {
          const dup = SceneCommands.duplicateEntity(sel);
          if (dup != null) store.select(dup);
        }
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        if (sel != null) {
          SceneCommands.deleteEntity(sel);
          store.select(null);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Drive engine edit/play mode from the toolbar's play/pause state. Edit mode
  // (the default) freezes gameplay systems so they don't fight scene edits;
  // Stop restores the pre-play scene snapshot. A restore re-spawns entities
  // with new ids, so any selection pointing at the played scene is now stale.
  const isPlaying = useEditorStore((s) => s.isPlaying);
  const isPaused = useEditorStore((s) => s.isPaused);
  useEffect(() => {
    const restored = EngineHost.setRunMode(isPlaying, isPaused);
    if (restored) useEditorStore.getState().select(null);
  }, [isPlaying, isPaused]);

  // The editor opens on the launcher (project browser); the shell + engine mount
  // only once a project is opened. (Logic wiring lands with the recents IPC.)
  const showLauncher = useEditorStore((s) => s.showLauncher);
  if (showLauncher) return <Launcher />;

  return (
    <div className="shell">
      <MenuBar />
      <Toolbar />
      <main className="shell__workspace">
        <DockLayout />
      </main>
      <StatusBar />
    </div>
  );
}
