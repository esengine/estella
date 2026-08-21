// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  host.ts — the engine's own headless render host.
 *
 * The pixel gates assert about the RENDERER, so their host is the engine's: an
 * offscreen canvas, no UI, no self-driving loop, and frames advanced by hand so
 * a capture is reproducible. Everything here is a call into the shipped SDK —
 * there is no authoring model between the scene file and the World.
 *
 * It publishes `window.__estellaHeadless`, the same shape the editor's host
 * does, so one runner drives either. Doors that only exist inside an editor
 * (the reference grid, hit-testing, the editor eye, material/mesh preview
 * renders) are absent rather than faked: a gate that needs one names the editor
 * host, and asking for one here fails with which door and why.
 */
import {
    createWebApp, setEditorMode, setPlayMode, Assets, acquireWebGPUDevice,
    loadSceneData, Renderer, instantiatePrefab, writeFieldPath, Transform, Name,
    getComponent, DeviceStatus, getDeviceStatus, getDeviceLostReport, recoverDevice,
    finishDeviceRecovery, getContextLossGuardInfo, decodeImagePixels,
} from 'esengine';
import type { App, SceneData, PrefabData, RenderSurfaceSource } from 'esengine';
import type { ESEngineModule } from 'esengine/wasm';
import { loadSpineSceneEntities, SpinePlugin } from 'esengine/spine';
import type { RuntimeAssetSource } from 'esengine/spine';
import { loadDragonBonesSceneEntities, DragonBonesPlugin } from 'esengine/dragonbones';

const UUID_PREFIX = '@uuid:';

const params = new URLSearchParams(location.search);
const width = Number(params.get('w')) || 1280;
const height = Number(params.get('h')) || 720;
const backend = params.get('backend') === 'webgpu' ? 'webgpu' : 'webgl2';
const colorSpace = params.get('colorSpace') === 'linear' ? 'linear' : undefined;
const seedParam = params.get('seed');
const randomSeed = seedParam !== null && Number.isFinite(Number(seedParam)) ? Number(seedParam) : undefined;
const depthLayers = Number(params.get('depthLayers')) || undefined;

let app: App | null = null;
let module: ESEngineModule | null = null;
let canvas: HTMLCanvasElement | null = null;
// A driver addresses entities by the id the SCENE FILE gives them, not by the
// World entity loadSceneData minted for it — that is the id an authored gate can
// write down. loadSceneData hands back exactly that mapping.
let sceneRaw: SceneData | null = null;
let sourceToEntity = new Map<number, number>();

/** A door this host does not have. Naming it beats a silent no-op that renders a wrong frame. */
function editorOnly(door: string): never {
    throw new Error(
        `${door} is an editor door — this is the engine's render host, which has no editor session. `
        + 'Run the gate that needs it against the editor host (--host editor).',
    );
}

async function boot(): Promise<void> {
    canvas = document.createElement('canvas');
    canvas.id = 'canvas';
    canvas.width = width;
    canvas.height = height;

    const glueUrl = `${location.origin}/wasm/esengine.js`;
    const { default: createModule } = (await import(/* @vite-ignore */ glueUrl)) as {
        default: (options?: Record<string, unknown>) => Promise<ESEngineModule>;
    };

    const moduleArg: Record<string, unknown> = {
        canvas,
        locateFile: (p: string) => `/wasm/${p}`,
        print: (t: string) => console.log('[wasm]', t),
        printErr: (t: string) => console.warn('[wasm]', t),
    };
    if (backend === 'webgpu') {
        // The device has to exist before the module instantiates (the wasm side
        // reads it synchronously), and the error listener is what makes an invalid
        // draw visible — without one Dawn drops it in silence.
        const gpu = await acquireWebGPUDevice('webgpu', (m: string) => console.error(m));
        if (!gpu.device) throw new Error(`WebGPU is not available: ${gpu.reason}`);
        console.info(`[engine] webgpu adapter: ${gpu.adapter ?? 'unreported'}`);
        moduleArg.preinitializedWebGPUDevice = gpu.device;
        // The swapchain glue resolves the canvas by selector, so it has to be
        // connected, and a hidden window never presents for drawImage readback —
        // the WebGPU capture takes the PAGE, which needs pixel-exact placement.
        canvas.style.position = 'fixed';
        canvas.style.left = '0';
        canvas.style.top = '0';
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
    }
    document.body.appendChild(canvas);

    module = await createModule(moduleArg);

    let renderSurface: RenderSurfaceSource;
    if (backend === 'webgpu') {
        renderSurface = { kind: 'webgpu', canvasSelector: '#canvas', readback: true };
    } else {
        const gl = canvas.getContext('webgl2', {
            alpha: false,
            antialias: true,
            depth: true,
            stencil: true,
            premultipliedAlpha: false,
            // Nothing composites here, and a readback happens in a later task than
            // the draw — without this the browser may discard the drawing buffer
            // and every capture comes back black.
            preserveDrawingBuffer: true,
        }) as WebGL2RenderingContext | null;
        if (!gl) throw new Error('WebGL2 is not available in this renderer.');
        renderSurface = {
            kind: 'gl-context',
            handle: module.GL.registerContext(gl, { majorVersion: 2, minorVersion: 0, enableExtensionsByDefault: true }),
        };
    }

    app = createWebApp(module, {
        renderSurface,
        colorSpace,
        randomSeed,
        depthLayers,
        getViewportSize: () => ({ width: canvas!.width, height: canvas!.height }),
        wasmBaseUrl: '/wasm',
    });
    app.enableStats();

    // The fixtures are AUTHORING scenes and were captured in authoring mode, where
    // gameplay systems stay frozen so a capture is the same frame every time.
    // ESTELLA_VERIFY_PLAY flips this per gate via setRunMode.
    setEditorMode(true);
    setPlayMode(false);
}

/**
 * Fetch an `.esscene` and load it through the engine's own asset system — one
 * asset-resolution path, the same `Assets` the shipped runtime uses. The
 * manifest is a uuid→url map beside the scene; without one, refs blank to 0.
 */
async function loadScene(sceneUrl: string, manifestUrl?: string): Promise<number> {
    if (!app) throw new Error('loadScene before boot');
    const res = await fetch(sceneUrl);
    if (!res.ok) throw new Error(`scene fetch failed: ${res.status} ${sceneUrl}`);
    const raw = (await res.json()) as SceneData;

    const uuidToUrl = await fetchManifest(manifestUrl);
    const assets = app.getResource(Assets);
    let resolved: SceneData = raw;
    if (assets) {
        assets.baseUrl = ''; // manifest urls are root-relative
        assets.setAssetRefResolver((ref: string) =>
            ref.startsWith(UUID_PREFIX) ? (uuidToUrl.get(ref.slice(UUID_PREFIX.length)) ?? null) : ref,
        );
        const result = await assets.preloadSceneAssets(raw);
        resolved = JSON.parse(JSON.stringify(raw)) as SceneData; // resolveSceneAssetPaths mutates
        assets.resolveSceneAssetPaths(resolved, result);
    }

    const map = loadSceneData(app.world, resolved as Parameters<typeof loadSceneData>[1]);
    sceneRaw = raw;
    sourceToEntity = map as unknown as Map<number, number>;
    // Both skeletal runtimes load outside Assets, so they bind after the World
    // exists. BOTH: a scene carrying one against a host that binds the other
    // renders an empty frame and reports no error.
    const toUrl = (ref: string) =>
        ref.startsWith(UUID_PREFIX) ? (uuidToUrl.get(ref.slice(UUID_PREFIX.length)) ?? ref) : ref;
    const entityMap = map as unknown as Map<number, number>;
    await loadSpine(app, raw, entityMap, toUrl);
    await loadDragonBones(app, raw, entityMap, toUrl);
    return map.size;
}

async function fetchManifest(manifestUrl?: string): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    if (!manifestUrl) return out;
    try {
        const res = await fetch(manifestUrl);
        if (!res.ok) return out;
        for (const [uuid, url] of Object.entries((await res.json()) as Record<string, string>)) out.set(uuid, url);
    } catch {
        // no manifest — refs blank to 0
    }
    return out;
}

async function loadSpine(
    target: App, sceneData: SceneData, entityMap: Map<number, number>, toUrl: (ref: string) => string,
): Promise<void> {
    const spineManager = target.getPlugin(SpinePlugin)?.spineManager;
    const wasm = target.wasmModule;
    const registry = target.world.getCppRegistry();
    if (!spineManager || !wasm || !registry) return;
    try {
        await loadSpineSceneEntities({
            module: wasm, source: skeletalSource(toUrl, 'spine'), spineManager, sceneData, entityMap, registry,
        });
    } catch (err) {
        console.warn('[engine] spine scene load failed', err);
    }
}

/**
 * The manager is acquired rather than read: the plugin fetches its wasm on first
 * ask, so a host that never loads an armature never loads the module.
 */
async function loadDragonBones(
    target: App, sceneData: SceneData, entityMap: Map<number, number>, toUrl: (ref: string) => string,
): Promise<void> {
    const wasm = target.wasmModule;
    if (!wasm) return;
    try {
        const manager = await target.getPlugin(DragonBonesPlugin)?.acquire();
        if (!manager) return;
        await loadDragonBonesSceneEntities({
            module: wasm, source: skeletalSource(toUrl, 'dragonbones'), manager, sceneData, entityMap,
        });
    } catch (err) {
        console.warn('[engine] DragonBones scene load failed', err);
    }
}

/**
 * The asset source both skeletal loaders fetch over. Skeleton and atlas arrive as
 * text/bytes; the atlas image decodes through the shared `decodeImagePixels`, the
 * same path the shipped runtime takes. What differs between the two runtimes is
 * how an atlas names its images, not how a host reaches a file — hence one source.
 */
function skeletalSource(toUrl: (ref: string) => string, label: string): RuntimeAssetSource {
    const fetchOk = async (ref: string, kind: string): Promise<Response> => {
        const r = await fetch(toUrl(ref));
        if (!r.ok) throw new Error(`${label} ${kind} ${r.status}: ${ref}`);
        return r;
    };
    return {
        resolveRef: (ref) => toUrl(ref),
        backend: {
            resolveUrl: (ref) => toUrl(ref),
            fetchText: async (ref) => (await fetchOk(ref, 'asset')).text(),
            fetchBinary: async (ref) => (await fetchOk(ref, 'asset')).arrayBuffer(),
        },
        decodePixels: async (ref) => decodeImagePixels(await (await fetchOk(ref, 'texture')).blob()),
    };
}

const api = {
    loadScene,

    resizeViewport(w: number, h: number): void {
        if (!canvas) throw new Error('resizeViewport before boot');
        canvas.width = w;
        canvas.height = h;
    },

    /** Advances frames by hand — the per-frame work app.run()'s loop does. */
    async step(framesIn: number | null = 1, dtIn: number | null = 1 / 60): Promise<{ world: string; frames: number; dt: number }> {
        // An omitted argument arrives as null across the JSON hop, and a default
        // parameter only answers to undefined. Normalise, and report what ran.
        const frames = Number(framesIn) > 0 ? Math.floor(Number(framesIn)) : 1;
        const dt = Number(dtIn) > 0 ? Number(dtIn) : 1 / 60;
        for (let i = 0; i < frames; i++) await app?.tick(dt);
        return { world: 'engine', frames, dt };
    },

    captureViewport(): { rgba: Uint8Array; width: number; height: number } {
        if (!canvas) throw new Error('captureViewport before boot');
        const w = canvas.width, h = canvas.height;
        const gl = canvas.getContext('webgl2') as WebGL2RenderingContext | null;
        if (gl) {
            const rgba = new Uint8Array(w * h * 4);
            gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
            return { rgba, width: w, height: h };
        }
        // WebGPU: read the presented frame back through a 2D copy.
        const copy = document.createElement('canvas');
        copy.width = w; copy.height = h;
        const ctx = copy.getContext('2d');
        if (!ctx) throw new Error('captureViewport: no 2d context for the WebGPU readback');
        ctx.drawImage(canvas, 0, 0);
        return { rgba: new Uint8Array(ctx.getImageData(0, 0, w, h).data.buffer), width: w, height: h };
    },

    getStats(): { entities: number; drawCalls: number } {
        return {
            entities: app?.world.entityCount() ?? 0,
            drawCalls: (module as unknown as { renderer_getDrawCalls?(): number } | null)?.renderer_getDrawCalls?.() ?? 0,
        };
    },

    /** Runs the gameplay systems the authoring mode freezes. */
    setRunMode(playing: boolean): boolean {
        setEditorMode(!playing);
        setPlayMode(playing);
        return false;
    },

    setYSortLayers(mask: number): void {
        Renderer.setYSortLayers(mask >>> 0);
    },

    /** Moves an entity — the 2.5D and parallax gates drive the camera this way. */
    setEntityXY(id: number, x: number, y: number): void {
        const entity = requireEntity(id);
        const t = app!.world.get(entity, Transform);
        t.position.x = x;
        t.position.y = y;
        app!.world.set(entity, Transform, t);
    },

    /**
     * Writes one component field by path, the engine's own write door. The
     * declared field type is the editor's vocabulary for how its inspector
     * renders a value; the World takes the value itself.
     */
    setField(id: number, component: string, key: string, _type: string, value: unknown): void {
        const entity = requireEntity(id);
        const comp = getComponent(component);
        if (!comp) throw new Error(`setField: no component named "${component}"`);
        const data = app!.world.get(entity, comp) as Record<string, unknown>;
        writeFieldPath(data, key, coerceToShape(readFieldPath(data, key), value));
        app!.world.set(entity, comp, data);
    },

    getEntity(id: number): { id: number; name: string; components: string[] } | null {
        const node = sceneRaw?.entities?.find((e) => e.id === id);
        if (!node) return null;
        return { id, name: node.name, components: (node.components ?? []).map((c) => c.type) };
    },

    /**
     * The scene's entity hierarchy, as the FILE declares it. The editor's version
     * of this reads its authoring model; here the file is the model, which is the
     * same tree for anything this host loads (it never edits one).
     */
    getSceneTree(): Array<{ id: number; name: string; children: unknown[] }> {
        const nodes = sceneRaw?.entities ?? [];
        const byId = new Map(nodes.map((e) => [e.id, e]));
        const build = (id: number): { id: number; name: string; children: unknown[] } => {
            const n = byId.get(id);
            return { id, name: n?.name ?? '', children: (n?.children ?? []).map(build) };
        };
        return nodes.filter((e) => e.parent === null || e.parent === undefined).map((e) => build(e.id));
    },

    // Editor doors, absent by design.
    setGrid: () => editorOnly('set_grid'),
    pick: () => editorOnly('pick'),
    useEditorView: () => editorOnly('use_editor_view'),
    setViewOrbit: () => editorOnly('set_view_orbit'),
    setViewPerspective: () => editorOnly('set_view_perspective'),
    renderSceneMaterialPreview: () => editorOnly('render_scene_material_preview'),
    renderSceneMeshPreview: () => editorOnly('render_scene_mesh_preview'),
};

/** Reads `path` ("a.b.c") out of `obj`, or undefined at the first missing hop. */
function readFieldPath(obj: unknown, path: string): unknown {
    let at: unknown = obj;
    for (const key of path.split('.')) {
        if (at === null || typeof at !== 'object') return undefined;
        at = (at as Record<string, unknown>)[key];
    }
    return at;
}

/**
 * A vector field is written down as an array — `[16, 0]` says more about a gate's
 * intent than `{"x":16,"y":0}` and is what the authored gates carry. The World
 * takes the struct, so widen against the value already there rather than against
 * a list of component shapes this host would then have to keep current.
 */
function coerceToShape(current: unknown, value: unknown): unknown {
    if (!Array.isArray(value)) return value;
    if (current === null || typeof current !== 'object' || Array.isArray(current)) return value;
    const keys = Object.keys(current as Record<string, unknown>);
    if (keys.length !== value.length) return value;
    return Object.fromEntries(keys.map((k, i) => [k, value[i]]));
}

function requireEntity(id: number): number {
    const entity = sourceToEntity.get(Number(id));
    if (entity === undefined) throw new Error(`the scene has no entity with id ${id}`);
    return entity;
}

// Held from before a loss: getExtension on an already-lost context is not
// required to hand the object back, and restoreContext has to be called on the
// same one that took the context away.
let cachedLoseExt: { loseContext(): void; restoreContext(): void } | null = null;
function loseContextExtension() {
    if (cachedLoseExt) return cachedLoseExt;
    const gl = canvas?.getContext('webgl2') as WebGL2RenderingContext | null;
    cachedLoseExt = gl?.getExtension('WEBGL_lose_context') ?? null;
    return cachedLoseExt;
}

declare global {
    interface Window {
        __estellaHeadless?: unknown;
    }
}

window.__estellaHeadless = {
    ready: boot(),
    api,
    device: {
        status: () => getDeviceStatus(),
        report: () => getDeviceLostReport(),
        recover: () => recoverDevice(),
        finishRecovery: () => finishDeviceRecovery(),
        recoverFull: async () => (await app?.getResource(Assets)?.recoverFromDeviceLoss()) ?? false,
        // Which textures did not come back, not how many: a failing recovery
        // needs the list, and a number cannot give it.
        awaiting: () => (app?.getResource(Assets)?.texturesAwaitingReupload() ?? [])
            .map((t: { handle: number; path: string }) => `${t.handle}|${t.path}`),
        // Emscripten's GL tables hold wrappers minted against the dead context;
        // counting them says whether a rebuild refilled them or merely added to
        // the stale ones.
        glTables: () => {
            const GL = (module as unknown as { GL?: Record<string, unknown> } | null)?.GL;
            const count = (n: string): number => {
                const t = GL?.[n] as unknown[] | undefined;
                if (!t) return -1;
                let live = 0;
                for (const e of t) if (e) live++;
                return live;
            };
            return {
                programs: count('programs'), shaders: count('shaders'), buffers: count('buffers'),
                textures: count('textures'), vaos: count('vaos'), framebuffers: count('framebuffers'),
            };
        },
        guard: () => getContextLossGuardInfo(),
        contextLost: () => {
            const gl = canvas?.getContext('webgl2') as WebGL2RenderingContext | null;
            return gl ? gl.isContextLost() : null;
        },
        lose: () => {
            const ext = loseContextExtension();
            if (ext) {
                ext.loseContext();
                return true;
            }
            // WebGPU has no lose-context extension; destroying the device is the
            // one loss a page can cause. The device IN USE, not the one booted
            // with — after a recovery those differ.
            const m = module as unknown as {
                currentWebGPUDevice?: { destroy?(): void };
                preinitializedWebGPUDevice?: { destroy?(): void };
            } | null;
            const gpu = m?.currentWebGPUDevice ?? m?.preinitializedWebGPUDevice;
            if (!gpu?.destroy) return false;
            gpu.destroy();
            return true;
        },
        restore: () => {
            const ext = loseContextExtension();
            if (!ext) return false;
            ext.restoreContext();
            return true;
        },
    },
    // Nothing about the geometry changes — same entity, same vertices, the other
    // path — so the frame afterwards has to be the same frame.
    makeMeshesResident: () => {
        const m = module as unknown as { mesh2d_makeAllResident?(registry: unknown): number } | null;
        const registry = app?.world.getCppRegistry();
        if (!m?.mesh2d_makeAllResident || !registry) return 0;
        return m.mesh2d_makeAllResident(registry);
    },
    // Through the asset layer, not a side door: the file goes through the same
    // load() every other asset type does, so what this proves is the format
    // reaching the screen rather than a decoder wired straight to the engine.
    loadMeshAsset: async (path: string) => {
        const assets = app?.getResource(Assets);
        const m = module as unknown as { mesh2d_setMeshAll?(registry: unknown, handle: number): number } | null;
        const registry = app?.world.getCppRegistry();
        if (!assets || !m?.mesh2d_setMeshAll || !registry) return 0;
        const mesh = await assets.load<{ handle: number }>('mesh', path);
        if (!mesh?.handle) return 0;
        return m.mesh2d_setMeshAll(registry, mesh.handle);
    },
    loadMaterialAsset: async (path: string) => {
        const assets = app?.getResource(Assets);
        const m = module as unknown as { mesh2d_setMaterialAll?(registry: unknown, id: number): number } | null;
        const registry = app?.world.getCppRegistry();
        if (!assets || !m?.mesh2d_setMaterialAll || !registry) return 0;
        const material = await assets.load<{ handle: number }>('material', path);
        if (!material?.handle) return 0;
        return m.mesh2d_setMaterialAll(registry, material.handle);
    },
    // A prefab brings its own asset refs, so this hands the file to the engine's
    // own instantiation and asserts nothing about what it names: the claim is
    // about an import's products, not a scene written to match them.
    loadPrefabAsset: async (path: string) => {
        const assets = app?.getResource(Assets);
        if (!assets || !app) return 0;
        const prefab = await assets.loadPrefab(path);
        const result = await instantiatePrefab(app.world, prefab.data as PrefabData, { assets });
        return result.entities.size;
    },
};

// Referenced so an unused-import check sees it; DeviceStatus is the vocabulary a
// driver compares status() against.
export const DEVICE_STATUS_VOCAB = DeviceStatus;
export const NAME_COMPONENT = Name;
