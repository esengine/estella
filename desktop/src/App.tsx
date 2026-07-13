// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
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
import { ConfirmHost } from '@/components/ConfirmHost';
import { Perf } from '@/components/Perf';
import { PerfRealmBridge } from '@/components/PerfRealmBridge';
import { BuildDialog } from '@/components/BuildDialog';
import { SettingsDialog } from '@/components/SettingsDialog';
import { TilemapPickerDialog } from '@/components/TilemapPickerDialog';
import { useEditorStore } from '@/store/editorStore';
import { commands } from '@/commands';
import { handleTilePaintKey } from '@/tools/tileMode';
import { suggestedMode } from '@/mode/activeMode';
import { useEditorMode } from '@/store/editorModeStore';
import { uiPreviewAspect } from '@/mode/resolutionPresets';
import { EngineHost } from '@/engine/EngineHost';
import type { EditorModeId } from '@/mode/editorModes';
import { useSelection } from '@/store/selectionStore';
import { PlayRealms } from '@/engine/PlayRealm';
import { PlayInspect } from '@/engine/PlayInspect';
import { TimelinePreview } from '@/engine/TimelinePreview';
import { TimelineRecorder } from '@/timeline/TimelineRecorder';
import { ProjectStore } from '@/project/ProjectStore';
import { EditorHistory } from '@/engine/EditorHistory';
import { dockApi } from '@/layout/dockApi';
import { Toasts } from '@/store/Toasts';
import { t } from '@/i18n';

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
      // Tile-editing context claims its keys first (single dispatch → no double-fire
      // with the transform-tool command bound to the same letter).
      if (handleTilePaintKey(e)) {
        e.preventDefault();
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

  // Reveal a mode's companion panels when the selection enters that mode (only on the
  // transition INTO one, so moving within a mode doesn't keep yanking focus). This
  // generalizes the old tilemap-painter auto-open: "select a tilemap → here's how you
  // paint it" is now one instance of "enter a mode → here are its panels". A selection
  // that implies a new mode also drops a stale explicit pin.
  useEffect(() => {
    let prevMode: EditorModeId | null = null;
    return useSelection.subscribe(() => {
      const mode = suggestedMode();
      if (mode.id !== prevMode) {
        useEditorMode.getState().clearPin();
        for (const p of mode.panels ?? []) {
          dockApi.openSidePanel(p.id, p.component, p.title, p.side ?? 'left', p.width ?? 300);
        }
      }
      prevMode = mode.id;
    });
  }, []);

  // Feed the UI-mode device selection into the editor UI layout: a chosen device preset
  // lays UI out at its aspect (previewing adaptation), 'design' keeps the design box. Re-sync
  // on any device/orientation change and on each engine (re)boot, since a fresh EditorView
  // resets uiPreviewAspect to the design default.
  useEffect(() => {
    const apply = () => {
      const { device, orientation } = useEditorMode.getState();
      EngineHost.setUiPreviewAspect(uiPreviewAspect(device, orientation));
    };
    apply();
    const unsubMode = useEditorMode.subscribe(apply);
    const unsubEngine = EngineHost.subscribe(apply);
    return () => { unsubMode(); unsubEngine(); };
  }, []);

  // Wire the Sequencer's edit-mode live preview (timeline document → World) and
  // record-mode auto-key once.
  useEffect(() => {
    TimelinePreview.attach();
    TimelineRecorder.attach();
  }, []);

  // Mirror unsaved-changes state to main for the window-close quit guard, and run
  // the save when main requests a save-before-quit.
  useEffect(() => {
    const bridge = window.estella?.app;
    if (!bridge) return;
    const push = () => bridge.setDirty(EditorHistory.isDirty());
    push();
    const unsub = EditorHistory.subscribe(push);
    bridge.onSaveBeforeQuit(async () => {
      try {
        await ProjectStore.save();
      } catch {
        await ProjectStore.saveAsViaDialog();
      }
    });
    return unsub;
  }, []);

  // Startup update notification (main checks GitHub Releases once after launch).
  useEffect(() => {
    const bridge = window.estella?.app;
    if (!bridge?.onUpdateAvailable) return;
    return bridge.onUpdateAvailable((release) => {
      Toasts.push(t('toast.updateAvailable', { version: release.version }), 'info', 0, {
        label: t('ui.download'),
        run: () => window.open(release.url),
      });
    });
  }, []);

  const idle = (fn: () => void) =>
    typeof window.requestIdleCallback === 'function' ? window.requestIdleCallback(fn) : setTimeout(fn, 500);

  // Play runs in an ISOLATED realm (the Game panel's iframe = the shipping
  // runtime), NOT by flipping the main edit World — so gameplay can never dirty
  // the scene and the Viewport stays a live Scene view.
  // (The headless/automation path still drives the main World via
  // EditorControlSurface.setRunMode + step for deterministic capture.)
  const isPlaying = useEditorStore((s) => s.isPlaying);
  const isPaused = useEditorStore((s) => s.isPaused);
  useEffect(() => {
    if (isPlaying) {
      const payload = ProjectStore.playPayload();
      if (!payload) {
        Toasts.push(t('layout.toast.openSceneFirst'), 'error');
        useEditorStore.getState().stop();
        return;
      }
      const players = useEditorStore.getState().playPlayers;
      void PlayRealms.startSession(payload, players);
      PlayInspect.start(); // poll the running game for live inspect/debug
      useEditorStore.getState().setInspectWorld('game'); // flip Outliner/Details to the live game
      // 'window' → a Game dock tab; 'viewport' → the Viewport mounts it (PIE).
      if (useEditorStore.getState().playTarget === 'window') dockApi.openGame();
      // Client players each get their own Game tab beside player 1.
      if (players > 1) dockApi.openGameClients(PlayRealms.clients.map((c) => c.id));
    } else {
      PlayRealms.stopSession();
      PlayInspect.stop();
      useEditorStore.getState().setInspectWorld('editor');
      dockApi.closeGame();
      dockApi.closeGameClients();
      // Not on mount/launcher — there is no project to stage yet.
      if (!useEditorStore.getState().showLauncher) idle(() => PlayRealms.prewarm());
    }
  }, [isPlaying]);
  useEffect(() => {
    if (isPlaying) PlayRealms.setPaused(isPaused);
  }, [isPaused, isPlaying]);

  // The editor opens on the launcher (project browser); the shell + engine mount
  // only once a project is opened. (Logic wiring lands with the recents IPC.)
  const showLauncher = useEditorStore((s) => s.showLauncher);
  // Prewarm the play realm as soon as a project opens.
  useEffect(() => {
    if (!showLauncher) idle(() => PlayRealms.prewarm());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showLauncher]);
  const buildOpen = useEditorStore((s) => s.buildOpen);
  const settingsOpen = useEditorStore((s) => s.settingsOpen);
  const tilemapPickerOpen = useEditorStore((s) => s.tilemapPickerOpen);
  if (showLauncher) return <Launcher />;

  return (
    <div className="shell">
      <Perf id="menubar"><MenuBar /></Perf>
      <Perf id="toolbar"><Toolbar /></Perf>
      <main className="shell__workspace">
        <Perf id="activitybar"><ActivityBar /></Perf>
        <DockLayout />
      </main>
      <Perf id="statusbar"><StatusBar /></Perf>
      <Perf id="contentdrawer"><ContentDrawer /></Perf>
      <PerfRealmBridge />
      {buildOpen && <BuildDialog />}
      {settingsOpen && <SettingsDialog />}
      {tilemapPickerOpen && <TilemapPickerDialog />}
      <Toaster />
      <ConfirmHost />
    </div>
  );
}
