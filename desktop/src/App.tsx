import { useEffect } from 'react';
import { MenuBar } from '@/layout/MenuBar';
import { Toolbar } from '@/layout/Toolbar';
import { StatusBar } from '@/layout/StatusBar';
import { DockLayout } from '@/layout/DockLayout';
import { ActivityBar } from '@/layout/ActivityBar';
import { ContentDrawer } from '@/layout/ContentDrawer';
import '@/engine/EditorSession'; // side effect: constructs defaultSession → wires the editor engine
import { Launcher } from '@/launcher/Launcher';
import { Toaster } from '@/components/Toaster';
import { BuildDialog } from '@/components/BuildDialog';
import { SettingsDialog } from '@/components/SettingsDialog';
import { useEditorStore } from '@/store/editorStore';
import { commands } from '@/commands';
import { PlayRealm } from '@/engine/PlayRealm';
import { PlayInspect } from '@/engine/PlayInspect';
import { ProjectStore } from '@/project/ProjectStore';
import { dockApi } from '@/layout/dockApi';
import { Toasts } from '@/store/Toasts';

// The editor shell: fixed menu + toolbar on top, dockable workspace in the
// middle, status strip at the bottom.
export function App() {
  // Global keymap: every shortcut is declared on its Command (single source).
  // Skipped while a text field is focused so typing, native text undo, and
  // backspace-to-delete-text aren't hijacked.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Ctrl+Space summons the Content Drawer — works even from a field.
      if ((e.ctrlKey || e.metaKey) && e.code === 'Space') {
        e.preventDefault();
        useEditorStore.getState().toggleContentDrawer();
        return;
      }
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

  // Play runs in an ISOLATED realm (the Game panel's iframe = the shipping
  // runtime), NOT by flipping the main edit World — so gameplay can never dirty
  // the scene and the Viewport stays a live Scene view (REARCH_EDITOR_REALM R2).
  // (The headless/automation path still drives the main World via
  // EditorControlSurface.setRunMode + step for deterministic capture.)
  const isPlaying = useEditorStore((s) => s.isPlaying);
  const isPaused = useEditorStore((s) => s.isPaused);
  useEffect(() => {
    if (isPlaying) {
      const payload = ProjectStore.playPayload();
      if (!payload) {
        Toasts.push('Open a scene before playing', 'error');
        useEditorStore.getState().stop();
        return;
      }
      void PlayRealm.start(payload);
      PlayInspect.start(); // poll the running game for live inspect/debug
      useEditorStore.getState().setInspectWorld('game'); // flip Outliner/Details to the live game
      // 'window' → a Game dock tab; 'viewport' → the Viewport mounts it (PIE).
      if (useEditorStore.getState().playTarget === 'window') dockApi.openGame();
    } else {
      PlayRealm.stop();
      PlayInspect.stop();
      useEditorStore.getState().setInspectWorld('editor');
      dockApi.closeGame();
    }
  }, [isPlaying]);
  useEffect(() => {
    if (isPlaying) PlayRealm.setPaused(isPaused);
  }, [isPaused, isPlaying]);

  // The editor opens on the launcher (project browser); the shell + engine mount
  // only once a project is opened. (Logic wiring lands with the recents IPC.)
  const showLauncher = useEditorStore((s) => s.showLauncher);
  const buildOpen = useEditorStore((s) => s.buildOpen);
  const settingsOpen = useEditorStore((s) => s.settingsOpen);
  if (showLauncher) return <Launcher />;

  return (
    <div className="shell">
      <MenuBar />
      <Toolbar />
      <main className="shell__workspace">
        <ActivityBar />
        <DockLayout />
      </main>
      <StatusBar />
      <ContentDrawer />
      {buildOpen && <BuildDialog />}
      {settingsOpen && <SettingsDialog />}
      <Toaster />
    </div>
  );
}
