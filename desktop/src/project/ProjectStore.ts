// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { createStore } from 'zustand/vanilla';
import { getComponent, getEditorType, Assets, migratePrefabData, extractPrefab, flattenPrefab, collectExternalEntityRefs, collapseInstance, applyDeltaToSource, buildVariant, validateOverrides, setTextureParams, TextureFilter, TextureWrap, Renderer, RETIRED_COMPONENT_TYPES, parseThemeOverrides, resolveAssetGroup } from 'esengine';
import { readTextureImportSettings } from './assetImporter';
import type { SceneData, PrefabData, ExtractEntity, ProcessedEntity, PhysicsPluginConfig, AudioProjectConfig, AssetsData, ThemeOverrides, StaleOverride, PrefabOverride, AddressableManifest, AssetGroupsConfig } from 'esengine';
import { EngineHost } from '@/engine/EngineHost';
import { applyWidgetTheme } from '@/engine/widgetTheme';
import { bootProfiler } from '@/engine/bootProfiler';
import { SceneModel } from '@/engine/SceneModel';
import { Reconciler } from '@/engine/Reconciler';
import { ViewportController } from '@/engine/ViewportController';
import { blankInputMap } from './inputMapDoc';
import { EditorHistory } from '@/engine/EditorHistory';
import { expandScenePrefabs, collapseScenePrefabs } from '@/engine/PrefabInstance';
import { SceneCommands } from '@/engine/SceneCommands';
import { Boxes } from 'lucide-react';
import { spritePrefab, setCanvasDesignSeed, setProjectCameraFit, type EntitySource } from '@/engine/entitySources';
import { setPrefabBaseResolver } from '@/engine/SceneQuery';
import { setUserSchemas, userSchema, setBitmaskSource, setEnumSource, type UserComponentSchema } from '@/engine/schema';
import { setAssetRefProblemResolver } from '@/engine/EditorControlSurface';
import { installSpineSync, type SpineTransport } from '@/engine/spineSync';
import { SceneStore } from '@/engine/SceneStore';
import { useSelection } from '@/store/selectionStore';
import { usePrefabConflicts } from '@/store/prefabConflicts';
import { Toasts } from '@/store/Toasts';
import { confirmDiscard } from './discardGuard';
import { confirm } from '@/components/confirm';
import { previewApply } from './applyPreview';
import { t } from '@/i18n';
import { assetTypeOf } from '@/project/assetMeta';
import { ASSET_SLOTS, metaTypeToSlot } from '@/project/assetSlots';
import type { AssetType } from '@/types';
import { resolveLayout, orientationFromDesignResolution, resolveOrientation, cameraScaleModeValue, WORKSPACE_DIR, PROJECT_MANIFEST_FILE, type OpenedProject, type ProjectFeatures, type ProjectLayout, type ProjectPackaging, type WorkspaceState, type DesignResolution, type ScreenOrientation, type CameraScaleMode } from './format';
import { useEditorMode } from '@/store/editorModeStore';
import { PlayRealms } from '@/engine/PlayRealm';
import { PlayInspect } from '@/engine/PlayInspect';
import { useEditorStore } from '@/store/editorStore';
import { resetFsWatch } from './fsWatch';
import type { DocSnapshot } from '@/document/DirtyRegistry';

/** Pad/truncate collision-layer names to the 16 Box2D filter bits (layer 0 = Default). */
function normalizeLayers(layers?: string[]): string[] {
  return Array.from({ length: 16 }, (_, i) => layers?.[i] ?? (i === 0 ? 'Default' : ''));
}

/** Pad/truncate the collision matrix to 16 rows; absent rows default to all-collide. */
function normalizeLayerMasks(masks?: number[]): number[] {
  return Array.from({ length: 16 }, (_, i) => (typeof masks?.[i] === 'number' ? masks[i] & 0xffff : 0xffff));
}

/** Whether an asset of the editor `type` is a valid pick for a `fieldType` slot. */
function assetMatchesSlot(type: AssetType, path: string, fieldType?: string): boolean {
  if (!fieldType) return true;
  // A 'texture' slot accepts any image (texture or sprite); others match by name.
  if (fieldType === 'texture') return type === 'texture' || type === 'sprite';
  // Spine slots discriminate the shared 'spine' Content-Browser type by
  // extension, through the SDK's own classification (.skel vs .atlas) — the
  // same vocabulary the cook's dep scan uses.
  if (fieldType === 'spine-skeleton' || fieldType === 'spine-atlas') return getEditorType(path) === fieldType;
  if (type === fieldType) return true;
  // Slots named in the SDK's editorType vocabulary rather than the
  // Content-Browser type name (anim-clip for .esanim, timeline for .estimeline).
  return getEditorType(path) === fieldType;
}

/** A pickable asset for the inspector's asset picker. */
export interface AssetEntry {
  ref: string;
  path: string;
  name: string;
  type: AssetType;
}

/**
 * Editor-side project/workspace model (RC12 §E7-3 / §E6-1).
 *
 * Wraps the Electron `window.estella.{project,fs}` bridge: opens a project
 * directory, loads its scene into the live engine World via `resetWorldTo`, and
 * saves back. The bridge sandboxes every fs path to the open project root.
 *
 * Assets resolve through the engine's own asset system:
 * the editor builds a uuid→path registry from `.meta` sidecars, points the
 * engine `Assets` loader at the `estella://` transport (electron/main serves
 * project files), and preloads EVERY referenced asset type — not just textures.
 * The lossless model keeps `@uuid:` refs verbatim, so save stays portable.
 */

const UUID_PREFIX = '@uuid:';

// UUID v4 shape — serialized refs come in three forms: `@uuid:` (canonical),
// a BARE uuid (`.esanim` flipbook frame textures), or a plain path. A bare
// uuid must resolve through the registry like a prefixed one; treating it as
// a path guarantees a 404 (estella://project/<uuid>) and white sprites.
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The uuid carried by a ref (`@uuid:` prefixed, any body — explicit intent —
 *  or bare-but-uuid-shaped), else null for plain paths. Lower-cased. */
function refUuid(ref: string): string | null {
  if (ref.startsWith(UUID_PREFIX)) return ref.slice(UUID_PREFIX.length).toLowerCase();
  return UUID_SHAPE.test(ref) ? ref.toLowerCase() : null;
}

/** The subset of the engine's SceneAssetResult the Reconciler resolver reads. */
interface PreloadResult {
  textureHandles: Map<string, number>;
  materialHandles: Map<string, number>;
  fontHandles: Map<string, number>;
}

interface ProjectState {
  root: string;
  name: string;
  layout: ProjectLayout;
  workspace: WorkspaceState;
  /** Entry scene from the manifest (project-relative); the editor opens it. */
  defaultScene?: string;
  /** Engine features (subsystems) the project enables; drives the play realm. */
  features?: ProjectFeatures;
  /** Persisted Package Project settings (last target/config/output). */
  packaging?: ProjectPackaging;
  /** Reference resolution new Canvas entities seed from; per-scene Canvas stays authoritative. */
  designResolution?: DesignResolution;
  /** The scene currently loaded into the world (project-relative path). */
  currentScene: string | null;
  /** When editing a PREFAB asset in place (Prefab Mode) rather than a scene:
   *  the prefab's display name + path, plus the leaf name of the scene "Back to
   *  Scene" returns to (for the banner breadcrumb) and whether it's a VARIANT
   *  (a different badge / banner). `currentScene` is null. */
  prefabEdit?: { name: string; path: string; returnScene: string | null; isVariant: boolean } | null;
}

/**
 * Component types in `data` that are genuinely unrecognized — not an engine
 * builtin AND not a known project component (no `schemas.json` entry). A project
 * component like `SpawnMarker` IS known (via extracted schema): it's editable +
 * lossless + runs in Play, so it's not flagged. Only a true typo / missing
 * declaration is reported.
 */
function unknownComponentTypes(data: SceneData): string[] {
  const unknown = new Set<string>();
  for (const entity of data.entities ?? []) {
    for (const comp of entity.components ?? []) {
      if (!getComponent(comp.type) && !userSchema(comp.type)) unknown.add(comp.type);
    }
  }
  return [...unknown];
}

/**
 * Drop components retired by an engine upgrade (see SDK RETIRED_COMPONENT_TYPES)
 * from a raw scene, in place; returns the retired type names that were present.
 * These are dead ENGINE types — unlike genuinely-unknown project components (kept
 * verbatim so they round-trip), they carry no live system. Stripping them out of
 * the source-of-truth model on open means a save cleans the file, and they never
 * reach the "unknown project component" warning below. The SDK scene loader drops
 * them too, so Play never warns "Unknown component type" on them.
 */
function stripRetiredComponents(data: SceneData): string[] {
  const dropped = new Set<string>();
  for (const entity of data.entities ?? []) {
    const comps = entity.components;
    if (!comps) continue;
    for (let i = comps.length - 1; i >= 0; i--) {
      if (RETIRED_COMPONENT_TYPES.has(comps[i].type)) { dropped.add(comps[i].type); comps.splice(i, 1); }
    }
  }
  return [...dropped];
}

/** An asset index entry as the registry consumes it (from scanAssets or the
 *  cached assets.json — same shape). */
type AssetEntryLite = { uuid: string; path: string; type?: string; importer?: Record<string, unknown> };

class ProjectStoreImpl {
  private readonly store = createStore<{ project: ProjectState | null }>(() => ({ project: null }));
  /** uuid → project-relative path, scanned from `.meta` sidecars — the editor's
   *  asset registry. The engine `Assets` loader resolves refs through it. */
  private readonly uuidToPath = new Map<string, string>();
  /** path → uuid (reverse), so a Content Browser drag (which carries a path) can
   *  be turned into a portable `@uuid:` ref for the model. */
  private readonly pathToUuid = new Map<string, string>();
  /** uuid → the asset's `.meta` importer block, so the edit viewport applies the
   *  same texture filter/wrap the runtime does (edit == play), and the asset
   *  inspector's Save can push a live sampler update. */
  private readonly uuidToImporter = new Map<string, Record<string, unknown>>();
  /** uuid → the asset's `.meta` type — the hot-sync path picks a loader by it. */
  private readonly uuidToType = new Map<string, string>();
  /** ref → loaded `.esprefab` (PrefabData), for scene load-expand / save-collapse. */
  private readonly prefabCache = new Map<string, PrefabData>();
  /** Active Prefab Mode session, or null. Holds the id-preservation map
   *  (source id → prefabEntityId) so save-back keeps each entity's identity, plus
   *  the scene to return to on exit. The reactive `prefabEdit` in ProjectState is
   *  the lightweight UI mirror. */
  private prefabSession: {
    ref: string;
    path: string;
    name: string;
    rootSource: number;
    idBySource: Map<number, string>;
    returnScene: string | null;
    /** Editor camera at enter, restored on exit so "Back to Scene" returns the
     *  user to the exact view they left instead of reframing to the scene camera. */
    returnView: { x: number; y: number; orthoSize: number } | null;
    /** Scene entity selected at enter (the instance you came from) — re-selected on
     *  exit. Scene entity ids are stable across the reload, so this survives it. */
    returnSelection: number | null;
    /** When editing a VARIANT: its base asset + ref. Save collapses the edited
     *  tree against this base into a variant delta (preserving basePrefab), rather
     *  than extracting a flat prefab. Null for an ordinary (flat) prefab. */
    base: PrefabData | null;
    baseRef: string | null;
  } | null = null;
  /** Cold refs already handed to a live load this registry generation — the touch
   *  listener fires on every projection of a still-cold ref, so without this a
   *  failing asset would re-fetch forever (and a slow one would double-load). */
  private readonly hotLoadStarted = new Set<string>();
  /** Resolved path → error message for live loads that FAILED — diagnostics
   *  surfaces these (the model looks fine; only the load knows it's broken). */
  private readonly assetLoadFailures = new Map<string, string>();
  /** Guards the off-critical-path asset revalidation after a cache-first boot. */
  private revalidating = false;
  /** Bumped on every project open ({@link adopt}); a revalidation captures it and
   *  bails after its await if it changed, so a slow scan for project A can never
   *  clobber project B's registry when the user switches within the scan window. */
  private projectGeneration = 0;
  /** The latest scene preload result; the Reconciler resolver reads handles from
   *  it for entities recreated incrementally (duplicate / undo / play-stop). */
  private lastAssetResult: PreloadResult | null = null;
  private knownSceneText: string | null = null;
  private knownScenePath: string | null = null;
  /** A disk-change discard prompt is showing — don't stack another. */
  private reloadPromptOpen = false;
  constructor() {
    // The inspector's override-aware reset reads prefab base data from the loaded
    // `.esprefab` cache this store owns. Non-variant prefabs resolve their base
    // directly from the asset entities; a variant/nested base degrades to the
    // component default (the entry simply isn't found here).
    setPrefabBaseResolver((ref, prefabId) => {
      const pe = this.prefabCache.get(ref)?.entities.find((e) => e.prefabEntityId === prefabId);
      return pe ? pe.components : null;
    });
    // Collider layer-mask fields resolve their bit labels from this project setting.
    setBitmaskSource('collisionLayers', () => this.collisionLayerOptions());
    // Render `layer` fields become a dropdown once the project names sorting layers.
    setEnumSource('sortingLayers', () => this.sortingLayerOptions());
    // New Canvas entities seed their design resolution from the project setting.
    setCanvasDesignSeed(() => this.designResolution());
    // The device preview reads the project camera fit so its letterbox matches the
    // runtime (WYSIWYG when the fit is on).
    setProjectCameraFit(() => {
      const f = this.screenFit();
      return { scaleMode: f.scaleMode, matchWidthOrHeight: f.matchWidthOrHeight };
    });
    // Diagnostics ask the registry whether a model-healthy asset ref actually
    // names a real, loadable asset (dead refs draw white boxes in silence).
    setAssetRefProblemResolver((ref) => this.assetRefProblem(ref));
    // Instantiating a variant / nested prefab resolves its base through the same
    // warm-cache reader the scene-load path uses (one resolution truth).
    SceneCommands.setPrefabResolver(this.prefabResolverSync);
  }

  /** Read accessor so existing `this.state` reads stay unchanged after the move. */
  private get state(): ProjectState | null {
    return this.store.getState().project;
  }

  subscribe = (fn: () => void): (() => void) => this.store.subscribe(fn);
  getSnapshot = (): ProjectState | null => this.store.getState().project;

  /** Show the OS folder picker and open the chosen project. */
  async openViaDialog(): Promise<boolean> {
    const bridge = window.estella;
    if (!bridge?.project) {
      console.warn('[project] fs bridge unavailable (not running under Electron)');
      return false;
    }
    // Picking a folder without a project.esproject rejects in the main process;
    // surface it as a toast instead of an unhandled rejection.
    try {
      const opened = await bridge.project.openDialog();
      if (!opened) return false;
      await this.adopted(opened);
      return true;
    } catch (e) {
      Toasts.push(t('proj.openFailed', { message: e instanceof Error ? e.message : String(e) }), 'error');
      return false;
    }
  }

  /** Open a project by absolute root path (e.g. a recent / dev default). */
  async open(root: string): Promise<boolean> {
    const bridge = window.estella;
    if (!bridge?.project) return false;
    try {
      await this.adopted(await bridge.project.open(root));
      return true;
    } catch (e) {
      Toasts.push(t('proj.openFailed', { message: e instanceof Error ? e.message : String(e) }), 'error');
      return false;
    }
  }

  /** Create a project from a template at `<location>/<name>`, then open it. */
  async createAndOpen(templateDir: string, location: string, name: string): Promise<boolean> {
    const bridge = window.estella;
    if (!bridge?.project?.createFromTemplate) return false;
    // Scaffolding can reject (name already taken, unwritable location, …) — the
    // same as open()/openViaDialog(). Surface it as a toast; an unhandled
    // rejection here strands the launcher on "Creating…" forever.
    try {
      const root = await bridge.project.createFromTemplate(templateDir, location, name);
      return this.open(root);
    } catch (e) {
      Toasts.push(t('proj.createFailed', { message: e instanceof Error ? e.message : String(e) }), 'error');
      return false;
    }
  }

  /**
   * Adopt an opened project: remember it, and arrange for its scene to load.
   * The engine usually isn't booted yet (we're still on the launcher), so the
   * scene loads via EngineHost's boot bootstrap; if the engine is already
   * running (re-opening from the editor), load immediately.
   */
  private async adopted(opened: OpenedProject): Promise<void> {
    // Staging problems (the .esengine/sdk types mirror) don't block the open,
    // but they must be LOUD — a silent skip is how projects lost their
    // `esengine` IDE types in v0.22.0 with nothing in any log (issue #49).
    if (opened.stagingError) {
      console.error('[project] SDK types staging failed:', opened.stagingError);
      Toasts.push(t('proj.sdkTypesFailed', { message: opened.stagingError }), 'error');
    }
    this.adopt(opened);
    await this.loadAssetGroupsConfig();
    await window.estella.recents.add(opened.root, opened.manifest.name);
    await this.refreshUserSchemas();
    EngineHost.setSceneBootstrap(() => this.loadCurrentScene());
    if (EngineHost.world) await this.loadCurrentScene();
  }

  /**
   * Make the editor aware of the project's own components: (re-)extract their
   * field schemas (pure-node, runs `defineComponent` in an isolated context — no
   * project systems execute), then load the result. So a project component like
   * `SpawnMarker` is first-class in the editor (inspector edits it, the model
   * round-trips it losslessly) WITHOUT the editor realm ever running project code.
   * Call on open + whenever the declaration entry changes. Best-effort — a failure
   * leaves the previous schemas (or builtins-only) and never blocks opening.
   */
  async refreshUserSchemas(): Promise<void> {
    try {
      await window.estella.project.extractSchemas();
    } catch (err) {
      console.warn('[project] schema extract failed (custom components fall back to lossless-only)', err);
    }
    await this.loadUserSchemas();
  }

  /**
   * Load the project's component field schemas from `.esengine/cache/schemas.json`
   * (built by {@link refreshUserSchemas}). Missing/invalid → builtins only; the
   * components still round-trip losslessly through the model.
   */
  private async loadUserSchemas(): Promise<void> {
    try {
      const json = await window.estella.fs.read(`${WORKSPACE_DIR}/cache/schemas.json`);
      setUserSchemas(JSON.parse(json) as UserComponentSchema[]);
    } catch {
      setUserSchemas([]);
    }
  }

  private adopt(opened: OpenedProject) {
    // If a play session is live, tear it down before swapping projects. The App
    // play-effect keys off `isPlaying`, which opening a project never changes, so
    // without this the editor stays "Running" on a realm we're about to reset and
    // PlayInspect keeps polling the destroyed realm. Stop the poll BEFORE the
    // reset; flipping isPlaying lets the effect finish the teardown (dock tabs).
    const es = useEditorStore.getState();
    if (es.isPlaying || es.isPaused) {
      PlayInspect.stop();
      es.setInspectWorld('editor');
      es.stop();
    }
    // A new project supersedes any in-flight revalidation of the old one (its
    // late populateRegistry must not clobber this project's registry).
    this.projectGeneration++;
    this.revalidating = false;
    // Drop any file-watch burst still queued for the previous project.
    resetFsWatch();
    // A play realm warmed for the PREVIOUS project holds its bundle + assets;
    // cold-reset so the next prewarm/Play stages this project.
    PlayRealms.resetPrimary();
    this.store.setState({
      project: {
        root: opened.root,
        name: opened.manifest.name,
        layout: resolveLayout(opened.manifest),
        workspace: opened.workspace,
        defaultScene: opened.manifest.defaultScene,
        features: opened.manifest.features,
        packaging: opened.manifest.packaging,
        designResolution: opened.manifest.designResolution,
        currentScene: null,
      },
    });
    // Seed the device-preview orientation from the project so the editor opens
    // matching the shipped orientation; the viewport toggle can still override it.
    useEditorMode.setState({ orientation: resolveOrientation(opened.manifest) });
  }

  /** Load the project's last-opened scene (or `<scenes>/main.esscene`) into the world. */
  async loadCurrentScene(): Promise<void> {
    const st = this.state;
    if (!st) return;
    // Project-level render config (WYSIWYG in the edit viewport). Applied here —
    // the one path that runs both on project open and once the engine is ready.
    Renderer.setYSortLayers(this.ySortMask());
    const rel =
      st.workspace.lastOpenedScene ?? st.defaultScene ?? `${st.layout.scenes}/main.esscene`;
    const text = await window.estella.fs.read(rel);
    const raw = JSON.parse(text) as SceneData;
    const retired = stripRetiredComponents(raw);
    if (retired.length > 0) {
      console.info(
        `[project] upgraded scene "${rel}": dropped retired engine component(s) ` +
        `(${retired.join(', ')}). Their behaviour is supplied by successor systems ` +
        `(e.g. UIController + gears for widgets); save the scene to persist the cleanup.`,
      );
    }
    const dropped = unknownComponentTypes(raw);
    if (dropped.length > 0) {
      console.warn(
        `[project] scene "${rel}" references components the editor doesn't know ` +
        `(${dropped.join(', ')}). Their entities still render, but the inspector ` +
        `can't show or edit these components' fields until they're declared in the ` +
        `project's script-register entry (src/components.ts) — the editor extracts ` +
        `schemas from there without running project code. They're preserved verbatim ` +
        `in the source-of-truth model and on save (JSON-first).`,
      );
    }
    // Build the uuid→path registry first (prefab + texture refs resolve through it).
    // Cache-first so the full O(files) disk scan doesn't gate engine-ready — it
    // revalidates in the background (see buildAssetRegistry).
    await bootProfiler.phase('scanAssets', () => this.buildAssetRegistry({ preferCache: true }));

    // Expand prefab-instance entries into ordinary tagged entities (the model is
    // always expanded; the file stores deltas). Internal
    // entities get fresh ids above the file's max so they don't collide.
    let nextId = raw.entities.reduce((m, e) => Math.max(m, (e as { id?: number }).id ?? 0), 0) + 1;
    const { scene: expandedRaw, tags } = await bootProfiler.phase('expandPrefabs', () => expandScenePrefabs(
      raw,
      (ref) => this.loadPrefabAsset(ref),
      () => nextId++,
    ));

    // Preload EVERY referenced asset type through the engine's own system, and
    // resolve a COPY of the (expanded) scene (refs → handles) for the World.
    const assets = EngineHost.getResource(Assets);
    let resolved: SceneData = expandedRaw;
    if (assets) {
      const result = await bootProfiler.phase('preloadSceneAssets', () => assets.preloadSceneAssets(expandedRaw));
      resolved = JSON.parse(JSON.stringify(expandedRaw)) as SceneData; // resolveSceneAssetPaths mutates
      assets.resolveSceneAssetPaths(resolved, result);
      this.lastAssetResult = result; // narrowed to the handle maps the resolver reads
    }

    // A scene is a session document: replacing it clears the SCENE's history
    // entries + selection so undo closures can't reference the previous scene's
    // entities (open asset editors keep theirs — their snapshots reference no
    // scene state). The Reconciler bulk path then builds the World
    // from the resolved scene and adopts the raw scene (with @uuid: refs + any
    // components/fields/invisible entities the World drops) as the source of
    // truth. The World is a lossy projection; the model is what save() serializes.
    EditorHistory.clearScene();
    useSelection.getState().select(null);
    // Incremental recreate (duplicate / undo / play-stop) re-resolves @uuid:→handle
    // from the same preload result — for all types, not just textures. Spine
    // slots resolve to project paths instead (they stay strings in the World).
    Reconciler.setAssetResolver((ref) => this.handleForRef(ref));
    Reconciler.setRefPathResolver((ref) => this.resolveRef(ref));
    // A projection that resolves COLD (assigned after the scene-open preload)
    // hands its ref here: async load through the engine loaders, re-project.
    Reconciler.setAssetTouchListener((ref, slot) => this.hotLoadAsset(ref, slot));
    // Spine bindings (skeleton/atlas/pages → SpineManager) are a live projection
    // of the model, driven by model events: adopt's `reset` performs the initial
    // bind, and later ref/field edits keep the viewport true (see spineSync).
    installSpineSync(this.spineTransport());
    await bootProfiler.phase('reconcile (build world)', () => Reconciler.adopt(expandedRaw, resolved));
    // Re-apply prefab-instance tags (adopt cleared them) so save can collapse.
    for (const { id, tag } of tags) SceneModel.setPrefabTag(id, tag);

    EngineHost.syncEditorViewToScene();
    // Edit-world live theme: re-resolve ThemeStyle-tagged widgets against the
    // project's effective theme, matching what a shipped runtime boots with.
    applyWidgetTheme(this.uiTheme(), this.uiThemeOverrides());
    // Surface any instance overrides the loader just dropped (they point at prefab
    // structure that no longer exists) — otherwise the customization loss is silent.
    this.detectPrefabConflicts(raw);
    // Loading a scene always leaves Prefab Mode (if it was active).
    this.prefabSession = null;
    this.store.setState({ project: { ...st, currentScene: rel, prefabEdit: null } });
    this.knownSceneText = text;
    this.knownScenePath = rel;
  }

  /** A fresh, untitled scene document: a single orthographic Camera at the origin. */
  private blankScene(): SceneData {
    return {
      version: '1.0',
      name: 'Untitled',
      entities: [
        {
          id: 0,
          name: 'Camera',
          parent: null,
          children: [],
          components: [
            { type: 'Transform', data: { position: { x: 0, y: 0, z: 10 } } },
            { type: 'Camera', data: { projectionType: 1, orthoSize: 300, isActive: true, priority: 0 } },
          ],
          visible: true,
        },
      ],
    } as unknown as SceneData;
  }

  /**
   * Start a fresh, UNTITLED scene (the UE/Unity "New Scene"): a blank document with
   * just a default Camera, adopted into the model. `currentScene` is null so the file
   * is created on first Save (which routes to Save-As). Clears history + selection like
   * a load, so undo can't reach the previous scene's entities. No disk write yet.
   */
  async newScene(): Promise<void> {
    const st = this.state;
    if (!st) return;
    const blank = this.blankScene();
    await this.buildAssetRegistry(); // keep the uuid→path registry current for new refs
    EditorHistory.clearScene();
    useSelection.getState().select(null);
    Reconciler.setAssetResolver((ref) => this.handleForRef(ref));
    Reconciler.setRefPathResolver((ref) => this.resolveRef(ref));
    Reconciler.setAssetTouchListener((ref, slot) => this.hotLoadAsset(ref, slot));
    installSpineSync(this.spineTransport());
    Reconciler.adopt(blank, blank); // no @uuid: refs → resolved === raw
    EngineHost.syncEditorViewToScene();
    usePrefabConflicts.getState().clear();
    this.prefabSession = null;
    this.store.setState({ project: { ...st, currentScene: null, prefabEdit: null } });
  }

  /**
   * Create a new blank scene FILE (+ `.meta`) under `destDir` for the Content
   * Browser's "New Scene" — writes it to disk WITHOUT switching the editor to it
   * (unlike {@link newScene}). Returns its project-relative path.
   */
  async createSceneFile(destDir: string): Promise<string> {
    const content = JSON.stringify(this.blankScene(), null, 2) + '\n';
    return window.estella.project.createAsset(destDir, 'scene.esscene', content, 'scene');
  }

  /** Create a blank `.inputmap` asset (named input actions) under `destDir`. */
  async createInputMapFile(destDir: string): Promise<string> {
    const content = JSON.stringify(blankInputMap(), null, 2) + '\n';
    return window.estella.project.createAsset(destDir, 'input.inputmap', content, 'inputmap');
  }

  /** Create a blank `.eslocale` string table (ONE locale's key → text; ship one
   *  file per language) under `destDir`. */
  async createLocaleTableFile(destDir: string): Promise<string> {
    const content = JSON.stringify({ version: 1, locale: 'en', entries: {} }, null, 2) + '\n';
    return window.estella.project.createAsset(destDir, 'strings.eslocale', content, 'locale');
  }

  /**
   * Load the project's asset index (the main-process AssetDatabase scan)
   * into a uuid→path registry, then point the engine
   * `Assets` loader at it + the `estella://` transport. This is the ONE
   * asset-resolution path: `Assets.resolveRef` turns `@uuid:` → path, the backend
   * fetches `estella://project/<path>`.
   */
  private async buildAssetRegistry(opts?: { preferCache?: boolean }): Promise<void> {
    if (!this.state) return;
    // Cache-first (boot): the O(files) disk scan is ~1.5s cold on an asset-heavy
    // project and gates the "engine ready" overlay. The cached assets.json is
    // almost always current (the fs watcher keeps it live while open), so build
    // the registry from it immediately and revalidate with the authoritative
    // scan OFF the critical path — only re-projecting if something changed while
    // the project was closed.
    if (opts?.preferCache) {
      const cached = await window.estella.project.cachedAssetIndex().catch(() => null);
      if (cached) {
        this.populateRegistry(cached.entries);
        void this.revalidateAssets();
        return;
      }
      // No cache (first-ever open) → fall through to a full, blocking scan.
    }
    const entries = await this.scanAssetsReporting();
    if (entries) this.populateRegistry(entries);
  }

  /** Run the authoritative scan; report its boot timing + any adopted orphans. */
  private async scanAssetsReporting(): Promise<AssetEntryLite[] | null> {
    try {
      const scan = await window.estella.project.scanAssets();
      if (scan.timingMs) bootProfiler.detail('scanAssets', scan.timingMs);
      if ((scan.adopted?.length ?? 0) > 0) {
        console.info(
          `[assets] adopted ${scan.adopted.length} file(s) that had no .meta — they are now registered assets`,
          scan.adopted,
        );
      }
      return scan.index.entries;
    } catch (err) {
      console.warn('[project] asset scan failed', err);
      return null;
    }
  }

  /** Rebuild the uuid↔path registry + Assets resolvers from an index's entries,
   *  dropping ALL caches — a full rescan (project open) can invalidate anything. */
  private populateRegistry(entries: readonly AssetEntryLite[]): void {
    this.prefabCache.clear();
    this.hotLoadStarted.clear();
    this.assetLoadFailures.clear();
    this.rebuildLookups(entries);
  }

  /** Rebuild only the (cheap, in-memory) uuid↔path lookup maps + Assets resolvers
   *  from an index's entries. Leaves the disk-loaded prefab cache and live-load
   *  bookkeeping alone — the incremental path invalidates those selectively. */
  private rebuildLookups(entries: readonly AssetEntryLite[]): void {
    this.uuidToPath.clear();
    this.pathToUuid.clear();
    this.uuidToImporter.clear();
    this.uuidToType.clear();
    for (const e of entries) {
      const uuid = e.uuid.toLowerCase();
      this.uuidToPath.set(uuid, e.path);
      this.pathToUuid.set(e.path, uuid);
      if (e.importer) this.uuidToImporter.set(uuid, e.importer);
      if (e.type) this.uuidToType.set(uuid, e.type);
    }

    const assets = EngineHost.getResource(Assets);
    if (assets) {
      assets.baseUrl = 'estella://project';
      assets.setAssetRefResolver((ref) => this.resolveRef(ref));
      // Edit viewport honors each texture's `.meta` filter/wrap at load — the same
      // settings the runtime applies (was runtime-only, so edit ≠ play before).
      assets.setTextureImportSettingsResolver((ref) => this.textureImportFor(ref));
    }
  }

  /**
   * Fold the fs watcher's precise changed paths into the registry incrementally
   * (the watcher path — {@link fsWatch}), instead of a full O(files) rescan on
   * every disk touch. The main process updates the cached index per-path and tells
   * us whether it had to fall back to a full scan (directory move / bulk / no
   * cache); on incremental success we rebuild only the lookup maps and invalidate
   * only the changed prefabs. A full-scan fallback repopulates wholesale (a
   * structural change can invalidate any cache), and is logged so it's never silent.
   */
  async applyDiskChanges(paths: readonly string[]): Promise<void> {
    if (!this.state) return;
    const result = await window.estella.project.scanAssetsIncremental([...paths]).catch(() => null);
    if (!result) {
      // IPC failed (e.g. project closing) — a full rescan is the safe recovery.
      await this.buildAssetRegistry();
      return;
    }
    if (result.fullRescan) {
      console.info(`[assets] full rescan: ${result.reason ?? 'unspecified'}`);
      this.populateRegistry(result.index.entries);
      return;
    }
    this.applyIncrementalRegistry(result.index.entries, paths);
  }

  /** Apply an incrementally-updated index to the renderer registry: rebuild the
   *  lookup maps, but evict from the prefab cache ONLY the changed/removed prefab
   *  paths — a scene save must not drop every loaded `.esprefab`. */
  private applyIncrementalRegistry(entries: readonly AssetEntryLite[], changedPaths: readonly string[]): void {
    const changed = new Set(changedPaths.map((p) => p.replace(/\\/g, '/').replace(/\.meta$/, '')));
    const kept = new Set(entries.map((e) => e.path));
    // Resolve each cached prefab's path via the CURRENT (pre-rebuild) map, so this
    // must run before rebuildLookups.
    for (const ref of [...this.prefabCache.keys()]) {
      const uuid = refUuid(ref);
      const p = uuid !== null ? this.uuidToPath.get(uuid) : undefined;
      if (!p || changed.has(p) || !kept.has(p)) this.prefabCache.delete(ref);
    }
    this.rebuildLookups(entries);
  }

  /** Off-critical-path authoritative scan after a cache-first boot: repopulate +
   *  re-project only the paths that changed while the project was closed (the
   *  common case is zero changes → a pure no-op). */
  private async revalidateAssets(): Promise<void> {
    if (this.revalidating) return;
    const gen = this.projectGeneration;
    this.revalidating = true;
    try {
      const entries = await this.scanAssetsReporting();
      if (!entries) return;
      if (gen !== this.projectGeneration) return; // switched projects mid-scan — don't clobber the new one
      const fresh = new Map<string, string>();
      for (const e of entries) fresh.set(e.path, e.uuid.toLowerCase());
      const changed: string[] = [];
      for (const [p, u] of fresh) if (this.pathToUuid.get(p) !== u) changed.push(p);
      for (const p of this.pathToUuid.keys()) if (!fresh.has(p)) changed.push(p); // removed
      if (changed.length === 0) return; // the cache was authoritative — nothing to do
      console.info(`[assets] revalidation: ${changed.length} asset change(s) since the project was last open`);
      this.populateRegistry(entries);
      this.hotSyncChangedPaths(changed);
    } finally {
      // A superseded scan must not clear the flag the new project's scan now owns.
      if (gen === this.projectGeneration) this.revalidating = false;
    }
  }

  /** The texture filter/wrap for a ref (`@uuid:` or path), from its `.meta`
   *  importer — the shape `Assets`'s TextureLoader consumes. Undefined ⇒ defaults. */
  private textureImportFor(ref: string): ReturnType<typeof readTextureImportSettings> {
    const uuid = refUuid(ref) ?? this.pathToUuid.get(ref);
    return readTextureImportSettings(uuid ? this.uuidToImporter.get(uuid) : undefined);
  }

  /** Push a texture's just-saved import settings to its LIVE gl handle so the edit
   *  viewport reflects a filter/wrap change immediately — no scene reload / sprite
   *  repoint (the handle is updated in place; sprites keep referencing it). Call
   *  after the asset inspector writes the `.meta` + refreshAssets. */
  applyLiveTextureSettings(path: string): void {
    const uuid = this.pathToUuid.get(path);
    const s = readTextureImportSettings(uuid ? this.uuidToImporter.get(uuid) : undefined);
    const handle = uuid ? EngineHost.getResource(Assets)?.getTexture(UUID_PREFIX + uuid)?.handle : undefined;
    if (!s || !handle) return;
    const filter = s.filter === 'nearest' ? TextureFilter.Nearest : TextureFilter.Linear;
    const wrap =
      s.wrap === 'clamp' ? TextureWrap.ClampToEdge : s.wrap === 'mirror' ? TextureWrap.MirroredRepeat : TextureWrap.Repeat;
    setTextureParams(handle, filter, filter, wrap, wrap);
  }

  /** Resolve a serialized asset ref to a project-relative path for the engine
   *  loader: a uuid ref (`@uuid:` or bare) → path (null if unknown); a plain
   *  path passes through. */
  private resolveRef(ref: string): string | null {
    const uuid = refUuid(ref);
    if (uuid === null) return ref;
    return this.uuidToPath.get(uuid) ?? null;
  }

  /** The project transport spine assets load over: ref → `estella://` URL for
   *  fetches, `@uuid:` ref → project path for atlas-dir derivation. */
  private spineTransport(): SpineTransport {
    return {
      toUrl: (ref) =>
        ref.startsWith(UUID_PREFIX)
          ? `estella://project/${this.resolveRef(ref) ?? ''}`
          : `estella://project/${ref.replace(/^\//, '')}`,
      resolvePath: (ref) => this.resolveRef(ref) ?? ref,
    };
  }

  /** The live GL handle for a uuid. Textures read the engine's live cache (so a
   *  just-assigned texture resolves); material/font fall back to the scene preload. */
  private handleForRef(ref: string): number {
    const tex = EngineHost.getResource(Assets)?.getTexture(ref);
    if (tex) return tex.handle;
    const uuid = refUuid(ref);
    const path = uuid !== null ? this.uuidToPath.get(uuid) : ref;
    const r = this.lastAssetResult;
    if (!path || !r) return 0;
    return r.materialHandles.get(path) ?? r.fontHandles.get(path) ?? 0;
  }

  /**
   * The async half of live asset resolution (the Reconciler's touch listener).
   * A projection just resolved `ref` COLD — the scene-open preload never saw it
   * (assigned after load: surface setField, the picker popover, a hot-created
   * asset). Load it through the engine's own loader for its slot type, then
   * re-project the components that reference it; failures are LOUD and recorded
   * for diagnostics. Deduped per registry generation so a broken ref can't
   * re-fetch forever.
   */
  private hotLoadAsset(ref: string, fieldType: string): void {
    const path = this.resolveRef(ref);
    if (path === null) return; // unknown uuid — diagnostics reports it; nothing to load
    const key = `${fieldType}:${path}`;
    if (this.hotLoadStarted.has(key)) return;
    this.hotLoadStarted.add(key);
    const assets = EngineHost.getResource(Assets);
    if (!assets) return;
    void this.loadForSlot(assets, fieldType, ref, path)
      .then(() => {
        this.assetLoadFailures.delete(path);
        Reconciler.reprojectRefs((r) => this.resolveRef(r) === path);
        SceneStore.poke();
      })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        this.assetLoadFailures.set(path, msg);
        console.error(`[assets] live load of ${fieldType} "${path}" failed: ${msg}`);
      });
  }

  /** Load `ref` through the loader its slot type names — the same loaders the
   *  scene-open preload dispatches to (one loading truth, two trigger times). */
  private loadForSlot(assets: AssetsData, fieldType: string, ref: string, path: string): Promise<unknown> {
    const def = ASSET_SLOTS[fieldType];
    if (!def) return Promise.reject(new Error(`no live loader for asset slot type "${fieldType}"`));
    const loaded = def.load(assets, ref, path);
    if (!def.record) return loaded;
    const kind = def.record;
    return loaded.then((r) => this.recordHandle(kind, path, (r as { handle: number }).handle));
  }

  /** Record a hot-loaded material/font handle where the incremental resolver
   *  looks them up (they have no live engine-side cache getter like textures). */
  private recordHandle(kind: 'material' | 'font', path: string, handle: number): void {
    if (!this.lastAssetResult) {
      this.lastAssetResult = { textureHandles: new Map(), materialHandles: new Map(), fontHandles: new Map() };
    }
    const maps = this.lastAssetResult;
    (kind === 'material' ? maps.materialHandles : maps.fontHandles).set(path, handle);
  }

  /**
   * Content changed ON DISK (fs watcher) — keep the live realm coherent: drop
   * every stale cache entry for the changed assets and, when something in the
   * open scene still references them, reload + re-project. This is the missing
   * half of hot reload that made a re-imported/re-written asset render stale
   * (or as fragments of whatever texture inherited its handle).
   */
  hotSyncChangedPaths(paths: readonly string[]): void {
    const assets = EngineHost.getResource(Assets);
    if (!assets) return;
    const seen = new Set<string>();
    for (const raw of paths) {
      const rel = raw.replace(/\\/g, '/').replace(/\.meta$/, '');
      if (rel === '' || seen.has(rel)) continue;
      seen.add(rel);
      const uuid = this.pathToUuid.get(rel);
      if (!uuid) continue; // not a registered asset (or deleted — registry refresh handles it)
      if (!assets.invalidate(rel)) continue; // nothing was cached → nothing is stale
      // The asset WAS live: clear the dedup so the reload can start, then reload
      // through the same slot-typed path a cold projection uses.
      for (const key of [...this.hotLoadStarted]) {
        if (key.endsWith(`:${rel}`)) this.hotLoadStarted.delete(key);
      }
      const slot = metaTypeToSlot(this.uuidToType.get(uuid));
      if (slot) this.hotLoadAsset(UUID_PREFIX + uuid, slot);
    }
  }

  /**
   * Why an asset REFERENCE would not produce a live asset, or null when it's
   * fine: `unresolved` (the registry knows no such uuid/path) or a recorded
   * live-load failure. Diagnostics adds these on top of required-empty — the
   * model value looks perfectly healthy in both cases.
   */
  assetRefProblem(ref: string): string | null {
    const uuid = refUuid(ref);
    const path = uuid !== null ? (this.uuidToPath.get(uuid) ?? null) : ref;
    if (path === null) return 'unresolved: no asset with this uuid in the registry';
    if (uuid === null && !this.pathToUuid.has(path)) {
      return `unresolved: "${path}" is not a registered asset`;
    }
    const failure = this.assetLoadFailures.get(path);
    return failure ? `load failed: ${failure}` : null;
  }

  /** The live material handle a scene's sprites use for @p path (from the last scene
   *  preload), or 0 if the material isn't loaded in the current scene. The Material Editor
   *  uses it to push live edits onto the running material so the viewport reflects them. */
  materialHandle(path: string): number {
    return this.lastAssetResult?.materialHandles.get(path) ?? 0;
  }

  /** Load a `.esprefab` asset (PrefabData) by ref, cached. The scene load-expand
   *  / save-collapse path resolves prefab instances through this. Warms the
   *  prefab's base (variant) + nested refs into the cache too, so the SYNChronous
   *  flatten resolver ({@link prefabResolverSync}) can resolve them. */
  private async loadPrefabAsset(ref: string): Promise<PrefabData | null> {
    if (!ref.startsWith(UUID_PREFIX)) return null;
    const cached = this.prefabCache.get(ref);
    if (cached) return cached;
    const path = this.uuidToPath.get(ref.slice(UUID_PREFIX.length).toLowerCase());
    if (!path) return null;
    try {
      const prefab = migratePrefabData(JSON.parse(await window.estella.fs.read(path))).data as PrefabData;
      // Cache BEFORE warming deps so a variant/nested ref CYCLE terminates (the
      // second visit hits the cache and returns instead of re-fetching forever).
      this.prefabCache.set(ref, prefab);
      await this.warmPrefabDeps(prefab);
      return prefab;
    } catch (err) {
      console.warn('[project] prefab load failed', path, err);
      return null;
    }
  }

  /** Recursively load a prefab's base (variant `basePrefab`) + every entity's
   *  `nestedPrefab` ref into the cache. flattenPrefab resolves those SYNChronously
   *  during expansion, so they must already be resident. */
  private async warmPrefabDeps(prefab: PrefabData): Promise<void> {
    if (prefab.basePrefab) await this.loadPrefabAsset(prefab.basePrefab);
    for (const e of prefab.entities) {
      const nested = e.nestedPrefab?.prefabPath;
      if (nested) await this.loadPrefabAsset(nested);
    }
  }

  /** Synchronous prefab resolver for flattenPrefab's variant / nested expansion —
   *  a cache read (the async {@link loadPrefabAsset} pre-warms every dependency).
   *  Installed on the scene-load + instantiate paths so a variant / nested
   *  instance resolves its base the same way in both. */
  private prefabResolverSync = (ref: string): PrefabData | null => this.prefabCache.get(ref) ?? null;

  /**
   * Scan a raw scene's prefab-instance entries for STALE overrides — ones that
   * target an entity / component the prefab no longer has. The loader silently
   * drops them (the customization vanishes with no trace), so record them per
   * instance root ({@link usePrefabConflicts}) for the Inspector to surface. Only
   * FLAT bases are checked: validateOverrides is structural, so a variant / nested
   * base (whose inherited entities live in ITS base) would false-positive.
   */
  private detectPrefabConflicts(raw: SceneData): void {
    const byInstance = new Map<number, StaleOverride[]>();
    for (const e of raw.entities as unknown[]) {
      const entry = e as { id?: number; prefab?: string; overrides?: PrefabOverride[] };
      if (typeof entry.prefab !== 'string' || !entry.overrides?.length || typeof entry.id !== 'number') continue;
      const base = this.prefabCache.get(entry.prefab);
      if (!base || base.basePrefab || base.entities.some((be) => be.nestedPrefab)) continue;
      const { stale } = validateOverrides(base, { instanceOverrides: entry.overrides });
      if (stale.length > 0) byInstance.set(entry.id, stale);
    }
    usePrefabConflicts.getState().setAll(byInstance);
    const total = usePrefabConflicts.getState().total;
    if (total > 0) {
      console.warn(
        `[prefab] ${total} stale override(s) on ${byInstance.size} instance(s) reference prefab ` +
        `structure that no longer exists — dropped on load. Select an affected instance to review, ` +
        `or save to persist the cleanup.`,
      );
      Toasts.push(t('proj.staleOverrides', { overrides: total, instances: byInstance.size }), 'warn', 4500);
    }
  }


  /**
   * Instantiate a `.esprefab` (by project-relative path) into the open scene
   * under `parent`, optionally placed at `position` (world coords). Selects the
   * new instance. This is the Content-Browser drag-into-scene entry point: it
   * resolves the path → `@uuid:` ref, loads the PrefabData, and runs the
   * undoable {@link SceneCommands.instantiatePrefab}. Returns the instance root
   * source id, or null if the path isn't a tracked prefab asset.
   */
  async instantiatePrefabFromPath(
    path: string,
    parent: number | null = null,
    position?: { x: number; y: number },
  ): Promise<number | null> {
    const uuid = this.pathToUuid.get(path);
    if (!uuid) return null;
    const ref = UUID_PREFIX + uuid;
    const prefab = await this.loadPrefabAsset(ref);
    if (!prefab) {
      Toasts.push(t('proj.prefabLoadFailed', { name: path.split('/').pop() ?? path }), 'error');
      return null;
    }
    const rootId = SceneCommands.instantiatePrefab(prefab, ref, parent, position);
    if (rootId != null) useSelection.getState().select(rootId);
    return rootId;
  }

  /**
   * Create-entity sources for the project's `.esprefab` assets — each instantiates
   * its prefab linked to the asset (so save collapses the instance to a delta). Feeds
   * the Create popover's 'Prefabs' category (REARCH ENTITY_CREATION E4b). `build`
   * loads the same PrefabData as the drag-into-scene path; on load failure it toasts +
   * throws so createFromSource creates nothing.
   */
  prefabSources(): EntitySource[] {
    const out: EntitySource[] = [];
    for (const [path, uuid] of this.pathToUuid) {
      if (!path.toLowerCase().endsWith('.esprefab')) continue;
      const ref = UUID_PREFIX + uuid;
      const name = (path.split('/').pop() ?? 'Prefab').replace(/\.esprefab$/i, '');
      out.push({
        id: `prefab:${path}`,
        label: name,
        category: 'Prefabs',
        icon: Boxes,
        keywords: [name],
        build: async () => {
          const p = await this.loadPrefabAsset(ref);
          if (!p) {
            Toasts.push(t('proj.prefabLoadFailed', { name }), 'error');
            throw new Error('prefab load failed');
          }
          return p;
        },
        linkPrefabRef: () => ref,
      });
    }
    return out;
  }

  /**
   * Enter Prefab Mode on the SOURCE of a prefab instance (Outliner / Inspector
   * "Edit Prefab" — Unity's open-from-instance, the common workflow of editing a
   * prefab you spotted in the scene). Resolves any entity of the instance to its
   * prefab asset and routes to {@link openPrefab}, which owns the unsaved-changes
   * guard + flat-only refusal. No-op if the entity isn't a prefab instance or its
   * asset can't be resolved.
   */
  async editPrefabOfInstance(id: number): Promise<void> {
    const tag = SceneModel.prefabTag(id);
    const ref = tag?.prefab ?? (tag ? SceneModel.prefabTag(tag.instanceRoot)?.prefab : undefined);
    if (!ref) return;
    const info = this.assetInfo(ref);
    if (!info) return;
    await this.openPrefab(info.path);
  }

  /**
   * Revert a prefab instance to the prefab (Details "Revert"): re-sync the whole
   * instance to the asset, discarding all overrides, keeping its placement. Works on
   * any entity of the instance (resolves to the instance root). Implemented by
   * composing the existing, tested delete + re-instantiate commands — so it can't
   * desync; the cost is two undo steps (delete, then instantiate). Returns the fresh
   * root's source id, or null if the entity isn't a prefab instance.
   */
  async revertPrefabInstance(sourceId: number): Promise<number | null> {
    const tag = SceneModel.prefabTag(sourceId);
    const instanceRoot = tag?.instanceRoot ?? sourceId;
    const ref = SceneModel.prefabTag(instanceRoot)?.prefab;
    if (!ref) return null;
    const info = this.assetInfo(ref);
    if (!info) return null;
    const root = SceneModel.entityBySource(instanceRoot);
    const parent = root?.parent ?? null;
    const tf = root?.components.find((c) => c.type === 'Transform')?.data as
      | { position?: { x: number; y: number } }
      | undefined;
    const position = tf?.position ? { x: tf.position.x, y: tf.position.y } : undefined;
    SceneCommands.deleteEntity(instanceRoot);
    return this.instantiatePrefabFromPath(info.path, parent, position);
  }

  /**
   * Apply a prefab instance's overrides back to the prefab asset (Details "Apply"):
   * this instance's current values become the prefab's new base, then the instance
   * re-syncs to that base so its overrides clear. Works on any entity of the
   * instance (resolves to the root). Returns the fresh root's source id, or null.
   *
   * Scope: property / name / visibility / component overrides PLUS structural
   * edits — entities the instance added or removed are folded into the asset via
   * `applyDeltaToSource` (structural changes prompt a confirm first, since they
   * rewrite the shared prefab for every instance). Metadata diffs are dropped —
   * the editor model doesn't track per-instance metadata, so they're never a real
   * override, and baking them would strip the prefab's own metadata. Live
   * propagation to *other* in-scene instances still isn't immediate; those
   * siblings re-derive from the new base on next load.
   */
  async applyPrefabInstance(sourceId: number): Promise<number | null> {
    const tag = SceneModel.prefabTag(sourceId);
    const instanceRoot = tag?.instanceRoot ?? sourceId;
    const ref = SceneModel.prefabTag(instanceRoot)?.prefab;
    if (!ref) return null;
    const info = this.assetInfo(ref);
    if (!info) return null;
    const oldPrefab = await this.loadPrefabAsset(ref);
    if (!oldPrefab) {
      Toasts.push(t('proj.prefabLoadFailed', { name: info.path.split('/').pop() ?? info.path }), 'error');
      return null;
    }

    // The instance's live subtree as flattened entities (matching the save path's
    // ProcessedEntity shape — metadata is not modelled per-instance).
    const processed: ProcessedEntity[] = [];
    for (const id of SceneModel.collectSubtree(instanceRoot)) {
      const e = SceneModel.entityBySource(id);
      const t = SceneModel.prefabTag(id);
      if (!e || !t) continue;
      processed.push({
        id,
        prefabEntityId: t.prefabId,
        name: e.name,
        parent: e.parent,
        children: e.children ?? [],
        components: e.components as ProcessedEntity['components'],
        visible: (e as { visible?: boolean }).visible ?? true,
      });
    }
    if (processed.length === 0) return null;

    // The full delta against the asset: property overrides + structural edits.
    const delta = collapseInstance(oldPrefab, ref, processed, this.prefabResolverSync);
    const overrides = delta.overrides
      .filter((o) => o.type !== 'metadata_set' && o.type !== 'metadata_removed');
    const { added, removed } = delta;
    const structural = added.length + removed.length;
    if (overrides.length === 0 && structural === 0) {
      Toasts.push(t('proj.noOverrides'), 'info');
      return instanceRoot;
    }

    const name = info.path.split('/').pop() ?? info.path;

    // Apply rewrites the SHARED prefab for every instance — show an itemized diff
    // preview and let the user confirm before committing. Names resolve from the
    // live instance, else the prefab base (for removed entities), else the id.
    const nameByPrefabId = new Map(processed.map((e) => [e.prefabEntityId, e.name]));
    const nameOf = (id: string): string =>
      nameByPrefabId.get(id) ?? oldPrefab.entities.find((e) => e.prefabEntityId === id)?.name ?? id;
    const ok = await previewApply(name, { overrides, added, removed }, nameOf);
    if (!ok) return instanceRoot;

    const newPrefab = applyDeltaToSource(oldPrefab, { overrides, added, removed });

    try {
      await window.estella.fs.write(info.path, JSON.stringify(newPrefab, null, 2) + '\n');
    } catch (err) {
      Toasts.push(t('proj.applyWriteFailed', { name }), 'error');
      return null;
    }
    this.prefabCache.set(ref, newPrefab);

    // Re-sync this instance to the updated base so its (now-applied) edits
    // clear — reuses the proven delete + re-instantiate path.
    const newRoot = await this.revertPrefabInstance(instanceRoot);
    if (structural > 0) {
      Toasts.push(t('proj.appliedStructural', {
        name, overrides: overrides.length, added: added.length, removed: removed.length,
      }), 'success');
    } else {
      Toasts.push(
        t(overrides.length === 1 ? 'proj.appliedOverride' : 'proj.appliedOverrides', {
          count: overrides.length, name,
        }),
        'success',
      );
    }
    return newRoot;
  }

  /**
   * Create a prefab VARIANT from a prefab instance (Outliner "Create Variant" —
   * Unity's "Create Prefab Variant"): write a new `.esprefab` that inherits the
   * instance's prefab and bakes the instance's current overrides + added entities
   * as the variant's own authored state, then re-link the scene instance to the
   * new variant (so its edits now live in the variant, tracked against the base).
   * Works on any entity of the instance. Returns the re-linked root's source id.
   *
   * Removals aren't representable in a variant (it extends its base — see
   * {@link buildVariant}); if the instance deleted base entities, those drops are
   * reported and skipped. Structural/undo caveats match Apply/Revert (the written
   * asset persists; the re-link is two undo steps).
   */
  async createVariantFromInstance(sourceId: number): Promise<number | null> {
    const tag = SceneModel.prefabTag(sourceId);
    const instanceRoot = tag?.instanceRoot ?? sourceId;
    const ref = SceneModel.prefabTag(instanceRoot)?.prefab;
    if (!ref) return null;
    const info = this.assetInfo(ref);
    if (!info) return null;
    const base = await this.loadPrefabAsset(ref);
    if (!base) {
      Toasts.push(t('proj.prefabLoadFailed', { name: info.path.split('/').pop() ?? info.path }), 'error');
      return null;
    }

    // The instance's live subtree → its delta vs the current prefab (same shape
    // Apply uses). Metadata diffs aren't real overrides (not modelled per-instance).
    const processed: ProcessedEntity[] = [];
    for (const id of SceneModel.collectSubtree(instanceRoot)) {
      const e = SceneModel.entityBySource(id);
      const et = SceneModel.prefabTag(id);
      if (!e || !et) continue;
      processed.push({
        id,
        prefabEntityId: et.prefabId,
        name: e.name,
        parent: e.parent,
        children: e.children ?? [],
        components: e.components as ProcessedEntity['components'],
        visible: (e as { visible?: boolean }).visible ?? true,
      });
    }
    if (processed.length === 0) return null;

    const delta = collapseInstance(base, ref, processed, this.prefabResolverSync);
    const overrides = delta.overrides.filter((o) => o.type !== 'metadata_set' && o.type !== 'metadata_removed');
    if (delta.removed.length > 0) {
      Toasts.push(t('proj.variantNoRemove', { count: delta.removed.length }), 'warn');
    }

    // Write the variant beside its base, name derived from the base file.
    const baseLeaf = (info.path.split('/').pop() ?? base.name).replace(/\.esprefab$/i, '');
    const variantName = `${baseLeaf} Variant`;
    const dir = info.path.includes('/') ? info.path.slice(0, info.path.lastIndexOf('/')) : '';
    const variant = buildVariant(base, ref, variantName, { overrides, added: delta.added });
    let newPath: string;
    try {
      newPath = await window.estella.project.createAsset(dir, `${variantName}.esprefab`, JSON.stringify(variant, null, 2) + '\n', 'prefab');
    } catch (err) {
      Toasts.push(t('proj.prefabCreateFailed', { name: variantName }), 'error');
      return null;
    }
    await this.refreshAssets(); // register the new asset so instantiate can resolve it

    // Re-link the scene instance to the variant, preserving its placement (the
    // proven delete + re-instantiate path — the variant flattens to the same tree).
    const root = SceneModel.entityBySource(instanceRoot);
    const parent = root?.parent ?? null;
    const tf = root?.components.find((c) => c.type === 'Transform')?.data as { position?: { x: number; y: number } } | undefined;
    const position = tf?.position ? { x: tf.position.x, y: tf.position.y } : undefined;
    SceneCommands.deleteEntity(instanceRoot);
    const newRoot = await this.instantiatePrefabFromPath(newPath, parent, position);
    Toasts.push(t('proj.variantCreated', { name: variantName }), 'success');
    return newRoot;
  }

  /**
   * Spawn a Sprite entity from an image asset dropped into the viewport: resolve its
   * texture ref (preloading it so it renders), read the image's natural pixel size,
   * and add a Transform + Sprite at the drop point. Returns the source id, or null if
   * the path isn't a tracked texture. One undoable step; the new entity is selected.
   */
  async instantiateSpriteFromPath(path: string, position: { x: number; y: number }): Promise<number | null> {
    const ref = await this.assetRefForPath(path, 'texture');
    if (!ref) return null;
    const size = await this.imageNaturalSize(path);
    const name = (path.split('/').pop() ?? 'Sprite').replace(/\.[^.]+$/, '') || 'Sprite';
    const id = SceneCommands.create(spritePrefab(name, ref, size), { parent: null, position });
    if (id != null) useSelection.getState().select(id);
    return id;
  }

  /** Natural pixel size of a project image via the `estella://` transport; a sane
   *  fallback if it can't decode (so a dropped sprite is never zero-sized). */
  private imageNaturalSize(path: string): Promise<{ x: number; y: number }> {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ x: img.naturalWidth || 100, y: img.naturalHeight || 100 });
      img.onerror = () => resolve({ x: 100, y: 100 });
      img.src = `estella://project/${path}`;
    });
  }

  /**
   * Create a `.esprefab` asset from a live entity subtree (the "Create Prefab"
   * authoring path — the inverse of {@link instantiatePrefabFromPath}). Extracts
   * the subtree rooted at `rootSourceId` into PrefabData, writes the asset +
   * its `.meta` (a fresh uuid) under `assets/prefabs/`, and re-scans the asset
   * DB so the prefab is immediately draggable. Non-destructive: the source
   * entities are left as-is. Returns the new prefab's `@uuid:` ref, or null.
   */
  async createPrefabFromEntity(rootSourceId: number): Promise<string | null> {
    const root = SceneModel.entityBySource(rootSourceId);
    if (!root) return null;
    const entities = SceneModel.collectSubtree(rootSourceId)
      .map((id) => SceneModel.entityBySource(id))
      .filter((e): e is NonNullable<typeof e> => !!e) as unknown as ExtractEntity[];

    const name = root.name?.trim() || 'Prefab';

    // Refs into entities outside this selection can't live in a standalone prefab;
    // extractPrefab clears them. Warn before dropping the links.
    const external = collectExternalEntityRefs(entities);
    if (external.length > 0) {
      const ok = await confirm({
        title: t('proj.prefabExternalRefsTitle'),
        body: t('proj.prefabExternalRefsBody', { count: external.length }),
        confirmLabel: t('proj.prefabExternalRefsConfirm'),
      });
      if (!ok) return null;
    }

    const prefab = extractPrefab(entities, rootSourceId, name);

    // A filesystem-safe leaf, deduped against existing assets.
    const base = name.replace(/[^A-Za-z0-9_-]+/g, '_') || 'Prefab';
    let rel = `assets/prefabs/${base}.esprefab`;
    for (let n = 1; this.pathToUuid.has(rel); n++) rel = `assets/prefabs/${base}-${n}.esprefab`;

    const uuid = crypto.randomUUID();
    try {
      await window.estella.fs.write(rel, JSON.stringify(prefab, null, 2) + '\n');
      await window.estella.fs.write(
        rel + '.meta',
        JSON.stringify({ uuid, version: '2.0', type: 'prefab', importer: { autoMigrate: true } }, null, 2) + '\n',
      );
    } catch (err) {
      console.warn('[project] prefab write failed', rel, err);
      Toasts.push(t('proj.prefabCreateFailed', { name: base }), 'error');
      return null;
    }

    await this.buildAssetRegistry(); // re-scan so the new prefab is tracked + draggable
    Toasts.push(t('proj.prefabCreated', { name: rel.split('/').pop() ?? rel }), 'info');
    return UUID_PREFIX + uuid;
  }

  /**
   * Re-scan the asset DB into the uuid↔path registry. Call after a Content
   * Browser mutation (rename / delete / duplicate / import) so refs stay
   * resolvable and the inspector reflects the new paths.
   */
  async refreshAssets(): Promise<void> {
    await this.buildAssetRegistry();
  }

  /**
   * Re-save every project `.esprefab` in the current format — the bulk "Resave
   * All Prefabs" upgrade. Each prefab is run through `migratePrefabData` (which
   * upgrades legacy numeric ids AND a merely-stale version) and only rewritten
   * when it actually changed. Instances re-derive from the upgraded assets on
   * next load. Reports how many were upgraded.
   */
  async resaveAllPrefabs(): Promise<void> {
    const paths = [...this.pathToUuid.keys()].filter((p) => p.endsWith('.esprefab'));
    if (paths.length === 0) {
      Toasts.push(t('proj.resaveNone'), 'info');
      return;
    }
    let upgraded = 0;
    let failed = 0;
    for (const path of paths) {
      try {
        const { data, migrated } = migratePrefabData(JSON.parse(await window.estella.fs.read(path)));
        if (!migrated) continue;
        await window.estella.fs.write(path, JSON.stringify(data, null, 2) + '\n');
        upgraded++;
      } catch (err) {
        console.warn('[project] resave prefab failed', path, err);
        failed++;
      }
    }
    this.prefabCache.clear(); // rewritten assets must reload fresh
    if (failed > 0) Toasts.push(t('proj.resaveFailed', { upgraded, failed }), 'error');
    else Toasts.push(t('proj.resaveDone', { count: upgraded }), 'success');
  }

  /** A tracked asset's portable `@uuid:` ref for a project-relative path (Copy
   *  Reference), or null if the path isn't an indexed asset. */
  assetRef(path: string): string | null {
    const uuid = this.pathToUuid.get(path);
    return uuid ? UUID_PREFIX + uuid : null;
  }

  /**
   * Assemble the isolated play-realm payload: the
   * current scene as RAW (`@uuid:`) SceneData straight from the expanded model —
   * the runtime needs no prefab expansion and handles are realm-local, so we send
   * the lossless refs, not resolved handles — plus a uuid→url manifest the realm
   * fetches over `estella://`. Null if no scene is loaded.
   */
  /** The project's asset-delivery config, cached on open (see {@link loadAssetGroupsConfig}). */
  private assetGroupsConfig: AssetGroupsConfig | null = null;

  /** Cache `.esengine/asset-groups.json` so {@link buildPlayManifest} resolves
   *  groups synchronously. Absent → null, and resolveAssetGroup falls back to the
   *  legacy folder-name convention. */
  private async loadAssetGroupsConfig(): Promise<void> {
    try {
      this.assetGroupsConfig = JSON.parse(
        await window.estella.fs.read(`${WORKSPACE_DIR}/asset-groups.json`),
      ) as AssetGroupsConfig;
    } catch {
      this.assetGroupsConfig = null;
    }
  }

  /**
   * Build the AddressableManifest for Play so `Assets.loadGroup` (remote / lazy
   * groups) works in the editor realm exactly as in a shipped build. Group
   * membership comes from the SAME resolver the cook uses ({@link resolveAssetGroup}
   * over the cached asset-groups config), so editor and shipped build never
   * disagree. Types are inferred from the extension (the realm resolves each
   * asset's url through the same uuid/path channel); `size` is 0 (unknown before a
   * cook, and unused by loadGroup).
   */
  private buildPlayManifest(): AddressableManifest {
    const typeOfExt = (path: string): string => {
      const ext = path.slice(path.lastIndexOf('.')).toLowerCase();
      if (['.png', '.jpg', '.jpeg', '.webp', '.ktx2', '.bmp', '.gif'].includes(ext)) return 'texture';
      if (ext === '.esmaterial') return 'material';
      if (['.wav', '.mp3', '.ogg', '.m4a'].includes(ext)) return 'audio';
      if (ext === '.esprefab') return 'prefab';
      if (ext === '.esshader') return 'text';
      if (['.esscene', '.esanim', '.estilemap', '.estileset', '.estimeline', '.json', '.eslocale'].includes(ext)) return 'json';
      return 'binary';
    };
    type Asset = { path: string; type: string; size: number; labels: string[] };
    const groups: Record<string, { bundleMode: string; labels: string[]; assets: Record<string, Asset> }> = {};
    for (const [uuid, raw] of this.uuidToPath) {
      const path = raw.replace(/\\/g, '/');
      const { name, delivery } = resolveAssetGroup(path, this.assetGroupsConfig);
      const g = (groups[name] ??= { bundleMode: delivery, labels: [], assets: {} });
      g.assets[uuid.toLowerCase()] = { path, type: typeOfExt(path), size: 0, labels: [] };
    }
    groups.main ??= { bundleMode: 'local', labels: [], assets: {} };
    return { version: '2.0', groups } as unknown as AddressableManifest;
  }

  playPayload(): {
    sceneData: SceneData;
    assetManifest: Record<string, string>;
    manifest: AddressableManifest;
    entrySceneName?: string;
    extraScenes?: Array<{ name: string; path: string }>;
    physicsEnabled?: boolean;
    physicsConfig?: PhysicsPluginConfig;
    audioConfig?: AudioProjectConfig;
    uiTheme?: 'light';
    uiThemeOverrides?: ThemeOverrides;
    ySortLayers?: number;
    colorSpace?: 'gamma' | 'linear';
    screenFit?: { designWidth: number; designHeight: number; scaleMode: number; matchWidthOrHeight: number };
  } | null {
    const sceneData = SceneModel.serialize();
    if (!sceneData) return null;
    // The realm runs from the project's estella:// origin, so assets are
    // same-origin estella:// — no cross-scheme dance needed.
    const assetManifest: Record<string, string> = {};
    for (const [uuid, path] of this.uuidToPath) assetManifest[uuid] = `estella://project/${path}`;
    // Play == ship: register every other project scene under its export name
    // (scenes-dir-relative path sans extension — the same rule exportGame's
    // discoverProjectScenes uses), so SceneManager.switchTo('levels/boss')
    // behaves in Play exactly as in a shipped build. The open scene's live
    // snapshot is the entry and takes its export name too.
    const st = this.state;
    const scenesDir = (st?.layout.scenes ?? 'assets/scenes').replace(/\\/g, '/');
    const exportSceneName = (p: string): string => {
      const rel = p.startsWith(`${scenesDir}/`) ? p.slice(scenesDir.length + 1) : p;
      return rel.replace(/\.esscene$/i, '');
    };
    const currentScene = st?.currentScene?.replace(/\\/g, '/') ?? null;
    const extraScenes: Array<{ name: string; path: string }> = [];
    for (const p of this.uuidToPath.values()) {
      const q = p.replace(/\\/g, '/');
      if (!/\.esscene$/i.test(q) || q === currentScene) continue;
      extraScenes.push({ name: exportSceneName(q), path: q });
    }
    // Carry the project's physics world config so the realm installs physics (even for
    // runtime-spawned bodies the static scene doesn't show) and matches the editor's
    // Project Settings. The collision matrix is sent ONLY when configured — otherwise
    // a layer's mask would override each collider's own maskBits (the two are exclusive).
    const f = this.physicsFeature();
    const physicsConfig: PhysicsPluginConfig = {
      gravity: f.gravity,
      fixedTimestep: f.fixedTimestep,
      subStepCount: f.subStepCount,
      contactHertz: f.contactHertz,
      contactDampingRatio: f.contactDampingRatio,
      contactSpeed: f.contactSpeed,
      enableSleep: f.enableSleep,
      enableContinuous: f.enableContinuous,
    };
    // Send the collision matrix ONLY when it actually restricts a pair — an all-collide
    // matrix would otherwise override each single-layer collider's own maskBits for nothing.
    if (f.collisionLayerMasks.some((m) => (m & 0xffff) !== 0xffff)) {
      physicsConfig.collisionLayerMasks = f.collisionLayerMasks;
    }
    const ySortLayers = this.ySortMask();
    const audioConfig = this.audioFeature();
    const colorSpace = this.renderingFeature().colorSpace;
    // Camera fit: only sent when the project opts in (scaleMode ≥ 0), so a played
    // scene with no fit boots exactly as before.
    const screenFit = this.screenFit();
    const uiTheme = this.uiTheme();
    const uiThemeOverrides = this.uiThemeOverrides();
    return {
      sceneData, assetManifest, manifest: this.buildPlayManifest(), physicsEnabled: f.enabled, physicsConfig,
      ...(currentScene ? { entrySceneName: exportSceneName(currentScene) } : {}),
      ...(extraScenes.length > 0 ? { extraScenes } : {}),
      ...(audioConfig.buses ? { audioConfig } : {}),
      ...(uiTheme === 'light' ? { uiTheme } : {}),
      ...(uiThemeOverrides ? { uiThemeOverrides } : {}),
      ...(ySortLayers !== 0 ? { ySortLayers } : {}),
      ...(colorSpace === 'linear' ? { colorSpace } : {}),
      ...(screenFit.scaleMode >= 0 ? { screenFit } : {}),
    };
  }

  /** The project's declared mixer state (Project Settings → Audio / the Mixer). */
  audioFeature(): AudioProjectConfig {
    return this.state?.features?.audio ?? {};
  }

  /** The project's built-in widget theme (Project Settings → UI). */
  uiTheme(): 'dark' | 'light' {
    return this.state?.features?.ui?.theme === 'light' ? 'light' : 'dark';
  }

  /** The project's theme color overrides (role → #rrggbbaa hex), possibly empty. */
  uiThemeColors(): Record<string, string> {
    return this.state?.features?.ui?.colors ?? {};
  }

  /** The color overrides as SDK {@link ThemeOverrides} (hex → 0..1 Color), or
   *  undefined when the project overrides nothing — the payload/boot shape. */
  uiThemeOverrides(): ThemeOverrides | undefined {
    return parseThemeOverrides(this.uiThemeColors());
  }

  /** Persist the widget theme; dark (the default) is expressed by absence.
   *  Color overrides survive a base-theme switch (they re-skin either base). */
  async setUiTheme(theme: 'dark' | 'light'): Promise<void> {
    await this.patchUiFeature_({ theme: theme === 'light' ? 'light' : undefined });
  }

  /** Set or clear one theme color override (`#rrggbbaa`; null clears the role). */
  async setUiThemeColor(role: string, hex: string | null): Promise<void> {
    const colors = { ...this.uiThemeColors() };
    if (hex) colors[role] = hex.toLowerCase();
    else delete colors[role];
    await this.patchUiFeature_({ colors: Object.keys(colors).length > 0 ? colors : undefined });
  }

  /** Merge a patch into `features.ui` and persist — a key set to undefined is
   *  removed, and an empty `ui` disappears entirely (dark + no overrides). */
  private async patchUiFeature_(patch: { theme?: 'light'; colors?: Record<string, string> }): Promise<void> {
    const st = this.state;
    if (!st) return;
    const cur: { theme?: 'light'; colors?: Record<string, string> } = { ...(st.features?.ui ?? {}) };
    if ('theme' in patch) {
      if (patch.theme) cur.theme = patch.theme;
      else delete cur.theme;
    }
    if ('colors' in patch) {
      if (patch.colors) cur.colors = patch.colors;
      else delete cur.colors;
    }
    const ui = Object.keys(cur).length > 0 ? cur : undefined;
    const features: ProjectFeatures = { ...st.features };
    if (ui) features.ui = ui;
    else delete features.ui;
    this.store.setState({ project: { ...st, features } });
    applyWidgetTheme(this.uiTheme(), this.uiThemeOverrides());
    try {
      const raw = JSON.parse(await window.estella.fs.read(PROJECT_MANIFEST_FILE)) as Record<string, unknown>;
      const rf = { ...(raw.features as Record<string, unknown> ?? {}) };
      if (ui) rf.ui = ui;
      else delete rf.ui;
      raw.features = rf;
      await window.estella.fs.write(PROJECT_MANIFEST_FILE, JSON.stringify(raw, null, 2) + '\n');
    } catch (e) {
      Toasts.push(t('proj.saveUiThemeFailed'), 'error');
      console.error('[project] patchUiFeature write failed', e);
    }
  }

  /**
   * Replace the project mixer state and persist to `project.esproject`. Rewrites
   * the RAW manifest JSON so unmodeled fields survive; in-memory state first so
   * the Mixer reflects immediately.
   */
  async setAudio(config: AudioProjectConfig): Promise<void> {
    const st = this.state;
    if (!st) return;
    const features: ProjectFeatures = { ...st.features, audio: config };
    this.store.setState({ project: { ...st, features } });
    try {
      const raw = JSON.parse(await window.estella.fs.read(PROJECT_MANIFEST_FILE)) as Record<string, unknown>;
      raw.features = { ...(raw.features as Record<string, unknown> ?? {}), audio: config };
      await window.estella.fs.write(PROJECT_MANIFEST_FILE, JSON.stringify(raw, null, 2) + '\n');
    } catch (e) {
      Toasts.push(t('proj.saveAudioFailed'), 'error');
      console.error('[project] setAudio write failed', e);
    }
  }

  /** The project's declared physics feature, with defaults (for Project Settings). The
   *  solver defaults mirror the runtime fallbacks so the UI shows the effective values. */
  physicsFeature(): {
    enabled: boolean; gravity: { x: number; y: number }; collisionLayers: string[];
    collisionLayerMasks: number[];
    fixedTimestep: number; subStepCount: number; contactHertz: number;
    contactDampingRatio: number; contactSpeed: number;
    enableSleep: boolean; enableContinuous: boolean;
  } {
    const p = this.state?.features?.physics;
    return {
      enabled: p?.enabled ?? false,
      gravity: p?.gravity ?? { x: 0, y: -9.81 },
      collisionLayers: normalizeLayers(p?.collisionLayers),
      collisionLayerMasks: normalizeLayerMasks(p?.collisionLayerMasks),
      fixedTimestep: p?.fixedTimestep ?? 1 / 60,
      subStepCount: p?.subStepCount ?? 4,
      contactHertz: p?.contactHertz ?? 120,
      contactDampingRatio: p?.contactDampingRatio ?? 10,
      contactSpeed: p?.contactSpeed ?? 10,
      enableSleep: p?.enableSleep ?? true,
      enableContinuous: p?.enableContinuous ?? true,
    };
  }

  /** Collision-layer bit options for the inspector's mask controls (name, else `Layer N`). */
  collisionLayerOptions(): Array<{ label: string; value: number }> {
    const names = this.physicsFeature().collisionLayers;
    return names.map((name, i) => ({ label: name || `Layer ${i}`, value: 1 << i }));
  }

  /** Named render sorting layers (z-order = slot index). Default empty list. */
  renderingFeature(): { sortingLayers: string[]; ySortLayers: number[]; colorSpace: 'gamma' | 'linear'; cameraScaleMode: CameraScaleMode; cameraMatch: number } {
    const r = this.state?.features?.rendering;
    return {
      sortingLayers: Array.from({ length: 8 }, (_, i) => r?.sortingLayers?.[i] ?? ''),
      ySortLayers: r?.ySortLayers ?? [],
      colorSpace: r?.colorSpace === 'linear' ? 'linear' : 'gamma',
      cameraScaleMode: r?.cameraScaleMode ?? 'none',
      cameraMatch: r?.cameraMatch ?? 0.5,
    };
  }

  /** The runtime screen-fit (createWebApp `screenFit` / ScreenScaling): the project
   *  design resolution + the mapped camera fit. `scaleMode` -1 ⇒ off (raw orthoSize). */
  screenFit(): { designWidth: number; designHeight: number; scaleMode: number; matchWidthOrHeight: number } {
    const d = this.designResolution();
    const r = this.renderingFeature();
    return {
      designWidth: d.width,
      designHeight: d.height,
      scaleMode: cameraScaleModeValue(r.cameraScaleMode),
      matchWidthOrHeight: r.cameraMatch,
    };
  }

  /** Bitmask over layers 0..31 that y-sort within the layer (0 = feature off). */
  ySortMask(): number {
    let mask = 0;
    for (const i of this.renderingFeature().ySortLayers) mask |= 1 << i;
    return mask >>> 0;
  }

  /** Sorting-layer dropdown options for render `layer` fields — only the NAMED
   *  slots (value = slot index = z-order); empty ⇒ the field stays a free number. */
  sortingLayerOptions(): Array<{ label: string; value: number }> {
    return this.renderingFeature()
      .sortingLayers.map((name, i) => ({ label: name.trim(), value: i }))
      .filter((o) => o.label !== '');
  }

  /** Set rendering-feature config (sorting layers, y-sort, color space) and persist
   *  to the manifest. Sorting/y-sort live-apply; colorSpace is boot-fixed (shaders
   *  compile against it) — the settings page prompts for a reload, like the backend. */
  async setRendering(patch: { sortingLayers?: string[]; ySortLayers?: number[]; colorSpace?: 'gamma' | 'linear'; cameraScaleMode?: CameraScaleMode; cameraMatch?: number }): Promise<void> {
    const st = this.state;
    if (!st) return;
    const rendering: NonNullable<ProjectFeatures['rendering']> = { ...st.features?.rendering };
    if (patch.sortingLayers) rendering.sortingLayers = patch.sortingLayers;
    if (patch.ySortLayers) rendering.ySortLayers = patch.ySortLayers;
    // 'gamma' is the default — expressed by ABSENCE so untouched manifests stay untouched.
    if (patch.colorSpace === 'linear') rendering.colorSpace = 'linear';
    else if (patch.colorSpace === 'gamma') delete rendering.colorSpace;
    // 'none' (off) is the default — expressed by ABSENCE, like colorSpace 'gamma'.
    if (patch.cameraScaleMode === 'none') delete rendering.cameraScaleMode;
    else if (patch.cameraScaleMode !== undefined) rendering.cameraScaleMode = patch.cameraScaleMode;
    if (patch.cameraMatch !== undefined) rendering.cameraMatch = patch.cameraMatch;
    const features: ProjectFeatures = { ...st.features, rendering };
    this.store.setState({ project: { ...st, features } });
    Renderer.setYSortLayers(this.ySortMask());
    try {
      const raw = JSON.parse(await window.estella.fs.read(PROJECT_MANIFEST_FILE)) as Record<string, unknown>;
      raw.features = { ...((raw.features as Record<string, unknown>) ?? {}), rendering };
      await window.estella.fs.write(PROJECT_MANIFEST_FILE, JSON.stringify(raw, null, 2) + '\n');
    } catch (e) {
      Toasts.push(t('proj.saveSortingLayersFailed'), 'error');
      console.error('[project] setRendering write failed', e);
    }
  }

  /** Project reference resolution — the seed for new Canvas entities. Falls back to
   *  the engine's own Canvas default (1920×1080), not the old create-preset hardcode. */
  designResolution(): DesignResolution {
    return this.state?.designResolution ?? { width: 1920, height: 1080 };
  }

  /** Set the project reference resolution and persist to the manifest root. Mirrors
   *  {@link setRendering}; the value only seeds newly created Canvases. */
  async setDisplay(patch: Partial<DesignResolution>): Promise<void> {
    const st = this.state;
    if (!st) return;
    const designResolution: DesignResolution = { ...this.designResolution(), ...patch };
    this.store.setState({ project: { ...st, designResolution } });
    try {
      const raw = JSON.parse(await window.estella.fs.read(PROJECT_MANIFEST_FILE)) as Record<string, unknown>;
      raw.designResolution = designResolution;
      await window.estella.fs.write(PROJECT_MANIFEST_FILE, JSON.stringify(raw, null, 2) + '\n');
    } catch (e) {
      Toasts.push(t('proj.saveDesignResolutionFailed'), 'error');
      console.error('[project] setDisplay write failed', e);
    }
  }

  /** Persisted Package Project settings (last target/config/output), or {}. */
  packagingSettings(): ProjectPackaging {
    return this.state?.packaging ?? {};
  }

  /** Persist Package Project settings to `project.esproject`, merging per-platform
   *  outDir so each target keeps its own. Mirrors {@link setRendering}. */
  async setPackaging(patch: ProjectPackaging): Promise<void> {
    const st = this.state;
    if (!st) return;
    const packaging: ProjectPackaging = {
      ...st.packaging,
      ...patch,
      outDir: { ...st.packaging?.outDir, ...patch.outDir },
    };
    this.store.setState({ project: { ...st, packaging } });
    try {
      const raw = JSON.parse(await window.estella.fs.read(PROJECT_MANIFEST_FILE)) as Record<string, unknown>;
      raw.packaging = packaging;
      await window.estella.fs.write(PROJECT_MANIFEST_FILE, JSON.stringify(raw, null, 2) + '\n');
    } catch (e) {
      Toasts.push(t('proj.savePackagingFailed'), 'error');
      console.error('[project] setPackaging write failed', e);
    }
  }

  /** The project's effective screen orientation — the explicit packaging setting, else
   *  derived from the design resolution's aspect. Drives the export targets and the
   *  editor's device preview; the segmented control reflects this resolved value. */
  resolvedOrientation(): ScreenOrientation {
    return this.state?.packaging?.orientation ?? orientationFromDesignResolution(this.designResolution());
  }

  /** Per-platform packaging config (appid / app id), or {}. */
  platformPackaging(): NonNullable<ProjectPackaging['platforms']> {
    return this.state?.packaging?.platforms ?? {};
  }

  /** Persist one platform's packaging config (merged) to `project.esproject`. */
  async setPlatformPackaging<K extends keyof NonNullable<ProjectPackaging['platforms']>>(
    platform: K,
    patch: Partial<NonNullable<NonNullable<ProjectPackaging['platforms']>[K]>>,
  ): Promise<void> {
    const st = this.state;
    if (!st) return;
    const prev = st.packaging?.platforms ?? {};
    const platforms = { ...prev, [platform]: { ...prev[platform], ...patch } } as NonNullable<ProjectPackaging['platforms']>;
    const packaging: ProjectPackaging = { ...st.packaging, platforms };
    this.store.setState({ project: { ...st, packaging } });
    try {
      const raw = JSON.parse(await window.estella.fs.read(PROJECT_MANIFEST_FILE)) as Record<string, unknown>;
      raw.packaging = packaging;
      await window.estella.fs.write(PROJECT_MANIFEST_FILE, JSON.stringify(raw, null, 2) + '\n');
    } catch (e) {
      Toasts.push(t('proj.savePlatformFailed'), 'error');
      console.error('[project] setPlatformPackaging write failed', e);
    }
  }

  /**
   * Enable/configure the project's physics feature and persist to
   * `project.esproject` (so the play realm installs physics even for
   * runtime-spawned bodies). Rewrites the RAW manifest JSON so fields the editor
   * parser doesn't model survive; in-memory state updates first so the toggle
   * reflects immediately.
   */
  async setPhysics(patch: Partial<NonNullable<ProjectFeatures['physics']>>): Promise<void> {
    const st = this.state;
    if (!st) return;
    const physics: NonNullable<ProjectFeatures['physics']> = { ...st.features?.physics, ...patch };
    const features: ProjectFeatures = { ...st.features, physics };
    this.store.setState({ project: { ...st, features } });
    try {
      const raw = JSON.parse(await window.estella.fs.read(PROJECT_MANIFEST_FILE)) as Record<string, unknown>;
      raw.features = { ...(raw.features as Record<string, unknown> ?? {}), physics };
      await window.estella.fs.write(PROJECT_MANIFEST_FILE, JSON.stringify(raw, null, 2) + '\n');
    } catch (e) {
      Toasts.push(t('proj.savePhysicsFailed'), 'error');
      console.error('[project] setPhysics write failed', e);
    }
  }

  /**
   * Set the project's startup scene (`defaultScene`) and persist to
   * `project.esproject` — the scene the editor opens, Play boots, and every
   * export ships as the first scene. Rewrites the RAW manifest JSON so fields
   * the editor parser doesn't model survive; in-memory state updates first.
   */
  async setDefaultScene(path: string): Promise<void> {
    const st = this.state;
    if (!st || st.defaultScene === path) return;
    // The startup scene always ships — becoming it lifts any export exclusion.
    const packaging = this.packagingWithoutExclusion_(st.packaging, path);
    this.store.setState({ project: { ...st, defaultScene: path, packaging } });
    try {
      const raw = JSON.parse(await window.estella.fs.read(PROJECT_MANIFEST_FILE)) as Record<string, unknown>;
      raw.defaultScene = path;
      if (packaging !== st.packaging) {
        // Merge into the RAW packaging so fields the editor parser doesn't
        // model survive the rewrite.
        const rawPkg = { ...((raw.packaging as Record<string, unknown>) ?? {}) };
        if (packaging?.excludeScenes) rawPkg.excludeScenes = packaging.excludeScenes;
        else delete rawPkg.excludeScenes;
        raw.packaging = rawPkg;
      }
      await window.estella.fs.write(PROJECT_MANIFEST_FILE, JSON.stringify(raw, null, 2) + '\n');
      Toasts.push(t('proj.startupScene', { name: path.split('/').pop() ?? path }), 'info');
    } catch (e) {
      Toasts.push(t('proj.saveStartupSceneFailed'), 'error');
      console.error('[project] setDefaultScene write failed', e);
    }
  }

  /** `packaging` with `path` lifted from excludeScenes (identity when absent). */
  private packagingWithoutExclusion_(packaging: ProjectPackaging | undefined, path: string): ProjectPackaging | undefined {
    if (!packaging?.excludeScenes?.includes(path)) return packaging;
    const excludeScenes = packaging.excludeScenes.filter((p) => p !== path);
    const next: ProjectPackaging = { ...packaging };
    if (excludeScenes.length > 0) next.excludeScenes = excludeScenes;
    else delete next.excludeScenes;
    return next;
  }

  /**
   * Exclude a scene from (or re-include it in) every export — persisted as
   * `packaging.excludeScenes`. Dev/test scenes stay editable and playable in
   * the editor; they just don't ship as switchable scenes.
   */
  async setSceneExcluded(path: string, excluded: boolean): Promise<void> {
    const st = this.state;
    if (!st) return;
    const cur = new Set(st.packaging?.excludeScenes ?? []);
    if (excluded) cur.add(path);
    else cur.delete(path);
    const packaging: ProjectPackaging = { ...st.packaging };
    if (cur.size > 0) packaging.excludeScenes = [...cur].sort();
    else delete packaging.excludeScenes;
    this.store.setState({ project: { ...st, packaging } });
    try {
      const raw = JSON.parse(await window.estella.fs.read(PROJECT_MANIFEST_FILE)) as Record<string, unknown>;
      // Merge into the RAW packaging so fields the editor parser doesn't model
      // survive the rewrite.
      const rawPkg = { ...((raw.packaging as Record<string, unknown>) ?? {}) };
      if (packaging.excludeScenes) rawPkg.excludeScenes = packaging.excludeScenes;
      else delete rawPkg.excludeScenes;
      raw.packaging = rawPkg;
      await window.estella.fs.write(PROJECT_MANIFEST_FILE, JSON.stringify(raw, null, 2) + '\n');
      const leaf = path.split('/').pop() ?? path;
      Toasts.push(t(excluded ? 'proj.excludedFromExport' : 'proj.includedInExport', { name: leaf }), 'info');
    } catch (e) {
      Toasts.push(t('proj.saveExclusionFailed'), 'error');
      console.error('[project] setSceneExcluded write failed', e);
    }
  }

  /** Display info for an asset ref (`@uuid:` or a project-relative path — the same
   *  forms the loaders accept), or null (none / unresolved). For the inspector's
   *  asset control: the project-relative path + a leaf name. */
  assetInfo(ref: unknown): { path: string; name: string } | null {
    if (typeof ref !== 'string' || ref.length === 0) return null;
    const path = ref.startsWith(UUID_PREFIX)
      ? this.uuidToPath.get(ref.slice(UUID_PREFIX.length).toLowerCase())
      : this.assetRef(ref)
        ? ref
        : undefined;
    return path ? { path, name: path.split('/').pop() ?? path } : null;
  }

  /** Project assets valid for an asset slot (the inspector's asset picker), by name. */
  listAssets(fieldType?: string): AssetEntry[] {
    const out: AssetEntry[] = [];
    for (const [uuid, path] of this.uuidToPath) {
      const name = path.split('/').pop() ?? path;
      const type = assetTypeOf(name);
      if (!assetMatchesSlot(type, path, fieldType)) continue;
      out.push({ ref: UUID_PREFIX + uuid, path, name, type });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Whether the asset at `path` is a valid pick for a `fieldType` slot — the same rule
   *  the picker popover filters by, exposed so drag-drop can reject a wrong-typed asset. */
  assetTypeAllowed(fieldType: string | undefined, path: string): boolean {
    if (!fieldType) return true;
    const name = path.split('/').pop() ?? path;
    return assetMatchesSlot(assetTypeOf(name), path, fieldType);
  }

  /**
   * Turn a Content-Browser drag (a project-relative path) into a portable
   * `@uuid:` ref, preloading the asset so the Reconciler's synchronous projection
   * finds its handle when the model field is set. Textures resolve live; other
   * types are best-effort (resolved at scene load). Returns null if the path
   * isn't a tracked asset.
   */
  async assetRefForPath(path: string, assetType?: string): Promise<string | null> {
    const uuid = this.pathToUuid.get(path);
    if (!uuid) return null;
    const ref = UUID_PREFIX + uuid;
    // Spine slots are path-valued: nothing to preload here — the spine binding
    // (skeleton + atlas + pages) loads as a pair when the component syncs.
    if (assetType === 'spine-skeleton' || assetType === 'spine-atlas') return ref;
    const assets = EngineHost.getResource(Assets);
    if (assets) {
      try {
        if (assetType === 'material') await assets.loadMaterial(ref);
        else if (assetType === 'font') await assets.loadFont(ref);
        else await assets.loadTexture(ref);
      } catch {
        // non-loadable for this slot — the field still stores the ref losslessly
      }
    }
    return ref;
  }

  /**
   * Serialize the editor's source-of-truth model — lossless (JSON-first) +
   * prefab-aware: collapse each expanded prefab-instance subtree back to a single
   * `{prefab, overrides, added, removed}` delta entry. The
   * model retains everything the World drops (unknown components/fields, invisible
   * entities, `@uuid:` asset refs), so this reads only the model.
   */
  private async serializeCurrent(): Promise<SceneData> {
    const model = SceneModel.serialize();
    if (!model) throw new Error('no scene loaded');
    const entities = await collapseScenePrefabs(
      model.entities,
      (id) => SceneModel.prefabTag(id),
      (ref) => this.loadPrefabAsset(ref),
    );
    return { ...model, name: this.state?.name ?? model.name, entities };
  }

  /**
   * The open scene as a crash-recovery snapshot: its real target path + the exact
   * bytes {@link save} would write, WITHOUT persisting or marking saved. Null for
   * an untitled scene (no `currentScene` path to recover into).
   */
  async snapshotScene(): Promise<DocSnapshot | null> {
    // Prefab Mode holds a prefab tree, not a scene (currentScene is null) — snapshot
    // the prefab to its own path so a crash mid-edit is recoverable, not silently lost.
    if (this.prefabSession) {
      const built = this.buildSessionPrefab(this.prefabSession);
      if (!built) return null;
      return { path: this.prefabSession.path, contents: JSON.stringify(built.prefab, null, 2) + '\n' };
    }
    const st = this.state;
    if (!st?.currentScene) return null;
    return { path: st.currentScene, contents: JSON.stringify(await this.serializeCurrent(), null, 2) + '\n' };
  }

  private async writeScene(relPath: string, data: SceneData): Promise<void> {
    const body = JSON.stringify(data, null, 2) + '\n';
    await window.estella.fs.write(relPath, body);
    this.knownSceneText = body;
    this.knownScenePath = relPath;
  }

  /**
   * Open a different scene file as the editor document (Content Browser
   * double-click). Persists it as the last-opened scene and reloads the world
   * (which clears history + selection — the caller guards unsaved changes).
   * `quiet` suppresses the "Opened" toast so a caller that owns its own feedback
   * (exitPrefabMode's "Returned to …") isn't double-noted.
   */
  async openScene(relPath: string, opts?: { quiet?: boolean }): Promise<void> {
    if (!this.state) return;
    await this.persistLastScene(relPath);
    await this.loadCurrentScene();
    if (!opts?.quiet) Toasts.push(t('proj.openedScene', { name: relPath.split('/').pop() ?? relPath }), 'info', 1600);
  }

  /**
   * Open a `.esprefab` in PREFAB MODE — edit the prefab's own entity tree in the
   * same outliner / inspector / viewport used for scenes. The asset is flattened
   * into ordinary entities (each remembered by its prefabEntityId so save-back
   * preserves identity), the current scene is swapped out, and a banner offers
   * "Back to Scene". A FLAT prefab extracts back to a flat asset on save; a
   * VARIANT of a flat base is editable too (save collapses the edits against the
   * base into a variant delta, preserving basePrefab). Nested prefabs — and
   * variants of a nested / variant base — are still refused (re-nesting on save
   * is unsolved). The caller guards unsaved changes.
   */
  async openPrefab(path: string): Promise<void> {
    const st = this.state;
    if (!st) return;
    const leaf = path.split('/').pop() ?? path;
    if (!(await confirmDiscard(t('discard.openPrefab', { name: leaf })))) return;
    const uuid = this.pathToUuid.get(path);
    const ref = uuid ? UUID_PREFIX + uuid : null;
    const prefab = ref ? await this.loadPrefabAsset(ref) : null;
    if (!ref || !prefab) {
      Toasts.push(t('proj.prefabLoadFailed', { name: leaf }), 'error');
      return;
    }
    // Nested prefabs can't be edited in place (re-nesting on save is unsolved).
    if (prefab.entities.some((e) => e.nestedPrefab)) {
      Toasts.push(t('proj.prefabModeNested'), 'warn');
      return;
    }
    // A VARIANT is editable when its base is FLAT (so save can collapse against a
    // simple baseline). A variant-of-variant / variant-of-nested base is refused.
    let base: PrefabData | null = null;
    if (prefab.basePrefab) {
      base = await this.loadPrefabAsset(prefab.basePrefab);
      if (!base || base.basePrefab || base.entities.some((e) => e.nestedPrefab)) {
        Toasts.push(t('proj.prefabModeNested'), 'warn');
        return;
      }
    }

    // The scene to return to + the view to restore on exit. Opening a prefab
    // from WITHIN Prefab Mode keeps the ORIGINAL home scene/view (an existing
    // session's — its currentScene is null), so "Back" always lands in the scene.
    const returnScene = this.prefabSession?.returnScene ?? st.currentScene;
    const returnView = this.prefabSession?.returnView ?? EngineHost.editorViewState();
    // The instance we entered from — captured before adopt clears selection, so
    // "Back to Scene" re-selects it (Unity/Godot behaviour).
    const returnSelection = this.prefabSession?.returnSelection ?? useSelection.getState().selectedId ?? null;

    // Flatten the asset into ordinary entities; remember each entity's stable id.
    // A variant resolves its base through the warm-cache resolver (loadPrefabAsset
    // above warmed it), yielding base entities + the variant's own overrides/adds.
    let nid = 0;
    const { entities, rootId } = flattenPrefab(prefab, [], { allocateId: () => nid++, loadPrefab: this.prefabResolverSync });
    const idBySource = new Map(entities.map((e) => [e.id, e.prefabEntityId]));
    const sceneData = {
      version: '1.0',
      name: prefab.name,
      entities: entities.map((e) => ({
        id: e.id, name: e.name, parent: e.parent, children: e.children,
        components: e.components, visible: e.visible,
      })),
    } as unknown as SceneData;

    await this.adoptDocument(sceneData);
    // A prefab carries no camera, so syncEditorViewToScene left the scene's view —
    // the prefab could sit off-screen if the user had panned away. Frame its
    // content so it's centered and readable on enter (matches Godot/Unity).
    // Deferred two frames: frameSelection reads composed WORLD transforms, which
    // read (0,0) until the first engine tick — so a variant whose root carries a
    // position override would otherwise frame at the origin and sit off-screen.
    const frameContent = (): void => {
      const world = EngineHost.world;
      if (world) ViewportController.frameSelection([...world.getAllEntities()]);
    };
    requestAnimationFrame(() => requestAnimationFrame(frameContent));
    const returnLeaf = returnScene ? (returnScene.split('/').pop() ?? returnScene) : null;
    const baseRef = prefab.basePrefab ?? null;
    this.prefabSession = { ref, path, name: prefab.name, rootSource: rootId, idBySource, returnScene, returnView, returnSelection, base, baseRef };
    this.store.setState({ project: { ...st, currentScene: null, prefabEdit: { name: prefab.name, path, returnScene: returnLeaf, isVariant: !!baseRef } } });
    Toasts.push(t('proj.openedPrefab', { name: prefab.name }), 'info', 1600);
  }

  /**
   * Adopt an in-memory SceneData into the editor (preload assets → build the World
   * → adopt as the model), mirroring {@link loadCurrentScene}'s tail. No file read
   * or prefab-tag handling — the caller owns those. Used by Prefab Mode.
   */
  private async adoptDocument(raw: SceneData): Promise<void> {
    const assets = EngineHost.getResource(Assets);
    let resolved: SceneData = raw;
    if (assets) {
      const result = await assets.preloadSceneAssets(raw);
      resolved = JSON.parse(JSON.stringify(raw)) as SceneData;
      assets.resolveSceneAssetPaths(resolved, result);
      this.lastAssetResult = result;
    }
    EditorHistory.clearScene();
    useSelection.getState().select(null);
    usePrefabConflicts.getState().clear(); // a prefab document has no scene instances
    Reconciler.setAssetResolver((ref) => this.handleForRef(ref));
    Reconciler.setRefPathResolver((ref) => this.resolveRef(ref));
    Reconciler.setAssetTouchListener((ref, slot) => this.hotLoadAsset(ref, slot));
    installSpineSync(this.spineTransport());
    Reconciler.adopt(raw, resolved);
    EngineHost.syncEditorViewToScene();
    applyWidgetTheme(this.uiTheme(), this.uiThemeOverrides());
  }

  /**
   * Save the prefab being edited in Prefab Mode back to its `.esprefab`, PRESERVING
   * each entity's prefabEntityId (so existing instances' overrides still resolve)
   * and minting uuids only for entities added during the session. A VARIANT session
   * instead collapses the edited tree against its base into a variant delta
   * (keeping basePrefab), so editing a variant stays base-tracked.
   */
  /** Serialize the live Prefab-Mode tree to a {@link PrefabData} without touching
   *  UI or store state — shared by {@link savePrefab} and the crash snapshot.
   *  `removedCount` is the number of base entities a variant edit dropped (a
   *  variant cannot delete a base entity), for the caller to surface. */
  private buildSessionPrefab(
    pe: NonNullable<typeof this.prefabSession>,
  ): { prefab: PrefabData; idBySource: Map<number, string>; removedCount: number } | null {
    const model = SceneModel.serialize();
    if (!model) return null;
    const idBySource = new Map(pe.idBySource);
    for (const e of model.entities) if (!idBySource.has(e.id)) idBySource.set(e.id, crypto.randomUUID());

    if (pe.base && pe.baseRef) {
      // VARIANT: diff the edited tree against the flat base → the variant's own
      // overrides + additions, then rebuild the variant (basePrefab preserved).
      const processed: ProcessedEntity[] = model.entities.map((e) => ({
        id: e.id,
        prefabEntityId: idBySource.get(e.id) ?? crypto.randomUUID(),
        name: e.name,
        parent: e.parent,
        children: e.children ?? [],
        components: e.components as ProcessedEntity['components'],
        visible: (e as { visible?: boolean }).visible ?? true,
      }));
      const delta = collapseInstance(pe.base, pe.baseRef, processed, this.prefabResolverSync);
      const overrides = delta.overrides.filter((o) => o.type !== 'metadata_set' && o.type !== 'metadata_removed');
      const prefab = buildVariant(pe.base, pe.baseRef, pe.name, { overrides, added: delta.added });
      return { prefab, idBySource, removedCount: delta.removed.length };
    }
    const prefab = extractPrefab(
      model.entities as unknown as ExtractEntity[],
      pe.rootSource,
      pe.name,
      (srcId) => idBySource.get(srcId) ?? crypto.randomUUID(),
    );
    return { prefab, idBySource, removedCount: 0 };
  }

  async savePrefab(): Promise<void> {
    const pe = this.prefabSession;
    if (!pe) return;
    const built = this.buildSessionPrefab(pe);
    if (!built) return;
    const { prefab, idBySource, removedCount } = built;
    if (removedCount > 0) Toasts.push(t('proj.variantNoRemove', { count: removedCount }), 'warn');
    try {
      await window.estella.fs.write(pe.path, JSON.stringify(prefab, null, 2) + '\n');
    } catch {
      Toasts.push(t('proj.applyWriteFailed', { name: pe.path.split('/').pop() ?? pe.path }), 'error');
      return;
    }
    this.prefabCache.set(pe.ref, prefab);
    this.prefabSession = { ...pe, idBySource };
    EditorHistory.markSaved();
    Toasts.push(t('proj.savedPrefab', { name: pe.name }), 'success');
  }

  /** Leave Prefab Mode and return to the scene that was open (or a blank one),
   *  restoring the editor view the user left it at. */
  async exitPrefabMode(): Promise<void> {
    if (!this.prefabSession) return;
    if (!(await confirmDiscard(t('discard.exitPrefab')))) return;
    const { returnScene: back, returnView, returnSelection } = this.prefabSession;
    this.prefabSession = null;
    const st = this.state;
    if (st) this.store.setState({ project: { ...st, prefabEdit: null } });
    if (back) {
      try {
        // The return scene may have been deleted or renamed while we edited the
        // prefab; an unguarded load would reject and strand the editor showing the
        // prefab tree with prefabSession already cleared. Fall back to a blank scene.
        await this.openScene(back, { quiet: true });
        // Reframe to where the user was before entering (openScene reseeds the view
        // from the scene camera; this puts their pan/zoom back).
        if (returnView) EngineHost.setEditorView(returnView);
        // Re-select the instance we came from — its scene id survived the reload.
        if (returnSelection != null && SceneModel.current?.entities.some((e) => e.id === returnSelection)) {
          useSelection.getState().select(returnSelection);
        }
        Toasts.push(t('proj.returnedScene', { name: back.split('/').pop() ?? back }), 'info', 1600);
      } catch {
        await this.newScene();
        Toasts.push(t('proj.returnSceneGone', { name: back.split('/').pop() ?? back }), 'warn');
      }
    } else {
      await this.newScene();
    }
  }

  /** True if the changed paths include the open scene document. */
  isOpenScenePath(paths: readonly string[]): boolean {
    const cur = this.state?.currentScene;
    if (!cur) return false;
    const norm = cur.replace(/\\/g, '/');
    return paths.some((p) => p.replace(/\\/g, '/') === norm);
  }

  /**
   * Reconcile the open scene with an on-disk change made outside the editor —
   * seamless when clean, discard-guarded when there are unsaved edits. A change
   * matching our own last write (or save) is a no-op.
   */
  async reloadOpenSceneFromDisk(): Promise<void> {
    const st = this.state;
    if (!st || !st.currentScene) return;
    let text: string;
    try { text = await window.estella.fs.read(st.currentScene); }
    catch { return; }
    if (text === this.knownSceneText && st.currentScene === this.knownScenePath) return;
    const name = st.currentScene.split('/').pop() ?? st.currentScene;
    if (EditorHistory.isDirty()) {
      // The confirm is async — further disk-change events while it's open must
      // not stack more dialogs for the same question.
      if (this.reloadPromptOpen) return;
      this.reloadPromptOpen = true;
      const ok = await confirmDiscard(t('discard.reloadChanged', { name }));
      this.reloadPromptOpen = false;
      if (!ok) {
        this.knownSceneText = text;
        this.knownScenePath = st.currentScene;
        return;
      }
    }
    await this.loadCurrentScene();
    Toasts.push(t('toast.reloadedFromDisk', { name }), 'info', 1600);
  }

  private async persistLastScene(relPath: string): Promise<void> {
    const st = this.state;
    if (!st) return;
    const workspace: WorkspaceState = { ...st.workspace, lastOpenedScene: relPath };
    this.store.setState({ project: { ...st, workspace, currentScene: relPath } });
    await window.estella.workspace.save(workspace);
  }

  /**
   * Overwrite the current scene file — now lossless (JSON-first L4): the saved
   * data comes from the source-of-truth model, which preserves components this
   * editor's engine never loaded. The old lossy overwrite-block is gone.
   */
  async save(): Promise<void> {
    if (this.prefabSession) { await this.savePrefab(); return; }
    const st = this.state;
    if (!st || !st.currentScene) throw new Error('no scene to save');
    await this.writeScene(st.currentScene, await this.serializeCurrent());
    await this.persistLastScene(st.currentScene);
    EditorHistory.markSaved();
    // The written scene is collapsed from the clean model — the stale overrides
    // the loader dropped are gone from the file now, so the warnings can clear.
    usePrefabConflicts.getState().clear();
    Toasts.push(t('proj.savedScene', { name: st.currentScene.split('/').pop() ?? st.currentScene }), 'success');
    void this.captureThumbnail();
  }

  /** Write the current world to a project-relative path (explicit, no lossy guard). */
  async saveAs(relPath: string): Promise<void> {
    if (!this.state) throw new Error('no project open');
    // In Prefab Mode the world holds a flattened PREFAB tree, not a scene —
    // writing it as a `.esscene` would emit a bogus scene AND repoint
    // `lastOpenedScene` at it. Save-As isn't a prefab operation; refuse it and
    // point the user at Save Prefab / Back. (save() already routes to savePrefab.)
    if (this.prefabSession) {
      Toasts.push(t('proj.saveAsInPrefabMode'), 'warn');
      return;
    }
    await this.writeScene(relPath, await this.serializeCurrent());
    await this.persistLastScene(relPath);
    EditorHistory.markSaved();
    usePrefabConflicts.getState().clear();
    Toasts.push(t('proj.savedScene', { name: relPath.split('/').pop() ?? relPath }), 'success');
    void this.captureThumbnail();
  }

  /**
   * Refresh the project's cover (`thumbnail.png` at the root — the launcher card
   * image): capture the composited viewport, center-cropped to the card's 16:9.
   * Editor chrome overlaid on the viewport (gizmos, perf HUD) is hidden for the
   * capture frame via a body class. Fire-and-forget from save — a cover refresh
   * must never turn into a save failure.
   */
  async captureThumbnail(): Promise<void> {
    try {
      const capture = window.estella.project.thumbnail;
      const canvas = EngineHost.canvas;
      if (!capture || !canvas || !this.state) return;
      const r = canvas.getBoundingClientRect();
      if (r.width < 64 || r.height < 64) return; // no meaningful cover from a collapsed viewport
      let w = r.width;
      let h = (r.width * 9) / 16;
      if (h > r.height) {
        h = r.height;
        w = (r.height * 16) / 9;
      }
      document.body.classList.add('thumb-capture');
      // Two frames + a beat, so the overlay-hidden state has been PRESENTED before
      // the grab — capturePage samples the last composited frame, not the DOM.
      await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(res, 60))));
      await capture({ x: r.x + (r.width - w) / 2, y: r.y + (r.height - h) / 2, width: w, height: h });
    } catch {
      // never surface — the cover is cosmetic
    } finally {
      document.body.classList.remove('thumb-capture');
    }
  }

  /**
   * Export a runnable web build of the project (play == ship): cook reachable
   * assets + bundle the game host + copy the runtime → a self-contained dir
   * (default `dist-game/`). Returns the bridge result so the Build dialog can
   * render status/log; null if no project is open.
   */
  async exportGame(opts?: { outDir?: string; minify?: boolean; sourcemap?: boolean; platform?: 'web' | 'desktop' | 'wechat' | 'playable'; compressTextures?: boolean; compressAudio?: boolean; atlasTextures?: boolean }) {
    if (!this.state) return null;
    return window.estella.project.exportGame(opts);
  }

  /** Prompt for a destination (Save-As) and write there. Returns the path or null. */
  async saveAsViaDialog(): Promise<string | null> {
    const st = this.state;
    if (!st || !window.estella.project.saveSceneDialog) return null;
    if (this.prefabSession) {
      Toasts.push(t('proj.saveAsInPrefabMode'), 'warn');
      return null;
    }
    const rel = await window.estella.project.saveSceneDialog(
      st.currentScene ?? `${st.layout.scenes}/scene.esscene`,
    );
    if (!rel) return null;
    await this.saveAs(rel);
    return rel;
  }
}

export const ProjectStore = new ProjectStoreImpl();
