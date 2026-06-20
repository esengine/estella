import { resetWorldTo, serializeScene, getComponent, getComponentAssetFields, Assets } from 'esengine';
import type { SceneData } from 'esengine';
import { EngineHost } from '@/engine/EngineHost';
import { SceneModel } from '@/engine/SceneModel';
import { resolveLayout, type OpenedProject, type ProjectLayout, type WorkspaceState } from './format';

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
  /**
   * True if the loaded scene carried component types this editor's engine has
   * not registered (its `src/` code isn't loaded) — they were dropped on load,
   * so overwriting the source file would lose them. Blocks overwrite-save until
   * project code loading lands; Save-As to a new file stays available.
   */
  lossy: boolean;
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
  private state: ProjectState | null = null;
  private readonly listeners = new Set<() => void>();
  /** Texture GL handle → asset uuid for the loaded scene; reverses refs on save. */
  private handleToUuid = new Map<number, string>();

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getSnapshot = (): ProjectState | null => this.state;

  private emit() {
    for (const l of this.listeners) l();
  }

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
    EngineHost.setSceneBootstrap(() => this.loadCurrentScene());
    if (EngineHost.world) await this.loadCurrentScene();
  }

  private adopt(opened: OpenedProject) {
    this.state = {
      root: opened.root,
      name: opened.manifest.name,
      layout: resolveLayout(opened.manifest),
      workspace: opened.workspace,
      defaultScene: opened.manifest.defaultScene,
      currentScene: null,
      lossy: false,
    };
    this.emit();
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
        `[project] scene "${rel}" uses components this editor hasn't loaded ` +
        `(${dropped.join(', ')}); they are dropped on load — overwrite-save is ` +
        `blocked until project code loading lands. Use Save As.`,
      );
    }
    const data = await this.resolveTextures(raw);
    const world = EngineHost.mutableWorld();
    if (world) {
      // resetWorldTo returns source-id → runtime entity. Adopt the raw scene
      // (with @uuid: refs + any components/fields/invisible entities the World
      // drops) as the editor's source of truth (REARCH_SERIALIZATION.md L1).
      // The World is a lossy projection; the model is what L4 will save.
      const entityMap = resetWorldTo(world, data);
      SceneModel.adopt(raw, entityMap);
    }
    this.state = { ...st, currentScene: rel, lossy: dropped.length > 0 };
    this.emit();
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
    this.handleToUuid = new Map();
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
    const uuidToHandle = new Map<string, number>();
    if (assets) {
      for (const [uuid, rel] of uuidToPath) {
        try {
          const { handle } = await assets.loadTexture(`estella://project/${rel}`);
          uuidToHandle.set(uuid, handle);
          this.handleToUuid.set(handle, uuid);
        } catch (err) {
          console.warn('[project] texture load failed', rel, err);
        }
      }
    }
    return mapAssetRefs(raw, (uuid) => uuidToHandle.get(uuid) ?? 0) as SceneData;
  }

  /** Serialize the live world; map texture handles back to `@uuid:` (portable). */
  private serializeCurrent(): SceneData {
    const world = EngineHost.mutableWorld();
    if (!world) throw new Error('engine not ready');
    return this.restoreAssetRefs(serializeScene(world, this.state?.name ?? 'scene'));
  }

  /** Replace texture-handle values in asset fields with their `@uuid:` refs. */
  private restoreAssetRefs(data: SceneData): SceneData {
    if (this.handleToUuid.size === 0) return data;
    for (const entity of data.entities ?? []) {
      for (const comp of entity.components ?? []) {
        const cdata = comp.data as Record<string, unknown>;
        for (const field of getComponentAssetFields(comp.type)) {
          const v = cdata[field];
          if (typeof v === 'number' && this.handleToUuid.has(v)) {
            cdata[field] = `${UUID_PREFIX}${this.handleToUuid.get(v)}`;
          }
        }
      }
    }
    return data;
  }

  private async writeScene(relPath: string, data: SceneData): Promise<void> {
    await window.estella.fs.write(relPath, JSON.stringify(data, null, 2) + '\n');
  }

  private async persistLastScene(relPath: string): Promise<void> {
    const st = this.state;
    if (!st) return;
    const workspace: WorkspaceState = { ...st.workspace, lastOpenedScene: relPath };
    this.state = { ...st, workspace, currentScene: relPath };
    this.emit();
    await window.estella.workspace.save(workspace);
  }

  /**
   * Overwrite the current scene file. Refuses when the load was lossy (would
   * clobber components this editor dropped) — the caller should fall back to
   * {@link saveAsViaDialog}.
   */
  async save(): Promise<void> {
    const st = this.state;
    if (!st || !st.currentScene) throw new Error('no scene to save');
    if (st.lossy) {
      throw new Error(
        'overwrite-save blocked: the scene has components this editor did not ' +
        'load (they would be lost). Use Save As to write a new file.',
      );
    }
    await this.writeScene(st.currentScene, this.serializeCurrent());
    await this.persistLastScene(st.currentScene);
  }

  /** Write the current world to a project-relative path (explicit, no lossy guard). */
  async saveAs(relPath: string): Promise<void> {
    if (!this.state) throw new Error('no project open');
    await this.writeScene(relPath, this.serializeCurrent());
    await this.persistLastScene(relPath);
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
