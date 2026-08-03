// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { Backend } from './Backend';
import { Catalog, type AtlasFrameInfo } from './Catalog';
import { ManifestModel, normalizeBundleMode, type AddressableManifest } from './AddressableManifest';
import { diffManifests, type UpdatePlan, type AssetChange } from './hotUpdate';
import { contentHashHex } from './contentHash';
import { platformLoadSubpackage, platformGetStorageItem, platformSetStorageItem, platformWriteCacheFile } from '../platform';
import type {
    AssetLoader, LoadContext, TextureResult, SpineResult,
    MaterialResult, FontResult, AudioResult, AnimClipResult,
    TilemapResult, TilesetResult, TimelineResult, PrefabResult,
    LocaleResult, FsmResult, BtResult, AnimatorControllerResult, JsonResult,
} from './AssetLoader';
import { AsyncCache } from './AsyncCache';
import type { ESEngineModule } from '../wasm';
import type { CppResourceManager } from '../wasm';
import { requireResourceManager, getResourceManager, evictTextureDimensions } from '../wasm/resourceManager';
import type { TextureImportSettings, TextureImportSettingsResolver } from './loaders/TextureLoader';
import { TextureLoader, textureResidencyKey } from './loaders/TextureLoader';
import { SpineAssetLoader } from './loaders/SpineAssetLoader';
import { MaterialAssetLoader } from './loaders/MaterialAssetLoader';
import { FontAssetLoader } from './loaders/FontAssetLoader';
import { AudioAssetLoader } from './loaders/AudioAssetLoader';
import { AnimClipAssetLoader } from './loaders/AnimClipAssetLoader';
import { TilemapAssetLoader } from './loaders/TilemapAssetLoader';
import { TilesetAssetLoader } from './loaders/TilesetAssetLoader';
import { TimelineAssetLoader } from './loaders/TimelineAssetLoader';
import { PrefabAssetLoader } from './loaders/PrefabAssetLoader';
import { FsmAssetLoader } from './loaders/FsmAssetLoader';
import { AnimatorControllerAssetLoader } from './loaders/AnimatorControllerAssetLoader';
import { BtAssetLoader } from './loaders/BtAssetLoader';
import { LocaleAssetLoader } from './loaders/LocaleAssetLoader';
import { JsonAssetLoader } from './loaders/JsonAssetLoader';
import type { SpineModuleController } from '../spine/SpineController';
import { getComponentDefaults } from '../ecs/component';
import { getComponentAssetFieldDescriptors } from '../scene/scene';
import { discoverSceneAssets } from './discoverAssets';
import { fetchDecodePixels } from './imageDecode';
import type { SceneData } from '../scene/scene';
import { SceneHandle, type ReleaseCallback } from './SceneHandle';
import type { AssetRegistry } from './AssetRegistry';
import { UUID_REF_PREFIX } from './AssetRegistry';
import type { AssetRefCounter } from './AssetRefCounter';
import { log } from '../util/logger';

/** Callback fired when `Assets.invalidate(ref)` actually dropped cache entries.
 *  `oldTextureHandle` is the texture handle that was bound before the drop (0 when
 *  none / not a texture) — the built-in rebinder swaps it to the reloaded handle. */
export type InvalidateListener = (ref: string, oldTextureHandle?: number) => void;

/** Input to {@link Assets.checkForUpdate}. */
export interface CheckForUpdateOptions {
    /** Url of the candidate (remote) manifest JSON — diffed against the active one. */
    manifestUrl: string;
    /** CDN root the candidate's `remote`-group assets are served from; remembered
     *  and applied by {@link Assets.applyUpdate}. Defaults to the current root. */
    remoteRoot?: string;
}

/** One asset {@link Assets.applyUpdate} could not deliver: `fetch` (download
 *  failed) or `integrity` (bytes' content hash ≠ the manifest's). */
export interface AssetDownloadFailure {
    path: string;
    reason: 'fetch' | 'integrity';
}

/** Outcome of {@link Assets.applyUpdate} — atomic: `ok` only when every changed
 *  asset downloaded + verified and the manifest was swapped. On failure nothing
 *  is applied (`updated: 0`) and `failed` lists why (rollback). */
export interface ApplyUpdateResult {
    ok: boolean;
    updated: number;
    failed: AssetDownloadFailure[];
}

/** The manifest + root staged by checkForUpdate, awaiting applyUpdate. */
interface PendingUpdate {
    plan: UpdatePlan;
    model: ManifestModel;
    manifestJson: AddressableManifest;
    remoteRoot: string | null;
}

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
    /**
     * Addressable manifest (groups + bundle modes). When set, enables
     * `loadGroup(name)`. Accepts the raw manifest JSON or a pre-built
     * {@link ManifestModel}. Optional — label/path loading works without it.
     */
    manifest?: AddressableManifest | ManifestModel;
    /** The wasm module, or null on the native (embedded-Dawn) backend, which has
     *  no wasm heap — its ResourceManager uploads texture bytes directly. */
    module: ESEngineModule | null;
    /**
     * Lazy accessor for the owning app's Audio API. AudioAssetLoader
     * calls it at load time so AssetPlugin and AudioPlugin can be built
     * in any order. Pass null (or omit) if no audio support is needed.
     */
    getAudio?: () => import('../audio/Audio').AudioAPI | null;
    getSpriteAnimation?: () => import('../animation/SpriteAnimator').SpriteAnimationAPI | null;
    /** Lazy accessor for the owning app's Localization service, same contract
     *  as {@link getAudio} — `.eslocale` tables register through it. */
    getLocalization?: () => import('../i18n/Localization').LocalizationAPI | null;
}

export interface AssetBundle {
    textures: Map<string, TextureResult>;
    materials: Map<string, MaterialResult>;
    spine: Map<string, SpineResult>;
    fonts: Map<string, FontResult>;
}

function emptyBundle(): AssetBundle {
    return { textures: new Map(), materials: new Map(), spine: new Map(), fonts: new Map() };
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

    private module_: ESEngineModule | null;
    private manifestModel_: ManifestModel | null = null;
    /** CDN root that `remote`-group assets resolve against; see {@link setRemoteRoot}. */
    private remoteRoot_?: string;
    /** The update staged by {@link checkForUpdate}, consumed by {@link applyUpdate}. */
    private pendingUpdate_: PendingUpdate | null = null;
    /** Storage key {@link applyUpdate} persists the active manifest under; set by
     *  {@link restorePersistedUpdate}. Null → persistence off. */
    private persistKey_: string | null = null;
    private getAudio_: () => import('../audio/Audio').AudioAPI | null;
    private getSpriteAnimation_: () => import('../animation/SpriteAnimator').SpriteAnimationAPI | null;
    private getLocalization_: () => import('../i18n/Localization').LocalizationAPI | null;
    private loaders_ = new Map<string, AssetLoader<unknown>>();
    private textureLoader_: TextureLoader;
    private textureImportResolver_: TextureImportSettingsResolver | null = null;
    private spineLoader_: SpineAssetLoader;

    private textureCache_ = new AsyncCache<TextureResult>((result) => {
        // A texture whose load finished after its getOrLoad timed out has no
        // owner; release its GL handle so it doesn't leak VRAM.
        requireResourceManager().releaseTexture(result.handle);
    });
    private textureRefCounts_ = new Map<string, number>();
    private genericCache_ = new Map<string, AsyncCache<unknown>>();
    /** Per-asset reference counts for the generic caches, keyed `type:path`.
     *  Same contract as textures: every load*() increments, every release*()
     *  decrements, and the loader's unload runs only at zero — so an asset
     *  shared by two scenes survives the first scene's unload. */
    private genericRefCounts_ = new Map<string, number>();
    private loadContext_: LoadContext | null = null;
    private assetRefResolver_: AssetRefResolver | null = null;
    private assetRegistry_: AssetRegistry | null = null;
    private refCounter_: AssetRefCounter | null = null;
    private invalidateListeners_ = new Set<InvalidateListener>();
    /** `"<kind>:<handle>"` → resolved load path, recorded on every handle-yielding
     *  load. The REVERSE of resolution — inspectors and tooling that only hold a
     *  live World handle use it to name the asset (see {@link pathForHandle}). */
    private handleToPath_ = new Map<string, string>();

    private constructor(options: AssetsOptions) {
        this.backend = options.backend;
        this.catalog = options.catalog ?? Catalog.empty();
        this.module_ = options.module;
        this.getAudio_ = options.getAudio ?? (() => null);
        this.getSpriteAnimation_ = options.getSpriteAnimation ?? (() => null);
        this.getLocalization_ = options.getLocalization ?? (() => null);
        this.setManifest(options.manifest ?? null);

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
        return this.loadTextureVariant_(ref, true);
    }

    async loadTextureRaw(ref: string): Promise<TextureResult> {
        return this.loadTextureVariant_(ref, false);
    }

    private async loadTextureVariant_(ref: string, flip: boolean): Promise<TextureResult> {
        const path = this.resolveLoadPath_(ref);
        const cacheKey = this.textureCacheKey_(path, flip);
        const settings = this.textureImportResolver_?.(ref);
        const result = await this.textureCache_.getOrLoad(cacheKey, () => {
            // Warm-cache hit: a texture whose last reference was released stays
            // resident in the C++ pool (up to the texture budget) under this
            // exact key — reviving it skips the whole fetch + decode + upload.
            const revived = this.reviveResidentTexture_(cacheKey);
            if (revived) return Promise.resolve(revived);
            this.textureLoader_.setPendingSettings(settings);
            return flip
                ? this.textureLoader_.load(path, this.getLoadContext_())
                : this.textureLoader_.loadRaw(path, this.getLoadContext_());
        });
        this.textureRefCounts_.set(cacheKey, (this.textureRefCounts_.get(cacheKey) ?? 0) + 1);
        this.recordHandlePath_('texture', result.handle, path);
        // The 9-slice border belongs to the IMAGE, so it rides its import
        // settings and is stamped onto the handle here — the one place every
        // creation path (decode, revive, external, cooked) funnels through, and
        // where the settings are already resolved. Without this a UIVisual set
        // to NineSlice finds no texture metadata and stretches its corners.
        if (settings?.sliceBorder) {
            const b = settings.sliceBorder;
            requireResourceManager().setTextureMetadata(result.handle, b.left, b.right, b.top, b.bottom);
        }
        return result;
    }

    /**
     * Try to revive an evictable texture from the C++ pool's residency cache.
     * Returns null on a miss — or when the resource-manager surface doesn't
     * support residency (minimal test mocks). Gated on invalidateTexturePath
     * too: reviving without the ability to sever a path on hot reload could
     * hand out stale bytes, so both must be present or neither is used.
     */
    private reviveResidentTexture_(cacheKey: string): TextureResult | null {
        const rm = requireResourceManager();
        if (typeof rm.acquireTextureByPath !== 'function'
            || typeof rm.invalidateTexturePath !== 'function') return null;
        const handle = rm.acquireTextureByPath(cacheKey);
        if (!handle) return null;
        const dims = rm.getTextureDimensions(handle);
        if (!dims) {
            rm.releaseTexture(handle);
            return null;
        }
        return { handle, width: dims.width, height: dims.height };
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

    /**
     * The load path behind a LIVE handle (`kind` = the asset slot type:
     * 'texture' | 'material' | 'font' | …), or null when this realm never
     * loaded such a handle. The reverse of ref resolution — the live "Game"
     * inspector uses it to show WHICH asset a World component's handle-valued
     * slot is wearing (a raw handle number names nothing to a human).
     */
    pathForHandle(kind: string, handle: number): string | null {
        return this.handleToPath_.get(`${kind}:${handle}`) ?? null;
    }

    /** Record a handle→path pair for {@link pathForHandle} (dropped on invalidate/releaseAll). */
    private recordHandlePath_(kind: string, handle: number, path: string): void {
        if (handle !== 0) this.handleToPath_.set(`${kind}:${handle}`, path);
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
        const result = await this.loadTyped<AnimClipResult>('anim-clip', ref);
        // The loader registers the clip under its RESOLVED load path (an absolute
        // URL in realms whose ref resolver returns fetchable URLs, e.g. the play
        // realm), but SpriteAnimator/Animator reference clips by the SERIALIZED
        // ref (project-relative path). Alias the raw ref to the same clip object
        // so lookups match in every realm — without this, play mode registered
        // `estella://…/walk.esanim` while components asked for
        // `assets/animations/walk.esanim`, and no clip ever advanced a frame.
        const anim = this.getSpriteAnimation_();
        if (anim && ref !== result.clipId) {
            const clip = anim.getClip(result.clipId);
            if (clip && !anim.getClip(ref)) anim.aliasClip(ref, clip);
        }
        return result;
    }

    async loadTilemap(ref: string): Promise<TilemapResult> {
        return this.loadTyped('tilemap', ref);
    }

    async loadTileset(ref: string): Promise<TilesetResult> {
        return this.loadTyped('tileset', ref);
    }

    async loadTimeline(ref: string): Promise<TimelineResult> {
        return this.loadTyped('timeline', ref);
    }

    /** Load a `.eslocale` string table and merge it into the app's Localization
     *  catalogs. Requires the LocalizationPlugin (fails loud otherwise). */
    async loadLocaleTable(ref: string): Promise<LocaleResult> {
        return this.loadTyped('locale', ref);
    }

    /** Load a `.esfsm` state machine into the shared AI store, keyed by its
     *  asset path — the ref a StateMachineAgent's `fsm` field resolves. */
    async loadStateMachine(ref: string): Promise<FsmResult> {
        return this.loadTyped('statemachine', ref);
    }

    /** Load a `.esbt` behavior tree into the shared AI store, keyed by its
     *  asset path — the ref a BehaviorTreeAgent's `bt` field resolves. */
    async loadBehaviorTree(ref: string): Promise<BtResult> {
        return this.loadTyped('behaviortree', ref);
    }

    /** Load a `.esanimator` controller into the shared animator store, keyed by
     *  its asset path — the ref an Animator's `controller` field resolves. */
    async loadAnimatorController(ref: string): Promise<AnimatorControllerResult> {
        return this.loadTyped('animatorcontroller', ref);
    }

    async loadPrefab(ref: string): Promise<PrefabResult> {
        return this.loadTyped('prefab', ref);
    }

    /**
     * Load a `.json` data asset — a game's own table, tuning or dialogue file.
     *
     * `T` is what the caller expects the document to be; nothing validates it,
     * so this is `JSON.parse`'s guarantee, not a schema's. What the asset system
     * adds over fetching the file yourself is everything around the parse: ref
     * resolution (`@uuid:` and manifest paths), one parse per file, group /
     * subpackage delivery, and hot update.
     */
    async loadJson<T = unknown>(ref: string): Promise<JsonResult<T>> {
        return this.loadTyped('json', ref);
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
        // Raw ref first: atlas frames register under every ref SPELLING
        // (`@uuid:…`, logical, "/"-rooted). The resolved path is the fallback —
        // for packed frames it is the shared PAGE path, which cannot key
        // per-frame data.
        return this.catalog.getAtlasFrame(ref)
            ?? this.catalog.getAtlasFrame(this.resolveLoadPath_(ref));
    }

    // =========================================================================
    // Addressable Manifest (groups / bundle modes)
    // =========================================================================

    /**
     * Set (or clear) the addressable manifest used by {@link loadGroup}.
     * Accepts the raw manifest JSON or a pre-built {@link ManifestModel};
     * `null` clears it.
     */
    setManifest(manifest: AddressableManifest | ManifestModel | null): void {
        this.manifestModel_ =
            manifest == null ? null
            : manifest instanceof ManifestModel ? manifest
            : ManifestModel.fromJson(manifest);
    }

    getManifest(): ManifestModel | null {
        return this.manifestModel_;
    }

    // =========================================================================
    // Batch Load (by label / by group)
    // =========================================================================

    async loadByLabel(
        label: string,
        onProgress?: (loaded: number, total: number) => void,
    ): Promise<AssetBundle> {
        const bundle = emptyBundle();
        let loadedCount = 0;
        const promises: Promise<void>[] = [];
        const track = (p: Promise<void>): Promise<void> =>
            p.then(() => { onProgress?.(++loadedCount, totalCount); })
             .catch(() => { onProgress?.(++loadedCount, totalCount); });

        for (const path of this.catalog.getByLabel(label)) {
            const entry = this.catalog.getEntry(path);
            if (!entry) continue;
            const task = this.bundleLoadTask_(path, entry.type, bundle);
            if (task) promises.push(track(task));
        }

        const totalCount = promises.length;
        onProgress?.(0, totalCount);
        loadedCount = 0;

        await Promise.allSettled(promises);
        return bundle;
    }

    /**
     * Load every asset in an addressable group through the typed loaders,
     * warming the cache (and populating the returned bundle for the four
     * displayable types). Requires a manifest (see {@link setManifest}); with
     * no manifest set, this is a no-op returning an empty bundle.
     *
     * This is the single group-loading channel — the basis for on-demand /
     * subpackage delivery. It dispatches through the same per-type loaders as
     * {@link loadByLabel}, so the two never diverge.
     */
    async loadGroup(
        groupName: string,
        onProgress?: (loaded: number, total: number) => void,
    ): Promise<AssetBundle> {
        const bundle = emptyBundle();
        const model = this.manifestModel_;
        if (!model) {
            log.warn('asset', `loadGroup('${groupName}') called but no manifest is set`);
            onProgress?.(0, 0);
            return bundle;
        }

        const mode = model.bundleMode(groupName);
        // A lazy group is an on-demand subpackage — download it before loading its
        // assets (no-op on platforms without a subpackage concept, e.g. web).
        if (mode === 'lazy') {
            await platformLoadSubpackage(groupName);
        }

        let loadedCount = 0;
        const promises: Promise<void>[] = [];
        const track = (p: Promise<void>): Promise<void> =>
            p.then(() => { onProgress?.(++loadedCount, totalCount); })
             .catch(() => { onProgress?.(++loadedCount, totalCount); });

        for (const asset of model.assetsInGroup(groupName)) {
            const path = this.manifestAssetUrl_(asset.path, mode === 'remote');
            const task = this.groupLoadTask_(path, asset.type, bundle);
            if (task) promises.push(track(task));
        }

        const totalCount = promises.length;
        onProgress?.(0, totalCount);
        loadedCount = 0;

        await Promise.allSettled(promises);
        return bundle;
    }

    /**
     * Release every asset {@link loadGroup} acquired for a group — the
     * symmetric other half of on-demand delivery. Each asset goes through its
     * type's canonical release channel, so reference counting decides what
     * actually happens: an asset another scene or group still holds survives;
     * one nobody holds drops to the evictable warm cache (textures, audio)
     * or unloads. Call it when the player leaves the area the group backs;
     * bouncing back is then absorbed by the warm caches instead of the
     * network. Requires a manifest, like loadGroup; no-op without one.
     */
    releaseGroup(groupName: string): void {
        const model = this.manifestModel_;
        if (!model) {
            log.warn('asset', `releaseGroup('${groupName}') called but no manifest is set`);
            return;
        }
        for (const asset of model.assetsInGroup(groupName)) {
            const path = this.resolveLoadPath_(asset.path);
            switch (asset.type) {
                case 'texture': this.releaseTexture(path); break;
                case 'material': this.releaseTyped('material', path); break;
                case 'bitmap-font': this.releaseTyped('font', path); break;
                case 'prefab': this.releaseTyped('prefab', path); break;
                case 'audio': this.releaseTyped('audio', path); break;
                // Spine skeletons bind to spawned entities and are owned by
                // the SpineAssetLoader / SpineManager lifecycle, not the
                // generic cache — releasing them here could yank a skeleton
                // out from under a live entity.
                default: break;
            }
        }
    }

    // =========================================================================
    // Hot Update (content-addressed remote delivery)
    // =========================================================================

    /** The CDN / remote root that `remote`-group assets resolve against. */
    get remoteRoot(): string | undefined { return this.remoteRoot_; }

    /** Point `remote`-group resolution at a CDN root: their content-addressed
     *  paths then fetch from `<root>/<path>`. A trailing slash is trimmed;
     *  `undefined` clears it (same-origin fallback). */
    setRemoteRoot(url: string | undefined): void {
        this.remoteRoot_ = url ? url.replace(/\/+$/, '') : undefined;
    }

    /** Absolute url of a `remote`-group asset against `root` (default the active
     *  remote root). An already-absolute manifest path (a fully-qualified CDN url)
     *  passes through; with no root the path returns as-is (same-origin fallback). */
    private remoteUrlFor_(path: string, root: string | undefined = this.remoteRoot_): string {
        if (/^[a-z][a-z0-9+.-]*:\/\//i.test(path)) return path;
        if (!root) return path;
        return `${root.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
    }

    /** The load url for a manifest asset. A `remote`-group asset resolves to its
     *  `<root>/<path>` CDN url when a root is set; every other case (local / lazy
     *  group, or a remote group with no CDN root — same-origin realms like editor
     *  Play) resolves through the normal resolver + Catalog. The single remote/local
     *  routing rule shared by {@link loadGroup} and {@link fetchAndVerify_}, so a
     *  loadGroup'd asset and the same asset reached by a scene `@uuid` ref (via
     *  {@link resolveLoadPath_} → {@link remoteAssetPath_}) never resolve two ways. */
    private manifestAssetUrl_(path: string, isRemote: boolean, root: string | undefined = this.remoteRoot_): string {
        return isRemote && root ? this.remoteUrlFor_(path, root) : this.resolveLoadPath_(path);
    }

    /**
     * Fetch a candidate manifest and diff it against the active one WITHOUT
     * applying anything — the "is there an update, and how big?" query. The
     * returned plan (changed assets + byte total) is what a UI shows before
     * asking the player to download; the candidate is staged for {@link applyUpdate}.
     *
     * Diffing is by content hash (see {@link diffManifests}); because assets are
     * content-addressed, a changed asset is a brand-new url, so applying can never
     * overwrite or corrupt a cached file.
     */
    async checkForUpdate(options: CheckForUpdateOptions): Promise<UpdatePlan> {
        const text = await this.backend.fetchText(this.backend.resolveUrl(options.manifestUrl));
        const json = JSON.parse(text) as AddressableManifest;
        const model = ManifestModel.fromJson(json);
        const plan = diffManifests(this.manifestModel_, model);
        const remoteRoot = options.remoteRoot ?? this.remoteRoot_ ?? null;
        this.pendingUpdate_ = { plan, model, manifestJson: json, remoteRoot };
        return plan;
    }

    /**
     * Apply the update staged by the last {@link checkForUpdate}, ATOMICALLY.
     * Phase 1 downloads AND integrity-verifies every changed (content-addressed)
     * asset — bytes are hashed and checked against the manifest's `contentHash`,
     * so a corrupted / tampered CDN response is caught. Only if ALL succeed does
     * phase 2 commit: swap the active manifest + root, rebind live handles (via
     * `onInvalidate`), and persist. If any asset fails to download or fails its
     * hash check, NOTHING is swapped — the old manifest stays active (rollback)
     * and the failures are returned. No-op with nothing staged.
     */
    async applyUpdate(onProgress?: (loaded: number, total: number) => void): Promise<ApplyUpdateResult> {
        const pending = this.pendingUpdate_;
        if (!pending) {
            log.warn('asset', 'applyUpdate() called with no pending update — call checkForUpdate first');
            onProgress?.(0, 0);
            return { ok: false, updated: 0, failed: [] };
        }
        const changed = pending.plan.changedAssets;
        const root = pending.remoteRoot ?? undefined;

        // Phase 1 — download + verify EVERY changed asset WITHOUT touching the
        // active manifest. Content-addressed, so these are brand-new urls (nothing
        // is overwritten); any failure here leaves the old manifest active = rollback.
        const failed: AssetDownloadFailure[] = [];
        let done = 0;
        onProgress?.(0, changed.length);
        const tasks = changed.map((c) => async (): Promise<void> => {
            const reason = await this.fetchAndVerify_(c, pending.model, root);
            if (reason) failed.push({ path: c.path, reason });
        });
        await runWithConcurrency(tasks, DEFAULT_PRELOAD_CONCURRENCY, () => {
            onProgress?.(++done, changed.length);
        });

        if (failed.length > 0) {
            log.warn('asset', `applyUpdate: ${failed.length}/${changed.length} asset(s) failed — update rolled back (manifest unchanged)`);
            return { ok: false, updated: 0, failed };
        }

        // Phase 2 — commit atomically. Capture the texture handle bound to each
        // changed asset BEFORE the swap (it resolves to the OLD path), then swap
        // root + manifest and notify with that handle so the built-in rebinder
        // swaps it to the freshly-fetched content in live components.
        const oldHandles = new Map<string, number>();
        for (const c of changed) {
            const tex = this.getTexture(c.key);
            if (tex) oldHandles.set(c.key, tex.handle);
        }
        if (pending.remoteRoot != null) this.setRemoteRoot(pending.remoteRoot);
        this.setManifest(pending.model);
        for (const c of changed) this.fireInvalidate_(c.key, oldHandles.get(c.key) ?? 0);
        this.persistActiveManifest_(pending.manifestJson);
        this.pendingUpdate_ = null;
        return { ok: true, updated: changed.length, failed: [] };
    }

    /** Download one changed asset's bytes from its delivery source (remote → CDN
     *  url against `root`, else the normal resolved path) and verify the content
     *  hash. Null on success, else the failure reason. Uses the PENDING manifest +
     *  root — phase 1 runs before the swap. */
    private async fetchAndVerify_(
        c: AssetChange, model: ManifestModel, root: string | undefined,
    ): Promise<AssetDownloadFailure['reason'] | null> {
        const group = model.group(c.group);
        const remote = group != null && normalizeBundleMode(group.bundleMode) === 'remote';
        const path = this.manifestAssetUrl_(c.path, remote, root);
        try {
            const url = this.backend.resolveUrl(path);
            const buf = await this.backend.fetchBinary(url);
            if (c.contentHash && contentHashHex(new Uint8Array(buf)) !== c.contentHash) {
                return 'integrity';
            }
            // Persist the verified, content-addressed bytes to the disk cache (keyed by
            // the immutable CDN url) so they load offline on the next boot and skip the
            // CDN. Best-effort (no-op on platforms without a cache, e.g. web); a failed
            // write never fails the update.
            if (remote) await platformWriteCacheFile(url, buf);
            return null;
        } catch {
            return 'fetch';
        }
    }

    /**
     * Remember a storage key under which {@link applyUpdate} persists the active
     * manifest, and immediately restore any manifest a prior run persisted there —
     * so a returning player boots straight onto the updated content, even offline.
     * Returns true if a persisted manifest was found and made active. Call at
     * boot, before the first scene loads.
     */
    restorePersistedUpdate(key: string): boolean {
        this.persistKey_ = key;
        const raw = platformGetStorageItem(key);
        if (!raw) return false;
        try {
            const parsed = JSON.parse(raw) as { manifest: AddressableManifest; remoteRoot?: string | null };
            if (parsed.remoteRoot) this.setRemoteRoot(parsed.remoteRoot);
            this.setManifest(parsed.manifest);
            return true;
        } catch (e) {
            log.warn('asset', 'failed to restore persisted manifest', e);
            return false;
        }
    }

    private persistActiveManifest_(json: AddressableManifest): void {
        if (!this.persistKey_) return;
        try {
            platformSetStorageItem(
                this.persistKey_,
                JSON.stringify({ manifest: json, remoteRoot: this.remoteRoot_ ?? null }),
            );
        } catch (e) {
            log.warn('asset', 'failed to persist updated manifest', e);
        }
    }

    /**
     * Load one asset into the displayable bundle maps. Returns the in-flight
     * promise for the four bundle-able types (texture / material / spine /
     * font), or null for any other type. Shared by `loadByLabel` and
     * `loadGroup` so both dispatch through one channel.
     */
    private bundleLoadTask_(
        path: string, type: string, bundle: AssetBundle,
    ): Promise<void> | null {
        switch (type) {
            case 'texture':
                return this.loadTexture(path).then(r => { bundle.textures.set(path, r); });
            case 'material':
                return this.loadMaterial(path).then(r => { bundle.materials.set(path, r); });
            case 'spine':
                return this.loadSpine(path).then(r => { bundle.spine.set(path, r); });
            case 'font':
            case 'bitmap-font':
                return this.loadFont(path).then(r => { bundle.fonts.set(path, r); });
            default:
                return null;
        }
    }

    /**
     * Like {@link bundleLoadTask_} but also warms the cache for non-displayable
     * types that have a typed loader (prefab, audio), so a whole group / sub-
     * package preloads. Raw types (json / text / binary) and unknowns return
     * null — they have no typed loader and are fetched lazily on demand.
     */
    private groupLoadTask_(
        path: string, type: string, bundle: AssetBundle,
    ): Promise<void> | null {
        const bundled = this.bundleLoadTask_(path, type, bundle);
        if (bundled) return bundled;
        switch (type) {
            case 'prefab': return this.loadPrefab(path).then(() => {});
            case 'audio':  return this.loadAudio(path).then(() => {});
            default:       return null;
        }
    }

    /**
     * Preload an explicit list of refs (`@uuid:` or paths) through the typed
     * loaders, warming every cache with bounded concurrency and progress.
     * This is the streaming prefetch primitive: point it at the next area's
     * assets while gameplay continues, and the eventual real loads hit warm
     * caches (or revive resident textures) instead of the network.
     *
     * Asset types come from the catalog / manifest when known, falling back
     * to file-extension matching against the registered loaders. Refs whose
     * type can't be determined — and refs that fail to load — are reported
     * in `failed`; preload itself never rejects.
     */
    async preload(
        refs: ReadonlyArray<string>,
        onProgress?: (loaded: number, total: number) => void,
        options?: { readonly maxConcurrent?: number },
    ): Promise<{ failed: MissingAsset[] }> {
        const failed: MissingAsset[] = [];
        const tasks: Array<() => Promise<void>> = [];

        for (const ref of refs) {
            const path = this.resolveLoadPath_(ref);
            const type = this.inferAssetType_(path);
            if (!type) {
                log.warn('asset', `preload: cannot determine asset type for ${ref}`);
                failed.push({ ref, reason: 'unresolved' });
                continue;
            }
            const load = this.typedLoadFor_(path, type);
            if (!load) {
                log.warn('asset', `preload: no loader for type '${type}' (${ref})`);
                failed.push({ ref, type, reason: 'unresolved' });
                continue;
            }
            tasks.push(() =>
                load().then(() => {}).catch(e => {
                    log.warn('asset', `preload: failed to load ${ref}`, e);
                    failed.push({
                        ref, type, reason: 'load-failed',
                        error: e instanceof Error ? e.message : String(e),
                    });
                }),
            );
        }

        let loadedCount = 0;
        const totalCount = tasks.length;
        onProgress?.(0, totalCount);
        const maxConcurrent = Math.max(1, options?.maxConcurrent ?? DEFAULT_PRELOAD_CONCURRENCY);
        await runWithConcurrency(tasks, maxConcurrent, () => {
            onProgress?.(++loadedCount, totalCount);
        });
        return { failed };
    }

    /** Asset type for a resolved path: catalog entry → manifest entry →
     *  extension match against the registered loaders → null. */
    private inferAssetType_(path: string): string | null {
        const catalogType = this.catalog.getEntry(path)?.type;
        if (catalogType) return catalogType;
        const manifestType = this.manifestModel_?.assetByPath(path)?.type;
        if (manifestType) return manifestType;
        const dot = path.lastIndexOf('.');
        if (dot < 0) return null;
        const ext = path.slice(dot).toLowerCase();
        for (const loader of this.loaders_.values()) {
            if (loader.extensions.includes(ext)) return loader.type;
        }
        return null;
    }

    /** Thunk that loads `path` through its type's canonical channel, or null
     *  when no loader handles the type. Textures/spine have dedicated entry
     *  points (refcount / two-file pairing); everything else is loadTyped. */
    private typedLoadFor_(path: string, type: string): (() => Promise<unknown>) | null {
        switch (type) {
            case 'texture': return () => this.loadTexture(path);
            case 'spine':   return () => this.loadSpine(path);
            case 'font':
            case 'bitmap-font': return () => this.loadFont(path);
            default:
                return this.loaders_.has(type) ? () => this.loadTyped(type, path) : null;
        }
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
        options?: { readonly maxConcurrent?: number; readonly skipSpine?: boolean },
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
        // Anim clips load by their RAW serialized ref: components (SpriteAnimator.clip,
        // Animator states) look clips up by that ref, and loadAnimClip aliases it to
        // the resolved registration. Feeding the resolved path here (like the handle
        // types) would strip the alias and leave play-realm lookups keyless.
        const animClipPaths = discovered.rawByType.get('anim-clip') ?? new Set<string>();
        const audioPaths = discovered.byType.get('audio') ?? new Set<string>();
        const tilemapPaths = discovered.byType.get('tilemap') ?? new Set<string>();
        const tilesetPaths = discovered.byType.get('tileset') ?? new Set<string>();
        const timelinePaths = discovered.byType.get('timeline') ?? new Set<string>();
        const fsmPaths = discovered.byType.get('statemachine') ?? new Set<string>();
        const btPaths = discovered.byType.get('behaviortree') ?? new Set<string>();
        const animatorPaths = discovered.byType.get('animatorcontroller') ?? new Set<string>();
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

        // Textures load through their AUTHORED ref, not the resolved path the
        // handle map is keyed by: per-asset import settings (filter/wrap/sRGB and
        // the 9-slice border) are looked up by the spelling a component carries,
        // which is the resolver's documented contract. Resolution happens inside
        // loadTexture anyway, so the bytes fetched are identical either way —
        // feeding it the resolved path only strips the lookup of its key.
        pushHandleLoad(
            texturePaths,
            p => this.loadTexture(discovered.rawFor.get(p) ?? p),
            textureHandles,
            'texture',
        );
        pushHandleLoad(materialPaths, p => this.loadMaterial(p), materialHandles, 'material');
        pushHandleLoad(fontPaths, p => this.loadFont(p), fontHandles, 'font');
        // The runtime scene loader owns spine as a two-phase load+apply through the
        // SpineManager (skeletons must bind to spawned entities); it opts out here so
        // spine page textures / virtual-FS writes aren't done twice.
        if (!options?.skipSpine) {
            for (const pair of spinePairs) {
                tasks.push(() =>
                    this.loadSpine(pair.skeleton, pair.atlas).then(() => {}).catch(e => {
                        log.warn('asset', `Failed to load spine: ${pair.skeleton}`, e);
                        recordFailure(pair.skeleton, 'spine', e);
                    }),
                );
            }
        }
        pushFireAndForget(animClipPaths, p => this.loadAnimClip(p), 'anim-clip');
        pushFireAndForget(tilemapPaths, p => this.loadTilemap(p), 'tilemap');
        pushFireAndForget(tilesetPaths, p => this.loadTileset(p), 'tileset');
        pushFireAndForget(timelinePaths, p => this.loadTimeline(p), 'timeline');
        pushFireAndForget(audioPaths, p => this.loadAudio(p), 'audio');
        // FSM/BT loaders register the parsed definition into the shared AI store
        // under the asset path, so a StateMachineAgent/BehaviorTreeAgent whose
        // fsm/bt is that path resolves once the scene finishes preloading.
        pushFireAndForget(fsmPaths, p => this.loadTyped('statemachine', p), 'statemachine');
        pushFireAndForget(btPaths, p => this.loadTyped('behaviortree', p), 'behaviortree');
        pushFireAndForget(animatorPaths, p => this.loadTyped('animatorcontroller', p), 'animatorcontroller');

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
            // Prefab-instance entries carry no inline components (a prefab ref +
            // overrides); their handles bind when the prefab expands, not here.
            if (!Array.isArray(entity.components)) continue;
            for (const comp of entity.components) {
                // Single source: the component def's declared asset fields.
                // Handle write-back always keys off assetFields (the direct
                // texture/material/font members), even for components whose
                // discovery is driven by a discoverAssets callback instead.
                const fields = getComponentAssetFieldDescriptors(comp.type);
                for (const { field, type } of fields) {
                    const ref = comp.data[field];
                    if (typeof ref !== 'string' || !ref) continue;

                    // UUID refs resolve to their current path; plain paths
                    // pass through. Unknown UUID → null, handle will be 0
                    // (caller's getter returns 0 when the key is missing).
                    const path = this.resolveRef(ref);
                    if (path == null) {
                        comp.data[field] = getComponentDefaults(comp.type)?.[field] ?? 0;
                        continue;
                    }

                    switch (type) {
                        case 'texture': {
                            const handle = textureHandles.get(path) ?? 0;
                            comp.data[field] = handle;
                            if (counter && handle) counter.addTextureRef(path, entity.id);
                            // Ref spelling first (per-frame keys); the resolved
                            // path for packed frames is the shared page.
                            const atlasInfo = this.catalog.getAtlasFrame(ref) ?? this.catalog.getAtlasFrame(path);
                            if (atlasInfo) {
                                // COMPOSE with any authored sub-region rather than
                                // stomping it: the authored uv nests inside the frame.
                                const aOff = comp.data['uvOffset'] as { x: number; y: number } | undefined;
                                const aSc = comp.data['uvScale'] as { x: number; y: number } | undefined;
                                const ox = aOff?.x ?? 0, oy = aOff?.y ?? 0;
                                const sx = aSc?.x ?? 1, sy = aSc?.y ?? 1;
                                comp.data['uvOffset'] = {
                                    x: atlasInfo.uvOffset[0] + ox * atlasInfo.uvScale[0],
                                    y: atlasInfo.uvOffset[1] + oy * atlasInfo.uvScale[1],
                                };
                                comp.data['uvScale'] = {
                                    x: sx * atlasInfo.uvScale[0],
                                    y: sy * atlasInfo.uvScale[1],
                                };
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
                // Last SDK reference: drop our one C++ ref. The pool decides
                // what that means — free immediately (no budget), or retain as
                // an evictable cache entry that the next load revives by key.
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

    /**
     * Release a material obtained via {@link loadMaterial}, addressed by its
     * handle (materials are tracked by handle, not ref, in the scene manager).
     * Routes through the shared refcount + cache path so a material shared by
     * two scenes survives until its last owner releases it, and the cache never
     * hands the next load a destroyed handle. Destroying the handle directly
     * (bypassing this) would strand a dead handle in the material cache.
     */
    releaseMaterial(handle: number): void {
        const path = this.pathForHandle('material', handle);
        if (path !== null) this.releaseTyped('material', path);
    }

    private releaseTyped(type: string, ref: string): void {
        const path = this.resolveLoadPath_(ref);
        const cache = this.genericCache_.get(type);
        if (!cache) return;
        const entry = cache.get(path);
        if (!entry) return;

        const key = `${type}:${path}`;
        const count = this.genericRefCounts_.get(key);
        if (count === undefined) return;
        if (count > 1) {
            this.genericRefCounts_.set(key, count - 1);
            return;
        }
        const loader = this.loaders_.get(type);
        loader?.unload(entry, this.getLoadContext_());
        cache.delete(path);
        this.genericRefCounts_.delete(key);
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
        // The texture handle bound to this path, captured BEFORE the caches drop
        // it, so a rebind listener can swap it in live components (hot update).
        const oldTextureHandle = this.textureCache_.get(this.textureCacheKey_(path, true))?.handle ?? 0;
        let hit = false;

        // Textures: cache_key has a flip flag suffix, so check both. The C++
        // pool's residency identity is severed too — an evictable entry under
        // this key is freed and can never be revived with stale bytes.
        const rm = getResourceManager();
        for (const flip of [true, false]) {
            const key = this.textureCacheKey_(path, flip);
            if (this.textureCache_.invalidate(key)) hit = true;
            if (this.textureRefCounts_.delete(key)) hit = true;
            if (typeof rm?.invalidateTexturePath === 'function') {
                if (rm.invalidateTexturePath(key)) hit = true;
            }
        }

        // Generic caches: material / font / anim-clip / tilemap / timeline / audio / prefab.
        for (const [type, cache] of this.genericCache_.entries()) {
            if (cache.invalidate(path)) hit = true;
            if (this.genericRefCounts_.delete(`${type}:${path}`)) hit = true;
        }

        // Loader-owned residency (e.g. the AudioAPI warm cache) can outlive
        // the Assets-level entry — sever it unconditionally so a warm-cache
        // revive can never serve stale bytes after a hot reload.
        for (const loader of this.loaders_.values()) {
            if (loader.invalidate?.(path)) hit = true;
        }

        // The reverse handle→path records for this path are stale now too — a
        // reload mints new handles; the old ones must stop naming the asset.
        for (const [key, p] of this.handleToPath_) {
            if (p === path) this.handleToPath_.delete(key);
        }

        if (hit) this.fireInvalidate_(ref, oldTextureHandle);

        return hit;
    }

    /** Fire every onInvalidate listener with `ref` (and the pre-drop texture
     *  handle, when known, so a rebinder can swap it in live components). Isolates
     *  throws. Shared by {@link invalidate} and {@link applyUpdate}. */
    private fireInvalidate_(ref: string, oldTextureHandle = 0): void {
        for (const listener of this.invalidateListeners_) {
            try {
                listener(ref, oldTextureHandle);
            } catch (e) {
                log.warn('asset', 'onInvalidate listener threw', e);
            }
        }
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
        this.genericRefCounts_.clear();
        this.handleToPath_.clear();
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
     * The load path a ref resolves to — resolver plus addressable Catalog,
     * the same two steps every typed load performs. This is the key a loader
     * registers a data asset under, so runtime stores keyed by registration
     * path (FSM/BT/timeline/tilemap via `resolveAssetKey`) must look up with
     * THIS: `resolveRef` alone diverges once the Catalog carries mappings.
     */
    resolveLoadPath(ref: string): string {
        return this.resolveLoadPath_(ref);
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
        // A `remote`-group asset (per the active addressable manifest) resolves to
        // its CDN url — so a scene @uuid ref to a remote asset loads from, and
        // hot-updates with, the CDN, not just loadGroup'd DLC assets. Gated on a
        // remote root being set, so same-origin realms (editor Play, a build with
        // no CDN) keep their normal resolver + base-prefixing untouched.
        const remote = this.remoteAssetPath_(ref);
        if (remote != null) return remote;
        const resolved = this.assetRefResolver_?.(ref) ?? ref;
        return this.catalog.resolve(resolved);
    }

    /** CDN url of `ref` when it names a `remote`-group asset AND a remote root is
     *  set; null otherwise (caller falls back to the normal resolver). */
    private remoteAssetPath_(ref: string): string | null {
        if (!this.remoteRoot_) return null;
        const model = this.manifestModel_;
        if (!model) return null;
        const key = ref.startsWith(UUID_REF_PREFIX)
            ? ref.slice(UUID_REF_PREFIX.length).toLowerCase()
            : ref;
        const path = model.remoteAssetPath(key) ?? model.remoteAssetPath(ref);
        return path != null ? this.remoteUrlFor_(path) : null;
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
        // The audio loader needs the AudioAPI outside load() too (unload /
        // invalidate have no LoadContext), so it shares Assets' lazy accessor.
        this.register(new AudioAssetLoader(() => this.getAudio_()));
        this.register(new AnimClipAssetLoader());
        this.register(new TilemapAssetLoader());
        this.register(new TilesetAssetLoader());
        this.register(new TimelineAssetLoader());
        this.register(new PrefabAssetLoader());
        this.register(new FsmAssetLoader());
        this.register(new AnimatorControllerAssetLoader());
        this.register(new BtAssetLoader());
        this.register(new LocaleAssetLoader());
        this.register(new JsonAssetLoader());
    }

    private textureCacheKey_(path: string, flip: boolean): string {
        return textureResidencyKey(path, flip);
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

        const result = await (cache.getOrLoad(path, () =>
            loader.load(path, this.getLoadContext_()),
        ) as Promise<T>);
        const key = `${type}:${path}`;
        this.genericRefCounts_.set(key, (this.genericRefCounts_.get(key) ?? 0) + 1);
        const handle = (result as { handle?: unknown } | null)?.handle;
        if (typeof handle === 'number' && handle !== 0) this.recordHandlePath_(type, handle, path);
        return result;
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
            releaseTexture(path: string): void {
                self.releaseTexture(path);
            },
            async loadText(path: string): Promise<string> {
                return self.backend.fetchText(self.backend.resolveUrl(path));
            },
            async loadBinary(path: string): Promise<ArrayBuffer> {
                return self.backend.fetchBinary(self.backend.resolveUrl(path));
            },
            async decodePixels(path: string) {
                // The platform's one decode path: the runtime-injected pixel
                // decoder when present (wechat / playable), else fetch→bitmap.
                const decoder = self.textureLoader_.pixelDecoder;
                if (decoder) return decoder(path, false);
                return fetchDecodePixels(self.backend.resolveUrl(self.catalog.getBuildPath(path)));
            },
            async createTextureFromPixels(width, height, pixels, flipY) {
                return self.textureLoader_.loadFromPixels(width, height, pixels, flipY);
            },
            getAudio() {
                return self.getAudio_();
            },
            getSpriteAnimation() {
                return self.getSpriteAnimation_();
            },
            getLocalization() {
                return self.getLocalization_();
            },
        };
        return this.loadContext_;
    }
}
