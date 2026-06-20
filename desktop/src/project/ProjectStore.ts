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
 * Texture `@uuid:` refs resolve through the `estella://` custom protocol
 * (electron/main) which serves the project's files — so project textures
 * actually render. On save, texture handles are mapped back to `@uuid:` using
 * each component's asset fields, keeping saved scenes portable.
 */

const UUID_PREFIX = '@uuid:';

interface AssetsLike {
  loadTexture(ref: string): Promise<{ handle: number }>;
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

/** Collect every `@uuid:<id>` referenced anywhere in the scene. */
function collectUuids(value: unknown, into: Set<string>): void {
  if (typeof value === 'string') {
    if (value.startsWith(UUID_PREFIX)) into.add(value.slice(UUID_PREFIX.length));
    return;
  }
  if (Array.isArray(value)) {
    for (const v of value) collectUuids(v, into);
    return;
  }
  if (value && typeof value === 'object') {
    for (const v of Object.values(value as Record<string, unknown>)) collectUuids(v, into);
  }
}

/** Replace `@uuid:<id>` refs with a resolved asset handle (or 0 if unresolved). */
function mapAssetRefs(value: unknown, resolve: (uuid: string) => number): unknown {
  if (typeof value === 'string') {
    return value.startsWith(UUID_PREFIX) ? resolve(value.slice(UUID_PREFIX.length)) : value;
  }
  if (Array.isArray(value)) return value.map((v) => mapAssetRefs(v, resolve));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = mapAssetRefs(v, resolve);
    return out;
  }
  return value;
}

class ProjectStoreImpl {
  private readonly store = createStore<{ project: ProjectState | null }>(() => ({ project: null }));
  /** Resolved `@uuid:` → GL handle map for the current scene's textures; the
   *  Reconciler reads it (via the registered resolver) when projecting entities
   *  recreated incrementally (duplicate, undo-of-delete) back into the World. */
  private readonly uuidToHandle = new Map<string, number>();
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
    const data = await this.resolveTextures(raw);
    // A scene is a session document: replacing it clears the editor history +
    // selection so undo closures can't reference the previous scene's entities
    // (REARCH_EDITOR_MODEL.md §6). The Reconciler bulk path then builds the World
    // from the resolved scene and adopts the raw scene (with @uuid: refs + any
    // components/fields/invisible entities the World drops) as the source of
    // truth. The World is a lossy projection; the model is what save() serializes.
    EditorHistory.clear();
    useSelection.getState().select(null);
    Reconciler.setAssetResolver((uuid) => this.uuidToHandle.get(uuid) ?? 0);
    Reconciler.adopt(raw, data);
    EngineHost.syncEditorViewToScene();
    this.store.setState({ project: { ...st, currentScene: rel } });
  }

  /**
   * Resolve the scene's `@uuid:` texture refs to live GL handles by loading the
   * files through the `estella://` protocol; records handle→uuid for save.
   * Unresolved refs blank to 0 (solid color). Textures only — material/font
   * refs aren't served yet.
   */
  private async resolveTextures(raw: SceneData): Promise<SceneData> {
    const st = this.state;
    const bridge = window.estella;
    this.uuidToHandle.clear();
    if (!st) return raw;

    const referenced = new Set<string>();
    collectUuids(raw, referenced);
    if (referenced.size === 0) return raw;

    // uuid → texture path, from the `.meta` sidecars in the textures dir.
    const uuidToPath = new Map<string, string>();
    try {
      for (const entry of await bridge.fs.readDir(st.layout.textures)) {
        if (entry.isDir || !entry.name.endsWith('.meta')) continue;
        try {
          const meta = JSON.parse(
            await bridge.fs.read(`${st.layout.textures}/${entry.name}`),
          ) as { uuid?: string };
          if (meta.uuid && referenced.has(meta.uuid)) {
            uuidToPath.set(meta.uuid, `${st.layout.textures}/${entry.name.replace(/\.meta$/, '')}`);
          }
        } catch {
          // skip a malformed .meta
        }
      }
    } catch {
      // no textures dir — every ref blanks to 0
    }

    const assets = EngineHost.getResource(Assets) as unknown as AssetsLike | undefined;
    if (assets) {
      for (const [uuid, rel] of uuidToPath) {
        try {
          const { handle } = await assets.loadTexture(`estella://project/${rel}`);
          this.uuidToHandle.set(uuid, handle);
        } catch (err) {
          console.warn('[project] texture load failed', rel, err);
        }
      }
    }
    return mapAssetRefs(raw, (uuid) => this.uuidToHandle.get(uuid) ?? 0) as SceneData;
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
