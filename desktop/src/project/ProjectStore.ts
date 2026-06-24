// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { createStore } from 'zustand/vanilla';
import { getComponent, Assets, migratePrefabData, extractPrefab } from 'esengine';
import type { SceneData, PrefabData, ExtractEntity } from 'esengine';
import { EngineHost } from '@/engine/EngineHost';
import { SceneModel } from '@/engine/SceneModel';
import { Reconciler } from '@/engine/Reconciler';
import { EditorHistory } from '@/engine/EditorHistory';
import { expandScenePrefabs, collapseScenePrefabs } from '@/engine/PrefabInstance';
import { SceneCommands } from '@/engine/SceneCommands';
import { setPrefabBaseResolver } from '@/engine/SceneQuery';
import { setUserSchemas, userSchema, setBitmaskSource, setEnumSource, type UserComponentSchema } from '@/engine/schema';
import { useSelection } from '@/store/selectionStore';
import { Toasts } from '@/store/Toasts';
import { assetTypeOf } from '@/project/assetMeta';
import type { AssetType } from '@/types';
import { resolveLayout, WORKSPACE_DIR, PROJECT_MANIFEST_FILE, type OpenedProject, type ProjectFeatures, type ProjectLayout, type WorkspaceState } from './format';

/** Pad/truncate collision-layer names to the 16 Box2D filter bits (layer 0 = Default). */
function normalizeLayers(layers?: string[]): string[] {
  return Array.from({ length: 16 }, (_, i) => layers?.[i] ?? (i === 0 ? 'Default' : ''));
}

/** Whether an asset of the editor `type` is a valid pick for a `fieldType` slot. */
function assetMatchesSlot(type: AssetType, fieldType?: string): boolean {
  if (!fieldType) return true;
  // A 'texture' slot accepts any image (texture or sprite); others match by name.
  if (fieldType === 'texture') return type === 'texture' || type === 'sprite';
  return type === fieldType;
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
  /** The scene currently loaded into the world (project-relative path). */
  currentScene: string | null;
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

class ProjectStoreImpl {
  private readonly store = createStore<{ project: ProjectState | null }>(() => ({ project: null }));
  /** uuid → project-relative path, scanned from `.meta` sidecars — the editor's
   *  asset registry. The engine `Assets` loader resolves refs through it. */
  private readonly uuidToPath = new Map<string, string>();
  /** path → uuid (reverse), so a Content Browser drag (which carries a path) can
   *  be turned into a portable `@uuid:` ref for the model. */
  private readonly pathToUuid = new Map<string, string>();
  /** ref → loaded `.esprefab` (PrefabData), for scene load-expand / save-collapse. */
  private readonly prefabCache = new Map<string, PrefabData>();
  /** The latest scene preload result; the Reconciler resolver reads handles from
   *  it for entities recreated incrementally (duplicate / undo / play-stop). */
  private lastAssetResult: PreloadResult | null = null;
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
    const opened = await bridge.project.openDialog();
    if (!opened) return false;
    await this.adopted(opened);
    return true;
  }

  /** Open a project by absolute root path (e.g. a recent / dev default). */
  async open(root: string): Promise<boolean> {
    const bridge = window.estella;
    if (!bridge?.project) return false;
    await this.adopted(await bridge.project.open(root));
    return true;
  }

  /** Create a project from a template at `<location>/<name>`, then open it. */
  async createAndOpen(templateDir: string, location: string, name: string): Promise<boolean> {
    const bridge = window.estella;
    if (!bridge?.project?.createFromTemplate) return false;
    const root = await bridge.project.createFromTemplate(templateDir, location, name);
    return this.open(root);
  }

  /**
   * Adopt an opened project: remember it, and arrange for its scene to load.
   * The engine usually isn't booted yet (we're still on the launcher), so the
   * scene loads via EngineHost's boot bootstrap; if the engine is already
   * running (re-opening from the editor), load immediately.
   */
  private async adopted(opened: OpenedProject): Promise<void> {
    this.adopt(opened);
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
    this.store.setState({
      project: {
        root: opened.root,
        name: opened.manifest.name,
        layout: resolveLayout(opened.manifest),
        workspace: opened.workspace,
        defaultScene: opened.manifest.defaultScene,
        features: opened.manifest.features,
        currentScene: null,
      },
    });
  }

  /** Read + parse a project-relative `.esscene` (raw — refs unresolved). */
  async readScene(relPath: string): Promise<SceneData> {
    return JSON.parse(await window.estella.fs.read(relPath)) as SceneData;
  }

  /** Load the project's last-opened scene (or `<scenes>/main.esscene`) into the world. */
  async loadCurrentScene(): Promise<void> {
    const st = this.state;
    if (!st) return;
    const rel =
      st.workspace.lastOpenedScene ?? st.defaultScene ?? `${st.layout.scenes}/main.esscene`;
    const raw = await this.readScene(rel);
    const dropped = unknownComponentTypes(raw);
    if (dropped.length > 0) {
      console.warn(
        `[project] scene "${rel}" uses components this editor's engine hasn't ` +
        `loaded (${dropped.join(', ')}); they don't render in the viewport, but ` +
        `are preserved verbatim in the source-of-truth model and on save (JSON-first).`,
      );
    }
    // Build the uuid→path registry first (prefab + texture refs resolve through it).
    await this.buildAssetRegistry();

    // Expand prefab-instance entries into ordinary tagged entities (the model is
    // always expanded; the file stores deltas). Internal
    // entities get fresh ids above the file's max so they don't collide.
    let nextId = raw.entities.reduce((m, e) => Math.max(m, (e as { id?: number }).id ?? 0), 0) + 1;
    const { scene: expandedRaw, tags } = await expandScenePrefabs(
      raw,
      (ref) => this.loadPrefabAsset(ref),
      () => nextId++,
    );

    // Preload EVERY referenced asset type through the engine's own system, and
    // resolve a COPY of the (expanded) scene (refs → handles) for the World.
    const assets = EngineHost.getResource(Assets);
    let resolved: SceneData = expandedRaw;
    if (assets) {
      const result = await assets.preloadSceneAssets(expandedRaw);
      resolved = JSON.parse(JSON.stringify(expandedRaw)) as SceneData; // resolveSceneAssetPaths mutates
      assets.resolveSceneAssetPaths(resolved, result);
      this.lastAssetResult = result; // narrowed to the handle maps the resolver reads
    }

    // A scene is a session document: replacing it clears the editor history +
    // selection so undo closures can't reference the previous scene's entities
    // selection. The Reconciler bulk path then builds the World
    // from the resolved scene and adopts the raw scene (with @uuid: refs + any
    // components/fields/invisible entities the World drops) as the source of
    // truth. The World is a lossy projection; the model is what save() serializes.
    EditorHistory.clear();
    useSelection.getState().select(null);
    // Incremental recreate (duplicate / undo / play-stop) re-resolves @uuid:→handle
    // from the same preload result — for all types, not just textures.
    Reconciler.setAssetResolver((uuid) => this.handleForUuid(uuid));
    Reconciler.adopt(expandedRaw, resolved);
    // Re-apply prefab-instance tags (adopt cleared them) so save can collapse.
    for (const { id, tag } of tags) SceneModel.setPrefabTag(id, tag);

    // Bind spine entities' skeletons/atlas/textures into the SpineManager so spine
    // renders in the viewport (the World holds the SpineAnimation components, but
    // spine assets load separately from Assets via side modules). The
    // entityMap is the Reconciler's source→runtime binding; refs resolve through
    // the project's estella:// transport.
    const spineMap = new Map<number, number>();
    for (const e of expandedRaw.entities) {
      const id = (e as { id?: number }).id;
      if (id === undefined) continue;
      const rt = SceneModel.runtimeFor(id);
      if (rt !== undefined) spineMap.set(id, rt as number);
    }
    await EngineHost.loadSpine(expandedRaw, spineMap, (ref) =>
      ref.startsWith('@uuid:')
        ? `estella://project/${this.resolveRef(ref) ?? ''}`
        : `estella://project/${ref.replace(/^\//, '')}`,
    );

    EngineHost.syncEditorViewToScene();
    this.store.setState({ project: { ...st, currentScene: rel } });
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
    EditorHistory.clear();
    useSelection.getState().select(null);
    Reconciler.setAssetResolver((uuid) => this.handleForUuid(uuid));
    Reconciler.adopt(blank, blank); // no @uuid: refs → resolved === raw
    EngineHost.syncEditorViewToScene();
    this.store.setState({ project: { ...st, currentScene: null } });
  }

  /**
   * Load the project's asset index (the main-process AssetDatabase scan)
   * into a uuid→path registry, then point the engine
   * `Assets` loader at it + the `estella://` transport. This is the ONE
   * asset-resolution path: `Assets.resolveRef` turns `@uuid:` → path, the backend
   * fetches `estella://project/<path>`.
   */
  private async buildAssetRegistry(): Promise<void> {
    this.uuidToPath.clear();
    this.pathToUuid.clear();
    this.prefabCache.clear();
    if (!this.state) return;
    try {
      const { index } = await window.estella.project.scanAssets();
      for (const e of index.entries) {
        const uuid = e.uuid.toLowerCase();
        this.uuidToPath.set(uuid, e.path);
        this.pathToUuid.set(e.path, uuid);
      }
    } catch (err) {
      console.warn('[project] asset scan failed', err);
    }

    const assets = EngineHost.getResource(Assets);
    if (assets) {
      assets.baseUrl = 'estella://project';
      assets.setAssetRefResolver((ref) => this.resolveRef(ref));
    }
  }

  /** Resolve a serialized asset ref to a project-relative path for the engine
   *  loader: `@uuid:` → path (null if unknown); a plain path passes through. */
  private resolveRef(ref: string): string | null {
    if (!ref.startsWith(UUID_PREFIX)) return ref;
    return this.uuidToPath.get(ref.slice(UUID_PREFIX.length).toLowerCase()) ?? null;
  }

  /** The live GL handle for a uuid. Textures read the engine's live cache (so a
   *  just-assigned texture resolves); material/font fall back to the scene preload. */
  private handleForUuid(uuid: string): number {
    const ref = UUID_PREFIX + uuid;
    const tex = EngineHost.getResource(Assets)?.getTexture(ref);
    if (tex) return tex.handle;
    const path = this.uuidToPath.get(uuid.toLowerCase());
    const r = this.lastAssetResult;
    if (!path || !r) return 0;
    return r.materialHandles.get(path) ?? r.fontHandles.get(path) ?? 0;
  }

  /** Load a `.esprefab` asset (PrefabData) by ref, cached. The scene load-expand
   *  / save-collapse path resolves prefab instances through this. */
  private async loadPrefabAsset(ref: string): Promise<PrefabData | null> {
    if (!ref.startsWith(UUID_PREFIX)) return null;
    const cached = this.prefabCache.get(ref);
    if (cached) return cached;
    const path = this.uuidToPath.get(ref.slice(UUID_PREFIX.length).toLowerCase());
    if (!path) return null;
    try {
      const prefab = migratePrefabData(JSON.parse(await window.estella.fs.read(path))).data as PrefabData;
      this.prefabCache.set(ref, prefab);
      return prefab;
    } catch (err) {
      console.warn('[project] prefab load failed', path, err);
      return null;
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
      Toasts.push(`Could not load prefab: ${path.split('/').pop() ?? path}`, 'error');
      return null;
    }
    const rootId = SceneCommands.instantiatePrefab(prefab, ref, parent, position);
    if (rootId != null) useSelection.getState().select(rootId);
    return rootId;
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
      Toasts.push(`Failed to create prefab: ${base}`, 'error');
      return null;
    }

    await this.buildAssetRegistry(); // re-scan so the new prefab is tracked + draggable
    Toasts.push(`Created prefab: ${rel.split('/').pop()}`, 'info');
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
  playPayload(): {
    sceneData: SceneData;
    assetManifest: Record<string, string>;
    physicsEnabled?: boolean;
    physicsGravity?: { x: number; y: number };
  } | null {
    const sceneData = SceneModel.serialize();
    if (!sceneData) return null;
    // The realm runs from the project's estella:// origin, so assets are
    // same-origin estella:// — no cross-scheme dance needed.
    const assetManifest: Record<string, string> = {};
    for (const [uuid, path] of this.uuidToPath) assetManifest[uuid] = `estella://project/${path}`;
    // Carry the project's declared physics enable so the realm installs physics
    // even for runtime-spawned bodies the static scene doesn't show.
    const physics = this.state?.features?.physics;
    return { sceneData, assetManifest, physicsEnabled: physics?.enabled, physicsGravity: physics?.gravity };
  }

  /** The project's declared physics feature, with defaults (for Project Settings). */
  physicsFeature(): { enabled: boolean; gravity: { x: number; y: number }; collisionLayers: string[] } {
    const p = this.state?.features?.physics;
    return {
      enabled: p?.enabled ?? false,
      gravity: p?.gravity ?? { x: 0, y: -9.81 },
      collisionLayers: normalizeLayers(p?.collisionLayers),
    };
  }

  /** Collision-layer bit options for the inspector's mask controls (name, else `Layer N`). */
  collisionLayerOptions(): Array<{ label: string; value: number }> {
    const names = this.physicsFeature().collisionLayers;
    return names.map((name, i) => ({ label: name || `Layer ${i}`, value: 1 << i }));
  }

  /** Named render sorting layers (z-order = slot index). Default empty list. */
  renderingFeature(): { sortingLayers: string[] } {
    const r = this.state?.features?.rendering;
    return { sortingLayers: Array.from({ length: 8 }, (_, i) => r?.sortingLayers?.[i] ?? '') };
  }

  /** Sorting-layer dropdown options for render `layer` fields — only the NAMED
   *  slots (value = slot index = z-order); empty ⇒ the field stays a free number. */
  sortingLayerOptions(): Array<{ label: string; value: number }> {
    return this.renderingFeature()
      .sortingLayers.map((name, i) => ({ label: name.trim(), value: i }))
      .filter((o) => o.label !== '');
  }

  /** Set rendering-feature config (sorting layers) and persist to the manifest. */
  async setRendering(patch: { sortingLayers?: string[] }): Promise<void> {
    const st = this.state;
    if (!st) return;
    const rendering: NonNullable<ProjectFeatures['rendering']> = { ...st.features?.rendering, ...patch };
    const features: ProjectFeatures = { ...st.features, rendering };
    this.store.setState({ project: { ...st, features } });
    try {
      const raw = JSON.parse(await window.estella.fs.read(PROJECT_MANIFEST_FILE)) as Record<string, unknown>;
      raw.features = { ...((raw.features as Record<string, unknown>) ?? {}), rendering };
      await window.estella.fs.write(PROJECT_MANIFEST_FILE, JSON.stringify(raw, null, 2) + '\n');
    } catch (e) {
      Toasts.push('Failed to save sorting layers', 'error');
      console.error('[project] setRendering write failed', e);
    }
  }

  /**
   * Enable/configure the project's physics feature and persist to
   * `project.esproject` (so the play realm installs physics even for
   * runtime-spawned bodies). Rewrites the RAW manifest JSON so fields the editor
   * parser doesn't model survive; in-memory state updates first so the toggle
   * reflects immediately.
   */
  async setPhysics(patch: { enabled?: boolean; gravity?: { x: number; y: number }; collisionLayers?: string[] }): Promise<void> {
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
      Toasts.push('Failed to save physics setting', 'error');
      console.error('[project] setPhysics write failed', e);
    }
  }

  /** Display info for an asset ref (`@uuid:`), or null (none / unresolved). For
   *  the inspector's asset control: the project-relative path + a leaf name. */
  assetInfo(ref: unknown): { path: string; name: string } | null {
    if (typeof ref !== 'string' || !ref.startsWith(UUID_PREFIX)) return null;
    const path = this.uuidToPath.get(ref.slice(UUID_PREFIX.length).toLowerCase());
    return path ? { path, name: path.split('/').pop() ?? path } : null;
  }

  /** Project assets valid for an asset slot (the inspector's asset picker), by name. */
  listAssets(fieldType?: string): AssetEntry[] {
    const out: AssetEntry[] = [];
    for (const [uuid, path] of this.uuidToPath) {
      const name = path.split('/').pop() ?? path;
      const type = assetTypeOf(name);
      if (!assetMatchesSlot(type, fieldType)) continue;
      out.push({ ref: UUID_PREFIX + uuid, path, name, type });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
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

  private async writeScene(relPath: string, data: SceneData): Promise<void> {
    await window.estella.fs.write(relPath, JSON.stringify(data, null, 2) + '\n');
  }

  /**
   * Open a different scene file as the editor document (Content Browser
   * double-click). Persists it as the last-opened scene and reloads the world
   * (which clears history + selection — the caller guards unsaved changes).
   */
  async openScene(relPath: string): Promise<void> {
    if (!this.state) return;
    await this.persistLastScene(relPath);
    await this.loadCurrentScene();
    Toasts.push(`Opened ${relPath.split('/').pop() ?? relPath}`, 'info', 1600);
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
    const st = this.state;
    if (!st || !st.currentScene) throw new Error('no scene to save');
    await this.writeScene(st.currentScene, await this.serializeCurrent());
    await this.persistLastScene(st.currentScene);
    Toasts.push(`Saved ${st.currentScene.split('/').pop()}`, 'success');
  }

  /** Write the current world to a project-relative path (explicit, no lossy guard). */
  async saveAs(relPath: string): Promise<void> {
    if (!this.state) throw new Error('no project open');
    await this.writeScene(relPath, await this.serializeCurrent());
    await this.persistLastScene(relPath);
    Toasts.push(`Saved ${relPath.split('/').pop()}`, 'success');
  }

  /**
   * Export a runnable web build of the project (play == ship): cook reachable
   * assets + bundle the game host + copy the runtime → a self-contained dir
   * (default `dist-game/`). Returns the bridge result so the Build dialog can
   * render status/log; null if no project is open.
   */
  async exportGame(opts?: { outDir?: string; minify?: boolean; sourcemap?: boolean; platform?: 'web' | 'desktop' | 'wechat' | 'playable' }) {
    if (!this.state) return null;
    return window.estella.project.exportGame(opts);
  }

  /** Prompt for a destination (Save-As) and write there. Returns the path or null. */
  async saveAsViaDialog(): Promise<string | null> {
    const st = this.state;
    if (!st || !window.estella.project.saveSceneDialog) return null;
    const rel = await window.estella.project.saveSceneDialog(
      st.currentScene ?? `${st.layout.scenes}/scene.esscene`,
    );
    if (!rel) return null;
    await this.saveAs(rel);
    return rel;
  }
}

export const ProjectStore = new ProjectStoreImpl();
