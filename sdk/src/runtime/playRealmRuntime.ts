// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    playRealmRuntime.ts
 * @brief   Editor play-realm runtime entry — the SAME shipping runtime
 *          (`initRuntime`) the playable/wechat paths use, but driven from a live
 *          scene SNAPSHOT + a uuid→url asset manifest fetched over the realm
 *          origin. So what the editor "plays" is literally the shipping runtime
 *          (play == ship). Mirrors {@link initPlayableRuntime} minus the
 *          base64/embedded asset packing.
 *
 *          Builtin components/systems run as-is. Project-defined components/systems
 *          are already registered by the time this runs: the host imports the project
 *          bundle (esengine external + import map → the shared instance) BEFORE booting,
 *          so its defineComponent/defineSystem populate the registry this drains. This
 *          entry only owns the runtime + snapshot + asset fetch.
 */
import type { ParsedTextureImportSettings } from '../asset/textureImportSettings';
import type { App } from '../app/app';
import type { ESEngineModule } from '../wasm';
import { initRuntime } from './runtimeLoader';
import { runtimeProjectSettings, type RuntimeProjectSettings } from './projectSettings';
import { cutWorld, resolvePrefabRoots, type CutWorld } from '../residency/cutWorld';
import { streamedWorldDeclaration } from '../residency/partitionWorld';
import { registryEntityFields } from '../residency/componentRefs';
import { deferFarProxies, farProxySceneName, farProxySettings, type FarProxyHost } from '../residency/farProxy';
import { decodeMesh, encodeMesh } from '../asset/meshFormat';
import type { RuntimeAssetSource } from './runtimeAssets';
import { HttpBackend } from '../asset/Backend';
import { Catalog, type CatalogData } from '../asset/Catalog';
import type { AddressableManifest } from '../asset/AddressableManifest';
import type { SceneData } from '../scene/scene';
import { fetchDecodePixels } from '../asset/imageDecode';
import { applyAssetRefResolvers, indexPackagedManifest } from './packagedRuntime';
import { assetRefId, localAssetPathWithoutSuffix, normalizeAssetPathSeparators } from '../asset/AssetRegistry';

export interface PlayRealmRuntimeConfig extends RuntimeProjectSettings {
    app: App;
    module: ESEngineModule;
    canvas: HTMLCanvasElement;
    /** The current scene as RAW (`@uuid:`) SceneData — handles are realm-local. */
    sceneData: SceneData;
    /** Where the host keeps this realm's textures compressed (RuntimeAssetSource). */
    compressedTexture?: RuntimeAssetSource['compressedTexture'];
    /** Additional switchable scenes beyond the entry (SceneManager targets).
     *  `path` entries load lazily through the runtime Assets on first switch. */
    extraScenes?: Array<{ name: string; data?: SceneData; path?: string }>;
    /** SceneManager name of the entry `sceneData` (default '__play'). Shipped
     *  builds pass the real scene name so game code can switch back to it. */
    entrySceneName?: string;
    /** Lowercased uuid → fetchable URL (e.g. `estella://project/<path>`). */
    assetManifest: Record<string, string>;
    /** Authored text files captured with the scene. Load them at their normal paths, including by UUID. */
    assetDocuments?: readonly { path: string; contents: string }[];
    /**
     * Logical (source) path → fetchable staged path, for cooked builds whose
     * content-addressed staging renamed the physical files. Path-style refs
     * (a scene's "assets/x.esmaterial") resolve through this BEFORE extension
     * sniffing, exactly like uuid refs — so a .png staged as .ktx2 transcodes.
     * Omit when files are served at their logical paths (the editor realm).
     */
    assetPathMap?: Record<string, string>;
    /**
     * Logical path → build-path catalog for the same cooked case: loaders fetch
     * their INNER text refs (a material's shader) through Catalog.getBuildPath,
     * which is identity without this. Omit alongside assetPathMap.
     */
    catalogData?: CatalogData | null;
    manifest?: AddressableManifest | null;
    /** CDN root `remote`-group assets resolve against — turns on hot-update delivery. */
    remoteRoot?: string;
    /** Storage key an applied hot-update persists under; boot restores it if present. */
    persistUpdateKey?: string;
    /** Base URL the engine side-modules (physics.wasm, …) are served from — same
     *  dir as esengine.wasm. When set, the realm can load physics on demand. */
    wasmBaseUrl?: string;
    /** Project-root URL for path-addressed runtime assets. Textures resolve
     *  through the uuid manifest, but the audio channel takes plain project-relative
     *  paths (`audio.playSFX('assets/…')`), so it needs this base to fetch from the
     *  project rather than the play-realm subdir. */
    assetBaseUrl?: string;
    /** Turn on per-phase / per-system frame timing (editor profiler; off in shipped games). */
    enableStats?: boolean;
    /**
     * How a far proxy's merged group is simplified, as a build does it. Without one Play's proxies keep every triangle of what they
     * stand for: right to look at, and as heavy as the whole world loaded.
     */
    simplifyFarProxy?: FarProxyHost['simplify'];
}

/**
 * Build the realm's asset source: `@uuid:` refs resolve through the editor-supplied
 * manifest (`resolveRef`), fetch goes over the realm origin via `HttpBackend`, and
 * images go fetch → blob → decode (NOT `<img crossorigin>`: Chromium refuses
 * CORS-mode images for custom schemes like `estella://`, and a non-CORS `<img>`
 * taints the canvas so getImageData throws — fetch+blob sidesteps both).
 * `estella://` is fetchable because it's a privileged supportFetchAPI scheme; the
 * editor returns `access-control-allow-origin: *`.
 */
/**
 * Resolve a play-realm asset ref to a fetchable URL. UUID refs go through the
 * editor-supplied manifest — a `@uuid:` prefix is explicit intent (any body), and
 * a BARE uuid-shaped ref counts too:
 * `.esanim` flipbook frames serialize bare uuids, and the old prefix-only check
 * dropped those into the path branch → guaranteed 404s, blank sprite animation
 * in play. Any other ref is a project-relative path (spine skel/atlas, …) and
 * resolves against the project root, not the `.esengine/play/` subdir the realm
 * runs from. Pure.
 */
export function resolvePlayAssetRef(
    ref: string,
    manifest: Record<string, string>,
    assetBaseUrl?: string,
    pathMap?: Record<string, string>,
): string {
    const uuid = assetRefId(ref);
    if (uuid !== null) {
        const url = manifest[uuid];
        if (!url) throw new Error(`asset not in play manifest: ${ref}`);
        return url;
    }
    const portable = normalizeAssetPathSeparators(ref);
    // Cooked builds: a logical path maps to its staged file (content-addressed
    // rename + possible extension swap) — resolved here so the result is the
    // extension-bearing physical path, same contract as the uuid branch.
    if (pathMap) {
        const file = portable.replace(/^\.?\//, '');
        const local = localAssetPathWithoutSuffix(portable);
        const staged = pathMap[ref] ?? pathMap[file]
            ?? (local === portable ? undefined : pathMap[local.replace(/^\.?\//, '')]);
        if (staged) return staged;
    }
    const base = (assetBaseUrl ?? '').replace(/\/$/, '');
    // Idempotent, like HttpBackend.resolveUrl: an already-resolved absolute URL or
    // base-prefixed path must not be prefixed again. Preload resolves a ref once to
    // bucket it by type, then the loader resolves it a second time — without this
    // guard a plain path would gain the base twice (estella://…/estella://…/404).
    if (portable.includes('://') || (base && portable.startsWith(`${base}/`))) return portable;
    return base ? `${base}/${portable.replace(/^\//, '')}` : portable;
}

/**
 * What a manifest tells a realm about its assets, in one place: two lookups a
 * packaged build and an editor Play session read identically. Assembled once per
 * source — rebuilding a spelling map per ref would walk the manifest on every
 * asset a scene preloads.
 */
function manifestBackedSettings(manifest: AddressableManifest): Partial<RuntimeAssetSource> {
    const index = indexPackagedManifest(manifest);
    return {
        resolveAddress: index.addressOf,
        textureImportSettings: index.textureImport,
        spineCulling: index.spineCulling,
    };
}

/**
 * A manifest's texture settings for a realm whose refs can be URLs. A material names its textures beside itself, and
 * beside a URL is another URL: one the manifest knows by path or uuid. Without this its maps miss their settings and are
 * decoded as colour, and every value in them bends.
 */
export function playRealmTextureSettings(
    lookup: (ref: string) => ParsedTextureImportSettings | undefined,
    manifest: Record<string, string>,
    assetBaseUrl?: string,
): (ref: string) => ParsedTextureImportSettings | undefined {
    const keyOf = new Map(Object.entries(manifest).map(([key, url]) => [url, key]));
    const base = assetBaseUrl?.replace(/\/$/, '');
    return (ref) => {
        const direct = lookup(ref);
        if (direct) return direct;
        const key = keyOf.get(ref);
        if (key !== undefined) return lookup(key);
        const path = base && ref.startsWith(`${base}/`) ? ref.slice(base.length + 1) : ref;
        const local = localAssetPathWithoutSuffix(path);
        return (path !== ref ? lookup(path) : undefined)
            ?? (local !== path ? lookup(normalizeAssetPathSeparators(local).replace(/^\//, '')) : undefined);
    };
}

/** Game-local files served under their normal asset paths, including captured documents and generated far proxies. */
export interface PlayMade {
    bytes: Map<string, Uint8Array>;
    later: Map<string, () => Promise<Uint8Array | null>>;
}

/** An http backend that answers some paths from what Play made: a world's far proxies, documents and meshes. */
class OverlayBackend extends HttpBackend {
    constructor(private readonly made_: PlayMade) {
        super({ baseUrl: '' });
    }

    private async made(path: string): Promise<Uint8Array | null> {
        for (const key of [path, this.resolveUrl(path)]) {
            const bytes = this.made_.bytes.get(key);
            if (bytes) return bytes;
            const make = this.made_.later.get(key);
            if (make) return make();
        }
        return null;
    }

    override async fetchBinary(path: string): Promise<ArrayBuffer> {
        const bytes = await this.made(path);
        return bytes ? bytes.slice().buffer : super.fetchBinary(path);
    }

    override async fetchText(path: string): Promise<string> {
        const bytes = await this.made(path);
        return bytes ? new TextDecoder().decode(bytes) : super.fetchText(path);
    }
}

function createPlayRealmSource(
    manifest: Record<string, string>,
    assetBaseUrl?: string,
    pathMap?: Record<string, string>,
    addressable?: AddressableManifest | null,
    compressedTexture?: RuntimeAssetSource['compressedTexture'],
    made: PlayMade = { bytes: new Map(), later: new Map() },
) {
    const backend = new OverlayBackend(made);
    const base = assetBaseUrl?.replace(/\/$/, '');
    return {
        backend,
        ...(compressedTexture ? { compressedTexture } : {}),
        decodePixels: (path, _flip, maxEdge) => fetchDecodePixels(backend.resolveUrl(path), maxEdge),
        resolveRef: (ref) => resolvePlayAssetRef(ref, manifest, assetBaseUrl, pathMap),
        resolveAddress: (ref) => {
            const url = resolvePlayAssetRef(ref, manifest, assetBaseUrl, pathMap);
            return base && url.startsWith(base + '/') ? url.slice(base.length + 1) : url;
        },
        // Cooked builds: logical paths (the pathMap keys). Editor play: the
        // manifest's resolved URLs — both keep the real extension, which is all
        // the .eslocale discovery filters on.
        listAssetPaths: () => (pathMap ? Object.keys(pathMap) : Object.values(manifest)),
        // Sampling, and the spine culling contract, both come off the addressable
        // manifest — the same fields a cooked build reads, so Play and ship
        // cannot disagree about what an author promised.
        ...(addressable ? withUrlSettings(manifestBackedSettings(addressable), manifest, assetBaseUrl) : {}),
    } satisfies RuntimeAssetSource;
}

function withUrlSettings(settings: Partial<RuntimeAssetSource>, manifest: Record<string, string>, assetBaseUrl?: string): Partial<RuntimeAssetSource> {
    const lookup = settings.textureImportSettings;
    return lookup ? { ...settings, textureImportSettings: playRealmTextureSettings(lookup, manifest, assetBaseUrl) } : settings;
}

/**
 * Cut the snapshot the way a cook would, or answer null when it is not a world.
 *
 * Here rather than on disk because the scene an author is playing may never
 * have been saved. Same `cutWorld`, so the cells and the manifest are what the
 * package would carry — only the documents stay in memory.
 */
export async function cutPlayWorld(
    scene: SceneData, sceneName: string, resolveRef: (ref: string) => string,
): Promise<CutWorld | null> {
    if (!streamedWorldDeclaration(scene)) return null;
    const resolvePrefab = await resolvePrefabRoots(scene, async (ref) => {
        const response = await fetch(resolveRef(ref));
        return response.ok ? await response.json() as unknown : null;
    });
    const cut = cutWorld(scene, sceneName, {
        // The realm's registry, which by now holds the project's own components
        // as well as the engine's — so a cross-cell reference a cook could not
        // see is found HERE, before it is packaged.
        entityFieldsOf: registryEntityFields(),
        resolvePrefab,
    });
    if (cut !== null && cut.errors.length > 0) {
        // Refused, not played whole: a world the editor agreed to run streamed is
        // one the author will ship, and this same cut fails the build.
        throw new Error(
            `scene "${sceneName}" cannot be cut into cells, so it cannot be played `
            + `as the streamed world it declares:\n`
            + cut.errors.map((e) => `  ${e}`).join('\n'),
        );
    }
    return cut;
}

/**
 * Give a cut world the far proxies a build would, when its `StreamedWorld` asks for them.
 *
 * Named on the manifest now and made by the same assembly a cook runs, simplified by `simplify` when the host lends the build's
 * simplifier, but each only when the streamer first fetches it: simplifying every cell before the game starts is a wait as long
 * as the world is large. The documents and meshes are served from `made` under the paths the manifest names.
 */
export async function addPlayFarProxies(
    cut: CutWorld, scene: SceneData, resolveRef: (ref: string) => string, made: PlayMade,
    simplify?: FarProxyHost['simplify'],
): Promise<void> {
    const settings = farProxySettings(scene);
    if (settings === null || settings.farDistance <= 0) return;
    const fetched = async (ref: string): Promise<Response | null> => {
        const response = await fetch(resolveRef(ref));
        return response.ok ? response : null;
    };
    const make = await deferFarProxies(cut, settings, {
        loadPrefab: async (ref) => (await (await fetched(ref))?.json() ?? null) as never,
        readMesh: async (ref) => {
            const response = await fetched(ref);
            return response ? decodeMesh(new Uint8Array(await response.arrayBuffer())) : null;
        },
        ...(simplify ? { simplify } : {}),
    });
    for (const cell of cut.manifest.cells) {
        if (!cell.proxy) continue;
        const document = async (): Promise<Uint8Array> => {
            const proxy = await make(cell.name);
            for (const { path, mesh } of proxy?.meshes ?? []) {
                const bytes = encodeMesh(mesh);
                made.bytes.set(path, bytes);
                made.bytes.set(resolveRef(path), bytes);
            }
            const empty: SceneData = { version: 4, name: farProxySceneName(cell.name), entities: [] };
            return new TextEncoder().encode(JSON.stringify(proxy?.document ?? empty));
        };
        made.later.set(cell.proxy, document);
        made.later.set(resolveRef(cell.proxy), document);
    }
}

/**
 * Boot the shipping runtime against an in-memory entry snapshot and the project's other authored scenes.
 */
export async function initPlayRealmRuntime(config: PlayRealmRuntimeConfig): Promise<void> {
    const { app, module, canvas, sceneData, assetManifest, assetBaseUrl } = config;
    const life = app.signal;
    const made: PlayMade = { bytes: new Map(), later: new Map() };
    const source = createPlayRealmSource(assetManifest, assetBaseUrl, config.assetPathMap, config.manifest,
                                         config.compressedTexture, made);
    const resolveRef = source.resolveRef;
    for (const { path, contents } of config.assetDocuments ?? []) {
        const bytes = new TextEncoder().encode(contents);
        made.bytes.set(path, bytes);
        made.bytes.set(resolveRef(path), bytes);
    }
    applyAssetRefResolvers(app, resolveRef);
    const entryName = config.entrySceneName ?? '__play';
    await initRuntime({
        app,
        module,
        source,
        manifest: config.manifest,
        remoteRoot: config.remoteRoot,
        persistUpdateKey: config.persistUpdateKey,
        catalog: config.catalogData ? Catalog.fromJson(config.catalogData) : undefined,
        scenes: [
            { name: entryName, data: sceneData },
            ...(config.extraScenes ?? []).filter((s) => s.name !== entryName),
        ],
        async prepareWorld(data, name) {
            const cut = await cutPlayWorld(data, name, resolveRef);
            if (cut) {
                life.throwIfAborted();
                await addPlayFarProxies(cut, data, resolveRef, made, config.simplifyFarProxy);
            }
            return cut;
        },
        firstScene: entryName,
        aspectRatio: canvas.width / canvas.height,
        ...runtimeProjectSettings(config),
    });
    // Per-phase / per-system frame timing for the editor profiler (enabled before
    // the loop starts so the runner instruments from frame zero).
    if (config.enableStats) app.enableStats();
    // Stopped while it loaded: the App was released, and running it now would bring the game
    // back with nothing left to stop it.
    life.throwIfAborted();
    await app.run();
}
