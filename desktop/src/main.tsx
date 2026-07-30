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
import './theme/transport.css';
import './theme/profiler.css';
import './theme/tileset.css';
import './theme/flipbook.css';
import './theme/tilemap.css';
import './theme/ui-palette.css';
import './theme/controllers.css';
import './theme/events.css';
import './theme/material.css';
import './theme/nodegraph.css';
import './theme/chrome.css';
import './theme/menus.css';
import './theme/settings.css';
import './theme/launcher.css';
import './theme/plugins.css';
import { App } from './App';
import { ProjectStore } from './project/ProjectStore';
import { useEditorStore } from './store/editorStore';
import { useSelection } from './store/selectionStore';
import { PlayRealm } from './engine/PlayRealm';
import { dockApi } from './layout/dockApi';
import { EditorControlSurface } from './engine/EditorSession';
import { EditorHistory } from './engine/EditorHistory';
import { SceneModel } from './engine/SceneModel';
import { EngineHost } from './engine/EngineHost';
import { Particle, getComponent } from 'esengine';
import { actionNames, actionParams, conditionNames } from '@/ai/actionCatalog';
import { applyFxPreview, initFxPreviewEditRestart } from './engine/fxPreview';
import { commands } from './commands/registry';
import { allEntitySources, sourceById, createFromSource, type TileGridConfig } from './engine/entitySources';
import { createTilemapFromTileset, createCollisionLayer } from './tilemap/createTilemap';
import { applySceneOps, type SceneOp } from './engine/sceneOps';
import { layerTilesetRefs, loadLayerTilesetModel } from './tilemap/layerTilesetModel';
import { SceneCommands } from './engine/SceneCommands';
import { useTilemapPaint } from './store/tilemapPaintStore';
import { ViewportController } from './engine/ViewportController';
import { PerfMonitor } from './engine/PerfMonitor';
import { LogStore } from './store/LogStore';
import { initFsWatch } from './project/fsWatch';
import { initPlugins } from './plugins/init';
import { openAssetOfType, opensInEditor } from './project/assetOpen';
import { DirtyRegistry } from './document/DirtyRegistry';
import { initBackgroundThrottle } from './engine/backgroundThrottle';
// Register the built-in settings (side effect) and replay persisted ones.
import './settings';
import { applySettings } from './store/settingsStore';

// Capture console (editor + SDK + wasm) into the Output Log panel from startup.
LogStore.install();
// Apply persisted editor settings (accent, UI scale, log cap) before first paint.
applySettings();
// Live-sync the asset registry + Content Browser with on-disk changes (incl.
// edits made outside the editor) via the main-process project watcher.
initFsWatch();

initBackgroundThrottle();
// Load the open project's editor plugins (and unload them when it closes).
initPlugins();

// Sync the FX-preview default into the engine flag before anything boots (the
// flag is module-scoped; emitters auto-play lazily once a scene loads), and
// wire the Details-edit → emitter-restart glue.
applyFxPreview(useEditorStore.getState().previewFx);
initFxPreviewEditRestart();

/** The open document: a scene, or the prefab being edited in Prefab Mode. `dirty` is
 *  the aggregate registry (scene + every open asset editor), the same truth the
 *  unsaved-changes prompts read. */
function documentState(): { kind: 'scene' | 'prefab'; path: string | null; name: string | null; dirty: boolean; isVariant?: boolean; returnScene?: string | null } {
  const st = ProjectStore.getSnapshot();
  const pe = st?.prefabEdit ?? null;
  const dirty = DirtyRegistry.isDirty();
  if (pe) return { kind: 'prefab', path: pe.path, name: pe.name, dirty, isVariant: !!pe.isVariant, returnScene: pe.returnScene };
  return { kind: 'scene', path: st?.currentScene ?? null, name: st?.name ?? null, dirty };
}

/** Open a scene and resolve once it is ADOPTED and readable, so a driver never has to
 *  poll get_scene_tree itself. Shared by the openScene and openAsset doors. */
async function openSceneAwaited(rel: string): Promise<void> {
  const v0 = EditorControlSurface.worldVersion();
  await ProjectStore.openScene(rel);
  const t0 = Date.now();
  while (EditorControlSurface.worldVersion() === v0 && Date.now() - t0 < 30_000) {
    await new Promise((r) => setTimeout(r, 100));
  }
}

/** Throw unless the entity belongs to a prefab instance — the identity operations
 *  answer `null` for anything else, which reads to a driver as "it worked". */
function requireInstance(entity: number): void {
  const tag = SceneModel.prefabTag(entity);
  const ref = tag?.prefab ?? (tag ? SceneModel.prefabTag(tag.instanceRoot)?.prefab : undefined);
  if (!ref) {
    throw new Error(`entity ${entity} is not part of a prefab instance (get_entity reports the link as \`prefab\`)`);
  }
}

// Automation hook (screenshots / visual-regression): with `?automation=1`, expose the
// minimum to drive the launcher→editor flow from a headless driver. Gated so the normal
// editor never carries it; mirrors the headless render host's `window.__estellaHeadless`.
if (new URLSearchParams(location.search).has('automation')) {
  (window as unknown as { __estellaEditor?: unknown }).__estellaEditor = {
    /**
     * The whole launcher → editor → scene-ready sequence, or a throw saying
     * which step failed.
     *
     * It used to be the three calls below, chained by the tool definition, with
     * the boolean from the open DISCARDED: a project that failed to open still
     * got `enterEditor()`, so the shell left the launcher with nothing loaded,
     * the driver waited out the scene timeout, and every later call answered
     * "no project open" — with the reason only ever shown as a toast nobody was
     * looking at. Sequencing belongs next to the code that knows the order.
     */
    open: async (root: string) => {
      if (!(await ProjectStore.open(root))) {
        throw new Error(
          `could not open the project at ${root} — it is still closed. `
          + 'The editor logged the reason (check the Output Log); a bad path and an '
          + 'unreadable project manifest are the usual ones.',
        );
      }
      useEditorStore.getState().enterEditor();
      const t0 = Date.now();
      while (EditorControlSurface.getSceneTree().length === 0 && Date.now() - t0 < 30_000) {
        await new Promise((r) => setTimeout(r, 100));
      }
      if (EditorControlSurface.getSceneTree().length === 0) {
        throw new Error(
          `the project at ${root} opened but no scene loaded — it may have none yet. `
          + 'Name one with open_scene, or create one with create_scene_file.',
        );
      }
      return true;
    },
    enterEditor: () => useEditorStore.getState().enterEditor(),
    /** Resolves once the scene is ADOPTED and readable (drivers must not need
     *  their own get_scene_tree polling): waits out the model-version bump the
     *  adopt performs, racing the engine boot on a freshly opened project. */
    openScene: async (rel: string, discardChanges = false) => {
      // A person gets a "save your work?" prompt here. A driver got silence and
      // lost whatever it had built — opening the scene it had just authored into
      // reloads it from disk, and the hundred entities never written are gone.
      // Refuse instead, and make discarding something the caller says out loud.
      if (!discardChanges && EditorHistory.isDirty()) {
        throw new Error(
          'the open scene has unsaved changes — save_scene first, or pass discardChanges to throw them away',
        );
      }
      await openSceneAwaited(rel);
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
    /** Re-scan the asset registry NOW (awaitable). The write doors' contract is
     *  "returned ⇒ resolvable": programmatic create/import chain this so a
     *  follow-up `@uuid:`/path ref never races the debounced watcher refresh. */
    refreshAssets: () => ProjectStore.refreshAssets(),
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
    /** The names the action/condition palettes offer — the one vocabulary
     *  `.esfsm` hooks, `.esbt` leaves and EventBinding rows share: the edit
     *  realm's own registrations plus the open project's (schemas artifact). */
    aiVocabulary: () => ({
      actions: actionNames(),
      conditions: conditionNames(),
      params: Object.fromEntries(actionNames().map((n) => [n, actionParams(n).map((p) => p.name)])),
    }),
    /** Dispatch any registered editor command by id (the UI's own channel). */
    runCommand: (id: string) => commands.run(id),
    /** Save the open scene to disk (the toolbar Save, awaitable). */
    save: () => ProjectStore.save(),
    /** Patch the project's physics feature (Project Settings → Physics). */
    setPhysics: (patch: Record<string, unknown>) => ProjectStore.setPhysics(patch),
    /** Create a blank scene FILE under `destDir` (Content Browser "New Scene"). */
    createSceneFile: (destDir: string, name?: string | null) =>
      ProjectStore.createSceneFile(destDir, name ?? undefined),
    /**
     * Extract an entity's subtree into a `.esprefab` asset (the Outliner's Create
     * Prefab), returning its `@uuid:` ref.
     *
     * The one authoring step automation could not take: a driver could build a
     * subtree but never turn it into a reusable one, so anything shared had to be
     * duplicated per scene. Goes through the editor's own extractor, so component
     * data and asset refs are serialized by the code that owns that format rather
     * than by a caller guessing at it.
     */
    createPrefabFromEntity: (id: number) => ProjectStore.createPrefabFromEntity(id),
    /** The Create-popover catalog: every ready-made entity the editor can spawn —
     *  including the open project's own components and prefabs, so automation sees
     *  the same list a person does. */
    listEntityTemplates: () => allEntitySources().map(({ id, label, category }) => ({ id, label, category })),
    /** Create a TilemapLayer from an .estileset with an optional grid layout
     *  (orientation/stagger/hex) — drives the New-Tilemap flow headlessly. */
    createTilemap: (tilesetPath: string, grid?: TileGridConfig) => createTilemapFromTileset(tilesetPath, grid),
    /** Create a collision (obstacle) layer and return its selected source id — drives the
     *  obstacle-grid flow headlessly (no tileset needed). */
    createCollisionLayer: async () => { await createCollisionLayer(); return useSelection.getState().selectedId; },
    /** Paint tiles into a TilemapLayer SOURCE entity (one undo step) — for shot tests. */
    paintTiles: (sourceId: number, edits: { x: number; y: number; tileId: number }[]) =>
      SceneCommands.paintTiles(sourceId, edits),
    /** All LIVE Marker entities (hand-placed model entities AND `.tmj`-derived RuntimeOnly
     *  children), each with its `type` + whether it's a model entity (`src != null`) or a
     *  derived projection (`src == null`) — verifies object-group → Marker convergence. */
    liveMarkers: () => {
      const w = EngineHost.world;
      const md = getComponent('Marker');
      if (!w || !md) return [];
      const colliders = ['BoxCollider', 'CircleCollider', 'PolygonCollider', 'ChainCollider']
        .map((n) => getComponent(n)).filter((c): c is NonNullable<typeof c> => !!c);
      return w.getEntitiesWithComponents([md]).map((rt) => {
        const m = w.get(rt, md) as { type?: string; properties?: Record<string, string> };
        // A point Marker has no collider (sensor: null); a region has one — sensor=true is a
        // Trigger Area, sensor=false is solid geometry (a `collision`-group wall).
        let sensor: boolean | null = null;
        for (const cd of colliders) {
          if (w.has(rt, cd)) { sensor = !!(w.get(rt, cd) as { isSensor?: boolean }).isSensor; break; }
        }
        return {
          rt,
          type: typeof m?.type === 'string' ? m.type : null,
          properties: m?.properties ?? {},
          sensor,
          src: SceneModel.sourceFor(rt) ?? null,
        };
      });
    },
    /** Probe a layer's resolved tile-collision overlay — the SAME pieces the viewport
     *  draws + Play spawns. Returns null if nothing resolves; else piece counts by kind.
     *  Verifies the collision-layer pipeline end-to-end (refs → palette model → outlines). */
    probeTileCollision: async (sourceId: number) => {
      const refs = layerTilesetRefs(sourceId);
      const model = await loadLayerTilesetModel(refs);
      if (!model) return null;
      const pieces = ViewportController.tilemapColliderOutlines(sourceId, model);
      return {
        refs,
        total: pieces.length,
        sensors: pieces.filter((p) => p.sensor).length,
        oneWay: pieces.filter((p) => p.oneWay).length,
        polygons: pieces.filter((p) => p.polylines.length > 0 && !p.sensor && !p.oneWay).length,
      };
    },
    /** Drive the tilemap paint store (tool / terrain set / wang color) — for shot tests. */
    setTilePaint: (patch: { tool?: unknown; terrainSet?: number; wangColor?: number }) => {
      const s = useTilemapPaint.getState();
      if (patch.tool !== undefined) s.setTool(patch.tool as never);
      if (patch.terrainSet !== undefined) s.setTerrainSet(patch.terrainSet);
      if (patch.wangColor !== undefined) s.setWangColor(patch.wangColor);
    },
    /** Spawn a ready-made entity through the one create pipeline (menu/DnD parity). */
    createEntity: async (sourceId: string, opts?: { parent?: number | null; x?: number; y?: number }) => {
      const source = sourceById(sourceId);
      if (!source) throw new Error(`unknown entity template: ${sourceId} (see listEntityTemplates)`);
      return createFromSource(source, {
        parent: opts?.parent ?? null,
        position: opts?.x != null && opts?.y != null ? { x: opts.x, y: opts.y } : undefined,
      });
    },
    /** Author a whole subtree in ONE undoable batch (create/parent/component/field
     *  ops, with `"$ref"` addressing between them) — the door for scene authoring
     *  at a scale where one-field-per-call is not viable. */
    applyOps: (ops: SceneOp[], label?: string) => applySceneOps(ops, label),
    /** Search the asset registry: case-insensitive substring over the project-relative
     *  path, optional asset `type`, capped. A real project has thousands of assets, so
     *  `total` reports the full match count even when `assets` is truncated. */
    listAssets: (opts?: { match?: string; type?: string; limit?: number }) => {
      const needle = opts?.match?.toLowerCase();
      const all = ProjectStore.listAssets().filter(
        (a) => (!opts?.type || a.type === opts.type) && (!needle || a.path.toLowerCase().includes(needle)),
      );
      return { total: all.length, assets: all.slice(0, opts?.limit ?? 200) };
    },
    /** An asset's `.meta` import settings, over its type's defaults. */
    getImportSettings: (path: string) => ProjectStore.getImportSettings(path),
    /** Patch an asset's `.meta` import settings (dotted keys, e.g. `sliceBorder.left`). */
    setImportSettings: (path: string, patch: Record<string, unknown>) =>
      ProjectStore.setImportSettings(path, patch),
    /**
     * Double-click-open an asset by project path, awaited: a prefab enters PREFAB
     * MODE, a scene becomes the document, everything else opens its own editor panel
     * (FSM / BT / tileset / clip / material…). Returns the document afterwards.
     *
     * Three things a driver needs that a double-click doesn't. No PROMPT can be left
     * standing: unsaved work is either refused here or discarded through the door's own
     * `discardChanges`, never handed to a modal with nobody there to answer it (which
     * hangs the call for good). Refusals that the UI reports as a toast — a nested
     * prefab, a variant of a non-flat base — become throws a driver can read. And a
     * type the editor has no editor for is refused instead of being handed to whatever
     * program the OS associates with it: "open this `.png`" means to author, not to pop
     * an image viewer on the user's desktop.
     */
    openAsset: async (path: string, discardChanges = false) => {
      const type = ProjectStore.assetTypeAt(path);
      if (!opensInEditor(type)) {
        throw new Error(
          `the editor has no editor for a '${type}' asset (${path}) — a double-click would hand it to an `
          + 'external program. Read or write it as text instead (read_project_file / write_project_file).',
        );
      }
      // A scene or prefab REPLACES the document, and both take `discardChanges` all the
      // way down. An asset editor prompts about ITS OWN document, which nothing here can
      // answer for — so it opens only from a clean state.
      const swapsDocument = type === 'scene' || type === 'prefab';
      if (DirtyRegistry.isDirty() && !(swapsDocument && discardChanges)) {
        throw new Error(swapsDocument
          ? `opening ${path} would discard unsaved changes — save first, or pass discardChanges to throw them away`
          : `save the open documents before opening ${path} — an asset editor asks about its own unsaved changes, `
            + 'and that prompt has nobody to answer it here',
        );
      }
      if (type === 'prefab') {
        await ProjectStore.openPrefab(path, { discardChanges: true });
        const doc = documentState();
        if (doc.kind !== 'prefab' || doc.path !== path) {
          throw new Error(
            `${path} did not open in Prefab Mode: a NESTED prefab, or a variant whose base isn't flat, is refused `
            + '(the editor logged the reason — get_logs)',
          );
        }
        return doc;
      }
      if (type === 'scene') {
        await openSceneAwaited(path);
        return documentState();
      }
      openAssetOfType(type, path, path.split('/').pop() ?? path);
      return documentState();
    },
    /**
     * What the editor is editing right now — the document every scene read/write
     * acts on: a scene, or a prefab when Prefab Mode is open. Without this a driver
     * that entered Prefab Mode had no way to tell (the tools kept answering, about a
     * different document), and no way to know whether `save` writes a scene or an asset.
     */
    documentState,
    /** Leave Prefab Mode — the banner's "Back to Scene". Refuses on unsaved prefab
     *  changes unless `discardChanges` (see openAsset). */
    exitPrefabMode: async (discardChanges = false) => {
      if (!ProjectStore.getSnapshot()?.prefabEdit) {
        throw new Error('not editing a prefab — nothing to leave (see get_document)');
      }
      if (!discardChanges && DirtyRegistry.isDirty()) {
        throw new Error('the prefab has unsaved changes — save first, or pass discardChanges to throw them away');
      }
      await ProjectStore.exitPrefabMode({ discardChanges: true });
      return documentState();
    },
    /** Open the prefab an INSTANCE came from, in Prefab Mode (the Outliner's "Edit
     *  Prefab") — the door that needs no ref→path lookup by the caller. */
    editPrefab: async (entity: number, discardChanges = false) => {
      requireInstance(entity);
      if (!discardChanges && DirtyRegistry.isDirty()) {
        throw new Error('editing the prefab would discard unsaved changes — save first, or pass discardChanges');
      }
      await ProjectStore.editPrefabOfInstance(entity, { discardChanges: true });
      const doc = documentState();
      if (doc.kind !== 'prefab') {
        throw new Error(
          'the prefab did not open — a NESTED prefab, or a variant whose base is not flat, is refused in Prefab Mode',
        );
      }
      return doc;
    },
    /** Push an instance's overrides back into its prefab asset (the Outliner's "Apply
     *  to Prefab"), rewriting the base for EVERY instance. `confirm` must be true: a
     *  person sees an itemized diff first, so a driver states the intent instead. */
    applyPrefab: async (entity: number, confirm: boolean) => {
      requireInstance(entity);
      if (confirm !== true) {
        throw new Error(
          'apply rewrites the shared prefab for every instance — pass confirm: true to commit. '
          + 'get_inspector on the instance lists what would be baked in (overridden fields are marked).',
        );
      }
      return ProjectStore.applyPrefabInstance(entity, { skipPreview: true });
    },
    /** Discard an instance's overrides and re-sync it to its prefab (the Outliner's
     *  "Revert to Prefab"). Returns the fresh instance root's source id. */
    revertPrefab: async (entity: number) => {
      requireInstance(entity);
      return ProjectStore.revertPrefabInstance(entity);
    },
    /** Detach an instance: its entities become ordinary scene entities and lose every
     *  prefab link (the Outliner's "Unpack Prefab"). Undoable. */
    unpackPrefab: (entity: number) => {
      requireInstance(entity);
      SceneCommands.unpackPrefabInstance(entity);
    },
    /** Save a new `.esprefab` that inherits the instance's prefab and bakes in its
     *  overrides (the Outliner's "Create Variant"), then re-link the instance to it. */
    createPrefabVariant: async (entity: number) => {
      requireInstance(entity);
      return ProjectStore.createVariantFromInstance(entity);
    },
    reveal: (id: string) => dockApi.revealAndExpand(id),
    /** Open a registered panel by id, docking it where its def says (reveal only
     *  fronts an ALREADY-docked panel, so on-demand panels need this door). */
    openPanel: (id: string) => dockApi.openPanel(id),
    /** Resize a docked panel (shot tests: reproduce narrow-dock layouts). */
    setPanelSize: (id: string, size: { width?: number; height?: number }) => dockApi.setPanelSize(id, size),
    /** The Output Log's captured entries (editor + SDK + wasm + play realm),
     *  newest last — an agent's only eyes on runtime errors. */
    logs: (tail = 50) => LogStore.getSnapshot().slice(-tail),
    togglePerfOverlay: () => PerfMonitor.toggleOverlay(),
    captureThumbnail: () => ProjectStore.captureThumbnail(),
    /** The editor camera center + zoom (framing assertions in shot tests). */
    editorView: () => EngineHost.editorViewState(),
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
