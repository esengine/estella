// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { useEffect, useSyncExternalStore } from 'react';
import { MenuBar } from '@/layout/MenuBar';
import { Toolbar } from '@/layout/Toolbar';
import { StatusBar } from '@/layout/StatusBar';
import { DockLayout } from '@/layout/DockLayout';
import { ActivityBar } from '@/layout/ActivityBar';
import { ContentDrawer } from '@/layout/ContentDrawer';
import '@/engine/EditorSession'; // side effect: constructs defaultSession → wires the editor engine
import '@/document/dirtyDocs'; // side effect: registers scene + asset docs on the DirtyRegistry
import { Launcher } from '@/launcher/Launcher';
import { Toaster } from '@/components/Toaster';
import { ConfirmHost } from '@/components/ConfirmHost';
import { PrefabModeBanner } from '@/components/PrefabModeBanner';
import { LoadingScreen } from '@/components/LoadingScreen';
import { LoadGate } from '@/store/loadGate';
import { Perf } from '@/components/Perf';
import { PerfRealmBridge } from '@/components/PerfRealmBridge';
import { BuildDialog } from '@/components/BuildDialog';
import { SettingsDialog } from '@/components/SettingsDialog';
import { TilemapPickerDialog } from '@/components/TilemapPickerDialog';
import { CommandPalette } from '@/components/CommandPalette';
import { useEditorStore } from '@/store/editorStore';
import { ConfirmService } from '@/components/confirm';
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
import { FlipbookViewportPreview } from '@/engine/FlipbookViewportPreview';
import { TimelineRecorder } from '@/timeline/TimelineRecorder';
import { ControllerRecorder } from '@/controller/ControllerRecorder';
import { ProjectStore } from '@/project/ProjectStore';
import { DirtyRegistry } from '@/document/DirtyRegistry';
import { Autosave } from '@/document/Autosave';
import { StatsStore } from '@/engine/StatsStore';
import { PerfMonitor } from '@/engine/PerfMonitor';
import { installGlobalErrorHandlers } from '@/store/errorSurface';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { dockApi } from '@/layout/dockApi';
import { forEachEditorWindow } from '@/layout/editorWindows';
import { Toasts } from '@/store/Toasts';
import { t } from '@/i18n';

// Commands that fire even while a text field is focused — Save must work mid-edit;
// everything else (typing, native Cmd+Z/backspace) stays with the field.
const FIELD_SAFE_COMMANDS = new Set(['project.save', 'project.saveAs']);

// The editor shell: fixed menu + toolbar on top, dockable workspace in the
// middle, status strip at the bottom.
export function App() {
  // Global keymap: every shortcut is declared on its Command (single source).
  // Skipped while a text field is focused so typing, native text undo, and
  // backspace-to-delete-text aren't hijacked. Attached to EVERY editor window
  // (main + each popped-out panel) so shortcuts fire whichever one has focus.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // A modal / confirm dialog owns the keyboard while open. Don't let global
      // shortcuts (Delete, Ctrl+Z, Ctrl+D, F5…) reach the scene behind it — worst
      // case they'd mutate the very scene a "Discard unsaved changes?" dialog is
      // protecting. Each dialog runs its own key handling (Escape to close, etc.).
      const ui = useEditorStore.getState();
      if (ui.settingsOpen || ui.paletteOpen || ui.buildOpen || ui.tilemapPickerOpen || ConfirmService.getSnapshot().length > 0) {
        return;
      }
      // Ctrl+Space summons the Content Drawer — works even from a field.
      if ((e.ctrlKey || e.metaKey) && e.code === 'Space') {
        e.preventDefault();
        useEditorStore.getState().toggleContentDrawer();
        return;
      }
      // The keydown's own target is the focused element in whichever window fired
      // it — correct across popouts, unlike the main window's document.activeElement.
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) {
        // A field owns typing + native text undo/backspace — but Save must still
        // work while editing a value. Fire only the field-safe chords, committing
        // the field first (blur → onBlur writes) so Save reads the new value.
        const cmd = commands.forEvent(e);
        if (cmd && FIELD_SAFE_COMMANDS.has(cmd.id)) {
          e.preventDefault();
          el.blur();
          cmd.run();
        }
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
    return forEachEditorWindow((win) => {
      win.addEventListener('keydown', onKey);
      return () => win.removeEventListener('keydown', onKey);
    });
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

  // Route otherwise-silent renderer faults (rejected promises, uncaught errors)
  // into the Output Log + a rate-limited toast — LogStore only patches console.*.
  useEffect(() => installGlobalErrorHandlers(), []);

  // Wire the edit-mode live previews (timeline document → World, selected
  // flipbook → World) and record-mode auto-key once.
  useEffect(() => {
    TimelinePreview.attach();
    FlipbookViewportPreview.attach();
    TimelineRecorder.attach();
    ControllerRecorder.attach();
  }, []);

  // Mirror unsaved-changes state to main for the window-close quit guard, and run
  // the save when main requests a save-before-quit. Both speak the DirtyRegistry
  // aggregate, so a dirty tileset/flipbook/graph editor prompts and saves like a
  // dirty scene (not just EditorHistory).
  useEffect(() => {
    const bridge = window.estella?.app;
    if (!bridge) return;
    const push = () => bridge.setDirty(DirtyRegistry.isDirty());
    push();
    const unsub = DirtyRegistry.subscribe(push);
    bridge.onSaveBeforeQuit(() => DirtyRegistry.saveAll());
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
      // Prefab Mode holds a prefab tree, not a playable scene (no camera → a black
      // frame). Refuse Play here so it can't start from the button, F5 or a command.
      if (ProjectStore.getSnapshot()?.prefabEdit) {
        Toasts.push(t('layout.toast.noPlayInPrefab'), 'warn');
        useEditorStore.getState().stop();
        return;
      }
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
  // Project-open loading gate (Unreal-style): overlay the mounting editor while
  // the editor engine boots AND the play realm prewarms its engine, so entering
  // the editor and the FIRST Play are both smooth. Everything heavy is warmed up
  // front; the overlay clears when every task is done.
  useEffect(() => {
    if (showLauncher) {
      // Back on the launcher there is no project — release the primary play
      // realm (a warm one still holds the closed project's bundle + wasm) and
      // stop the per-frame telemetry loops that would otherwise poll wasm forever
      // (the Viewport that started them has unmounted).
      PlayRealms.resetPrimary();
      StatsStore.stop();
      PerfMonitor.stop();
      Autosave.stop();
      return;
    }
    // A project just opened: run the crash-recovery snapshotter.
    Autosave.start();
    LoadGate.begin([
      { key: 'engine', label: t('load.engine') },
      { key: 'playRealm', label: t('load.playRealm') },
    ]);
    let cancelled = false;
    const safety = setTimeout(() => LoadGate.close(), 20000); // never trap the user behind the overlay
    const engineReady = new Promise<void>((resolve) => {
      if (EngineHost.getSnapshot().status === 'ready') return resolve();
      const un = EngineHost.subscribe(() => {
        if (EngineHost.getSnapshot().status === 'ready') { un(); resolve(); }
      });
    });
    void engineReady
      .then(() => { if (!cancelled) LoadGate.done('engine'); })
      // Engine ready ⇒ the viewport is mounted ⇒ the persistent play host is
      // attached, so the realm can boot its engine now (no scene, off-screen).
      .then(() => (cancelled ? undefined : PlayRealms.prewarm()))
      .then(() => { if (!cancelled) LoadGate.done('playRealm'); })
      // Scene is loaded + overlay clearing: offer to restore any autosave newer
      // than its saved file (a prior session crashed with unsaved edits).
      .then(() => { if (!cancelled) void Autosave.recover(); })
      .finally(() => clearTimeout(safety));
    return () => { cancelled = true; clearTimeout(safety); LoadGate.close(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showLauncher]);
  // Prefab Mode tints the whole workspace so it's unmistakable you're editing a
  // prefab asset, not the scene (the banner names it; this frames the viewport).
  const inPrefabMode = useSyncExternalStore(ProjectStore.subscribe, () => !!ProjectStore.getSnapshot()?.prefabEdit);
  const buildOpen = useEditorStore((s) => s.buildOpen);
  const settingsOpen = useEditorStore((s) => s.settingsOpen);
  const tilemapPickerOpen = useEditorStore((s) => s.tilemapPickerOpen);
  const paletteOpen = useEditorStore((s) => s.paletteOpen);
  if (showLauncher) return <ErrorBoundary label="launcher"><Launcher /></ErrorBoundary>;

  // Each chrome region gets its own ErrorBoundary so one throwing region (e.g.
  // the StatusBar consuming live engine data every 333ms) shows a recoverable
  // card instead of white-screening the whole editor.
  return (
    <div className={inPrefabMode ? 'shell shell--prefab' : 'shell'}>
      <ErrorBoundary label="menubar"><Perf id="menubar"><MenuBar /></Perf></ErrorBoundary>
      <ErrorBoundary label="toolbar"><Perf id="toolbar"><Toolbar /></Perf></ErrorBoundary>
      <ErrorBoundary label="prefab-banner"><PrefabModeBanner /></ErrorBoundary>
      <main className="shell__workspace">
        <ErrorBoundary label="activitybar"><Perf id="activitybar"><ActivityBar /></Perf></ErrorBoundary>
        <DockLayout />
      </main>
      <ErrorBoundary label="statusbar"><Perf id="statusbar"><StatusBar /></Perf></ErrorBoundary>
      <ErrorBoundary label="contentdrawer"><Perf id="contentdrawer"><ContentDrawer /></Perf></ErrorBoundary>
      <PerfRealmBridge />
      {buildOpen && <BuildDialog />}
      {settingsOpen && <SettingsDialog />}
      {tilemapPickerOpen && <TilemapPickerDialog />}
      {paletteOpen && <CommandPalette onClose={() => useEditorStore.getState().setPaletteOpen(false)} />}
      <Toaster />
      <ConfirmHost />
      <LoadingScreen />
    </div>
  );
}
