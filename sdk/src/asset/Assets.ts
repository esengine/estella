import type { Backend } from './Backend';
import { Catalog, type AtlasFrameInfo } from './Catalog';
import type {
    AssetLoader, LoadContext, TextureResult, SpineResult,
    MaterialResult, FontResult, AudioResult, AnimClipResult,
    TilemapResult, TimelineResult, PrefabResult,
} from './AssetLoader';
import { AsyncCache } from './AsyncCache';
import type { ESEngineModule } from '../wasm';
import type { CppResourceManager } from '../wasm';
import { requireResourceManager, evictTextureDimensions } from '../resourceManager';
import type { TextureImportSettings, TextureImportSettingsResolver } from './loaders/TextureLoader';
import { TextureLoader } from './loaders/TextureLoader';
import { SpineAssetLoader } from './loaders/SpineAssetLoader';
import { MaterialAssetLoader } from './loaders/MaterialAssetLoader';
import { FontAssetLoader } from './loaders/FontAssetLoader';
import { AudioAssetLoader } from './loaders/AudioAssetLoader';
import { AnimClipAssetLoader } from './loaders/AnimClipAssetLoader';
import { TilemapAssetLoader } from './loaders/TilemapAssetLoader';
import { TimelineAssetLoader } from './loaders/TimelineAssetLoader';
import { PrefabAssetLoader } from './loaders/PrefabAssetLoader';
import type { SpineModuleController } from '../spine/SpineController';
import { getAssetFields } from './AssetFieldRegistry';
import { discoverSceneAssets } from './discoverAssets';
import type { SceneData } from '../scene';
import { SceneHandle, type ReleaseCallback } from './SceneHandle';
import type { AssetRegistry } from './AssetRegistry';
import type { AssetRefCounter } from './AssetRefCounter';
import { log } from '../logger';

/** Callback fired when `Assets.invalidate(ref)` actually dropped cache entries. */
export type InvalidateListener = (ref: string) => void;

/**
 * Default upper bound on concurrent loads inside preloadSceneAssets.
 * Picked to match typical browser per-origin connection limits; scenes
 * with hundreds of assets would otherwise fan out all at once and
 * saturate the network, CPU image decoders, and WASM memory.
 */
const DEFAULT_PRELOAD_CONCURRENCY = 6;

/**
 * Run an array of lazy task thunks with at most `maxConcurrent` in
 * flight. Calls `onEach` once per task completion (success or failure)
 * so callers can drive a progress indicator. Never rejects — individual
 * task errors are expected to be handled inside the thunk itself.
 */
async function runWithConcurrency(
    tasks: ReadonlyArray<() => Promise<void>>,
    maxConcurrent: number,
    onEach: () => void,
): Promise<void> {
    if (tasks.length === 0) return;
    let cursor = 0;
    const workers: Promise<void>[] = [];
    const worker = async (): Promise<void> => {
        while (cursor < tasks.length) {
            const i = cursor++;
            try {
                await tasks[i]();
            } finally {
                onEach();
            }
        }
    };
    const slots = Math.min(maxConcurrent, tasks.length);
    for (let i = 0; i < slots; i++) {
        workers.push(worker());
    }
    await Promise.all(workers);
}

export interface AssetsOptions {
    backend: Backend;
    catalog?: Catalog;
    module: ESEngineModule;
    /**
     * Lazy accessor for the owning app's Audio API. AudioAssetLoader
     * calls it at load time so AssetPlugin and AudioPlugin can be built
     * in any order. Pass null (or omit) if no audio support is needed.
     */
    getAudio?: () => import('../audio/Audio').AudioAPI | null;
}

export interface AssetBundle {
    textures: Map<string, TextureResult>;
    materials: Map<string, MaterialResult>;
    spine: Map<string, SpineResult>;
    fonts: Map<string, FontResult>;
}

/**
 * Describes one asset a scene / prefab referenced that couldn't be
 * materialized into a usable handle. The caller of preloadSceneAssets
 * uses this to surface editor UI ("missing asset") or to abort the
 * load entirely — instead of the old behaviour of silently storing
 * `texture: 0` and hoping the renderer notices.
 */
export interface MissingAsset {
    /** The original serialized ref (`"@uuid:..."` or a plain path). */
    ref: string;
    /** Asset type (`"texture"`, `"material"`, ...) when known. */
    type?: string;
    /** `unresolved` = UUID not in registry; `load-failed` = fetch threw. */
    reason: 'unresolved' | 'load-failed';
    /** Stringified error for `load-failed`. */
    error?: string;
}

export interface SceneAssetResult {
    textureHandles: Map<string, number>;
    materialHandles: Map<string, number>;
    fontHandles: Map<string, number>;
    releaseCallbacks: ReleaseCallback[];
    missing: MissingAsset[];
}

export type AssetRefResolver = (ref: string) => string | null;

export class Assets {
    readonly backend: Backend;
    readonly catalog: Catalog;

    get baseUrl(): string | undefined { return this.baseUrl_; }
    set baseUrl(url: string | undefined) {
        this.baseUrl_ = url;
        if (this.backend.setBaseUrl) {
            this.backend.setBaseUrl(url ?? '');
        }
    }
    private baseUrl_?: string;

    private module_: ESEngineModule;
    private getAudio_: () => import('../audio/Audio').AudioAPI | null;
    private loaders_ = new Map<string, AssetLoader<unknown>>();
    private textureLoader_: TextureLoader;
    private textureImportResolver_: TextureImportSettingsResolver | null = null;
    private spineLoader_: SpineAssetLoader;

    private textureCache_ = new AsyncCache<TextureResult>();
    private textureRefCounts_ = new Map<string, number>();
    private genericCache_ = new Map<string, AsyncCache<unknown>>();
    private loadContext_: LoadContext | null = null;
    private assetRefResolver_: AssetRefResolver | null = null;
    private assetRegistry_: AssetRegistry | null = null;
    private refCounter_: AssetRefCounter | null = null;
    private invalidateListeners_ = new Set<InvalidateListener>();

    private constructor(options: AssetsOptions) {
        this.backend = options.backend;
        this.catalog = options.catalog ?? Catalog.empty();
        this.module_ = options.module;
        this.getAudio_ = options.getAudio ?? (() => null);

        this.textureLoader_ = new TextureLoader(options.module);
        this.spineLoader_ = new SpineAssetLoader(options.module);

        this.registerBuiltinLoaders();
    }

    static create(options: AssetsOptions): Assets {
        return new Assets(options);
    }

    // =========================================================================
    // Loader Registry
    // =========================================================================

    register<T>(loader: AssetLoader<T>): void {
        this.loaders_.set(loader.type, loader as AssetLoader<unknown>);
    }

    getLoader<T>(type: string): AssetLoader<T> | undefined {
        return this.loaders_.get(type) as AssetLoader<T> | undefined;
    }

    // =========================================================================
    // Typed Load Methods (User API)
    // =========================================================================

    async loadTexture(ref: string): Promise<TextureResult> {
        const path = this.resolveLoadPath_(ref);
        const cacheKey = this.textureCacheKey_(path, true);
        const settings = this.textureImportResolver_?.(ref);
        const result = await this.textureCache_.getOrLoad(cacheKey, () => {
            this.textureLoader_.setPendingSettings(settings);
            return this.textureLoader_.load(path, this.getLoadContext_());
        });
        this.textureRefCounts_.set(cacheKey, (this.textureRefCounts_.get(cacheKey) ?? 0) + 1);
        return result;
    }

    async loadTextureRaw(ref: string): Promise<TextureResult> {
        const path = this.resolveLoadPath_(ref);
        const cacheKey = this.textureCacheKey_(path, false);
        const settings = this.textureImportResolver_?.(ref);
        const result = await this.textureCache_.getOrLoad(cacheKey, () => {
            this.textureLoader_.setPendingSettings(settings);
            return this.textureLoader_.loadRaw(path, this.getLoadContext_());
        });
        this.textureRefCounts_.set(cacheKey, (this.textureRefCounts_.get(cacheKey) ?? 0) + 1);
        return result;
    }

    /**
     * Provide per-asset texture import settings at load time (filter, wrap,
     * mipmaps). The resolver is called with the original ref — keyed off
     * `@uuid:...` in editor scenarios. Returning `undefined` uses defaults.
     */
    setTextureImportSettingsResolver(resolver: TextureImportSettingsResolver | null): void {
        this.textureImportResolver_ = resolver;
    }

    getTexture(ref: string): TextureResult | undefined {
        const path = this.resolveLoadPath_(ref);
        return this.textureCache_.get(this.textureCacheKey_(path, true));
    }

    async loadSpine(skeletonRef: string, atlasRef?: string): Promise<SpineResult> {
        const skelPath = this.resolveLoadPath_(skeletonRef);
        const ctx = this.getLoadContext_();
        if (atlasRef) {
            const atlasPath = this.resolveLoadPath_(atlasRef);
            return this.spineLoader_.loadWithAtlas(skelPath, atlasPath, ctx);
        }
        return this.spineLoader_.load(skelPath, ctx);
    }

    async loadMaterial(ref: string): Promise<MaterialResult> {
        return this.loadTyped('material', ref);
    }

    async loadFont(ref: string): Promise<FontResult> {
        return this.loadTyped('font', ref);
    }

    async loadAudio(ref: string): Promise<AudioResult> {
        return this.loadTyped('audio', ref);
    }

    async loadAnimClip(ref: string): Promise<AnimClipResult> {
        return this.loadTyped('anim-clip', ref);
    }

    async loadTilemap(ref: string): Promise<TilemapResult> {
        return this.loadTyped('tilemap', ref);
    }

    async loadTimeline(ref: string): Promise<TimelineResult> {
        return this.loadTyped('timeline', ref);
    }

    async loadPrefab(ref: string): Promise<PrefabResult> {
        return this.loadTyped('prefab', ref);
    }

    // =========================================================================
    // Generic Load (for custom loaders)
    // =========================================================================

    async load<T>(type: string, ref: string): Promise<T> {
        return this.loadTyped<T>(type, ref);
    }

    // =========================================================================
    // Atlas Query
    // =========================================================================

    getAtlasFrame(ref: string): AtlasFrameInfo | null {
        const path = this.resolveLoadPath_(ref);
        return this.catalog.getAtlasFrame(path);
    }

    // =========================================================================
    // Label Batch Load
    // =========================================================================

    async loadByLabel(
        label: string,
        onProgress?: (loaded: number, total: number) => void,
    ): Promise<AssetBundle> {
        const paths = this.catalog.getByLabel(label);
        const bundle: AssetBundle = {
            textures: new Map(),
            materials: new Map(),
            spine: new Map(),
            fonts: new Map(),
        };

        let loadedCount = 0;
        const promises: Promise<void>[] = [];

        const track = (p: Promise<void>): Promise<void> =>
            p.then(() => { onProgress?.(++loadedCount, totalCount); })
             .catch(() => { onProgress?.(++loadedCount, totalCount); });

        for (const path of paths) {
            const entry = this.catalog.getEntry(path);
            if (!entry) continue;

            switch (entry.type) {
                case 'texture':
                    promises.push(track(
                        this.loadTexture(path).then(r => { bundle.textures.set(path, r); }),
                    ));
                    break;
                case 'material':
                    promises.push(track(
                        this.loadMaterial(path).then(r => { bundle.materials.set(path, r); }),
                    ));
                    break;
                case 'spine':
                    promises.push(track(
                        this.loadSpine(path).then(r => { bundle.spine.set(path, r); }),
                    ));
                    break;
                case 'font':
                    promises.push(track(
                        this.loadFont(path).then(r => { bundle.fonts.set(path, r); }),
                    ));
                    break;
            }
        }

        const totalCount = promises.length;
        onProgress?.(0, totalCount);
        loadedCount = 0;

        await Promise.allSettled(promises);
        return bundle;
    }

    // =========================================================================
    // Raw Data (escape hatch)
    // =========================================================================

    async fetchJson<T = unknown>(ref: string): Promise<T> {
        const path = this.resolveLoadPath_(ref);
        const url = this.backend.resolveUrl(this.catalog.getBuildPath(path));
        const text = await this.backend.fetchText(url);
        return JSON.parse(text) as T;
    }

    async fetchBinary(ref: string): Promise<ArrayBuffer> {
        const path = this.resolveLoadPath_(ref);
        const url = this.backend.resolveUrl(this.catalog.getBuildPath(path));
        return this.backend.fetchBinary(url);
    }

    async fetchText(ref: string): Promise<string> {
        const path = this.resolveLoadPath_(ref);
        const url = this.backend.resolveUrl(this.catalog.getBuildPath(path));
        return this.backend.fetchText(url);
    }

    // =========================================================================
    // Scene Asset Preloading
    // =========================================================================

    async preloadSceneAssets(
        sceneData: SceneData,
        onProgress?: (loaded: number, total: number) => void,
        options?: { readonly maxConcurrent?: number },
    ): Promise<SceneAssetResult> {
        const missing: MissingAsset[] = [];
        const discovered = discoverSceneAssets(sceneData, (ref) => this.resolveRef(ref));
        for (const ref of discovered.unresolved) {
            missing.push({ ref, reason: 'unresolved' });
        }
        if (discovered.unresolved.length > 0) {
            log.warn(
                'asset',
                `${discovered.unresolved.length} unresolved asset ref(s)`,
                discovered.unresolved,
            );
        }
        const texturePaths = discovered.byType.get('texture') ?? new Set<string>();
        const materialPaths = discovered.byType.get('material') ?? new Set<string>();
        const fontPaths = discovered.byType.get('font') ?? new Set<string>();
        const animClipPaths = discovered.byType.get('anim-clip') ?? new Set<string>();
        const audioPaths = discovered.byType.get('audio') ?? new Set<string>();
        const tilemapPaths = discovered.byType.get('tilemap') ?? new Set<string>();
        const timelinePaths = discovered.byType.get('timeline') ?? new Set<string>();
        const spinePairs = discovered.spines;

        const textureHandles = new Map<string, number>();
        const materialHandles = new Map<string, number>();
        const fontHandles = new Map<string, number>();
        const releaseCallbacks: ReleaseCallback[] = [];

        let loadedCount = 0;

        const recordFailure = (path: string, label: string, err: unknown): void => {
            missing.push({
                ref: path,
                type: label,
                reason: 'load-failed',
                error: err instanceof Error ? err.message : String(err),
            });
        };

        // Build task thunks instead of starting the promises eagerly — the
        // worker pool below calls them one at a time per slot so a scene
        // with hundreds of assets doesn't saturate the network or tie up
        // image decoders all at once.
        const tasks: Array<() => Promise<void>> = [];
        const pushHandleLoad = (
            paths: Set<string>, loader: (p: string) => Promise<{ handle: number }>,
            handles: Map<string, number>, label: string,
        ): void => {
            for (const path of paths) {
                tasks.push(() =>
                    loader(path).then(r => { handles.set(path, r.handle); }).catch(e => {
                        log.warn('asset', `Failed to load ${label}: ${path}`, e);
                        handles.set(path, 0);
                        recordFailure(path, label, e);
                    }),
                );
            }
        };
        const pushFireAndForget = (
            paths: Set<string>, loader: (p: string) => Promise<unknown>, label: string,
        ): void => {
            for (const path of paths) {
                tasks.push(() =>
                    loader(path).then(() => {}).catch(e => {
                        log.warn('asset', `Failed to load ${label}: ${path}`, e);
                        recordFailure(path, label, e);
                    }),
                );
            }
        };

        pushHandleLoad(texturePaths, p => this.loadTexture(p), textureHandles, 'texture');
        pushHandleLoad(materialPaths, p => this.loadMaterial(p), materialHandles, 'material');
        pushHandleLoad(fontPaths, p => this.loadFont(p), fontHandles, 'font');
        for (const pair of spinePairs) {
            tasks.push(() =>
                this.loadSpine(pair.skeleton, pair.atlas).then(() => {}).catch(e => {
                    log.warn('asset', `Failed to load spine: ${pair.skeleton}`, e);
                    recordFailure(pair.skeleton, 'spine', e);
                }),
            );
        }
        pushFireAndForget(animClipPaths, p => this.loadAnimClip(p), 'anim-clip');
        pushFireAndForget(tilemapPaths, p => this.loadTilemap(p), 'tilemap');
        pushFireAndForget(timelinePaths, p => this.loadTimeline(p), 'timeline');
        pushFireAndForget(audioPaths, p => this.loadAudio(p), 'audio');

        const totalCount = tasks.length;
        onProgress?.(0, totalCount);

        const maxConcurrent = Math.max(1, options?.maxConcurrent ?? DEFAULT_PRELOAD_CONCURRENCY);
        await runWithConcurrency(tasks, maxConcurrent, () => {
            onProgress?.(++loadedCount, totalCount);
        });

        return { textureHandles, materialHandles, fontHandles, releaseCallbacks, missing };
    }

    resolveSceneAssetPaths(sceneData: SceneData, result: SceneAssetResult): void {
        const { textureHandles, materialHandles, fontHandles } = result;
        const counter = this.refCounter_;

        for (const entity of sceneData.entities) {
            for (const comp of entity.components) {
                const fields = getAssetFields(comp.type);
                for (const { field, type } of fields) {
                    const ref = comp.data[field];
                    if (typeof ref !== 'string' || !ref) continue;

                    // UUID refs resolve to their current path; plain paths
                    // pass through. Unknown UUID → null, handle will be 0
                    // (caller's getter returns 0 when the key is missing).
                    const path = this.resolveRef(ref);
                    if (path == null) {
                        comp.data[field] = 0;
                        continue;
                    }

                    switch (type) {
                        case 'texture': {
                            const handle = textureHandles.get(path) ?? 0;
                            comp.data[field] = handle;
                            if (counter && handle) counter.addTextureRef(path, entity.id);
                            const atlasInfo = this.catalog.getAtlasFrame(path);
                            if (atlasInfo) {
                                comp.data['uvOffset'] = { x: atlasInfo.uvOffset[0], y: atlasInfo.uvOffset[1] };
                                comp.data['uvScale'] = { x: atlasInfo.uvScale[0], y: atlasInfo.uvScale[1] };
                                if (atlasInfo.trim) {
                                    comp.data['_trimOffsetX'] = atlasInfo.trim.offsetX;
                                    comp.data['_trimOffsetY'] = atlasInfo.trim.offsetY;
                                    comp.data['_trimSourceW'] = atlasInfo.trim.sourceW;
                                    comp.data['_trimSourceH'] = atlasInfo.trim.sourceH;
                                }
                            }
                            break;
                        }
                        case 'material': {
                            const handle = materialHandles.get(path) ?? 0;
                            comp.data[field] = handle;
                            if (counter && handle) counter.addMaterialRef(path, entity.id);
                            break;
                        }
                        case 'font': {
                            const handle = fontHandles.get(path) ?? 0;
                            comp.data[field] = handle;
                            if (counter && handle) counter.addFontRef(path, entity.id);
                            break;
                        }
                    }
                }
            }
        }
    }

    // =========================================================================
    // Release
    // =========================================================================

    releaseTexture(ref: string): void {
        const path = this.resolveLoadPath_(ref);
        for (const flip of [true, false]) {
            const key = this.textureCacheKey_(path, flip);
            const count = this.textureRefCounts_.get(key);
            if (count === undefined) continue;

            const info = this.textureCache_.get(key);
            if (!info) continue;

            const newCount = count - 1;
            if (newCount <= 0) {
                const rm = requireResourceManager();
                rm.releaseTexture(info.handle);
                evictTextureDimensions(info.handle);
                this.textureCache_.delete(key);
                this.textureRefCounts_.delete(key);
            } else {
                this.textureRefCounts_.set(key, newCount);
            }
        }
    }

    releaseFont(ref: string): void {
        this.releaseTyped('font', ref);
    }

    releaseAudio(ref: string): void {
        this.releaseTyped('audio', ref);
    }

    releaseAnimClip(ref: string): void {
        this.releaseTyped('anim-clip', ref);
    }

    releaseTimeline(ref: string): void {
        this.releaseTyped('timeline', ref);
    }

    releaseTilemap(ref: string): void {
        this.releaseTyped('tilemap', ref);
    }

    releasePrefab(ref: string): void {
        this.releaseTyped('prefab', ref);
    }

    private releaseTyped(type: string, ref: string): void {
        const path = this.resolveLoadPath_(ref);
        const cache = this.genericCache_.get(type);
        if (!cache) return;
        const entry = cache.get(path);
        if (entry) {
            const loader = this.loaders_.get(type);
            loader?.unload(entry);
            cache.delete(path);
        }
    }

    /**
     * Drop every internal cache entry for `ref` so the next `loadTexture` /
     * `loadMaterial` / ... fetches fresh bytes. Call this when the source
     * file changed on disk (hot reload).
     *
     * Any GPU handle that was already handed out stays valid and keeps
     * rendering — that's the caller's concern to release. The next load
     * produces a brand-new handle from the updated bytes; the old handle
     * is evicted from the cache but not freed, so currently-rendering
     * entities don't flicker.
     *
     * If any cache held `ref`, invokes every listener registered via
     * `onInvalidate` with the original ref. Listeners that throw are
     * caught and logged — one bad subscriber can't prevent other
     * subscribers from observing the invalidation.
     *
     * Returns true if any cache held `ref`.
     */
    invalidate(ref: string): boolean {
        const path = this.resolveRef(ref) ?? ref;
        let hit = false;

        // Textures: cache_key has a flip flag suffix, so check both.
        for (const flip of [true, false]) {
            const key = this.textureCacheKey_(path, flip);
            if (this.textureCache_.invalidate(key)) hit = true;
            if (this.textureRefCounts_.delete(key)) hit = true;
        }

        // Generic caches: material / font / anim-clip / tilemap / timeline / audio / prefab.
        for (const cache of this.genericCache_.values()) {
            if (cache.invalidate(path)) hit = true;
        }

        if (hit) {
            for (const listener of this.invalidateListeners_) {
                try {
                    listener(ref);
                } catch (e) {
                    log.warn('asset', 'onInvalidate listener threw', e);
                }
            }
        }

        return hit;
    }

    /**
     * Subscribe to cache invalidations. The listener fires once per
     * successful `invalidate(ref)` call with the original ref (not the
     * resolved path). Returns an unsubscribe function.
     *
     * Typical use: a scene-graph controller or renderer that holds cached
     * handles for assets — subscribe to re-bind / re-load on hot reload
     * so stale GPU handles stop being rendered.
     */
    onInvalidate(listener: InvalidateListener): () => void {
        this.invalidateListeners_.add(listener);
        return () => {
            this.invalidateListeners_.delete(listener);
        };
    }

    releaseAll(): void {
        const rm = requireResourceManager();
        for (const info of this.textureCache_.values()) {
            rm.releaseTexture(info.handle);
            evictTextureDimensions(info.handle);
        }
        this.textureCache_.clearAll();
        this.textureRefCounts_.clear();

        this.spineLoader_.releaseAll();
        this.materialLoader_?.releaseAll();

        for (const cache of this.genericCache_.values()) {
            cache.clearAll();
        }
        this.genericCache_.clear();
    }

    // =========================================================================
    // Spine Controller
    // =========================================================================

    setSpineController(controller: SpineModuleController): void {
        this.spineLoader_.setSpineController(controller);
    }

    getSpineLoader(): SpineAssetLoader {
        return this.spineLoader_;
    }

    getTextureLoader(): TextureLoader {
        return this.textureLoader_;
    }

    setAssetRefResolver(resolver: AssetRefResolver): void {
        this.assetRefResolver_ = resolver;
    }

    getAssetRefResolver(): AssetRefResolver | null {
        return this.assetRefResolver_;
    }

    /**
     * Attach an AssetRegistry so that scene/prefab refs of the form
     * `"@uuid:..."` are resolved to current paths before loading.
     * Convenience over `setAssetRefResolver`: sets the resolver to
     * `registry.resolveRef`.
     */
    setAssetRegistry(registry: AssetRegistry): void {
        this.assetRegistry_ = registry;
        this.assetRefResolver_ = (ref) => registry.resolveRef(ref);
    }

    getAssetRegistry(): AssetRegistry | null {
        return this.assetRegistry_;
    }

    /**
     * Attach an AssetRefCounter. When set, resolveSceneAssetPaths records
     * which entity references which texture/material/font path as it
     * hands out handles. Paired with `world.onDespawn(e =>
     * counter.removeAllRefsForEntity(e))` — which AssetPlugin installs
     * — this gives editor tools visibility into "who's holding X" and
     * "does anything still need this asset?". Optional; null means no
     * tracking (default, zero overhead).
     */
    setRefCounter(counter: AssetRefCounter): void {
        this.refCounter_ = counter;
    }

    getRefCounter(): AssetRefCounter | null {
        return this.refCounter_;
    }

    /**
     * Resolve any serialized asset ref (UUID or plain path) to a concrete
     * path. Returns null when a UUID ref can't be matched to a known
     * asset. Without a registry/resolver configured, refs pass through
     * unchanged — legacy path-only scenes keep working.
     */
    resolveRef(ref: string): string | null {
        if (this.assetRefResolver_) return this.assetRefResolver_(ref);
        return ref;
    }

    /**
     * Canonical path-resolution for all typed load methods.
     * Runs the AssetRefResolver first so `@uuid:...` refs map to their real
     * project path, then applies the addressable Catalog for any further
     * indirection. If the resolver returns null (unknown UUID), we fall back
     * to the Catalog on the original ref — the loader will 404 with a clear
     * error rather than silently succeeding on a nonsense URL.
     *
     * Historically each load method called `this.catalog.resolve(ref)`
     * directly, which completely bypassed the AssetRefResolver. Editors that
     * serialized asset refs as `@uuid:...` could never resolve them at load
     * time — textures silently rendered white. This helper closes that gap.
     */
    private resolveLoadPath_(ref: string): string {
        const resolved = this.assetRefResolver_?.(ref) ?? ref;
        return this.catalog.resolve(resolved);
    }

    // =========================================================================
    // Private
    // =========================================================================

    private materialLoader_: MaterialAssetLoader | null = null;

    private registerBuiltinLoaders(): void {
        this.register(this.textureLoader_);
        this.register(this.spineLoader_);
        this.materialLoader_ = new MaterialAssetLoader();
        this.register(this.materialLoader_);
        this.register(new FontAssetLoader());
        this.register(new AudioAssetLoader());
        this.register(new AnimClipAssetLoader());
        this.register(new TilemapAssetLoader());
        this.register(new TimelineAssetLoader());
        this.register(new PrefabAssetLoader());
    }

    private textureCacheKey_(path: string, flip: boolean): string {
        return `${path}:${flip ? 'f' : 'n'}`;
    }

    private async loadTyped<T>(type: string, ref: string): Promise<T> {
        const loader = this.loaders_.get(type) as AssetLoader<T> | undefined;
        if (!loader) {
            throw new Error(`No loader registered for type: ${type}`);
        }
        const path = this.resolveLoadPath_(ref);

        let cache = this.genericCache_.get(type);
        if (!cache) {
            cache = new AsyncCache<unknown>();
            this.genericCache_.set(type, cache);
        }

        return cache.getOrLoad(path, () =>
            loader.load(path, this.getLoadContext_()),
        ) as Promise<T>;
    }

    private getLoadContext_(): LoadContext {
        if (this.loadContext_) return this.loadContext_;
        const self = this;
        this.loadContext_ = {
            backend: this.backend,
            catalog: this.catalog,
            resourceManager: requireResourceManager() as CppResourceManager,
            async loadTexture(path: string, flipY?: boolean): Promise<TextureResult> {
                if (flipY === false) {
                    return self.loadTextureRaw(path);
                }
                return self.loadTexture(path);
            },
            async loadText(path: string): Promise<string> {
                return self.backend.fetchText(self.backend.resolveUrl(path));
            },
            async loadBinary(path: string): Promise<ArrayBuffer> {
                return self.backend.fetchBinary(self.backend.resolveUrl(path));
            },
            getAudio() {
                return self.getAudio_();
            },
        };
        return this.loadContext_;
    }
}
