import { createStore } from 'zustand/vanilla';
import { getComponent, Assets } from 'esengine';
import type { SceneData } from 'esengine';
import { EngineHost } from '@/engine/EngineHost';
import { SceneModel } from '@/engine/SceneModel';
import { Reconciler } from '@/engine/Reconciler';
import { EditorHistory } from '@/engine/EditorHistory';
import { setUserSchemas, type UserComponentSchema } from '@/engine/schema';
import { useSelection } from '@/store/selectionStore';
import { Toasts } from '@/store/Toasts';
import { resolveLayout, WORKSPACE_DIR, type OpenedProject, type ProjectLayout, type WorkspaceState } from './format';

/**
 * Editor-side project/workspace model (RC12 §E7-3 / §E6-1).
 *
 * Wraps the Electron `window.estella.{project,fs}` bridge: opens a project
 * directory, loads its scene into the live engine World via `resetWorldTo`, and
 * saves back. The bridge sandboxes every fs path to the open project root.
 *
 * Assets resolve through the engine's own asset system (REARCH_ASSETS.md A1):
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
  /** The scene currently loaded into the world (project-relative path). */
  currentScene: string | null;
}

/** Component types in `data` that the engine doesn't know — dropped on load. */
function unknownComponentTypes(data: SceneData): string[] {
  const unknown = new Set<string>();
  for (const entity of data.entities ?? []) {
    for (const comp of entity.components ?? []) {
      if (!getComponent(comp.type)) unknown.add(comp.type);
    }
  }
  return [...unknown];
}

class ProjectStoreImpl {
  private readonly store = createStore<{ project: ProjectState | null }>(() => ({ project: null }));
  /** uuid → project-relative path, scanned from `.meta` sidecars — the editor's
   *  asset registry. The engine `Assets` loader resolves refs through it. */
  private readonly uuidToPath = new Map<string, string>();
  /** The latest scene preload result; the Reconciler resolver reads handles from
   *  it for entities recreated incrementally (duplicate / undo / play-stop). */
  private lastAssetResult: PreloadResult | null = null;
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
    await this.loadUserSchemas();
    EngineHost.setSceneBootstrap(() => this.loadCurrentScene());
    if (EngineHost.world) await this.loadCurrentScene();
  }

  /**
   * Load the project's component field schemas (`.esengine/cache/schemas.json`,
   * built by extractSchemas) so the inspector can list + edit user/script
   * components — which never run in the editor realm, so the engine registry
   * doesn't know them. Missing/invalid cache → builtins only (run "Extract
   * Schemas"); the components still round-trip losslessly through the model.
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
    // Build the uuid→path registry + point the engine Assets loader at the
    // estella:// transport, then preload EVERY referenced asset type (textures,
    // materials, fonts, audio, spine, …) through the engine's own system, and
    // resolve a COPY of the scene (refs → handles) for the World.
    await this.buildAssetRegistry();
    const assets = EngineHost.getResource(Assets);
    let resolved: SceneData = raw;
    if (assets) {
      const result = await assets.preloadSceneAssets(raw);
      resolved = JSON.parse(JSON.stringify(raw)) as SceneData; // resolveSceneAssetPaths mutates
      assets.resolveSceneAssetPaths(resolved, result);
      this.lastAssetResult = result; // narrowed to the handle maps the resolver reads
    }

    // A scene is a session document: replacing it clears the editor history +
    // selection so undo closures can't reference the previous scene's entities
    // (REARCH_EDITOR_MODEL.md §6). The Reconciler bulk path then builds the World
    // from the resolved scene and adopts the raw scene (with @uuid: refs + any
    // components/fields/invisible entities the World drops) as the source of
    // truth. The World is a lossy projection; the model is what save() serializes.
    EditorHistory.clear();
    useSelection.getState().select(null);
    // Incremental recreate (duplicate / undo / play-stop) re-resolves @uuid:→handle
    // from the same preload result — for all types, not just textures.
    Reconciler.setAssetResolver((uuid) => this.handleForUuid(uuid));
    Reconciler.adopt(raw, resolved);
    EngineHost.syncEditorViewToScene();
    this.store.setState({ project: { ...st, currentScene: rel } });
  }

  /**
   * Scan `.meta` sidecars under the project's asset roots into a uuid→path
   * registry, then point the engine `Assets` loader at it + the `estella://`
   * transport. This is the ONE asset-resolution path: `Assets.resolveRef` turns
   * `@uuid:` → path, the backend fetches `estella://project/<path>` (REARCH_ASSETS.md A1).
   */
  private async buildAssetRegistry(): Promise<void> {
    const st = this.state;
    this.uuidToPath.clear();
    if (!st) return;
    // The conventional asset root(s): the top-level dir of the declared scenes /
    // textures dirs (e.g. `assets`), which also holds prefabs/audio/etc.
    const roots = new Set([st.layout.scenes, st.layout.textures].map((d) => d.split('/')[0]));
    for (const root of roots) await this.scanMetaDir(root);

    const assets = EngineHost.getResource(Assets);
    if (assets) {
      assets.baseUrl = 'estella://project';
      assets.setAssetRefResolver((ref) => this.resolveRef(ref));
    }
  }

  /** Recursively collect `<file>.meta` → {uuid} under `dir` into uuidToPath. */
  private async scanMetaDir(dir: string): Promise<void> {
    let entries;
    try {
      entries = await window.estella.fs.readDir(dir);
    } catch {
      return; // dir absent
    }
    for (const e of entries) {
      const p = `${dir}/${e.name}`;
      if (e.isDir) {
        await this.scanMetaDir(p);
        continue;
      }
      if (!e.name.endsWith('.meta')) continue;
      try {
        const meta = JSON.parse(await window.estella.fs.read(p)) as { uuid?: string };
        if (meta.uuid) this.uuidToPath.set(meta.uuid.toLowerCase(), p.replace(/\.meta$/, ''));
      } catch {
        // skip a malformed .meta
      }
    }
  }

  /** Resolve a serialized asset ref to a project-relative path for the engine
   *  loader: `@uuid:` → path (null if unknown); a plain path passes through. */
  private resolveRef(ref: string): string | null {
    if (!ref.startsWith(UUID_PREFIX)) return ref;
    return this.uuidToPath.get(ref.slice(UUID_PREFIX.length).toLowerCase()) ?? null;
  }

  /** The live GL handle for a uuid, from the latest preload result (any type). */
  private handleForUuid(uuid: string): number {
    const path = this.uuidToPath.get(uuid.toLowerCase());
    const r = this.lastAssetResult;
    if (!path || !r) return 0;
    return r.textureHandles.get(path) ?? r.materialHandles.get(path) ?? r.fontHandles.get(path) ?? 0;
  }

  /**
   * Serialize the editor's source-of-truth model — lossless (JSON-first L4).
   * The model retains everything the World drops (unknown components/fields,
   * invisible entities, `@uuid:` asset refs), so this no longer reads from the
   * World and needs no handle→uuid restoration.
   */
  private serializeCurrent(): SceneData {
    const model = SceneModel.serialize();
    if (!model) throw new Error('no scene loaded');
    return { ...model, name: this.state?.name ?? model.name };
  }

  private async writeScene(relPath: string, data: SceneData): Promise<void> {
    await window.estella.fs.write(relPath, JSON.stringify(data, null, 2) + '\n');
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
    await this.writeScene(st.currentScene, this.serializeCurrent());
    await this.persistLastScene(st.currentScene);
    Toasts.push(`Saved ${st.currentScene.split('/').pop()}`, 'success');
  }

  /** Write the current world to a project-relative path (explicit, no lossy guard). */
  async saveAs(relPath: string): Promise<void> {
    if (!this.state) throw new Error('no project open');
    await this.writeScene(relPath, this.serializeCurrent());
    await this.persistLastScene(relPath);
    Toasts.push(`Saved ${relPath.split('/').pop()}`, 'success');
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
