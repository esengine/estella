// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

// Web fonts bundled locally so the editor renders identically offline.
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';

import './theme/tokens.css';
import './theme/global.css';
import './theme/controls.css';
// dockview base styles first, then our override layer on top of them.
import 'dockview/dist/styles/dockview.css';
import './theme/dockview-theme.css';
import './theme/app.css';
import './theme/inspector.css';
import './theme/outliner.css';
import './theme/log.css';
import './theme/viewport.css';
import './theme/content.css';
import './theme/sequencer.css';
import './theme/profiler.css';
import './theme/tileset.css';
import './theme/flipbook.css';
import './theme/tilemap.css';
import './theme/ui-palette.css';
import './theme/material.css';
import './theme/nodegraph.css';
import './theme/chrome.css';
import './theme/menus.css';
import './theme/settings.css';
import './theme/launcher.css';
import { App } from './App';
import { ProjectStore } from './project/ProjectStore';
import { useEditorStore } from './store/editorStore';
import { useSelection } from './store/selectionStore';
import { PlayRealm } from './engine/PlayRealm';
import { dockApi } from './layout/dockApi';
import { EditorControlSurface } from './engine/EditorSession';
import { SceneModel } from './engine/SceneModel';
import { EngineHost } from './engine/EngineHost';
import { Particle, getComponent } from 'esengine';
import { applyFxPreview, initFxPreviewEditRestart } from './engine/fxPreview';
import { commands } from './commands/registry';
import { ENTITY_SOURCES, sourceById, createFromSource } from './engine/entitySources';
import { ViewportController } from './engine/ViewportController';
import { PerfMonitor } from './engine/PerfMonitor';
import { LogStore } from './store/LogStore';
import { initFsWatch } from './project/fsWatch';
import { ASSET_OPEN } from './project/assetOpen';
import { assetTypeOf } from './project/assetTypes';
import { initBackgroundThrottle } from './engine/backgroundThrottle';
// Register the built-in settings (side effect) and replay persisted ones.
import './settings';
// Register the Text.i18nKey picker's key index (side effect, like spineEnums).
import './project/localeKeys';
import { applySettings } from './store/settingsStore';

// Capture console (editor + SDK + wasm) into the Output Log panel from startup.
LogStore.install();
// Apply persisted editor settings (accent, UI scale, log cap) before first paint.
applySettings();
// Live-sync the asset registry + Content Browser with on-disk changes (incl.
// edits made outside the editor) via the main-process project watcher.
initFsWatch();

initBackgroundThrottle();

// Sync the FX-preview default into the engine flag before anything boots (the
// flag is module-scoped; emitters auto-play lazily once a scene loads), and
// wire the Details-edit → emitter-restart glue.
applyFxPreview(useEditorStore.getState().previewFx);
initFxPreviewEditRestart();

// Automation hook (screenshots / visual-regression): with `?automation=1`, expose the
// minimum to drive the launcher→editor flow from a headless driver. Gated so the normal
// editor never carries it; mirrors the headless render host's `window.__estellaHeadless`.
if (new URLSearchParams(location.search).has('automation')) {
  (window as unknown as { __estellaEditor?: unknown }).__estellaEditor = {
    open: (root: string) => ProjectStore.open(root),
    enterEditor: () => useEditorStore.getState().enterEditor(),
    /** Resolves once the scene is ADOPTED and readable (drivers must not need
     *  their own get_scene_tree polling): waits out the model-version bump the
     *  adopt performs, racing the engine boot on a freshly opened project. */
    openScene: async (rel: string) => {
      const v0 = EditorControlSurface.worldVersion();
      await ProjectStore.openScene(rel);
      const t0 = Date.now();
      while (EditorControlSurface.worldVersion() === v0 && Date.now() - t0 < 30_000) {
        await new Promise((r) => setTimeout(r, 100));
      }
    },
    /** Resolves once the project's initial scene is in the tree (call after
     *  open + enterEditor; the boot pipeline loads the last-opened scene). */
    sceneReady: async (timeoutMs = 30_000) => {
      const t0 = Date.now();
      while (EditorControlSurface.getSceneTree().length === 0 && Date.now() - t0 < timeoutMs) {
        await new Promise((r) => setTimeout(r, 100));
      }
      return EditorControlSurface.getSceneTree().length > 0;
    },
    selectAsset: (path: string | null) => useSelection.getState().selectAsset(path),
    play: () => useEditorStore.getState().togglePlay(),
    playState: () => PlayRealm.getSnapshot(),
    /** Player count for the next Play (1 = single, 2-4 = listen server + clients). */
    setPlayPlayers: (n: number) => useEditorStore.getState().setPlayPlayers(n),
    /** Advance the EDIT-realm engine n frames (headless drivers: rAF may stall). */
    tickEngine: async (n: number, dt = 1 / 60) => {
      for (let i = 0; i < n; i++) await EngineHost.tick(dt);
    },
    /** Live particle count of a SOURCE entity's emitter (edit-preview probes). */
    particleAlive: (id: number) => {
      const rt = SceneModel.runtimeFor(id);
      const particle = EngineHost.getResource(Particle);
      return rt != null && particle ? particle.getAliveCount(rt) : -1;
    },
    /** Dispatch any registered editor command by id (the UI's own channel). */
    runCommand: (id: string) => commands.run(id),
    /** Save the open scene to disk (the toolbar Save, awaitable). */
    save: () => ProjectStore.save(),
    /** Create a blank scene FILE under `destDir` (Content Browser "New Scene"). */
    createSceneFile: (destDir: string) => ProjectStore.createSceneFile(destDir),
    /** The Create-popover catalog: every ready-made entity the editor can spawn. */
    listEntityTemplates: () => ENTITY_SOURCES.map(({ id, label, category }) => ({ id, label, category })),
    /** Spawn a ready-made entity through the one create pipeline (menu/DnD parity). */
    createEntity: async (sourceId: string, opts?: { parent?: number | null; x?: number; y?: number }) => {
      const source = sourceById(sourceId);
      if (!source) throw new Error(`unknown entity template: ${sourceId} (see listEntityTemplates)`);
      return createFromSource(source, {
        parent: opts?.parent ?? null,
        position: opts?.x != null && opts?.y != null ? { x: opts.x, y: opts.y } : undefined,
      });
    },
    /** Double-click-open an asset by project path (FSM/BT/tileset/clip editors…). */
    openAsset: (path: string) => {
      const name = path.split('/').pop() ?? path;
      ASSET_OPEN[assetTypeOf(name)]?.(path, name);
    },
    reveal: (id: string) => dockApi.revealAndExpand(id),
    togglePerfOverlay: () => PerfMonitor.toggleOverlay(),
    captureThumbnail: () => ProjectStore.captureThumbnail(),
    surface: EditorControlSurface,
    /** Live world position of a SOURCE entity (engine-composed, Yoga-fresh for
     *  UI nodes) — lets a drag-automation shot assert a move stuck or was
     *  layout-rejected. */
    entityWorldXY: (id: number) => {
      const rt = SceneModel.runtimeFor(id);
      return rt == null ? null : ViewportController.getEntityWorldXY(rt);
    },
    /** The LIVE World component data for a SOURCE entity — for verifying that a
     *  model edit actually reached the engine (vs stayed model-only). */
    runtimeFor: (id: number) => SceneModel.runtimeFor(id),
    worldComp: (id: number, comp: string) => {
      const rt = SceneModel.runtimeFor(id);
      const w = EngineHost.world;
      const def = getComponent(comp);
      return rt != null && def && w?.has(rt, def) ? w.get(rt, def) : null;
    },
    pickAt: (cx: number, cy: number) =>
      ViewportController.pickEntitiesAt(cx, cy).map((rt) => ({ rt, src: SceneModel.sourceFor(rt) })),
    screenRectOf: (id: number) => {
      const rt = SceneModel.runtimeFor(id);
      return rt == null ? null : ViewportController.getEntityScreenRect(rt);
    },
    frame: (ids: number[]) => ViewportController.frameSelection(ids),
  };
}

// Tag the OS so the title bar renders the right chrome on first paint (macOS
// reserves space for the native traffic lights; Windows/Linux draw our controls).
const plat = window.estella?.platform;
document.documentElement.classList.add(
  plat === 'darwin' ? 'platform-mac' : plat === 'win32' ? 'platform-win' : 'platform-linux',
);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
