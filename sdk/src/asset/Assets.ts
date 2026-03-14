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
import {
    getAssetFields, getCompoundAssetFields,
} from './AssetFieldRegistry';
import type { SceneData } from '../scene';
import { SceneHandle, type ReleaseCallback } from './SceneHandle';

export interface AssetsOptions {
    backend: Backend;
    catalog?: Catalog;
    module: ESEngineModule;
}

export interface AssetBundle {
    textures: Map<string, TextureResult>;
    materials: Map<string, MaterialResult>;
    spine: Map<string, SpineResult>;
    fonts: Map<string, FontResult>;
}

export interface SceneAssetResult {
    textureHandles: Map<string, number>;
    materialHandles: Map<string, number>;
    fontHandles: Map<string, number>;
    releaseCallbacks: ReleaseCallback[];
}

export class Assets {
    readonly backend: Backend;
    readonly catalog: Catalog;

    private module_: ESEngineModule;
    private loaders_ = new Map<string, AssetLoader<unknown>>();
    private textureLoader_: TextureLoader;
    private spineLoader_: SpineAssetLoader;

    private textureCache_ = new AsyncCache<TextureResult>();
    private textureRefCounts_ = new Map<string, number>();
    private genericCache_ = new Map<string, AsyncCache<unknown>>();
    private loadContext_: LoadContext | null = null;

    private constructor(options: AssetsOptions) {
        this.backend = options.backend;
        this.catalog = options.catalog ?? Catalog.empty();
        this.module_ = options.module;

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
        const path = this.catalog.resolve(ref);
        const cacheKey = this.textureCacheKey_(path, true);
        const result = await this.textureCache_.getOrLoad(cacheKey, () =>
            this.textureLoader_.load(path, this.getLoadContext_()),
        );
        this.textureRefCounts_.set(cacheKey, (this.textureRefCounts_.get(cacheKey) ?? 0) + 1);
        return result;
    }

    async loadTextureRaw(ref: string): Promise<TextureResult> {
        const path = this.catalog.resolve(ref);
        const cacheKey = this.textureCacheKey_(path, false);
        const result = await this.textureCache_.getOrLoad(cacheKey, () =>
            this.textureLoader_.loadRaw(path, this.getLoadContext_()),
        );
        this.textureRefCounts_.set(cacheKey, (this.textureRefCounts_.get(cacheKey) ?? 0) + 1);
        return result;
    }

    getTexture(ref: string): TextureResult | undefined {
        const path = this.catalog.resolve(ref);
        return this.textureCache_.get(this.textureCacheKey_(path, true));
    }

    async loadSpine(skeletonRef: string, atlasRef?: string): Promise<SpineResult> {
        const skelPath = this.catalog.resolve(skeletonRef);
        const ctx = this.getLoadContext_();
        if (atlasRef) {
            const atlasPath = this.catalog.resolve(atlasRef);
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
        const path = this.catalog.resolve(ref);
        return this.catalog.getAtlasFrame(path);
    }

    // =========================================================================
    // Label Batch Load
    // =========================================================================

    async loadByLabel(label: string): Promise<AssetBundle> {
        const paths = this.catalog.getByLabel(label);
        const bundle: AssetBundle = {
            textures: new Map(),
            materials: new Map(),
            spine: new Map(),
            fonts: new Map(),
        };

        const promises: Promise<void>[] = [];
        for (const path of paths) {
            const entry = this.catalog.getEntry(path);
            if (!entry) continue;

            switch (entry.type) {
                case 'texture':
                    promises.push(
                        this.loadTexture(path).then(r => { bundle.textures.set(path, r); }),
                    );
                    break;
                case 'material':
                    promises.push(
                        this.loadMaterial(path).then(r => { bundle.materials.set(path, r); }),
                    );
                    break;
                case 'spine':
                    promises.push(
                        this.loadSpine(path).then(r => { bundle.spine.set(path, r); }),
                    );
                    break;
                case 'font':
                    promises.push(
                        this.loadFont(path).then(r => { bundle.fonts.set(path, r); }),
                    );
                    break;
            }
        }

        await Promise.allSettled(promises);
        return bundle;
    }

    // =========================================================================
    // Raw Data (escape hatch)
    // =========================================================================

    async fetchJson<T = unknown>(ref: string): Promise<T> {
        const path = this.catalog.resolve(ref);
        const buildPath = this.catalog.getBuildPath(path);
        const text = await this.backend.fetchText(buildPath);
        return JSON.parse(text) as T;
    }

    async fetchBinary(ref: string): Promise<ArrayBuffer> {
        const path = this.catalog.resolve(ref);
        const buildPath = this.catalog.getBuildPath(path);
        return this.backend.fetchBinary(buildPath);
    }

    async fetchText(ref: string): Promise<string> {
        const path = this.catalog.resolve(ref);
        const buildPath = this.catalog.getBuildPath(path);
        return this.backend.fetchText(buildPath);
    }

    // =========================================================================
    // Scene Asset Preloading
    // =========================================================================

    async preloadSceneAssets(sceneData: SceneData): Promise<SceneAssetResult> {
        const texturePaths = new Set<string>();
        const materialPaths = new Set<string>();
        const fontPaths = new Set<string>();
        const animClipPaths = new Set<string>();
        const audioPaths = new Set<string>();
        const tilemapPaths = new Set<string>();
        const timelinePaths = new Set<string>();
        const spinePairs: Array<{ skeleton: string; atlas: string }> = [];

        for (const entity of sceneData.entities) {
            for (const comp of entity.components) {
                const fields = getAssetFields(comp.type);
                for (const { field, type } of fields) {
                    const value = comp.data[field];
                    if (typeof value !== 'string' || !value) continue;
                    switch (type) {
                        case 'texture': texturePaths.add(value); break;
                        case 'material': materialPaths.add(value); break;
                        case 'font': fontPaths.add(value); break;
                        case 'anim-clip': animClipPaths.add(value); break;
                        case 'audio': audioPaths.add(value); break;
                        case 'tilemap': tilemapPaths.add(value); break;
                        case 'timeline': timelinePaths.add(value); break;
                    }
                }

                const compounds = getCompoundAssetFields(comp.type);
                for (const compound of compounds) {
                    if (compound.type === 'spine') {
                        const skeleton = comp.data[compound.fields.skeleton] as string;
                        const atlas = comp.data[compound.fields.atlas] as string;
                        if (skeleton && atlas) {
                            spinePairs.push({ skeleton, atlas });
                        }
                    }
                }
            }
        }

        const textureHandles = new Map<string, number>();
        const materialHandles = new Map<string, number>();
        const fontHandles = new Map<string, number>();
        const releaseCallbacks: ReleaseCallback[] = [];

        const loadHandles = (
            paths: Set<string>, loader: (p: string) => Promise<{ handle: number }>,
            handles: Map<string, number>, label: string,
        ): Promise<void>[] =>
            [...paths].map(path =>
                loader(path).then(r => { handles.set(path, r.handle); }).catch(e => {
                    console.warn(`[Assets] Failed to load ${label}: ${path}`, e);
                    handles.set(path, 0);
                }),
            );

        const loadFireAndForget = (
            paths: Set<string>, loader: (p: string) => Promise<unknown>, label: string,
        ): Promise<void>[] =>
            [...paths].map(path =>
                loader(path).then(() => {}).catch(e => {
                    console.warn(`[Assets] Failed to load ${label}: ${path}`, e);
                }),
            );

        const promises: Promise<void>[] = [
            ...loadHandles(texturePaths, p => this.loadTexture(p), textureHandles, 'texture'),
            ...loadHandles(materialPaths, p => this.loadMaterial(p), materialHandles, 'material'),
            ...loadHandles(fontPaths, p => this.loadFont(p), fontHandles, 'font'),
            ...spinePairs.map(pair =>
                this.loadSpine(pair.skeleton, pair.atlas).then(() => {}).catch(e => {
                    console.warn(`[Assets] Failed to load spine: ${pair.skeleton}`, e);
                }),
            ),
            ...loadFireAndForget(animClipPaths, p => this.loadAnimClip(p), 'anim-clip'),
            ...loadFireAndForget(tilemapPaths, p => this.loadTilemap(p), 'tilemap'),
            ...loadFireAndForget(timelinePaths, p => this.loadTimeline(p), 'timeline'),
            ...loadFireAndForget(audioPaths, p => this.loadAudio(p), 'audio'),
        ];

        await Promise.all(promises);

        return { textureHandles, materialHandles, fontHandles, releaseCallbacks };
    }

    resolveSceneAssetPaths(sceneData: SceneData, result: SceneAssetResult): void {
        const { textureHandles, materialHandles, fontHandles } = result;

        for (const entity of sceneData.entities) {
            for (const comp of entity.components) {
                const fields = getAssetFields(comp.type);
                for (const { field, type } of fields) {
                    const value = comp.data[field];
                    if (typeof value !== 'string' || !value) continue;

                    switch (type) {
                        case 'texture': {
                            comp.data[field] = textureHandles.get(value) ?? 0;
                            const atlasInfo = this.catalog.getAtlasFrame(value);
                            if (atlasInfo) {
                                comp.data['uvOffset'] = { x: atlasInfo.uvOffset[0], y: atlasInfo.uvOffset[1] };
                                comp.data['uvScale'] = { x: atlasInfo.uvScale[0], y: atlasInfo.uvScale[1] };
                            }
                            break;
                        }
                        case 'material':
                            comp.data[field] = materialHandles.get(value) ?? 0;
                            break;
                        case 'font':
                            comp.data[field] = fontHandles.get(value) ?? 0;
                            break;
                    }
                }
            }
        }
    }

    // =========================================================================
    // Release
    // =========================================================================

    releaseTexture(ref: string): void {
        const path = this.catalog.resolve(ref);
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
        const path = this.catalog.resolve(ref);

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
        };
        return this.loadContext_;
    }
}
