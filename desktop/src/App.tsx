import { useEffect } from 'react';
import { MenuBar } from '@/layout/MenuBar';
import { Toolbar } from '@/layout/Toolbar';
import { StatusBar } from '@/layout/StatusBar';
import { DockLayout } from '@/layout/DockLayout';
import { EngineHost } from '@/engine/EngineHost';
import { Launcher } from '@/launcher/Launcher';
import { Toaster } from '@/components/Toaster';
import { useEditorStore } from '@/store/editorStore';
import { useSelection } from '@/store/selectionStore';
import { commands } from '@/commands';

// The editor shell: fixed menu + toolbar on top, dockable workspace in the
// middle, status strip at the bottom.
export function App() {
  // Global keymap: every shortcut is declared on its Command (single source).
  // Skipped while a text field is focused so typing, native text undo, and
  // backspace-to-delete-text aren't hijacked.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) {
        return;
      }
      const cmd = commands.forEvent(e);
      if (cmd) {
        e.preventDefault();
        cmd.run();
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
    if (restored) useSelection.getState().select(null);
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
      <Toaster />
    </div>
  );
}
