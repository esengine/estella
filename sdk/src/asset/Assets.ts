// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { RuntimeConfig } from '../defaults';
import type { Backend } from './Backend';
import { manifestBackend } from './manifestBackend';
import { atlasFrameUv, Catalog, type AtlasFrameInfo } from './Catalog';
import { ManifestModel, type AddressableManifest, type AddressableManifestAsset, type AddressableAssetType } from './AddressableManifest';
import { diffManifests, type AssetChange, type UpdatePlan, type UpdateFile } from './hotUpdate';
import { pathWithinRemoteRoot, physicalAssetFiles, remoteAssetUrl } from './physicalAssetFiles';
import { contentHashHex } from './contentHash';
import { encodeUtf8 } from '../util/utf8';
import { getPlatform, isPlatformInitialized } from '../platform/base';
import { contentCacheFor, type CacheVersion, type ContentCacheReport, type CacheCleanupResult } from '../platform/contentCache';
import { platformLoadSubpackage, platformGetStorageItem, platformSetStorageItem, platformRemoveStorageItem, platformWriteCacheFile } from '../platform';
import type {
    AssetLoader, LoadContext, TextureResult, SpineResult,
    MaterialResult, FontResult, AudioResult, AnimClipResult,
    TilemapResult, TilesetResult, TimelineResult, PrefabResult,
    LocaleResult, FsmResult, BtResult, AnimatorControllerResult, JsonResult,
} from './AssetLoader';
import { AsyncCache, RetryableAssetError } from './AsyncCache';
import { PreparedAssetCache } from './PreparedAssetCache';
import { assetPairKey } from './assetPairKey';
import { collectMaterialTextures, SurfaceTextureUses, type SurfaceAsset, type SurfaceClaim, type SurfaceUse } from './surfaceTextureUses';
import { atlasBindingSettings, atlasPageBinding, bindingFile, bindingRecord, manifestBindingKey, manifestFileReads,
    sceneBindingBase, sceneBindingProfile, sceneImportBinding } from './manifestBinding';
import { atlasTextureSettingsKey, type ParsedTextureImportSettings } from './textureImportSettings';
import { SceneTextureImports, SceneTextureInputs } from './sceneTextureImports';
import { SCENE_HANDLE_TYPES, emptySceneAssetValue, isSceneHandleType, type SceneHandleType } from './sceneHandleTypes';
import { TextureContent, textureContentName, type ESEngineModule } from '../wasm';
import type { CppResourceManager } from '../wasm';
import { requireResourceManager, getResourceManager, evictTextureDimensions, textureRefill } from '../wasm/resourceManager';
import type { TextureImportSettingsResolver } from './loaders/TextureLoader';
import type { TextureFormatReport } from './textureFormatReport';
import { logicalTextureKey, TextureLoader, textureResidencyKey } from './loaders/TextureLoader';
import { AssetRefLedger, type AssetRefLease, type LoadGeneration } from './AssetRefLedger';
import { ManifestBindingHistory } from './ManifestBindingHistory';
import { optionalAssetLoaders } from './optionalLoaders';
import { AssetScope, ownedAssetLease, type AssetLease } from './AssetLease';
import { leaseBinding, leaseDependencies, leaseDependencyKey, leaseMatchesSource, leaseOwner, type BindingLease } from './leaseBindings';
import { EntityAssetScopes } from './entityAssetScopes';
import { RegistryAssetSlots, type RegistryAssetKind, type RegistrySlotLease } from './registryAssets';
import {
    DependencyRecorder, PreparationFailure, preparationFailureReason, isInvalidatable,
    cachedPaths, matchingDependents, ownedDependents, rebuildPlan,
    type AssetDependencyOwner, type AssetIdentity, type AssetWithReceipts, type DependencyReceipt, type Preparation, type PreparedLoad,
} from './dependencies';
import { SpineAssetLoader } from './loaders/SpineAssetLoader';
import { MaterialAssetLoader } from './loaders/MaterialAssetLoader';
import { MaterialShaderAssetLoader } from './loaders/MaterialShaderAssetLoader';
import { isBuiltinAssetRef, isFileAssetRef, matchesAssetFieldType } from './documentRef';
import { MeshAssetLoader, type MeshResult } from './loaders/MeshAssetLoader';
import type { MeshData } from './meshFormat';
import { nativeEngineApi, type EngineApi } from '../ecs/bridge/engineApi';
import { isBuiltinMeshRef } from './builtinMeshes';
import { EnvironmentAssetLoader, type EnvironmentResult } from './loaders/EnvironmentAssetLoader';
import { ProbeVolumeAssetLoader, type ProbeVolumeResult } from './loaders/ProbeVolumeAssetLoader';
import { MeshSdfAssetLoader } from './loaders/MeshSdfAssetLoader';
import { MeshCardsAssetLoader } from './loaders/MeshCardsAssetLoader';
import { FontAssetLoader } from './loaders/FontAssetLoader';
import { AudioAssetLoader } from './loaders/AudioAssetLoader';
import { AnimClipAssetLoader } from './loaders/AnimClipAssetLoader';
import { PrefabAssetLoader } from './loaders/PrefabAssetLoader';
import { preparePrefabFromSource, type PreparedPrefab } from '../prefab/preparedPrefab';
import type { PrefabOverride } from '../prefab';
import { LocaleAssetLoader } from './loaders/LocaleAssetLoader';
import { ProjectLocaleTables, type PreparedProjectLocaleTables } from './projectLocaleTables';
import { localeCatalogsFor, type LocalizationAPI, type LocaleTableAsset } from '../i18n/Localization';
import { JsonAssetLoader } from './loaders/JsonAssetLoader';
import { SoundEventAssetLoader } from './loaders/SoundEventAssetLoader';
import { getComponent, getComponentDefaults, type AnyComponentDef } from '../ecs/component';
import { observesAssetReferences } from './assetReferenceTracking';
import { getComponentAssetFieldDescriptors, recordUnresolvedSceneAsset } from '../scene/scene';
import { canonicalComponentType } from '../scene/legacyComponents';
import { indexSceneAssets, SceneAssetOwners, type SceneAssetRefs } from './discoverAssets';
import { fetchDecodePixels } from './imageDecode';
import type { SceneData, AssetFieldType } from '../scene/scene';
import { type ReleaseCallback } from './SceneHandle';
import { assetRefId, extractUuid, UUID_REF_PREFIX } from './AssetRegistry';
import { siblingMeshGIRefs, type MeshGIRefs } from '../gi/meshGIAssets';
import type { AssetRefCounter } from './AssetRefCounter';
import type { World } from '../ecs/world';
import type { Entity } from '../types';
import { log } from '../util/logger';
import { disposeAll } from '../util/disposeAll';
import { normalizeConcurrency, runWithConcurrency } from '../util/runWithConcurrency';
import { recoverDevice, getDeviceStatus, DeviceStatus } from '../render/renderer';
import type { MaterialAssetData } from '../render/material';

/**
 * One asset generation ending: which ref, what kind of asset it was, and what
 * live holders were bound to just before the drop.
 *
 * The kind travels because every source of one knows it, and a listener that
 * has to guess can only serve the kind somebody had in mind.
 */
export interface AssetInvalidation {
    /** As the caller spelled it, not the resolved path. */
    readonly ref: string;
    /** @internal An existing scene's sampler to retain when replacing its bound handle. */
    readonly bindingRef?: string;
    /** In whichever vocabulary the source knew: a loader/field type, or the
     *  manifest's type for an applied update. */
    readonly type: AssetFieldType | AddressableAssetType;
    /** What holders were bound to: a texture's handle, a loader's value.
     *  Undefined when nothing was cached to report. */
    readonly oldValue?: unknown;
}

/** Callback fired when an asset generation ends — `Assets.invalidate(ref)`
 *  dropped cache entries, or `applyUpdate` replaced the content behind a ref. */
export type InvalidateListener = (event: AssetInvalidation) => void;

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
    /** `packed`: the update's manifest packs the asset, and an update downloads assets one by one. */
    reason: 'fetch' | 'integrity' | 'packed';
}

/**
 * How far an update got. Each is its own answer: an update can be running in this
 * session and still be gone on the next launch, which a single `ok` cannot say.
 */
export interface UpdateStages {
    /** Every changed asset downloaded and matched its content hash. */
    verified: boolean;
    /** This session runs on the new manifest, and its asset graph has settled on it. */
    applied: boolean;
    /** The next launch starts on it: stored, and read back. Null without a persistence key. */
    persisted: boolean | null;
    /** Every changed remote asset is in the disk cache, so the next launch reads them
     *  without the network. Null where the platform keeps no cache. */
    cached: boolean | null;
}

/** Outcome of {@link Assets.applyUpdate} — atomic: `ok` only when every changed
 *  asset downloaded + verified and the manifest was swapped. On failure nothing
 *  is applied (`updated: 0`) and `failed` lists why (rollback). */
export interface ApplyUpdateResult {
    ok: boolean;
    /** Assets with new payloads or settings in the committed manifest. */
    updated: number;
    failed: AssetDownloadFailure[];
    stages: UpdateStages;
    /** The revision this session runs on afterwards. */
    revision: string | null;
    /** The changed assets the cache refused, by url: what the next launch fetches again. */
    uncached: string[];
    /** Why nothing was attempted: no update staged (none checked, or another apply took it). */
    reason?: 'nothing-staged';
}

/** What {@link Assets.updateStatus} reports. */
export interface UpdateStatus {
    /** The revision this session runs on. */
    revision: string | null;
    /** The revision the next launch starts on, when an update was persisted. */
    persistedRevision: string | null;
    /** The update {@link Assets.checkForUpdate} staged, and what applying it downloads. */
    staged: { revision: string | null; assets: number; bytes: number } | null;
    applying: boolean;
}

interface ManifestBindingSource { key: string; type: string; ref: string; path: string; page?: AddressableManifestAsset }

/** The manifest + root staged by checkForUpdate, awaiting applyUpdate. */
interface PendingUpdate {
    model: ManifestModel;
    manifestJson: AddressableManifest;
    remoteRoot: string | null;
}

/** One native reference acquired by decoding or reviving a texture. */
interface TextureLoad extends LoadGeneration {
    readonly value: TextureResult;
}


/** A preload's timings are a report, so they need no platform: a realm without
 *  one (a test, a tool) still loads. */
const preloadClock = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export interface AssetsOptions {
    backend: Backend;
    catalog?: Catalog;
    /** Switch the source's lookups, preserving a caller-supplied catalog override. */
    activateManifest?: (model: ManifestModel | null, suppliedCatalog?: Catalog) => Catalog;
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
    meshes: Map<string, MeshResult>;
    environments: Map<string, EnvironmentResult>;
    probeVolumes: Map<string, ProbeVolumeResult>;
    /** Selected assets whose loaders failed, with their refs and reasons. */
    failed: MissingAsset[];
    /**
     * What this load actually acquired. Release through it rather than by group
     * name: a manifest can be updated between the two, and then the group's
     * membership is no longer the set this bundle took out.
     */
    scope: AssetScope;
    /** Give back everything this bundle acquired. Idempotent. */
    release(): void;
}

function emptyBundle(): AssetBundle {
    const scope = new AssetScope();
    return {
        textures: new Map(), materials: new Map(), spine: new Map(), fonts: new Map(),
        meshes: new Map(), environments: new Map(), probeVolumes: new Map(), failed: [],
        scope, release: () => scope.releaseAll(),
    };
}


/**
 * How one addressable asset type is acquired and given back.
 *
 * ONE table, because two of them drift: load handled `font` and release did
 * not, so every group carrying a font kept its reference forever. A type that
 * the group loads now supplies the matching release.
 */
interface GroupAssetChannel {
    load(assets: Assets, ref: string, bundle: AssetBundle, name: string): Promise<void>;
    release(assets: Assets, path: string): void;
}

// These components read raw files or host streams themselves unless a project installs a typed loader.
const SYSTEM_READ_SCENE_TYPES = new Set(['image', 'video', 'groom', 'terrain-tiles', 'terrain-layer-info', 'physical-material']);

interface BatchAsset {
    ref: string;
    type: string;
    name: string;
    group?: string;
}

function scopedGroupChannel<T>(type: string, values?: (bundle: AssetBundle) => Map<string, T>): GroupAssetChannel {
    return {
        async load(assets, ref, bundle, name) {
            const lease = bundle.scope.add(await assets.acquireTyped<T>(type, ref));
            values?.(bundle).set(name, lease.value);
        },
        release: (assets, ref) => assets.releaseTyped(type, ref),
    };
}

const GROUP_ASSET_CHANNELS: ReadonlyMap<string, GroupAssetChannel> = new Map(Object.entries({
    texture: {
        async load(assets, ref, bundle, name) {
            const lease = bundle.scope.add(await assets.acquireTexture(ref));
            bundle.textures.set(name, lease.value);
        },
        release: (assets, ref) => assets.releaseTexture(ref),
    },
    spine: {
        async load(assets, ref, bundle, name) {
            const lease = bundle.scope.add(await assets.acquireSpine(ref));
            bundle.spine.set(name, lease.value);
        },
        release: (assets, ref) => assets.releaseTyped('spine', ref),
    },
    material: scopedGroupChannel('material', b => b.materials),
    font: scopedGroupChannel('font', b => b.fonts),
    mesh: scopedGroupChannel('mesh', b => b.meshes),
    environment: scopedGroupChannel('environment', b => b.environments),
    probeVolume: scopedGroupChannel('probeVolume', b => b.probeVolumes),
} satisfies Record<SceneHandleType | 'spine', GroupAssetChannel>));

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

/**
 * Say what failed, wherever it failed. Two loading doors reached this same dead
 * end — a caller holding an empty result it cannot tell from an empty group —
 * so the sentence is written once rather than at each of them.
 */
function warnFailedLoads(failed: readonly MissingAsset[], where?: string): void {
    if (failed.length === 0) return;
    log.warn('asset', `${where ? `${where}: ` : ''}${failed.length} asset(s) failed to load`, failed);
}

type AssetLoadServices = Omit<LoadContext, 'resourceManager'> & { resourceManager: CppResourceManager | null };

interface SceneAssetAcquisition {
    readonly type: string;
    readonly path: string;
    readonly lease: AssetLease;
    readonly entityIds?: ReadonlySet<number>;
    /** Owners that also need this receipt outside their declared fields. Null when all uses are fields. */
    readonly auxiliaryEntityIds?: ReadonlySet<number> | null;
}

export interface SceneAssetResult {
    textureHandles: Map<string, number>;
    materialHandles: Map<string, number>;
    fontHandles: Map<string, number>;
    meshHandles: Map<string, number>;
    environmentHandles: Map<string, number>;
    probeVolumeHandles: Map<string, number>;
    releaseCallbacks: ReleaseCallback[];
    /**
     * What this preload actually acquired. Release side reads THIS rather than
     * re-deriving from the scene's declared refs: a failed load left no lease,
     * and an invalidate mid-load left the receipt of the era we really got.
     */
    scope: AssetScope;
    /** @internal The scene's embedded texture settings take effect at its successful handoff. */
    publishTextureImports?: () => void;
    /** @internal Optional subsystem readers use the same sampler inputs as the main scene preload. */
    textureReader?: Pick<Assets, 'acquireTexture' | 'acquireSpine' | 'fetchText' | 'fetchBinary'>;
    /** @internal Projection of successful acquisitions; their scope/era remains the owner. */
    acquisitions?: readonly SceneAssetAcquisition[];
    /** @internal The names used by this preload, including across an intervening manifest update. */
    resolveRef?: AssetRefResolver;
    /** @internal Atlas coordinates captured at the start of each texture acquisition. */
    atlasFrameFor?: (ref: string, path: string) => AtlasFrameInfo | null;
    missing: MissingAsset[];
    /** Per asset type: how many loaded, the sum of their load times and the
     *  slowest one, in ms. Loads overlap, so the sums exceed the wall time. */
    timings: Record<string, { count: number; ms: number; slowestMs: number }>;
    /** Wall time of the whole preload, in ms. */
    wallMs: number;
}

export type AssetRefResolver = (ref: string) => string | null;

type RecordingContext = LoadContext & { recorder: DependencyRecorder; textureInputs: SceneTextureInputs };

/**
 * The asset server: one typed loader per asset type, over one ref vocabulary.
 *
 * Every `ref` a loader takes is one of two spellings, and both land on the same
 * file:
 *
 *  - a **project-root-relative path** — `'assets/textures/player.png'`. Relative
 *    to the project root, NOT to the assets folder, so it carries the `assets/`
 *    segment: it is the path the Content Browser shows, the key the cook's
 *    manifest is built on, and what the backend appends to its base url. A ref
 *    that drops the root resolves just the same and 404s, because nothing lives
 *    at the project root.
 *  - an **`@uuid:` ref** — what the editor serializes into scenes and prefabs so
 *    renaming or moving the file breaks nothing. Not hand-written; the realm's
 *    resolver turns it back into the path above before any fetch.
 */
/**
 * A path-addressed release had more than one generation to choose from, so it
 * took the oldest and may have freed somebody else's asset. Reported once per
 * key: the caller that can carry a lease should, and one that cannot needs to
 * hear it once, not every frame.
 */
const ambiguousWarned_ = new Set<string>();
function warnAmbiguousRelease_(key: string): void {
    if (ambiguousWarned_.has(key)) return;
    ambiguousWarned_.add(key);
    log.warn('asset',
        `release("${key}") had more than one live generation and released the oldest — `
        + 'which may not be the one the caller holds. Release it by its lease instead.');
}

const streamingDefaults = new WeakMap<Assets, () => number>();


interface MeshRecoverySource {
    readonly owner: Assets;
    readonly loader: MeshAssetLoader;
    pending?: Promise<boolean>;
}

/** The device reports a pool-wide list of mesh handles. Their source data belongs to individual loaders. */
const meshOwnersByPool = new WeakMap<CppResourceManager, Map<number, MeshRecoverySource>>();

/** @internal The owning App supplies its current quality level until this Assets leaves its resource slot. */
export function bindTextureStreamingStart(assets: Assets, provider: () => number): () => void {
    streamingDefaults.set(assets, provider);
    return () => {
        if (streamingDefaults.get(assets) === provider) streamingDefaults.delete(assets);
    };
}

export class Assets {
    readonly backend: Backend;
    private readonly transport_: Backend;
    private catalog_: Catalog;
    private readonly activateManifest_?: AssetsOptions['activateManifest'];
    get catalog(): Catalog { return this.catalog_; }

    get baseUrl(): string | undefined { return this.baseUrl_; }
    set baseUrl(url: string | undefined) {
        this.baseUrl_ = url;
        if (this.backend.setBaseUrl) {
            this.backend.setBaseUrl(url ?? '');
        }
    }
    private baseUrl_?: string;

    private module_: ESEngineModule | null;
    private readonly subpackages_ = new Map<string, Promise<void>>();
    private manifestModel_: ManifestModel | null = null;
    private readonly manifestBindings_ = new ManifestBindingHistory();
    /** CDN root that `remote`-group assets resolve against; see {@link setRemoteRoot}. */
    private remoteRoot_?: string;
    /** Applies run one after another: two at once would each commit, and one that
     *  finishes after a newer check would clear the newer candidate. */
    private applyChain_: Promise<unknown> = Promise.resolve();
    private applying_ = 0;
    /** The update staged by {@link checkForUpdate}, consumed by {@link applyUpdate}. */
    private pendingUpdate_: PendingUpdate | null = null;
    /** Storage key {@link applyUpdate} persists the active manifest under; set by
     *  {@link restorePersistedUpdate}. Null → persistence off. */
    private persistKey_: string | null = null;
    /** The revision this package shipped, read when persistence is armed at boot. */
    private shippedRevision_: string | null = null;
    private cacheOwner_: string | null = null;
    private cacheRollback_: CacheVersion | null = null;
    private cacheLaunch_: CacheVersion | null = null;
    private cacheLaunchRollback_: CacheVersion | null = null;
    private activeUpdate_: PendingUpdate | null = null;
    private getAudio_: () => import('../audio/Audio').AudioAPI | null;
    private getSpriteAnimation_: () => import('../animation/SpriteAnimator').SpriteAnimationAPI | null;
    private getLocalization_: () => LocalizationAPI | null;
    private projectLocales_?: ProjectLocaleTables;
    private loaders_ = new Map<string, AssetLoader<unknown>>();
    private textureLoader_: TextureLoader;
    private textureImportResolver_: TextureImportSettingsResolver | null = null;
    private readonly sceneTextureImports_ = new SceneTextureImports();
    private readonly sceneTextureReaders_ = new WeakMap<SceneTextureInputs, NonNullable<SceneAssetResult['textureReader']>>();
    private readonly sampledTypes_ = new Set<string>();
    private spineLoader_: SpineAssetLoader;

    private textureCache_ = new AsyncCache<TextureLoad>(load => this.releaseUnclaimedTexture_(load));
    /** Live texture references per cache key. See {@link AssetRefLedger}. */
    private textureRefs_ = new AssetRefLedger<number>();

    /**
     * Bumped by releaseAll(). A load in flight across one has no owner left: the
     * scene that asked is gone and its references were dropped, so the texture
     * it produces is destroyed by the pool before the caller's `await` ever
     * resumes. Delivering that handle is a use-after-free; the load fails instead.
     */
    private resetEpoch_ = 0;
    private releasing_ = false;
    private preparations_ = new Set<DependencyRecorder>();

    /** @internal How many times everything this loader held has been given back: what a holder kept of an earlier one names things that are gone. */
    get epoch(): number { return this.resetEpoch_; }

    private assertLoading_(epoch = this.resetEpoch_): void {
        if (this.releasing_ || epoch !== this.resetEpoch_) {
            throw new Error('Assets were released while loading; this request has no owner. Load it again.');
        }
    }
    private genericCache_ = new Map<string, PreparedAssetCache>();
    /** Per-asset reference counts for the generic caches, keyed `type:path`.
     *  Same contract as textures: every load*() increments, every release*()
     *  decrements, and the loader's unload runs only at zero — so an asset
     *  shared by two scenes survives the first scene's unload. */
    private genericRefs_ = new AssetRefLedger<PreparedLoad<unknown>>();
    /** Propagations in flight — what {@link assetGraphSettled} waits on. */
    private settling_ = new Set<Promise<void>>();
    private loadContext_: AssetLoadServices | null = null;
    private assetRefResolver_: AssetRefResolver | null = null;
    private hostAssetType_?: (ref: string) => string | undefined;
    /** File locations produced by a host resolver, keyed back to the staged manifest path. */
    private readonly stagedPaths_ = new Map<string, string>();
    private refCounter_: AssetRefCounter | null = null;
    private invalidateListeners_ = new Set<InvalidateListener>();
    private sourceListeners_ = new Set<(path: string) => void>();
    private readonly appScope_ = new AssetScope();
    private readonly materialLoader_ = new MaterialAssetLoader();
    private materialDraftGeneration_ = 0;
    private entityScopes_ = new EntityAssetScopes(this.leaseForBinding.bind(this));
    private readonly registrySlots_ = new RegistryAssetSlots();
    /** Resolved load paths by asset type and native handle, for {@link pathForHandle}. */
    private readonly handlePaths_ = new Map<string, Map<number, string>>();
    private readonly surfaceUses_ = new SurfaceTextureUses();
    /** The edge a mesh texture is first loaded at while texture streaming is on; 0 loads it whole. */
    private streamingStartEdge_: number | (() => number) = 0;

    /**
     * Geometry built at run time rather than loaded (a static batch), by handle. It has no file to be replayed
     * from, so the data itself is kept: a device loss puts it back from here.
     */
    private builtMeshes_ = new Map<number, MeshData>();
    private meshOwners_?: Map<number, MeshRecoverySource>;
    private builtTextures_ = new Set<number>();

    private constructor(options: AssetsOptions) {
        this.transport_ = options.backend;
        this.backend = options.backend && manifestBackend(options.backend, () => this.manifestModel_,
            group => this.mountSubpackage_(group), this.stagedPaths_);
        this.catalog_ = options.catalog ?? Catalog.empty();
        const { activateManifest, catalog } = options;
        this.activateManifest_ = activateManifest && (model => activateManifest(model, catalog));
        this.module_ = options.module;
        this.getAudio_ = options.getAudio ?? (() => null);
        this.getSpriteAnimation_ = options.getSpriteAnimation ?? (() => null);
        this.getLocalization_ = options.getLocalization ?? (() => null);
        if (options.manifest) this.setManifest(options.manifest);

        this.textureLoader_ = new TextureLoader(options.module);
        this.spineLoader_ = new SpineAssetLoader();

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

    /**
     * The textures the engine is waiting for content for — its ledger, not a
     * mirror of this cache — with who refills each and the path it was
     * registered under. A blank path is not this layer's to fetch.
     */
    texturesAwaitingReupload(): { handle: number; content: TextureContent; path: string }[] {
        return this.owedTextureEntries_().map(row => row.content === TextureContent.Asset
            ? { ...row, path: bindingFile(logicalTextureKey(row.path)) } : row);
    }

    private owedTextureEntries_(): { handle: number; content: TextureContent; path: string }[] {
        const raw = requireResourceManager().texturesAwaitingReupload?.() ?? '';
        if (!raw) return [];
        return raw.split('\n').map((line) => {
            const [handle, content, ...path] = line.split('|');
            return {
                handle: Number(handle),
                content: Number(content) as TextureContent,
                path: path.join('|'),
            };
        });
    }

    /**
     * Decode the texture behind @p handle again, no larger than @p maxEdge texels on a side (0 is its full size), behind the same handle:
     * what texture streaming moves a texture between sizes with. Returns null when the handle cannot be resized or
     * when the requested bound would shrink a texture held at its imported size.
     */
    async resizeTexture(handle: number, maxEdge: number): Promise<{ width: number; height: number } | null> {
        const size = await this.textureLoader_.resize(handle, maxEdge, this.getLoadContext_());
        if (size) evictTextureDimensions(handle);
        return size;
    }

    /** The size of the file behind @p handle, whatever size it is held at; null for a texture no file of this realm's stands behind. */
    textureFullSize(handle: number): { width: number; height: number } | null {
        return this.textureLoader_.fullSize(handle);
    }

    /**
     * Say that a material or texture will be drawn on meshes made at run time, before loading it. A scene's MeshRenderers
     * are found when the scene loads; plants a world grows, and anything else built in code, are not in any scene, so
     * their textures were loaded at their files' size even where texture streaming starts mesh textures small. Noted
     * here, a material's textures and a texture start small and are streamed from there like a scene's.
     *
     * @experimental
     */
    noteMeshSurface(surface: { material?: string; texture?: string }): void {
        if (surface.material) this.surfaceUses_.noteMesh(this.surfaceKey_('material', surface.material));
        if (surface.texture) this.surfaceUses_.noteMesh(this.surfaceKey_('texture', surface.texture));
    }

    private surfaceKey_(type: SurfaceAsset, ref: string): string { return assetPairKey(type, this.assetIdentity_(ref)); }

    /** @internal Load a hot replacement for the texture consumers present in this world. */
    async acquireSurfaceBinding(type: SurfaceAsset, ref: string, use: SurfaceUse): Promise<AssetLease> {
        const claim = this.surfaceUses_.claim(this.surfaceKey_(type, ref), use);
        try { return await (type === 'texture' ? this.acquireTexture(ref) : this.acquireTyped(type, ref)); }
        finally { claim.release(); }
    }

    private async restoreSurfaceTexture_(handle: number): Promise<void> {
        const restoring = this.textureLoader_.restoreForSurface(handle, this.getLoadContext_());
        if (!restoring) return;
        if (!await restoring) throw new Error(`Texture ${handle} could not restore its imported size`);
        evictTextureDimensions(handle);
    }

    /** A positive edge overrides this App's initial mesh texture size. Zero uses its quality profile, or full size without one. */
    setTextureStreamingStart(edge: number | (() => number)): void {
        this.streamingStartEdge_ = edge;
    }

    private initialMeshTextureEdge_(): number {
        const edge = typeof this.streamingStartEdge_ === 'function' ? this.streamingStartEdge_() : this.streamingStartEdge_;
        return edge > 0 ? edge : streamingDefaults.get(this)?.() ?? 0;
    }

    /** Whether {@link resizeTexture} can move @p handle between sizes. */
    textureResizable(handle: number): boolean {
        return this.textureLoader_.resizable(handle);
    }

    /**
     * Held textures are restored by their producers. A native file with no registered
     * producer can still be loaded by path. Unheld GPU cache entries can be discarded.
     */
    async reuploadTexturesAfterDeviceLoss(): Promise<number> {
        const rm = requireResourceManager();
        if (!rm.adoptTextureContent) return 0;

        let restored = 0;
        let discardCold = false;
        for (const { handle, content, path: poolKey } of this.owedTextureEntries_()) {
            if (content === TextureContent.Asset && poolKey && typeof rm.trimTextureCache === 'function'
                && rm.getTextureRefCount?.(handle) === 0) {
                discardCold = true;
                continue;
            }
            const refill = textureRefill(handle);
            if (refill) {
                try {
                    if (await refill()) restored++;
                } catch (e) {
                    log.warn('assets', `Device recovery: refilling texture ${handle} (${textureContentName(content)}) failed`, e);
                }
                continue;
            }
            const path = logicalTextureKey(poolKey);
            if (content !== TextureContent.Asset || !path) {
                log.warn('assets', `Device recovery: texture ${handle} (${textureContentName(content)})`
                    + ' has no provider to refill it; it stays blank');
                rm.forgoTextureContent?.(handle);
                continue;
            }
            if (poolKey !== path && this.textureLoader_.poolKey(path, rm) !== poolKey) continue;
            const cut = path.lastIndexOf(':');
            const ref = cut < 0 ? path : path.slice(0, cut);
            const flip = cut < 0 || path.slice(cut + 1) === 'f';
            try {
                const source = this.textureBinding_(ref);
                const resident = rm.getTextureDimensions?.(handle);
                const edge = resident ? Math.max(resident.width, resident.height) : 0;
                const fresh = await this.textureLoader_.loadDetached(source.path, this.getLoadContext_(), flip, source.settings, edge);
                try { if (rm.adoptTextureContent(handle, fresh.handle)) restored++; }
                finally { rm.releaseTexture(fresh.handle); }
            } catch (e) {
                log.warn('assets', `Device recovery: re-upload failed for ${ref}`, e);
            }
        }
        // A file can be reacquired during a refill. Trim by current ownership so a new handle keeps its path.
        if (discardCold) rm.trimTextureCache();
        log.info('assets', `Device recovery: ${restored} texture(s) re-uploaded`);
        return restored;
    }

    /**
     * The meshes the engine is waiting for geometry for, by handle. No path
     * travels with them: the engine never knew one, and this layer does.
     */
    meshesAwaitingRematerialization(): number[] {
        const raw = requireResourceManager().meshesAwaitingRemat?.() ?? '';
        return raw ? raw.split(',').map(Number).filter((h) => h > 0) : [];
    }

    /** Every live mesh and whether its geometry is on the device. */
    meshRealizations(): { handle: number; realized: boolean }[] {
        const raw = requireResourceManager().meshRealizations?.() ?? '';
        if (!raw) return [];
        return raw.split(',').map((row) => {
            const [handle, realized] = row.split(':');
            return { handle: Number(handle), realized: realized === '1' };
        });
    }

    /**
     * Replays each owed mesh from its source, into the handle it already has.
     *
     * A missing provenance is a CONTRACT VIOLATION, not a mesh that turns out to
     * be unrecoverable: the engine only owes what a producer declared
     * replayable, so an absent path means this layer lost the record.
     *
     * @return How many came back. The rest stay owed.
     */
    async rematerializeMeshesAfterDeviceLoss(): Promise<number> {
        const owners = meshOwnersByPool.get(requireResourceManager());
        let restored = 0;
        for (const handle of this.meshesAwaitingRematerialization()) {
            const source = owners?.get(handle);
            if (!source) {
                log.error('assets', `Device recovery: mesh ${handle} is declared replayable and has no recorded source`);
                continue;
            }
            try {
                source.pending ??= Promise.resolve().then(() => source.owner.replayMesh_(handle, source))
                    .finally(() => { delete source.pending; });
                if (await source.pending) restored++;
                else if (owners?.get(handle) === source) log.error('assets', `Device recovery: could not restore mesh ${handle}`);
            } catch (e) {
                log.error('assets', `Device recovery: replaying mesh ${handle} failed`, e);
            }
        }
        log.info('assets', `Device recovery: ${restored} mesh(es) rematerialized`);
        return restored;
    }

    private async replayMesh_(handle: number, source: MeshRecoverySource): Promise<boolean> {
        if (this.meshOwners_?.get(handle) !== source) return false;
        const { loader } = source;
        const built = this.builtMeshes_.get(handle);
        if (built) return loader.uploadData(built, handle) !== 0;
        const path = this.pathForHandle('mesh', handle);
        if (!path) return false;
        return loader.rematerialize(handle, path, this.getLoadContext_(),
            () => this.meshOwners_?.get(handle) === source && this.pathForHandle('mesh', handle) === path);
    }

    private rememberMeshOwner_(handle: number, loader: MeshAssetLoader): void {
        if (!this.meshOwners_) {
            const rm = this.loadContext_?.resourceManager ?? getResourceManager();
            if (!rm) return;
            this.meshOwners_ = meshOwnersByPool.get(rm) ?? new Map();
            meshOwnersByPool.set(rm, this.meshOwners_);
        }
        if (this.meshOwners_.get(handle)?.owner !== this) this.meshOwners_.set(handle, { owner: this, loader });
    }

    private forgetMeshOwner_(handle: number): void {
        if (this.meshOwners_?.get(handle)?.owner === this) this.meshOwners_.delete(handle);
    }

    /**
     * Pays what the engine owes after rebuilding the device. The rebuild itself
     * is the engine's, once per loss; this only refills content. Returns whether
     * the device is whole — false while the context is not back yet, or while
     * content is still owed, so a caller retries.
     */
    async recoverFromDeviceLoss(): Promise<boolean> {
        if (!recoverDevice()) return false;
        await this.reuploadTexturesAfterDeviceLoss();
        await this.rematerializeMeshesAfterDeviceLoss();
        const whole = getDeviceStatus() === DeviceStatus.Live;
        if (!whole) {
            const owed = this.texturesAwaitingReupload().length + this.meshesAwaitingRematerialization().length;
            log.warn('assets', `Device recovery: ${owed} texture(s)/mesh(es) have not come back`);
        }
        return whole;
    }

    /** The decoded geometry behind a mesh handle this realm loaded, or null when nothing here can name it. */
    async readMeshData(handle: number): Promise<MeshData | null> {
        const path = this.pathForHandle('mesh', handle);
        const source = this.meshOwners_?.get(handle);
        if (!path || source?.owner !== this) return null;
        try {
            return await source.loader.readSource(path, this.getLoadContext_());
        } catch (e) {
            log.warn('assets', `Reading the geometry of ${path} failed`, e);
            return null;
        }
    }

    /** Uploads geometry built at run time. Returns its handle, or 0 when the engine refused it. */
    createMesh(data: MeshData): number {
        this.assertLoading_();
        const loader = this.getLoader<MeshResult>('mesh');
        if (!(loader instanceof MeshAssetLoader)) return 0;
        const handle = loader.uploadData(data);
        if (handle !== 0) {
            this.builtMeshes_.set(handle, data);
            this.rememberMeshOwner_(handle, loader);
        }
        return handle;
    }

    /** Gives back geometry {@link createMesh} made. */
    releaseBuiltMesh(handle: number): void {
        if (!this.builtMeshes_.delete(handle)) return;
        const loader = this.meshOwners_?.get(handle)?.loader ?? this.getLoader<MeshResult>('mesh');
        this.forgetMeshOwner_(handle);
        if (loader instanceof MeshAssetLoader) loader.releaseData(handle);
    }

    /**
     * A texture made here from pixels and not read from a file: RGBA, a byte a channel, rows from the top (`flipY` false keeps them as given, for
     * a texture a shader reads by its own coordinates). `srgb` false says its texels are numbers and not colours (a map a shader looks values up
     * in). Returns its handle, to give a material (`Material.setUniform(m, 'u_map', { textureId })`) or a `MeshRenderer.texture`; give it back with
     * {@link releaseBuiltTexture}. A game that works something out as it runs (a map of a world it has just generated) has no file to load it from.
     */
    async createTexture(image: { width: number; height: number; pixels: Uint8Array }, options: { srgb?: boolean; flipY?: boolean } = {}): Promise<number> {
        if (image.pixels.length !== image.width * image.height * 4) throw new Error(`createTexture: ${image.width} by ${image.height} is ${image.width * image.height * 4} bytes of RGBA, and ${image.pixels.length} were given`);
        const made = await this.textureLoader_.loadFromPixels(image.width, image.height, image.pixels, options.flipY ?? true, TextureContent.Retained, options.srgb ?? true);
        if (made.handle !== 0) this.builtTextures_.add(made.handle);
        return made.handle;
    }

    /** Gives back a texture {@link createTexture} made. */
    releaseBuiltTexture(handle: number): void {
        if (!this.builtTextures_.delete(handle)) return;
        requireResourceManager().releaseTexture(handle);
    }

    private async loadTextureVariant_(ref: string, flip: boolean, inputs = this.sceneTextureImports_.current): Promise<TextureResult> {
        const { result, lease } = await this.acquireTextureVariant_(ref, flip, undefined, inputs);
        this.textureRefs_.leaveByPath(lease.key, lease.generation);
        return result;
    }

    private async acquireTextureVariant_(
        ref: string, flip: boolean, resolution?: 'imported', inputs = this.sceneTextureImports_.current,
    ): Promise<{ result: TextureResult; lease: AssetRefLease<number>; path: string; releaseSize?: () => void }> {
        this.assertLoading_();
        const { path, settings } = this.textureBinding_(ref, undefined, inputs);
        const cacheKey = this.textureCacheKey_(path, flip);
        const epoch = this.resetEpoch_;
        const load = await this.textureCache_.getOrLoad(cacheKey, async () => {
            // Warm-cache hit: a texture whose last reference was released stays
            // resident in the C++ pool (up to the texture budget) under this
            // exact key — reviving it skips the whole fetch + decode + upload.
            const revived = this.reviveResidentTexture_(cacheKey);
            if (revived) return { value: revived };
            const use = this.surfaceUses_.use(this.surfaceKey_('texture', ref));
            const options = {
                settings, resolution: use === 'full' ? 'imported' as const : resolution,
                startEdge: use === 'mesh' && resolution !== 'imported' ? this.initialMeshTextureEdge_() : 0,
            };
            const ctx = this.getLoadContext_();
            const value = flip
                ? await this.textureLoader_.load(path, ctx, options)
                : await this.textureLoader_.loadRaw(path, ctx, options);
            return { value };
        });
        // BEFORE acquiring, so no ledger entry is ever created for a load nobody
        // is left to own — one that N shared callers would each then drop,
        // releasing the load's single C++ reference N times.
        if (epoch !== this.resetEpoch_) {
            this.releaseUnclaimedTexture_(load);
            throw new Error(
                `Assets were released while "${ref}" was loading; its texture has no owner. Load it again.`,
            );
        }
        const result = load.value;
        const lease = this.textureRefs_.acquireLoad(cacheKey, result.handle, load);
        // The last holder may release between a cache hit and this continuation.
        if (!lease) return this.acquireTextureVariant_(ref, flip, resolution, inputs);
        const releaseSize = resolution === 'imported' ? this.textureLoader_.holdImportedSize(result.handle) : undefined;
        try {
            if (this.textureLoader_.mayHoldReducedTextures && (resolution === 'imported'
                || this.surfaceUses_.use(this.surfaceKey_('texture', ref)) === 'full')) {
                await this.restoreSurfaceTexture_(result.handle);
                this.assertLoading_(epoch);
            }
            this.recordHandlePath_('texture', result.handle, path);
            // The imported nine-slice border also belongs on revived and externally supplied handles.
            if (settings?.sliceBorder) {
                const b = settings.sliceBorder;
                requireResourceManager().setTextureMetadata(result.handle, b.left, b.right, b.top, b.bottom);
            }
            return { result, lease, path, releaseSize };
        } catch (error) {
            releaseSize?.();
            this.releaseTextureLease(lease);
            throw error;
        }
    }

    private releaseUnclaimedTexture_(load: TextureLoad): void {
        if (load.generation !== undefined) return;
        load.generation = null;
        this.textureLoader_.unload(load.value);
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
        const handle = rm.acquireTextureByPath(this.textureLoader_.poolKey(cacheKey, rm));
        if (!handle) return null;
        const dims = rm.getTextureDimensions(handle);
        if (!dims) {
            rm.releaseTexture(handle);
            return null;
        }
        const value = { handle, width: dims.width, height: dims.height };
        this.textureLoader_.adoptRevived(handle, cacheKey, value);
        return value;
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
        const path = this.handleLoadKey_('texture', ref);
        return this.textureCache_.get(this.textureCacheKey_(path, true))?.value;
    }

    /**
     * The load path behind a LIVE handle (`kind` = the asset slot type:
     * 'texture' | 'material' | 'font' | …), or null when this realm never
     * loaded such a handle. The reverse of ref resolution — the live "Game"
     * inspector uses it to show WHICH asset a World component's handle-valued
     * slot is wearing (a raw handle number names nothing to a human).
     */
    pathForHandle(kind: string, handle: number): string | null {
        const path = this.handlePaths_.get(kind)?.get(handle);
        return path === undefined ? null : bindingFile(path);
    }

    private meshGIResolver_?: (path: string) => MeshGIRefs | null;

    /** @internal Project index used by the edit viewport for loose meshes. */
    setMeshGIResolver(resolve: (path: string) => MeshGIRefs | null): void { this.meshGIResolver_ = resolve; }

    /** @internal GI belongs to the placed logical mesh even when two mesh records ship identical geometry. */
    meshGIForHandle(handle: number): MeshGIRefs | null {
        const key = this.handlePaths_.get('mesh')?.get(handle);
        if (!key) return null;
        const file = bindingFile(key);
        if (this.manifestModel_) {
            const logical = bindingRecord(key);
            if (logical) return this.manifestModel_.meshGIFor(logical);
            const record = this.manifestRecord_(file);
            return record && !this.manifestModel_.sharesFile(record.asset.path) ? this.manifestModel_.meshGIFor(record.key) : null;
        }
        return this.meshGIResolver_ ? this.meshGIResolver_(file) : siblingMeshGIRefs(this.catalog.addressOf(file) ?? file);
    }

    /**
     * The load path of a texture by the id the renderer bound it with — a frame
     * capture's `textureId` — rather than by asset handle. Null for a texture no
     * asset of this realm loaded: the white fill, a render target, a glyph atlas.
     */
    pathForRenderedTexture(renderId: number): string | null {
        const rm = getResourceManager();
        if (!rm || renderId === 0) return null;
        for (const [handle, path] of this.handlePaths_.get('texture') ?? []) {
            if (rm.getTextureGLId(handle) === renderId) return bindingFile(path);
        }
        return null;
    }

    /** Record a handle→path pair, dropped on invalidation or final release. */
    private recordHandlePath_(kind: string, handle: number, path: string, loader?: AssetLoader<unknown>): void {
        if (!handle) return;
        let paths = this.handlePaths_.get(kind);
        if (!paths) {
            paths = new Map();
            this.handlePaths_.set(kind, paths);
        }
        paths.set(handle, path);
        if (loader instanceof MeshAssetLoader) this.rememberMeshOwner_(handle, loader);
    }

    /** {@link acquireSpine} without the receipt, for a caller that will let the
     *  realm's teardown be its release. */
    async loadSpine(skeletonRef: string, atlasRef?: string): Promise<SpineResult> {
        const lease = await this.acquireSpine(skeletonRef, atlasRef);
        this.genericRefs_.leaveByPath(lease.key, lease.generation);
        return lease.value;
    }

    /**
     * One spine PAIR — a skeleton and the atlas it is drawn with. The same
     * skeleton with another atlas is another asset, which is why the receipt
     * names the pair and not the skeleton's path.
     */
    async acquireSpine(skeletonRef: string, atlasRef?: string): Promise<AssetLease<SpineResult>> {
        try { return await this.acquireSpineLease_(skeletonRef, atlasRef); }
        catch (error) { throw preparationFailureReason(error); }
    }

    private async acquireSpineLease_(skeletonRef: string, atlasRef?: string, owner?: AssetDependencyOwner,
        inputs = this.sceneTextureImports_.current): Promise<AssetLease<SpineResult>> {
        const skeleton = this.resolveLoadPath_(skeletonRef);
        const atlas = this.spineAtlasOf_(skeleton, atlasRef);
        if (!atlas) {
            throw new Error(`Spine skeleton has no atlas dependency: ${skeleton}. `
                + 'Pass the atlas explicitly or configure Catalog deps.');
        }
        const pair = assetPairKey(skeleton, atlas);
        const key = this.spineBinding_(pair, inputs);
        return this.acquirePrepared_<SpineResult>(
            this.spineLoader_, key, skeletonRef,
            (ctx) => this.spineLoader_.prepare(skeleton, atlas, ctx), owner, inputs,
        );
    }

    private spineBinding_(pair: string, inputs = this.sceneTextureImports_.current): string {
        return inputs.settings.size ? this.sceneBinding_('spine', pair, inputs.signature) : pair;
    }

    /** The atlas of a pair the caller named only half of: a skeleton's atlas is
     *  a Catalog dependency, which is what a cook records for it. */
    private spineAtlasOf_(skeleton: string, atlasRef?: string): string | undefined {
        const atlas = atlasRef || this.catalog.getDeps(skeleton)[0];
        return atlas ? this.resolveLoadPath_(atlas) : undefined;
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

    private directLocalePublication_(ref: string): () => void {
        const service = this.getLocalization_();
        if (!service) throw new Error(`${ref}: no Localization resource — add localizationPlugin to the app before loading locale tables`);
        const id = this.registryIdentity_(ref);
        const publish = localeCatalogsFor(service).prepare(id, this);
        return () => {
            const current = this.getLocalization_();
            const table = this.resolveRegistryAsset<LocaleTableAsset>('locale', id);
            if (!table || !current) return;
            if (current === service) publish(table);
            localeCatalogsFor(current).keepDirect(this, id, table);
        };
    }

    private localeTables_(): ProjectLocaleTables {
        return this.projectLocales_ ??= new ProjectLocaleTables(this, this.appScope_, {
            identity: ref => this.registryIdentity_(ref),
            path: ref => {
                const asset = this.manifestRecord_(ref)?.asset;
                return asset?.address ?? asset?.path ?? ref;
            },
            acquire: ref => this.acquireTypedLease_('locale', ref, undefined, 'project'),
            table: id => this.loaders_.get('locale') instanceof LocaleAssetLoader
                ? this.resolveRegistryAsset<LocaleTableAsset>('locale', id) : undefined,
        });
    }

    /** @internal Plugin startup installs configured tables into the current app catalog. */
    async installProjectLocaleTables(configured: readonly string[], discovered?: readonly string[]): Promise<void> {
        const service = this.getLocalization_();
        if (!service) throw new Error('Project locale tables require a Localization resource');
        await this.localeTables_().install(service, configured, discovered);
    }

    /** @internal Keep a scene's translations in its own scope until publication succeeds. */
    prepareProjectLocaleTables(configured: readonly string[], discovered: readonly string[], scope: AssetScope,
        assertCurrent: () => void): Promise<PreparedProjectLocaleTables> {
        const epoch = this.resetEpoch_;
        return this.localeTables_().prepare(configured, discovered, scope, () => {
            assertCurrent();
            this.assertLoading_(epoch);
        });
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
        return this.atlasFrameIn_(this.catalog, ref);
    }

    private atlasFrameIn_(catalog: Catalog, ref: string, path?: string): AtlasFrameInfo | null {
        // Raw ref first: atlas frames register under every ref SPELLING
        // (`@uuid:…`, logical, "/"-rooted). The resolved path is the fallback —
        // for packed frames it is the shared PAGE path, which cannot key
        // per-frame data.
        return catalog.getAtlasFrame(ref) ?? catalog.getAtlasFrame(path ?? this.resolveLoadPath_(ref));
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
        const model =
            manifest == null ? null
            : manifest instanceof ManifestModel ? manifest
            : ManifestModel.fromJson(manifest);
        const catalog = this.activateManifest_?.(model) ?? this.catalog_;
        this.catalog_ = catalog.withManifestLabels(model);
        this.manifestModel_ = model;
        for (const [url, path] of this.stagedPaths_) {
            if (!model?.assetByPath(path)) this.stagedPaths_.delete(url);
        }
        // A platform subpackage is mounted by name for this app version. A label edit can reuse that mount.
        for (const name of this.subpackages_.keys()) {
            if (model?.bundleMode(name) !== 'lazy') this.subpackages_.delete(name);
        }
        this.loadContext_ = null;
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
        const members: BatchAsset[] = [];
        for (const ref of this.catalog.getByLabel(label)) {
            const record = this.manifestRecord_(ref);
            if (record) members.push(this.batchAsset_(record.key, record.asset, record.group));
            else {
                const entry = this.catalog.getEntry(ref);
                if (entry) members.push({ ref, name: ref, type: entry.type });
            }
        }
        return this.loadBatch_(`loadByLabel('${label}')`, members, onProgress);
    }

    /** Load the registered asset types in a group, mounting its subpackage before reading its files. */
    async loadGroup(
        groupName: string,
        onProgress?: (loaded: number, total: number) => void,
    ): Promise<AssetBundle> {
        const group = this.manifestModel_?.group(groupName);
        if (!this.manifestModel_) log.warn('asset', `loadGroup('${groupName}') called but no manifest is set`);
        const members = Object.entries(group?.assets ?? {}).map(([key, asset]) => this.batchAsset_(key, asset, groupName));
        return this.loadBatch_(`loadGroup('${groupName}')`, members, onProgress, groupName);
    }

    private batchAsset_(key: string, asset: AddressableManifestAsset, group: string): BatchAsset {
        const ref = this.groupAssetRef_(key, asset, this.manifestModel_?.bundleMode(group) === 'remote');
        // An atlas frame owns a receipt for the page texture but keeps its authored name in the bundle.
        const name = asset.metadata?.atlasFrame ? asset.address ?? key : ref;
        return { ref, name, group, type: asset.type };
    }

    private batchChannel_(type: string): GroupAssetChannel | undefined {
        return GROUP_ASSET_CHANNELS.get(type) ?? (this.loaders_.has(type) ? scopedGroupChannel(type) : undefined);
    }

    /** Concurrent callers share a mount. A rejected request leaves the package available for retry. */
    private mountSubpackage_(group: string): Promise<void> {
        const existing = this.subpackages_.get(group);
        if (existing) return existing;
        const mount = Promise.resolve().then(() => platformLoadSubpackage(group)).catch(error => {
            if (this.subpackages_.get(group) === mount) this.subpackages_.delete(group);
            throw new RetryableAssetError(`Could not mount subpackage '${group}': ${error instanceof Error ? error.message : String(error)}`, error);
        });
        this.subpackages_.set(group, mount);
        return mount;
    }

    private async loadBatch_(
        caller: string, members: Iterable<BatchAsset>,
        onProgress?: (loaded: number, total: number) => void, requestedGroup?: string,
    ): Promise<AssetBundle> {
        const bundle = emptyBundle();
        const groups = new Set<string>(requestedGroup ? [requestedGroup] : []);
        const tasks: Array<() => Promise<void>> = [];
        for (const { ref, name, type, group } of members) {
            const channel = this.batchChannel_(type);
            if (!channel) continue;
            if (group) groups.add(group);
            tasks.push(async () => {
                try { await channel.load(this, ref, bundle, name); }
                catch (error) { bundle.failed.push({ ref, type, reason: 'load-failed', error: String(error) }); }
            });
        }
        let loaded = 0;
        onProgress?.(0, tasks.length);
        const lazy = [...groups].filter(group => this.manifestModel_?.bundleMode(group) === 'lazy');
        await Promise.all(lazy.map(group => this.mountSubpackage_(group)));
        try {
            await runWithConcurrency(tasks, RuntimeConfig.preloadConcurrency, () => onProgress?.(++loaded, tasks.length));
        } catch (error) {
            bundle.release();
            throw error;
        }
        warnFailedLoads(bundle.failed, caller);
        return bundle;
    }

    /**
     * Release every asset the group's CURRENT membership names.
     *
     * @details Prefer `bundle.release()` on what {@link loadGroup} returned:
     *          this door re-reads the manifest, so an update between the two
     *          releases a set the load never took. No-op without a manifest.
     */
    releaseGroup(groupName: string): void {
        const model = this.manifestModel_;
        if (!model) {
            log.warn('asset', `releaseGroup('${groupName}') called but no manifest is set`);
            return;
        }
        const mode = model.bundleMode(groupName);
        for (const [key, asset] of Object.entries(model.group(groupName)?.assets ?? {})) {
            // The SAME path loadGroup acquired under. Resolving it a different
            // way here would release a key nobody holds, which is a leak that
            // looks exactly like a working release.
            const path = this.groupAssetRef_(key, asset, mode === 'remote');
            this.batchChannel_(asset.type)?.release(this, path);
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
        this.loadContext_ = null;
    }

    /** The load url for a manifest asset. A `remote`-group asset resolves to its
     *  `<root>/<path>` CDN url when a root is set; every other case (local / lazy
     *  group, or a remote group with no CDN root — same-origin realms like editor
     *  Play) resolves through the normal resolver + Catalog. The single remote/local
     *  routing rule shared by {@link loadGroup} and {@link fetchAndVerify_}, so a
     *  loadGroup'd asset and the same asset reached by a scene `@uuid` ref (via
     *  {@link resolveLoadPath_} → {@link remoteAssetPath_}) never resolve two ways. */
    private manifestAssetUrl_(path: string, isRemote: boolean, root: string | undefined = this.remoteRoot_): string {
        return isRemote && root ? remoteAssetUrl(path, root) : this.resolveLoadPath_(path);
    }

    private groupAssetRef_(key: string, asset: AddressableManifestAsset, remote: boolean): string {
        if (this.manifestModel_?.sharesFile(asset.path) && (this.sceneHandleRecord_(key) || this.loaders_.get(asset.type)?.registry)) return key;
        if (asset.type === 'audio' && asset.address) return asset.address;
        return this.manifestAssetUrl_(asset.path, remote);
    }

    private planUpdate_(model: ManifestModel, nextRoot: string | null): UpdatePlan {
        return diffManifests(this.manifestModel_, model, { current: this.remoteRoot_, next: nextRoot });
    }

    /**
     * Fetch a candidate manifest and diff it against the active one WITHOUT
     * applying anything — the "is there an update, and how big?" query. The
     * returned plan lists both payloads to download and assets that can reuse
     * their bytes. The candidate is staged for {@link applyUpdate}.
     */
    async checkForUpdate(options: CheckForUpdateOptions): Promise<UpdatePlan> {
        const text = await this.backend.fetchText(this.backend.resolveUrl(options.manifestUrl));
        const json = JSON.parse(text) as AddressableManifest;
        const model = ManifestModel.fromJson(json);
        const remoteRoot = options.remoteRoot ?? this.remoteRoot_ ?? null;
        const plan = this.planUpdate_(model, remoteRoot);
        this.pendingUpdate_ = { model, manifestJson: json, remoteRoot };
        await this.protectCacheVersions_();
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
        this.applying_++;
        const run = this.applyChain_.then(async () => {
            try { return await this.applyStaged_(onProgress); }
            finally { this.activeUpdate_ = null; }
        });
        this.applyChain_ = run.catch(() => {});
        try {
            return await run;
        } finally {
            this.applying_--;
        }
    }

    private async applyStaged_(onProgress?: (loaded: number, total: number) => void): Promise<ApplyUpdateResult> {
        const pending = this.pendingUpdate_;
        const revision = (): string | null => this.manifestModel_?.revision() ?? null;
        const none: UpdateStages = { verified: false, applied: false, persisted: false, cached: false };
        if (!pending) {
            log.warn('asset', 'applyUpdate() called with no pending update — call checkForUpdate first');
            onProgress?.(0, 0);
            return { ok: false, updated: 0, failed: [], stages: none, revision: revision(), uncached: [], reason: 'nothing-staged' };
        }
        // Against what runs NOW, not what ran when it was checked: an apply that
        // finished in between moved the base, and its assets need no second download.
        const plan = this.planUpdate_(pending.model, pending.remoteRoot);
        const downloads = plan.downloadFiles;
        const root = pending.remoteRoot ?? undefined;
        this.activeUpdate_ = pending;
        await this.protectCacheVersions_();

        // Phase 1 — download + verify EVERY changed asset WITHOUT touching the
        // active manifest. Content-addressed, so these are brand-new urls (nothing
        // is overwritten); any failure here leaves the old manifest active = rollback.
        const failed: AssetDownloadFailure[] = [];
        const uncached: string[] = [];
        let cacheable = false;
        let done = 0;
        onProgress?.(0, downloads.length);
        const tasks = downloads.map((c) => async (): Promise<void> => {
            const got = await this.fetchAndVerify_(c, pending.model, root);
            if (got.failure) failed.push({ path: c.path, reason: got.failure });
            if (got.cache !== 'unsupported' && got.cache !== undefined) cacheable = true;
            if (got.cache === 'failed') uncached.push(got.url);
        });
        await runWithConcurrency(tasks, RuntimeConfig.preloadConcurrency, () => {
            onProgress?.(++done, downloads.length);
        });

        if (failed.length > 0) {
            log.warn('asset', `applyUpdate: ${failed.length}/${downloads.length} asset(s) failed — update rolled back (manifest unchanged)`);
            return { ok: false, updated: 0, failed, stages: none, revision: revision(), uncached: [] };
        }

        const rollback = this.cacheVersion_(this.manifestModel_, this.remoteRoot_, 'rollback');
        // Protect both sides durably BEFORE committing: a crash may still boot
        // the old persisted manifest until the new one has been stored.
        const previousRollback = this.cacheRollback_;
        const changed = [...plan.changedAssets, ...plan.reconfiguredAssets];
        let previousSources: ManifestBindingSource[];
        this.cacheRollback_ = rollback;
        try {
            await this.protectCacheVersions_(this.cacheVersion_(pending.model, root, 'current'));
            previousSources = this.rememberManifestBindings_([...changed, ...plan.removedAssets]);
            this.setManifest(pending.model);
        } catch (err) {
            this.cacheRollback_ = previousRollback;
            throw err;
        }
        if (pending.remoteRoot != null) this.setRemoteRoot(pending.remoteRoot);
        const outgoing = this.manifestBindings_.heldValues(changed, this.textureRefs_, this.genericRefs_);
        const nextTypes = new Map(changed.map(c => [c.key, c.type]));
        const metadataOnly = new Set(plan.reconfiguredAssets.map(c => c.key));
        for (const source of previousSources) {
            const { key } = source;
            // A frame can move or change sampler while siblings still use the previous upload.
            // Its binding is refreshed below. Retire the GPU page only when its bytes actually leave.
            const page = source.page;
            if (page && (metadataOnly.has(key)
                || (page.contentHash && pending.model.assetByPath(page.path)?.contentHash === page.contentHash))) continue;
            const sameFile = nextTypes.get(key) === source.type
                && sceneBindingBase(this.handleLoadKey_(source.type, source.ref)) === sceneBindingBase(source.path);
            this.endManifestResidency_(source, sameFile);
        }
        // A newer check staged while this one downloaded stays staged.
        if (this.pendingUpdate_ === pending) this.pendingUpdate_ = null;
        for (const c of changed) {
            const values = outgoing.get(c.key);
            if (values) {
                for (const { value: oldValue, profile } of values.values()) {
                    const bindingRef = this.replacementBinding_(c.type, c.key, profile);
                    this.fireInvalidate_({ ref: c.key, type: c.type, oldValue, ...(bindingRef && { bindingRef }) });
                }
            } else {
                this.fireInvalidate_({ ref: c.key, type: c.type });
            }
        }
        for (const c of changed) this.fireSourceChanged_(c.key);
        if (changed.length) this.track_(this.rebuildChangedFiles_(changed.map(c => c.key)));
        // The update is applied when the asset graph agrees with the manifest —
        // not when the manifest was swapped. Bindings converge on a frame, which
        // an app that is not ticking would never reach from here.
        await this.assetGraphSettled();
        const persisted = this.persistActiveManifest_(pending.manifestJson);
        // Until storage accepts the new manifest, the previous next-launch
        // version AND its rollback must remain pinned across subsequent updates.
        if (persisted === true) {
            this.cacheLaunch_ = this.cacheVersion_(pending.model, root, 'retained');
            this.cacheLaunchRollback_ = rollback ? { ...rollback, reason: 'retained' } : null;
        }
        await this.protectCacheVersions_().catch(e => log.warn('asset', 'updated content is protected but its cache index could not be refreshed', e));
        if (persisted !== true) {
            log.warn('asset', persisted === false
                ? 'applyUpdate: the update runs now, but was not stored — the next launch starts on the previous version'
                : 'applyUpdate: no persistence key (restorePersistedUpdate was never called), so the next launch starts on what shipped');
        }
        return {
            ok: true, updated: changed.length, failed: [], revision: revision(), uncached,
            stages: { verified: true, applied: true, persisted, cached: cacheable ? uncached.length === 0 : null },
        };
    }

    private endManifestResidency_(source: ManifestBindingSource, sameFile: boolean): void {
        const ended = this.endCachedEra_({ type: source.type, path: source.ref }, source.path);
        if (!sameFile && !ended.dropped) return;
        const loader = this.loaders_.get(source.type);
        if (!sameFile && loader === this.textureLoader_) {
            this.textureLoader_.detachSource(source.path);
            return;
        }
        try { loader?.invalidate?.(ended.residencyPath); }
        catch (error) { log.warn('asset', `could not invalidate loader residency for "${source.ref}"`, error); }
    }

    private rememberManifestBindings_(changes: readonly AssetChange[]): ManifestBindingSource[] {
        const sources: ManifestBindingSource[] = [];
        for (const c of changes) {
            const prior = this.manifestModel_?.assetByKey(c.key);
            if (!prior && this.manifestModel_) continue;
            const type = prior?.type ?? c.type;
            if (!this.loaders_.get(type)?.load) continue;
            const uuid = extractUuid(c.key);
            const ref = uuid ? `${UUID_REF_PREFIX}${uuid}` : c.key;
            const path = this.handleLoadKey_(type, ref);
            const base = this.currentPrepared_(type, ref)?.owner.key ?? path;
            for (const binding of this.sampledTypes_.has(type) ? this.sampledPaths_(type, sceneBindingBase(base)) : [base]) {
                sources.push({ key: c.key, type, ref, path: binding, page: prior?.metadata?.atlasFrame ? prior : undefined });
                const generations = type === 'texture' && this.loaders_.get(type) === this.textureLoader_
                    ? this.textureRefs_.generations(this.textureCacheKey_(binding, true))
                    : this.genericRefs_.generations(assetPairKey(type, binding));
                this.manifestBindings_.remember(type, c.key, generations);
            }
        }
        return sources;
    }

    /** Which revision runs, which one the next launch starts on, and what is staged. */
    updateStatus(): UpdateStatus {
        const pending = this.pendingUpdate_;
        const plan = pending ? this.planUpdate_(pending.model, pending.remoteRoot) : null;
        return {
            revision: this.manifestModel_?.revision() ?? null,
            persistedRevision: this.persistedRevision_(),
            staged: plan ? {
                revision: plan.toRevision, assets: plan.downloadFiles.length, bytes: plan.totalBytes,
            } : null,
            applying: this.applying_ > 0,
        };
    }

    private cacheVersion_(model: ManifestModel | null, root: string | undefined, reason: CacheVersion['reason']): CacheVersion | null {
        if (!model) return null;
        const urls = new Set<string>();
        for (const { group, asset } of model.entries()) {
            if (model.bundleMode(group) !== 'remote') continue;
            for (const file of physicalAssetFiles(asset)) {
                if (!root && !/^https?:\/\//i.test(file.path)) continue;
                const url = this.backend.resolveUrl(remoteAssetUrl(file.path, root));
                if (/^https?:\/\//i.test(url)) urls.add(url);
            }
        }
        const keys = [...urls];
        return { revision: model.revision() ?? contentHashHex(encodeUtf8(JSON.stringify(keys))), reason, keys };
    }

    private async protectCacheVersions_(current?: CacheVersion | null): Promise<void> {
        if (!isPlatformInitialized()) return;
        const cache = contentCacheFor(getPlatform());
        if (cache.capability() !== 'managed') return;
        this.cacheOwner_ ??= `assets:${this.persistKey_ ?? this.remoteRoot_ ?? 'package'}`;
        this.cacheLaunch_ ??= this.cacheVersion_(this.manifestModel_, this.remoteRoot_, 'retained');
        const versions = [current ?? this.cacheVersion_(this.manifestModel_, this.remoteRoot_, 'current'),
            this.cacheRollback_, this.cacheLaunch_, this.cacheLaunchRollback_];
        for (const update of [this.pendingUpdate_, this.activeUpdate_]) if (update) {
            versions.push(this.cacheVersion_(update.model, update.remoteRoot ?? undefined, 'pending'));
        }
        await cache.protect(this.cacheOwner_, versions.filter((v): v is CacheVersion => v !== null));
    }

    /** Disk cache statistics, distinct from texture/audio residency budgets.
     * A scan reconciles interrupted writes/deletes; unknown files stay pinned. */
    async diskCacheReport(rescan = false): Promise<ContentCacheReport> {
        if (!isPlatformInitialized()) return { capability: 'unavailable', usedBytes: null, indexBytes: null,
            protectedBytes: null, reclaimableBytes: null, entries: [], versions: [] };
        // Keep in-memory protection even at quota: requiring an index write
        // before showing/cleaning a full disk would make it impossible to free.
        await this.protectCacheVersions_().catch(e => log.warn('asset', 'cache protection is active but its index could not be stored', e));
        return { ...await contentCacheFor(getPlatform()).report(rescan), owner: this.cacheOwner_ ?? undefined };
    }

    /** Preview by default; execution recomputes LRU against current protections. */
    async cleanDiskCache(budgetBytes: number, execute = false): Promise<CacheCleanupResult> {
        if (!Number.isSafeInteger(budgetBytes) || budgetBytes < 0) throw Error('cache budget must be a non-negative safe integer');
        await this.diskCacheReport();
        if (!isPlatformInitialized()) return { report: await this.diskCacheReport(), budgetBytes,
            candidates: [], releaseBytes: 0, remainingBytes: null, budgetMet: null, removed: [], failed: [] };
        const result = await contentCacheFor(getPlatform()).cleanup(budgetBytes, execute);
        result.report.owner = this.cacheOwner_ ?? undefined;
        return result;
    }

    /** Keep an older downloaded build, independently of the rolling rollback. */
    async retainDiskCacheVersion(revision: string, retain = true): Promise<ContentCacheReport> {
        await this.diskCacheReport();
        if (!isPlatformInitialized() || !this.cacheOwner_) throw Error('cache management unavailable');
        const cache = contentCacheFor(getPlatform());
        await cache.retainVersion(this.cacheOwner_, revision, retain);
        return { ...await cache.report(), owner: this.cacheOwner_ };
    }

    /** Download one changed asset's bytes from its delivery source (remote → CDN
     *  url against `root`, else the normal resolved path) and verify the content
     *  hash. Null on success, else the failure reason. Uses the PENDING manifest +
     *  root — phase 1 runs before the swap. */
    private async fetchAndVerify_(
        c: UpdateFile, model: ManifestModel, root: string | undefined,
    ): Promise<{ url: string; failure?: AssetDownloadFailure['reason']; cache?: 'stored' | 'failed' | 'unsupported' }> {
        const mode = model.bundleMode(c.group);
        const remote = mode === 'remote';
        // An export with hot update configured does not pack; a manifest that does
        // was built for a package that is not updated, and is refused rather than
        // fetched as files that do not exist.
        if (c.kind === 'pack') return { url: c.path, failure: 'packed' };
        // The candidate supplies a staged path. Resolving it against the active
        // manifest would send a move from CDN to package back to the old CDN.
        const path = remote ? remoteAssetUrl(c.path, root) : c.path;
        const url = this.transport_.resolveUrl(path);
        try {
            if (mode === 'lazy') await this.mountSubpackage_(c.group);
            const buf = await this.transport_.fetchBinary(url);
            if ((c.kind === 'streamTail' && c.size > 0 && buf.byteLength !== c.size)
                || (c.contentHash && contentHashHex(new Uint8Array(buf)) !== c.contentHash)) {
                return { url, failure: 'integrity' };
            }
            // Verified, content-addressed bytes go to the disk cache keyed by the
            // immutable CDN url, so the next launch reads them offline. A refused
            // write does not fail the update; it is reported as not cached.
            return { url, cache: remote ? await platformWriteCacheFile(url, buf) : undefined };
        } catch {
            return { url, failure: 'fetch' };
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
        // What this package shipped: an update stored against any other package is
        // older than what the player now has installed.
        this.shippedRevision_ = this.manifestModel_?.revision() ?? null;
        const raw = platformGetStorageItem(key);
        if (!raw) return false;
        try {
            const parsed = JSON.parse(raw) as { manifest: AddressableManifest; remoteRoot?: string | null; base?: string | null; cacheRollback?: CacheVersion | null };
            if (parsed.base === undefined || parsed.base !== this.shippedRevision_) {
                log.info('asset', `a stored update (${parsed.manifest?.revision ?? '?'}) was made for another package `
                    + `(${parsed.base ?? 'unknown'}, this one ships ${this.shippedRevision_ ?? 'none'}) — starting on what shipped`);
                platformRemoveStorageItem(key);
                return false;
            }
            this.setManifest(parsed.manifest);
            if (parsed.remoteRoot) this.setRemoteRoot(parsed.remoteRoot);
            if (parsed.cacheRollback && typeof parsed.cacheRollback.revision === 'string'
                && Array.isArray(parsed.cacheRollback.keys) && parsed.cacheRollback.keys.every(k => typeof k === 'string')) {
                this.cacheRollback_ = { ...parsed.cacheRollback, reason: 'rollback' };
                this.cacheLaunchRollback_ = { ...this.cacheRollback_, reason: 'retained' };
            }
            void this.protectCacheVersions_().catch(e => log.warn('asset', 'cache protection could not be persisted', e));
            return true;
        } catch (e) {
            log.warn('asset', 'failed to restore persisted manifest', e);
            return false;
        }
    }

    /** True once stored and read back; a store can drop a write without throwing.
     *  Null with no persistence key. */
    private persistActiveManifest_(json: AddressableManifest): boolean | null {
        if (!this.persistKey_) return null;
        const value = JSON.stringify({ manifest: json, remoteRoot: this.remoteRoot_ ?? null, base: this.shippedRevision_, cacheRollback: this.cacheRollback_ });
        try {
            platformSetStorageItem(this.persistKey_, value);
            return platformGetStorageItem(this.persistKey_) === value;
        } catch (e) {
            log.warn('asset', 'failed to persist updated manifest', e);
            return false;
        }
    }

    private persistedRevision_(): string | null {
        const raw = this.persistKey_ ? platformGetStorageItem(this.persistKey_) : null;
        if (!raw) return null;
        try {
            return (JSON.parse(raw) as { manifest?: AddressableManifest }).manifest?.revision ?? null;
        } catch {
            return null;
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
        const mounts = new Map<string, Promise<void>>();

        for (const ref of refs) {
            const path = this.resolveLoadPath_(ref);
            const record = this.manifestRecord_(ref);
            const type = record?.asset.type ?? this.inferAssetType_(path);
            if (!type) {
                log.warn('asset', `preload: cannot determine asset type for ${ref}`);
                failed.push({ ref, reason: 'unresolved' });
                continue;
            }
            const named = type === 'audio' || this.sceneHandleRecord_(ref) || this.loaders_.get(type)?.registry;
            const load = this.typedLoadFor_(named ? ref : path, type);
            if (!load) {
                log.warn('asset', `preload: no loader for type '${type}' (${ref})`);
                failed.push({ ref, type, reason: 'unresolved' });
                continue;
            }
            const lazy = record && this.manifestModel_?.bundleMode(record.group) === 'lazy' ? record.group : undefined;
            tasks.push(async () => {
                try {
                    if (lazy) {
                        const mount = mounts.get(lazy) ?? this.mountSubpackage_(lazy);
                        mounts.set(lazy, mount);
                        await mount;
                    }
                    await load();
                } catch (e) {
                    log.warn('asset', `preload: failed to load ${ref}`, e);
                    failed.push({ ref, type, reason: 'load-failed', error: e instanceof Error ? e.message : String(e) });
                }
            });
        }

        let loadedCount = 0;
        const totalCount = tasks.length;
        onProgress?.(0, totalCount);
        const maxConcurrent = options?.maxConcurrent ?? RuntimeConfig.preloadConcurrency;
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
            case 'font':    return () => this.loadFont(path);
            default:
                return this.loaders_.has(type) ? () => this.loadTyped(type, path) : null;
        }
    }

    // =========================================================================
    // Raw Data (escape hatch)
    // =========================================================================

    async fetchJson<T = unknown>(ref: string): Promise<T> {
        return JSON.parse(await this.fetchText(ref)) as T;
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
        options?: {
            readonly maxConcurrent?: number; readonly skipSpine?: boolean;
            /** The level of the one line that says what was preloaded and how long it took. Default 'info'. */
            readonly summary?: 'info' | 'debug';
            /** Record declaring entities. Managed scenes need only dependencies outside stored fields. */
            readonly entityOwnership?: boolean | 'auxiliary';
            /** Receive the authored references before any acquisition or progress notification. */
            readonly onDiscover?: (authored: SceneAssetRefs) => void;
            /** @internal Stop starting work when the owning scene can no longer publish. */
            readonly assertCurrent?: () => void;
            /** @internal Resolve live component writes with the owning scene or the entity's retained settings. */
            readonly owner?: { world: World; entity: Entity; sceneScope?: AssetScope | null };
        },
    ): Promise<SceneAssetResult> {
        const owner = options?.owner;
        const inputs = owner && this.entityScopes_.textureInputsFor(owner.world, owner.entity, owner.sceneScope);
        return this.preloadSceneAssets_(sceneData, onProgress, options, undefined, inputs);
    }

    private async preloadSceneAssets_(
        sceneData: SceneData,
        onProgress?: (loaded: number, total: number) => void,
        options?: Parameters<Assets['preloadSceneAssets']>[2],
        recorder?: DependencyRecorder, inherited = this.sceneTextureImports_.current,
    ): Promise<SceneAssetResult> {
        const assertCurrent = options?.assertCurrent;
        assertCurrent?.();
        const missing: MissingAsset[] = [];
        const epoch = this.resetEpoch_;
        const declared = this.sceneTextureImports_.prepare(sceneData.textureImporterSettings,
            ref => this.projectTextureImport_(ref) ? undefined : this.assetIdentity_(ref), inherited);
        const inputs = declared?.inputs ?? inherited.forPreparation();
        const scope = new AssetScope();
        this.entityScopes_.recordTextureInputs(scope, inputs);
        const reader = this.sceneTextureReader_(inputs);
        const entityOwnership = options?.entityOwnership ?? false;
        const owners = new SceneAssetOwners({ entityOwnership });
        const resolve = cachedPaths(ref => this.sceneAssetRef(ref));
        const discovered = indexSceneAssets(sceneData, resolve, {
            owners, onAuthored: options?.onDiscover,
            acquireAs: (type, raw, path) => !isSceneHandleType(type) && this.loaders_.get(type)?.registry ? this.registryIdentity_(raw) : path,
            knownFile: (ref, type) => matchesAssetFieldType(this.hostAssetType_?.(ref) ?? this.catalog.assetTypeOf(ref), type),
        });
        const surfaceClaims = new Map<string, SurfaceClaim>();
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

        const handleMaps = Object.fromEntries(SCENE_HANDLE_TYPES.map(type => [
            `${type}Handles`, new Map<string, number>(),
        ])) as Pick<SceneAssetResult, `${SceneHandleType}Handles`>;
        const initialCatalog = this.catalog;
        let textureCatalogs: Map<string, Catalog> | undefined;
        const releaseCallbacks: ReleaseCallback[] = [];
        const acquisitions: SceneAssetAcquisition[] = [];
        const recordAcquisition = (type: string, path: string, lease: AssetLease): void => {
            const claim = surfaceClaims.get(assetPairKey(type, path));
            if (claim) lease = claim.keep(lease);
            if (recorder) recorder.own(path, lease, type);
            else {
                scope.add(lease);
                if (owners.hasAuxiliary(type, path)) scope.preserveDependency(lease);
            }
            acquisitions.push({ type, path, lease, entityIds: entityOwnership ? owners.get(type, path) : undefined,
                auxiliaryEntityIds: entityOwnership ? owners.auxiliaryFor(type, path) : undefined });
            releaseCallbacks.push(() => lease.release());
        };

        let loadedCount = 0;

        const recordFailure = (path: string, label: string, err: unknown): void => {
            recorder?.failed(path, err);
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
        /**
         * One task per path. The receipt is recorded only when the acquire
         * SUCCEEDED — a failed load owns nothing, so there is nothing for the
         * scene to give back and nothing to guess about at unload.
         */
        const timings: SceneAssetResult['timings'] = Object.create(null);
        const timedLoad = <R>(label: string, load: () => Promise<R>): Promise<R> => {
            const began = preloadClock();
            return load().finally(() => {
                const ms = preloadClock() - began;
                const t = timings[label] ??= { count: 0, ms: 0, slowestMs: 0 };
                t.count++;
                t.ms += ms;
                t.slowestMs = Math.max(t.slowestMs, ms);
            });
        };
        const pushAcquire = (
            label: string,
            handles?: Map<string, number>,
            acquire: (path: string) => Promise<AssetLease> = path => this.acquireTypedLease_(label, path, recorder?.owner, 'direct', inputs),
        ): void => {
            for (const path of discovered.byType.get(label) ?? []) {
                tasks.push(() =>
                    timedLoad(label, () => acquire(path)).then(lease => {
                        // A baked asset's era owns these acquisitions. An ordinary
                        // scene owns them through the returned scope instead.
                        recordAcquisition(label, path, lease);
                        if (handles) {
                            handles.set(path, (lease.value as { handle?: number } | null)?.handle ?? 0);
                        }
                    }).catch(e => {
                        log.warn('asset', `Failed to load ${label}: ${path}`, e);
                        handles?.set(path, 0);
                        recordFailure(path, label, e);
                    }),
                );
            }
        };

        // Resolve for the scene map, acquire by the authored ref for this record's settings and dependencies.
        for (const type of SCENE_HANDLE_TYPES) {
            pushAcquire(type, handleMaps[`${type}Handles`], path => {
                const ref = discovered.rawFor.get(path) ?? path;
                if (type !== 'texture') return this.acquireTypedLease_(type, ref, recorder?.owner, 'direct', inputs);
                const catalog = this.catalog;
                if (catalog !== initialCatalog) (textureCatalogs ??= new Map()).set(path, catalog);
                return reader.acquireTexture(ref);
            });
        }
        // A pair, so not `pushAcquire` (which keys by one path); the receipt is
        // the scene's exactly as every other one is. The runtime scene loader
        // opts out: its second phase binds to entities that do not exist yet.
        if (!options?.skipSpine) {
            for (const pair of discovered.spines) {
                tasks.push(() =>
                    this.acquireSpineLease_(pair.skeleton, pair.atlas, recorder?.owner, inputs).then((lease) => {
                        recordAcquisition('spine', assetPairKey(pair.skeleton, pair.atlas), lease);
                    }).catch(e => {
                        log.warn('asset', `Failed to load spine: ${pair.skeleton}`, e);
                        recordFailure(pair.skeleton, 'spine', e);
                    }),
                );
            }
        }
        for (const type of discovered.byType.keys()) {
            if (isSceneHandleType(type)) continue;
            if (this.loaders_.has(type) || !SYSTEM_READ_SCENE_TYPES.has(type)) pushAcquire(type);
        }

        const totalCount = tasks.length;
        const maxConcurrent = options?.maxConcurrent ?? RuntimeConfig.preloadConcurrency;
        const began = preloadClock();
        try {
            for (const type of ['texture', 'material'] as const) {
                for (const [path, use] of owners.surfaces[type]) {
                    if (!discovered.byType.get(type)?.has(path)) continue;
                    const ref = discovered.rawFor.get(path) ?? path;
                    surfaceClaims.set(assetPairKey(type, path), this.surfaceUses_.claim(this.surfaceKey_(type, ref), use));
                }
            }
            const reportProgress = (loaded: number) => {
                assertCurrent?.();
                onProgress?.(loaded, totalCount);
                // A progress listener can retire the scene before the next task starts.
                assertCurrent?.();
            };
            reportProgress(0);
            await runWithConcurrency(tasks, maxConcurrent, () => reportProgress(++loadedCount));
            const wallMs = preloadClock() - began;
            if (totalCount > 0) {
                const parts = Object.entries(timings).sort((a, b) => b[1].ms - a[1].ms)
                    .map(([k, t]) => `${k} ${t.count} (${Math.round(t.ms)}ms, slowest ${Math.round(t.slowestMs)}ms)`);
                const slots = Math.min(normalizeConcurrency(maxConcurrent), totalCount);
                log[options?.summary ?? 'info']('asset', `preloaded ${totalCount} asset(s) in ${Math.round(wallMs)}ms, up to ${slots} at a time: ${parts.join(', ')}`);
            }
            warnFailedLoads(missing.filter(m => m.reason === 'load-failed'));

            return { ...handleMaps, releaseCallbacks, scope, acquisitions, resolveRef: resolve, missing, timings, wallMs,
                atlasFrameFor: (ref, path) => this.atlasFrameIn_(textureCatalogs?.get(path) ?? initialCatalog, ref, path),
                publishTextureImports: () => {
                    this.assertLoading_(epoch);
                    declared?.publish();
                    if (!this.sampledTypes_.size) return;
                    this.registrySlots_.publishSceneNames(acquisitions.map(({ lease }) => lease));
                },
                textureReader: reader };
        } catch (error) {
            try { scope.releaseAll(); }
            catch (cleanupError) { log.warn('asset', 'Scene preload cleanup failed', cleanupError); }
            throw error;
        } finally {
            for (const claim of surfaceClaims.values()) claim.release();
        }
    }

    resolveSceneAssetPaths(sceneData: SceneData, result: SceneAssetResult): void {
        for (const entity of sceneData.entities) {
            // Prefab-instance entries carry no inline components (a prefab ref +
            // overrides); their handles bind when the prefab expands, not here.
            if (!Array.isArray(entity.components)) continue;
            for (const comp of entity.components) {
                // A component can customize discovery and still declare which fields take handles.
                const componentType = canonicalComponentType(comp.type);
                const fields = getComponentAssetFieldDescriptors(componentType);
                for (const { field, type, fileExtension } of fields) {
                    const ref = comp.data[field];
                    if (ref === 0 || ref === '' || ref === null) {
                        comp.data[field] = emptySceneAssetValue(type);
                        continue;
                    }
                    if (typeof ref !== 'string') continue;
                    if (fileExtension && !isFileAssetRef(ref, fileExtension)) continue;

                    // Use the name under which this preparation acquired the field, even after an update.
                    const path = result.resolveRef ? result.resolveRef(ref) : this.resolveRef(ref);
                    if (path == null) {
                        comp.data[field] = getComponentDefaults(componentType)?.[field] ?? emptySceneAssetValue(type);
                        if (isSceneHandleType(type) && getComponent(componentType)?._builtin) recordUnresolvedSceneAsset(sceneData, comp, field, ref);
                        continue;
                    }

                    if (type === 'image' || type === 'groom' || type === 'terrain-tiles') {
                        comp.data[field] = this.resolveRef(ref) ?? path;
                        continue;
                    }
                    if (!isSceneHandleType(type)) continue;
                    const handle = result[`${type}Handles`].get(path) ?? 0;
                    comp.data[field] = handle;
                    if (!handle) {
                        if (getComponent(componentType)?._builtin) recordUnresolvedSceneAsset(sceneData, comp, field, ref);
                        continue;
                    }
                    if (!this.handlePaths_.get(type)?.has(handle)) this.recordHandlePath_(type, handle, path);

                    if (type !== 'texture') continue;
                    const atlasInfo = result.atlasFrameFor ? result.atlasFrameFor(ref, path) : this.atlasFrameIn_(this.catalog, ref, path);
                    if (atlasInfo) {
                        Object.assign(comp.data, atlasFrameUv(atlasInfo, comp.data));
                        if (atlasInfo.trim) {
                            comp.data['_trimOffsetX'] = atlasInfo.trim.offsetX;
                            comp.data['_trimOffsetY'] = atlasInfo.trim.offsetY;
                            comp.data['_trimSourceW'] = atlasInfo.trim.sourceW;
                            comp.data['_trimSourceH'] = atlasInfo.trim.sourceH;
                        }
                    }
                }
            }
        }
    }

    private readonly referencePath_ = (type: string, handle: number) => this.pathForHandle(type, handle);
    /** @internal Project this component's stored handles into the optional usage monitor. */
    readonly syncAssetFieldReferences = (world: World, entity: Entity, component: AnyComponentDef): void => {
        if (!this.refCounter_ || this.releasing_ || !this.handlePaths_.size || world.isDestructionPending(entity)) return;
        const data = world.tryGet(entity, component) as Record<string, unknown> | null;
        this.refCounter_.syncComponent(world, entity, component, data, this.referencePath_);
    };

    /** Record scene users only after source IDs have been mapped to live World entities.
     * Resolution is preparation; source IDs cannot be removed by World.onDespawn. */
    trackSceneAssetReferences(scene: SceneData, entities: ReadonlyMap<number, number>, world?: World): void {
        const counter = this.refCounter_;
        if (!counter) return;
        const standalone = world && !observesAssetReferences(world, this);
        for (const source of scene.entities) {
            const entity = entities.get(source.id);
            if (entity === undefined || (world && !world.valid(entity)) || !Array.isArray(source.components)) continue;
            for (const comp of source.components) {
                const component = getComponent(canonicalComponentType(comp.type));
                if (!component?.assetFields.length) continue;
                if (world) {
                    if (standalone) counter.observeEntity(world, entity, this.syncAssetFieldReferences);
                    this.syncAssetFieldReferences(world, entity, component);
                } else counter.syncComponent(undefined, entity, component, comp.data, this.referencePath_);
            }
        }
    }

    // =========================================================================
    // Acquire — the same loads, but handing back an ownership receipt
    // =========================================================================

    /**
     * The receipt releases this version even after a file edit.
     * Set flipY to false to keep the authored row order for an atlas.
     * Pass 'imported' to use pixel coordinates. The texture is full size when
     * this resolves and stays there until the last imported-size receipt is released.
     */
    async acquireTexture(ref: string, flipY = true, resolution?: 'imported'): Promise<AssetLease<TextureResult>> {
        const { result, lease, releaseSize } = await this.acquireTextureVariant_(ref, flipY, resolution);
        return this.textureLease_(lease, result, lease.key, releaseSize);
    }

    /** {@link acquireTexture} for everything that goes through a typed loader. */
    async acquireTyped<T>(type: string, ref: string): Promise<AssetLease<T>> {
        try { return await this.acquireTypedLease_<T>(type, ref); }
        catch (error) { throw preparationFailureReason(error); }
    }

    private async acquireTypedLease_<T>(type: string, ref: string, owner?: AssetDependencyOwner,
        localeIntent: 'direct' | 'project' = 'direct', inputs = this.sceneTextureImports_.current): Promise<AssetLease<T>> {
        const loader = this.loaders_.get(type);
        if (loader === this.spineLoader_) {
            const receipt: AssetLease = await this.acquireSpineLease_(ref, undefined, owner, inputs);
            return receipt as AssetLease<T>;
        }
        if (loader === this.textureLoader_) {
            const { result, lease, path } = await this.acquireTextureVariant_(ref, true, undefined, inputs);
            const receipt: AssetLease = this.textureLease_(lease, result, assetPairKey('texture', path));
            return receipt as AssetLease<T>;
        }
        const epoch = this.resetEpoch_;
        this.assertLoading_(epoch);
        const publish = loader instanceof LocaleAssetLoader && localeIntent === 'direct'
            ? this.directLocalePublication_(ref) : undefined;
        const slot = await this.acquireSlot_<T>(type, ref, owner, inputs);
        try {
            this.assertLoading_(epoch);
            if (slot) publish?.();
        }
        catch (error) { slot?.release(); throw error; }
        if (!(loader instanceof MaterialAssetLoader) || !this.textureLoader_.mayHoldReducedTextures
            || this.surfaceUses_.use(this.surfaceKey_('material', ref)) !== 'full') return slot ?? this.acquireHandle_<T>(type, ref, owner, inputs);
        const held = slot ?? await this.acquireHandle_<T>(type, ref, owner, inputs);
        try {
            const handles = new Set<number>();
            collectMaterialTextures((held.value as MaterialResult).handle, handles);
            await Promise.all([...handles].map(handle => this.restoreSurfaceTexture_(handle)));
            this.assertLoading_(epoch);
        } catch (error) { held.release(); throw error; }
        return held;
    }

    private async acquireSlot_<T>(type: string, ref: string, owner?: AssetDependencyOwner,
        inputs = this.sceneTextureImports_.current): Promise<AssetLease<T> | null> {
        const kind = this.registryKind_<T>(type, inputs);
        if (!kind) return null;
        // Keyed by identity, never by the locator: a content-addressed url is
        // revision-specific, so a slot keyed by one is a slot PER REVISION and
        // an update publishes into a new one while every holder reads the old.
        const identity = this.registryIdentity_(ref);
        // Answering to the ref as the caller spelled it too: a component looks
        // the asset up by the spelling a scene serialized.
        const names = ref === identity ? [identity] : [identity, ref];
        if (!this.loaders_.get(type)?.bindsTextures || (!inputs.settings.size && inputs === this.sceneTextureImports_.current)) {
            return this.registrySlots_.acquire(kind, type, identity, names, owner);
        }
        const key = this.sceneBinding_(type, identity, inputs.signature);
        const lease = await this.registrySlots_.acquire(kind, type, key, [key], owner, names);
        if (inputs === this.sceneTextureImports_.current) this.registrySlots_.publishSceneNames([lease]);
        return lease;
    }

    /**
     * The owner-facing receipt for one ledger acquisition.
     *
     * `retain` goes through the ledger rather than through this class's load
     * path: an owner splitting what it holds joins the era it already has, which
     * after an invalidate is not the era a path resolves to.
     */
    private textureLease_<T extends TextureResult | number>(
        lease: AssetRefLease<number>, value: T, key = lease.key, releaseSize?: () => void,
    ): BindingLease<T> {
        const imported = releaseSize !== undefined;
        return {
            [leaseBinding]: 'texture',
            key, generation: lease.generation, value,
            release: () => {
                releaseSize?.();
                releaseSize = undefined;
                this.releaseTextureLease(lease);
            },
            retain: () => {
                if (imported && !releaseSize) return null;
                const child = this.textureRefs_.retain(lease);
                if (!child) return null;
                return this.textureLease_(child, value, key, imported ? this.textureLoader_.holdImportedSize(child.value) : undefined);
            },
        };
    }

    /**
     * A receipt for a texture this engine COMPOSED — no path, no generation, no
     * cache entry to join. Its only identity is the handle, so the last holder
     * destroys it rather than handing it back to a pool that could revive it.
     */
    private ownedTextureLease_(value: TextureResult): AssetLease<TextureResult> {
        return ownedAssetLease(`composed:${value.handle}`, value.handle, value, texture => {
            requireResourceManager().releaseTexture(texture.handle);
            evictTextureDimensions(texture.handle);
        }, 'texture');
    }

    /** {@link textureLease_} for everything that goes through a typed loader. */
    private typedLease_<T>(
        type: string, lease: AssetRefLease<PreparedLoad<unknown>>, value: T, unclaim?: () => void,
    ): BindingLease<T> {
        const source = lease.value.loader.fieldBinding === 'source' ? lease.value.owner : undefined;
        return {
            [leaseBinding]: source ?? type,
            [leaseOwner]: lease.value.owner,
            [leaseDependencies]: lease.value.dependencies,
            [leaseMatchesSource]: source && (ref => this.namedBinding_(type, ref) === source),
            [leaseDependencyKey]: lease.value.loader === this.spineLoader_ ? lease.value.owner.key : undefined,
            key: lease.key, generation: lease.generation, value,
            failedDependencies: lease.value.failedDependencies,
            release: () => { unclaim?.(); this.releaseTypedLease(type, lease); },
            retain: () => {
                const child = this.genericRefs_.retain(lease);
                return child ? this.typedLease_(type, child, value) : null;
            },
        };
    }

    // =========================================================================
    // Release
    // =========================================================================

    releaseTexture(ref: string): void {
        const path = this.handleLoadKey_('texture', ref);
        const flips = [true, false];
        const claimed = flips.filter(flip => this.textureRefs_.hasPathClaim(
            this.textureCacheKey_(this.claimedSceneBinding_('texture', path, flip), flip)));
        for (const flip of claimed.length ? claimed : flips) this.releaseTextureVariant_(path, flip);
    }

    private releaseTextureVariant_(path: string, flip: boolean): void {
        const key = this.textureCacheKey_(this.claimedSceneBinding_('texture', path, flip), flip);
        const dropped = this.textureRefs_.releaseOldest(key);
        if (!dropped) return;
        if (dropped.ambiguous) warnAmbiguousRelease_(key);
        if (dropped.exhausted) this.disposeTexture_(key, dropped.value);
    }

    /**
     * @internal Give back one texture acquisition by its receipt — exact even
     * when `invalidate()` left two generations of the same path live. Callers
     * hold an {@link AssetLease} and use its `release()`.
     */
    releaseTextureLease(lease: AssetRefLease<number>): void {
        const dropped = this.textureRefs_.release(lease);
        if (dropped?.exhausted) this.disposeTexture_(lease.key, dropped.value);
    }

    /** The last SDK reference to a texture handle is gone: let the C++ pool decide. */
    private disposeTexture_(key: string, handle: number): void {
        // The pool decides what that means — free immediately (no budget), or
        // retain as an evictable cache entry that the next load revives by key.
        this.handlePaths_.get('texture')?.delete(handle);
        // Only when it is still the cached value: a superseded handle left the
        // cache when its generation ended, and the entry there now belongs to a
        // generation with holders of its own.
        if (this.textureCache_.get(key)?.value.handle === handle) this.textureCache_.delete(key);
        this.textureLoader_.releaseHandle(handle);
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
        const path = this.handlePaths_.get('material')?.get(handle);
        if (path !== undefined) this.releaseTyped('material', path);
    }

    /**
     * Give back one reference to every asset in `byType` — what a scene, a
     * document or a group acquired, in one call.
     *
     * Materials (handle-keyed) and skeletons (SpineManager's) are skipped.
     * @beta Pre-1.0: the type vocabulary follows the loader registry.
     */
    releaseAssets(byType: ReadonlyMap<string, ReadonlySet<string>>): void {
        for (const [type, paths] of byType) {
            if (type === 'material' || type === 'spine') continue;
            for (const path of paths) {
                if (type === 'texture') this.releaseTexture(path);
                else this.releaseTyped(type, path);
            }
        }
    }

    /** @internal Hand a scene the existing acquisitions reported by a path-only loader. */
    takeTrackedAsset(type: string, ref: string, scope: AssetScope): boolean {
        const path = this.handleLoadKey_(type, ref);
        const atlas = this.loaders_.get(type) === this.spineLoader_ ? this.spineAtlasOf_(path) : undefined;
        const typedKey = assetPairKey(type, this.claimedSceneBinding_(type, atlas ? this.spineBinding_(assetPairKey(path, atlas)) : path));
        const genericClaim = this.genericRefs_.hasPathClaim(typedKey);
        const before = scope.size;
        if (type === 'texture') {
            const variants = [true, false].map(flip => this.textureCacheKey_(this.claimedSceneBinding_('texture', path, flip), flip));
            const reported = variants.filter(key => this.textureRefs_.hasPathClaim(key));
            // A typed texture loader can coexist with a built-in flip variant.
            // Prefer all value-only acquisitions over borrowing a receipt by path.
            for (const key of reported.length || genericClaim ? reported : variants) {
                const claim = this.textureRefs_.takeByPath(key);
                if (!claim) continue;
                const cached = this.textureCache_.get(key)?.value;
                scope.add(this.textureLease_(claim, cached?.handle === claim.value ? cached : claim.value));
            }
            if (scope.size !== before && !genericClaim) return true;
        }
        if (!genericClaim) {
            const slot = this.registrySlots_.takeByName(type, this.registryIdentity_(ref));
            if (slot) { scope.add(slot); return true; }
        }
        const claim = this.genericRefs_.takeByPath(typedKey);
        if (!claim) return false;
        scope.add(this.typedLease_(type, claim, claim.value.value));
        return true;
    }

    /**
     * @internal Release one reference to a typed asset by path — the door the
     * group channel table uses. Game code calls the named release* methods.
     */
    releaseTyped(type: string, ref: string): void {
        const resolved = this.handleLoadKey_(type, ref);
        if (type === 'texture' && this.loaders_.get(type) === this.textureLoader_) {
            this.releaseTextureVariant_(resolved, true);
            return;
        }
        if (this.registrySlots_.size && this.registrySlots_.releaseByName(type, this.registryIdentity_(ref))) return;
        // NOT gated on a live cache entry: a generation superseded by
        // invalidate() is out of the cache while its holders still owe a
        // release, and returning here left their asset unreachable.
        let path = this.claimedSceneBinding_(type, resolved);
        if (type === 'spine') {
            const atlas = this.spineAtlasOf_(resolved);
            if (atlas) {
                const pair = this.claimedSceneBinding_(type, this.spineBinding_(assetPairKey(resolved, atlas)));
                const builtin = this.genericRefs_.generations(assetPairKey(type, pair))[0];
                const custom = this.genericRefs_.generations(assetPairKey(type, resolved))[0];
                if (builtin && custom) warnAmbiguousRelease_(assetPairKey(type, resolved));
                if (builtin && (!custom || builtin.id < custom.id)) path = pair;
            }
        }
        const key = assetPairKey(type, path);
        const dropped = this.genericRefs_.releaseOldest(key);
        if (!dropped) return;
        if (dropped.ambiguous) warnAmbiguousRelease_(key);
        if (dropped.exhausted) this.disposeGeneric_(type, path, dropped.value);
    }

    /**
     * @internal The typed twin of {@link releaseTextureLease}; callers use the
     * lease's own `release()`.
     */
    releaseTypedLease(type: string, lease: AssetRefLease<PreparedLoad<unknown>>): void {
        const dropped = this.genericRefs_.release(lease);
        if (!dropped?.exhausted) return;
        this.disposeGeneric_(type, dropped.value.owner.key, dropped.value);
    }

    /** The last reference to a typed asset is gone: hand it to its loader. */
    private disposeGeneric_(type: string, path: string, era: PreparedLoad<unknown>): void {
        const cache = this.genericCache_.get(type);
        if (cache && cache.get(path) === era) cache.delete(path);
        this.retire_(era);
    }

    /** End one cached era: its loader destroys what it made, then what its
     *  preparation acquired goes back — in that order, since the value is what
     *  is still using it. */
    private retire_(era: PreparedLoad<unknown>): void {
        if (era.generation === null) return;
        era.generation = null;
        const type = era.owner.type;
        const handle = (era.value as { handle?: unknown } | null)?.handle;
        if (typeof handle === 'number' && era.loader.fieldBinding !== 'source') {
            this.handlePaths_.get(type)?.delete(handle);
            if (type === 'mesh') this.forgetMeshOwner_(handle);
        }
        disposeAll([
            () => era.loader.unload?.(era.value),
            () => era.dependencies.releaseAll(),
        ], dispose => dispose());
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
     * What was BUILT from `ref` ends too. The plan is read BEFORE anything is
     * dropped, and walked deepest-first with each group awaiting the one before
     * it: a parent re-prepared too early acquires the era it already had.
     *
     * Returns true if any cache held `ref` itself.
     */
    invalidate(ref: string): boolean {
        const refs = this.invalidationRefs_(ref);
        const plan = this.rebuildPlan_(refs);
        // A failed preparation has no live era, but its canonical cooldown
        // rejection still records why it failed. Clear it before rebuilding
        // holders reached by the restored source, rather than reusing failure.
        const sources = new Set(refs.map(path => this.assetIdentity_(path)));
        for (const cache of this.genericCache_.values()) {
            for (const [key, error] of cache.failures()) {
                if (error instanceof PreparationFailure
                    && error.sources.some(path => sources.has(this.assetIdentity_(path)))) cache.invalidate(key);
            }
        }
        const ended = refs.map(path => this.invalidateSource_(path));
        const pending = ended.flatMap(result => result.rebuilt ? [result.rebuilt] : []);
        if (pending.length || plan.length) {
            this.track_(pending.length ? Promise.all(pending).then(() => this.rebuildAssetGraph_(plan)) : this.rebuildAssetGraph_(plan));
        }
        for (const path of refs) this.fireSourceChanged_(path);
        return ended.some(result => result.hit);
    }

    /** Editing a physical atlas page changes the pixels of every frame that reads it. */
    private invalidationRefs_(ref: string): string[] {
        const model = this.manifestModel_;
        const path = this.stagedPaths_.get(ref) ?? pathWithinRemoteRoot(ref, this.remoteRoot_);
        const file = model?.assetByPath(path) ?? (path.startsWith('/') ? model?.assetByPath(path.slice(1)) : undefined);
        if (!file || !model?.sharesFile(file.path)) return [ref];
        const records = model.entries().filter(record => record.asset.path === file.path);
        return records.some(record => record.asset.metadata?.atlasFrame) ? records.map(record => record.key) : [ref];
    }

    /**
     * Resolves when every propagation started so far has landed.
     *
     * The ASSET graph only. What reads it — a component bound to a handle — is
     * the second barrier, and it moves on a frame rather than here: see the
     * live-binding coordinator's `settled`.
     *
     * @internal
     */
    async assetGraphSettled(): Promise<void> {
        // A rebuild can start another (a group awaits the one before it), so
        // draining once is not the same as being settled.
        while (this.settling_.size > 0) {
            const inFlight = [...this.settling_];
            await Promise.all(inFlight);
            for (const work of inFlight) this.settling_.delete(work);
        }
    }

    /** What a change to `ref` reaches. Not filtered by path: an asset that
     *  happens to live at the changed file can still be what the chain reaches
     *  LAST, and dropping it there is the same erasure one level up. */
    private rebuildPlan_(refs: string | readonly string[]): AssetIdentity[][] {
        const canonical = cachedPaths(path => this.graphPath_(path));
        const changed = new Set((typeof refs === 'string' ? [refs] : refs).map(canonical));
        const eras = this.eras_();
        for (const preparation of this.preparations_) {
            const owner = preparation.owner;
            if (owner && this.genericCache_.get(owner.type)?.isPreparing(owner)) {
                eras.push({ type: owner.type, path: owner.key, edges: preparation.pendingEdges() });
            }
        }
        const roots = matchingDependents(eras, edge => isInvalidatable(edge) && changed.has(canonical(edge.path)));
        if (!roots.length) return [];
        return rebuildPlan(roots, ownedDependents(eras, canonical));
    }

    /** Count one propagation as in flight until it lands. It answers to nobody
     *  in the ordinary case, so a failure is reported here rather than thrown at
     *  whoever happens to be waiting. */
    private track_(work: Promise<void>): void {
        const settled = work.catch((e: unknown) => {
            log.warn('asset', 'propagating a change failed; what it reached keeps what it has', e);
        });
        this.settling_.add(settled);
        void settled.finally(() => this.settling_.delete(settled));
    }

    /** Each group only once everything it was built from has landed. */
    private async rebuildAssetGraph_(plan: AssetIdentity[][]): Promise<void> {
        for (const group of plan) {
            const work: Promise<void>[] = [];
            for (const vertex of group) {
                const { rebuilt } = this.invalidateAsset_(vertex, true);
                if (rebuilt) work.push(rebuilt);
            }
            if (work.length) await Promise.all(work);
        }
    }

    /**
     * End every era at one PATH: a file changed, and whatever it names changed
     * with it. What `invalidate(ref)` is, and what a hot update's changed key is.
     */
    private invalidateSource_(ref: string): { hit: boolean; rebuilt?: Promise<void> } {
        let hit = false;
        const work: Array<Promise<void>> = [];
        for (const type of this.loaders_.keys()) {
            const ended = this.invalidateAsset_({ type, path: ref });
            hit = ended.hit || hit;
            if (ended.rebuilt) work.push(ended.rebuilt);
        }
        return { hit, rebuilt: work.length ? Promise.all(work).then(() => undefined) : undefined };
    }

    private invalidateTexturePath_(path: string): boolean {
        let dropped = false;
        const rm = getResourceManager();
        // Both flip variants: the cache key carries the flag. The C++ pool's
        // residency identity is severed too — an evictable entry under this
        // key is freed and can never be revived with stale bytes.
        for (const flip of [true, false]) {
            const key = this.textureCacheKey_(path, flip);
            if (this.textureCache_.invalidate(key)) dropped = true;
            // The ledger is NOT dropped: holders of the outgoing generation
            // still owe a release, and forgetting them strands their texture
            // with nobody able to free it. The era still ends here.
            this.textureRefs_.supersede(key);
            if (typeof rm?.invalidateTexturePath === 'function' && rm.invalidateTexturePath(this.textureLoader_.poolKey(key, rm))) {
                dropped = true;
            }
        }
        // The pool's primary loader also sees files a native host published under a plain path.
        if (typeof rm?.invalidateTexturePath === 'function' && this.textureLoader_.poolKey(path, rm) === path
            && rm.invalidateTexturePath(path)) {
            dropped = true;
        }
        return dropped;
    }

    /**
     * End ONE asset's era — its type all the way down. A path can name a texture
     * and a material, and what one of them acquired changing is not a change to
     * the other; a plan that knows the difference and then ends both has thrown
     * away what it knew.
     */
    private invalidateAsset_(asset: AssetIdentity, fromGraph = false): { hit: boolean; rebuilt?: Promise<void> } {
        const { type } = asset;
        // Handle-bound graph nodes already carry their cache key, including a skeleton/atlas pair.
        const cache = this.genericCache_.get(type);
        const path = fromGraph && cache ? asset.path : this.handleLoadKey_(type, asset.path);
        const bySource = !fromGraph && sceneBindingBase(asset.path) === asset.path && this.sampledTypes_.has(type);
        const variants = bySource ? this.sampledPaths_(type, sceneBindingBase(path)) : [path];
        const named = fromGraph ? asset.path : this.registryIdentity_(asset.path);
        const work: Promise<void>[] = [];
        if (this.loaders_.get(type)?.registry) {
            for (const key of this.registrySlots_.refreshKeys(type, named, bySource)) {
                const ready = this.republishSlot_(type, key);
                if (ready) work.push(ready);
            }
        }
        let hit = work.length > 0;
        for (const key of variants) {
            const ended = this.endCachedEra_(asset, key);
            const dropped = this.loaders_.get(type)?.invalidate?.(ended.residencyPath) || ended.dropped;
            const handlePaths = this.handlePaths_.get(type);
            if (handlePaths) {
                for (const [handle, held] of handlePaths) {
                    if (held === key) handlePaths.delete(handle);
                }
            }
            if (dropped) {
                hit = true;
                const logical = sceneBindingBase(asset.path);
                const ref = bindingRecord(logical) ?? logical;
                const bindingRef = this.replacementBinding_(type, ref, sceneBindingProfile(key));
                this.fireInvalidate_({ ref, type: type as AssetFieldType, oldValue: ended.oldValue, ...(bindingRef && { bindingRef }) });
            }
        }
        return { hit, rebuilt: work.length ? Promise.all(work).then(() => undefined) : undefined };
    }

    /** End residency without spending the receipts that still own this preparation. */
    private endCachedEra_(asset: AssetIdentity, path: string): { dropped: boolean; oldValue: unknown; residencyPath: string } {
        const { type } = asset;
        const cache = this.genericCache_.get(type);
        const loader = this.loaders_.get(type);
        let residencyPath = loader === this.textureLoader_ ? path : bindingFile(path);
        // Held by a cache or by a loader's own residency: what a listener is
        // told about. A slot swaps its era instead, and reports nothing.
        let dropped = false;
        let oldValue: unknown;

        if (type === 'texture') {
            // The handle bound to this path, captured BEFORE the caches drop it,
            // so a rebind listener can swap it in live components.
            oldValue = this.textureCache_.get(this.textureCacheKey_(path, true))?.value.handle ?? 0;
            dropped = this.invalidateTexturePath_(path);
        } else if (loader instanceof AudioAssetLoader) {
            const audio = this.getAudio_();
            const sourceOf = (ref: string) => audio?.getBufferSource(ref)
                ?? this.backend.resolveUrl(this.catalog.getBuildPath(this.audioFile_(ref).path));
            residencyPath = sourceOf(asset.path);
            // Each authored clip holds its own lease, while a change to the file ends every preparation of it.
            if (cache) {
                for (const key of cache.keys()) {
                    if (key !== asset.path && sourceOf(key) !== residencyPath) continue;
                    oldValue ??= cache.get(key)?.value;
                    if (cache.invalidate(key)) dropped = true;
                    this.genericRefs_.supersede(assetPairKey(type, key));
                }
            }
        } else {
            if (cache) {
                oldValue = cache.get(path)?.value;
                if (cache.invalidate(path)) dropped = true;
            }
            // The ledger stays, for the same reason as a texture's.
            this.genericRefs_.supersede(assetPairKey(type, path));
        }

        return { dropped, oldValue, residencyPath };
    }

    /**
     * Prepare a new era for the slot (type, ref) names, and publish it
     * atomically. By IDENTITY: the slot is keyed by what the asset is, and this
     * preparation resolves where the current revision serves it.
     */
    private republishSlot_(type: string, identity: string): Promise<void> | undefined {
        if (!this.registrySlots_.has(type, identity)) return;
        const kind = this.registryKind_(type);
        if (!kind) return;
        return this.registrySlots_.republish(kind, type, identity).then(
            () => undefined,
            (e: unknown) => {
                log.warn('asset', `hot update: re-publishing "${identity}" failed; holders keep the era they have`, e);
            },
        );
    }

    /** Plan from the outgoing receipts. Directly changed slots that also depend
     *  on a change publish at their position in the plan, after their inputs. */
    private async rebuildChangedFiles_(files: readonly string[]): Promise<void> {
        const plan = this.rebuildPlan_(files);
        const planned = new Set<string>();
        for (const group of plan) {
            for (const asset of group) planned.add(assetPairKey(asset.type, asset.path));
        }
        const direct: Promise<void>[] = [];
        for (const file of files) {
            const identity = this.registryIdentity_(file);
            for (const [type, loader] of this.loaders_) {
                if (!loader.registry) continue;
                for (const path of this.registrySlots_.refreshKeys(type, identity, this.sampledTypes_.has(type))) {
                    const key = assetPairKey(type, path);
                    if (planned.has(key)) continue;
                    planned.add(key);
                    const work = this.republishSlot_(type, path);
                    if (work) direct.push(work);
                }
            }
        }
        await Promise.all(direct);
        await this.rebuildAssetGraph_(plan);
    }

    /** Fire every onInvalidate listener with one generation's ending. Isolates
     *  throws. Shared by {@link invalidate} and {@link applyUpdate}. */
    private fireInvalidate_(event: AssetInvalidation): void {
        for (const listener of this.invalidateListeners_) {
            try {
                listener(event);
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

    onSourceChanged(listener: (path: string) => void): () => void {
        this.sourceListeners_.add(listener);
        return () => {
            this.sourceListeners_.delete(listener);
        };
    }

    sourceIdentity(ref: string): string {
        return this.assetIdentity_(ref);
    }

    private fireSourceChanged_(ref: string): void {
        if (this.sourceListeners_.size === 0) return;
        const path = this.assetIdentity_(ref);
        for (const listener of this.sourceListeners_) {
            try {
                listener(path);
            } catch (e) {
                log.warn('asset', 'onSourceChanged listener threw', e);
            }
        }
    }

    /**
     * @internal Live entry counts for the resource census.
     *
     * Cache sizes are not expected to return to baseline — that is what a cache
     * is for. `refCounts` and `handlePaths` are: every load handing one out has a
     * release taking it back. `pendingLoads` and `propagations` should be zero at rest.
     */
    sizes(): {
        textureCached: number;
        pendingLoads: number;
        /** Rebuilds of dependents still running after an invalidation. */
        propagations: number;
        refCounts: number;
        refRows: number;
        genericCaches: number;
        genericCached: number;
        handlePaths: number;
        invalidateListeners: number;
        registrySlots: number;
        trackedRefRows: number;
    } {
        const tex = this.textureCache_.sizes();
        let genericCached = 0;
        let pending = tex.pending;
        let handlePaths = 0;
        for (const paths of this.handlePaths_.values()) handlePaths += paths.size;
        for (const cache of this.genericCache_.values()) {
            const s = cache.sizes();
            genericCached += s.cached;
            pending += s.pending;
        }
        return {
            textureCached: tex.cached,
            pendingLoads: pending,
            propagations: this.settling_.size,
            refCounts: this.textureRefs_.size + this.genericRefs_.size,
            refRows: this.textureRefs_.rows + this.genericRefs_.rows,
            genericCaches: this.genericCache_.size,
            genericCached,
            handlePaths,
            invalidateListeners: this.invalidateListeners_.size,
            registrySlots: this.registrySlots_.size,
            trackedRefRows: this.refCounter_?.getTotalRefRows() ?? 0,
        };
    }

    /**
     * What is explicitly owned by the whole asset realm.
     *
     * Its life is this instance's. Entity bindings use scene or entity scopes,
     * including runtime entities with no scene, so their resources can end sooner.
     *
     * @internal
     */
    get appScope(): AssetScope {
        return this.appScope_;
    }

    /**
     * What entities own for themselves — runtime entities with no scene and
     * persistent entities that outlived theirs. Despawn, core departure and asset reset end ownership.
     *
     * @internal
     */
    get entityScopes(): EntityAssetScopes {
        return this.entityScopes_;
    }

    /** @internal A standalone bake uses the same acquisition transaction as a graph recipe. */
    async preparePrefab(ref: string, overrides: readonly PrefabOverride[] = []): Promise<PreparedPrefab> {
        const epoch = this.resetEpoch_;
        try {
            const era = await this.prepared_(ctx => this.bakePrefab_(this.resolveLoadPath_(ref), ctx, overrides));
            if (epoch !== this.resetEpoch_) {
                era.dependencies.releaseAll();
                throw new Error(`Assets were released while "${ref}" was preparing; it has no owner. Load it again.`);
            }
            return { ...era, ref, release: () => era.dependencies.releaseAll() };
        } catch (error) { throw preparationFailureReason(error); }
    }

    /** Acquire a private material for an unsaved document. Realm teardown invalidates all its receipts. @internal */
    async acquireMaterialDraft(path: string, data: MaterialAssetData, signal?: AbortSignal): Promise<AssetLease<MaterialResult> | null> {
        if (signal?.aborted) return null;
        const epoch = this.resetEpoch_;
        const era = await this.prepared_(async ctx => ({
            build: await this.materialLoader_.prepareDocument(data, path, ctx, false),
        })).catch(error => { throw preparationFailureReason(error); });
        let resetLease: AssetLease<MaterialResult> | undefined;
        try {
            if (signal?.aborted || epoch !== this.resetEpoch_) return null;
            const material = era.build();
            const key = `material-draft:${path}`, generation = ++this.materialDraftGeneration_;
            let disposed = false;
            const owner = ownedAssetLease(key, generation, material, value => {
                disposed = true;
                try { this.materialLoader_.unload(value); }
                finally { era.dependencies.releaseAll(); }
            });
            resetLease = this.appScope_.add(owner);
            const guard = (receipt: AssetLease<MaterialResult>): AssetLease<MaterialResult> => ({
                ...receipt,
                retain: () => {
                    const next = disposed ? null : receipt.retain();
                    return next ? guard(next) : null;
                },
            });
            // The app scope can retire the draft even if a draw still holds a receipt.
            return guard(ownedAssetLease(key, generation, material, () => {
                this.appScope_.forget(owner);
                owner.release();
            }));
        } finally {
            if (!resetLease) era.dependencies.releaseAll();
        }
    }

    releaseAll(): void {
        if (this.releasing_) return;
        this.releasing_ = true;
        // Pending loads lose ownership even if a user-provided unload throws.
        this.resetEpoch_++;
        try {
            this.projectLocales_?.clear();
            this.sceneTextureImports_.clear();
            disposeAll([
                () => this.entityScopes_.close(),
                () => {
                    const pending = [...this.preparations_];
                    this.preparations_.clear();
                    disposeAll(pending, recorder => recorder.rollback());
                },
                // Normal receipts first, then every remaining generation.
                () => this.appScope_.releaseAll(),
                () => this.registrySlots_.releaseAll(),
                () => {
                    const handles = new Set<number>();
                    for (const load of this.textureCache_.values()) {
                        load.generation = null;
                        handles.add(load.value.handle);
                    }
                    this.textureCache_.clearAll();
                    for (const { value } of this.textureRefs_.drain()) handles.add(value);
                    disposeAll([...handles], handle => this.textureLoader_.releaseHandle(handle));
                },
                () => {
                    for (const cache of this.genericCache_.values()) cache.clearAll();
                    this.genericCache_.clear();
                    const generations = this.genericRefs_.drain();
                    disposeAll(generations, ({ value }) => this.retire_(value));
                },
                () => disposeAll([...this.builtMeshes_.keys()], handle => this.releaseBuiltMesh(handle)),
                () => this.refCounter_?.clear(),
            ], dispose => dispose());
        } finally {
            this.meshOwners_ = undefined;
            this.surfaceUses_.clear();
            this.handlePaths_.clear();
            this.entityScopes_ = new EntityAssetScopes(this.leaseForBinding.bind(this));
            this.releasing_ = false;
        }
    }

    // =========================================================================
    // Spine Controller
    // =========================================================================

    getTextureLoader(): TextureLoader {
        return this.textureLoader_;
    }

    /**
     * What the textures this realm loaded became on the GPU, and which compressed
     * formats the device samples at all. @experimental
     *
     * The upload half; what the BUILD shipped is the cook's own record. A realm
     * that plays source images still answers `deviceFormats` — the capability a
     * cooked payload would meet here.
     */
    textureFormatReport(): TextureFormatReport {
        return this.textureLoader_.formatReport();
    }

    setAssetRefResolver(resolver: AssetRefResolver, typeOf?: (ref: string) => string | undefined): void {
        if (resolver !== this.assetRefResolver_) this.stagedPaths_.clear();
        this.assetRefResolver_ = resolver;
        this.hostAssetType_ = typeOf;
    }

    private readonly assetProblems_ = new Map<string, readonly string[]>();
    private assetProblemListener_: ((asset: string, problems: readonly string[]) => void) | null = null;

    /**
     * What is wrong with an asset that loaded: the parts of it that were left out, each said once. Empty when it is whole (or was never
     * loaded). A material whose texture would not load, or whose value has a shape nothing reads, is here and not in a failed load.
     * @experimental
     */
    getAssetProblems(asset: string): readonly string[] {
        return this.assetProblems_.get(this.assetIdentity_(asset)) ?? [];
    }

    /** Hear every change to an asset's problems (the editor's diagnostics). One listener; null removes it. @experimental */
    setAssetProblemListener(listener: ((asset: string, problems: readonly string[]) => void) | null): void {
        this.assetProblemListener_ = listener;
    }

    getAssetRefResolver(): AssetRefResolver | null {
        return this.assetRefResolver_;
    }

    /**
     * Attach optional usage monitoring. Scene publication records the World and
     * runtime entity ID. Despawn and core departure retire that World's rows.
     * Plugin and runtime factories install a counter by default.
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
        if (isBuiltinAssetRef(ref)) return ref;
        if (this.assetRefResolver_) return this.assetRefResolver_(ref);
        return ref;
    }

    /** @internal Key used for scene handle maps and their entity ownership. */
    sceneAssetRef(ref: string): string | null {
        const record = this.sceneHandleRecord_(ref);
        return record && this.manifestModel_?.sharesFile(record.asset.path) ? record.key : this.resolveRef(ref);
    }

    private manifestRecord_(ref: string) {
        const model = this.manifestModel_;
        if (!model) return;
        const path = this.stagedPaths_.get(ref) ?? pathWithinRemoteRoot(ref, this.remoteRoot_);
        return model.recordForRef(ref) ?? (path !== ref ? model.recordForRef(path) : undefined);
    }

    private sceneHandleRecord_(ref: string) {
        const record = this.manifestRecord_(ref);
        return record && isSceneHandleType(record.asset.type) ? record : undefined;
    }

    private graphPath_(ref: string): string {
        ref = sceneBindingBase(ref);
        const key = bindingRecord(ref) ?? this.sceneHandleRecord_(ref)?.key;
        return key ?? this.resolveLoadPath_(ref);
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
        if (sceneBindingBase(ref) !== ref) return bindingFile(ref);
        // Built-in geometry names code, not a file. Every realm's resolver turns a
        // non-URL ref into one (the play realm prefixes an origin), so a ref that
        // has nothing to resolve has to say so before resolution, not after.
        if (isBuiltinAssetRef(ref)) return ref;
        // A `remote`-group asset (per the active addressable manifest) resolves to
        // its CDN url — so a scene @uuid ref to a remote asset loads from, and
        // hot-updates with, the CDN, not just loadGroup'd DLC assets. Gated on a
        // remote root being set, so same-origin realms (editor Play, a build with
        // no CDN) keep their normal resolver + base-prefixing untouched. It is
        // the one step that carries a REVISION, which is why identity stops
        // short of it.
        const remote = this.remoteAssetPath_(ref);
        if (remote != null) return remote;
        // Deliberately NOT assetIdentity_: for a remote-group asset that answers
        // with the ADDRESS, and the package carries the STAGED name. Where the
        // bytes are is the realm's question, so its resolver gets it.
        const record = this.manifestRecord_(ref);
        const resolved = this.catalog.resolve(this.assetRefResolver_?.(ref) ?? record?.asset.path ?? ref);
        if (record && resolved !== record.asset.path) this.stagedPaths_.set(resolved, record.asset.path);
        return resolved;
    }

    /** CDN url of `ref` when it names a `remote`-group asset AND a remote root is
     *  set; null otherwise (caller falls back to the normal resolver). */
    private remoteAssetPath_(ref: string): string | null {
        if (!this.remoteRoot_) return null;
        const model = this.manifestModel_;
        if (!model) return null;
        const path = model.remoteAssetPath(ref);
        return path != null ? remoteAssetUrl(path, this.remoteRoot_) : null;
    }

    /**
     * What a ref MEANS in this realm, with no revision in it.
     *
     * Distinct from {@link resolveLoadPath_}, which goes on to where that asset
     * is served from NOW. Identity is what a slot is keyed by and what two
     * spellings agree on; a locator is what one preparation reads.
     */
    private assetIdentity_(ref: string): string {
        ref = sceneBindingBase(ref);
        if (isBuiltinMeshRef(ref)) return ref;
        // A manifest names one asset three ways — record key, address, build
        // path — and only it knows they are the same asset. Folding them here is
        // what keeps a uuid ref and a path ref on ONE slot.
        const record = this.manifestRecord_(bindingRecord(ref) ?? ref);
        if (record && (isSceneHandleType(record.asset.type) || record.asset.type === 'audio')) {
            return record.asset.address ?? record.key;
        }
        const path = pathWithinRemoteRoot(ref, this.remoteRoot_);
        const named = this.manifestModel_?.remoteAssetIdentity(ref)
            ?? (path === ref ? null : this.manifestModel_?.remoteAssetIdentity(path));
        if (named != null) return named;
        const resolved = this.assetRefResolver_?.(ref) ?? ref;
        return this.catalog.resolve(resolved);
    }

    // =========================================================================
    // Private
    // =========================================================================

    private registerBuiltinLoaders(): void {
        this.register(this.textureLoader_);
        this.register(this.spineLoader_);
        this.register(new MaterialShaderAssetLoader());
        this.register(this.materialLoader_);
        this.register(new FontAssetLoader());
        // The engine core however it is embedded: the module on the web, the host's
        // bindings on a device. Taking only the module made these two web-only by
        // construction — a packaged game passes `module: null`.
        const core = (): EngineApi | null => this.module_ ?? nativeEngineApi();
        this.register(new MeshAssetLoader(core));
        this.register(new EnvironmentAssetLoader(core));
        this.register(new ProbeVolumeAssetLoader(core));
        this.register(new MeshSdfAssetLoader());
        this.register(new MeshCardsAssetLoader());
        // The audio loader needs the AudioAPI outside load() too (unload /
        // invalidate have no LoadContext), so it shares Assets' lazy accessor.
        this.register(new AudioAssetLoader(() => this.getAudio_()));
        this.register(new AnimClipAssetLoader());
        this.register(new PrefabAssetLoader());
        // A recipe is bound to an exact era, just like a resolved material.
        // Use the same pending cache, generation ledger and dependency graph.
        this.register<PreparedPrefab>({
            type: 'prepared-prefab', extensions: [], bindsTextures: true,
            load: (path, context) => this.bakePrefab_(path, context as RecordingContext),
            unload: (prepared) => prepared.release(),
        });
        this.register(new LocaleAssetLoader(this));
        this.register(new JsonAssetLoader());
        this.register(new SoundEventAssetLoader());
        // …and whatever an optional subsystem brought with it. A loader names
        // its subsystem's parser, so one the core constructs is one every
        // package carries.
        for (const loader of optionalAssetLoaders()) this.register(loader);
    }

    private textureCacheKey_(path: string, flip: boolean): string {
        return textureResidencyKey(path, flip);
    }

    private async loadTyped<T>(type: string, ref: string): Promise<T> {
        if (this.getLoader<T>(type)?.registry) {
            const lease = await this.acquireTyped<T>(type, ref) as RegistrySlotLease<T>;
            if (this.getLoader(type)?.bindsTextures) this.registrySlots_.leaveByName(type, this.registryIdentity_(ref), lease);
            return lease.value;
        }
        try {
            const lease = await this.acquireHandle_<T>(type, ref);
            this.genericRefs_.leaveByPath(lease.key, lease.generation);
            return lease.value;
        } catch (error) { throw preparationFailureReason(error); }
    }

    private async acquireHandle_<T>(
        type: string, ref: string, owner?: AssetDependencyOwner, inputs = this.sceneTextureImports_.current,
    ): Promise<AssetLease<T>> {
        const loader = this.loaders_.get(type) as AssetLoader<T> | undefined;
        if (!loader) {
            throw new Error(`No loader registered for type: ${type}`);
        }
        if (!loader.load) {
            throw new Error(`Loader for "${type}" publishes by name; acquire it through its slot`);
        }
        if (loader instanceof AudioAssetLoader) {
            const { path, address } = this.audioFile_(ref);
            return this.acquirePrepared_<T>(loader, ref, ref, ctx => loader.load(ref, ctx, path, address) as Promise<T>, owner);
        }
        const load = loader.load.bind(loader);
        const profile = sceneBindingProfile(ref);
        if (profile !== undefined) inputs = SceneTextureInputs.fromSignature(profile);
        const path = this.resolveLoadPath_(ref);
        const key = this.handleLoadKey_(type, ref, path, inputs);
        return this.acquirePrepared_<T>(loader, key, ref, ctx => load(path, ctx), owner, inputs);
    }

    private audioFile_(ref: string): { path: string; address?: string } {
        const entry = this.manifestModel_?.assetByKey(extractUuid(ref) ?? ref);
        const resolved = this.resolveLoadPath_(ref);
        return { path: resolved === ref ? entry?.path ?? resolved : resolved, address: entry?.address };
    }

    private handleLoadKey_(type: string, ref: string, file?: string, inputs = this.sceneTextureImports_.current): string {
        if (type === 'texture') return this.textureBinding_(ref, file, inputs).path;
        if (sceneBindingProfile(ref) !== undefined || bindingRecord(ref) !== undefined || this.loaders_.get(type) instanceof AudioAssetLoader) return ref;
        const path = file ?? this.resolveLoadPath_(ref);
        const record = this.sceneHandleRecord_(ref);
        const key = record?.asset.type === type ? manifestBindingKey(record.key, path) : path;
        // The document keeps the texture or material handles it requested under these defaults.
        const loader = this.loaders_.get(type);
        return inputs.settings.size && loader?.bindsTextures && !loader.registry && loader !== this.spineLoader_
            ? this.sceneBinding_(type, key, inputs.signature) : key;
    }

    private sceneBinding_(type: string, base: string, profile: string): string {
        this.sampledTypes_.add(type);
        return sceneImportBinding(base, profile);
    }

    /** Only live, pending or revivable variants can be invalidated. Their owners already know the keys. */
    private sampledPaths_(type: string, base: string): Set<string> {
        const paths = new Set([base]);
        const collect = (path: string) => { if (sceneBindingBase(path) === base) paths.add(path); };
        if (type === 'texture') {
            for (const key of this.textureCache_.keys()) collect(key.slice(0, -2));
            for (const path of this.textureLoader_.sourcePaths()) collect(path);
        } else {
            for (const path of this.genericCache_.get(type)?.keys() ?? []) collect(path);
        }
        return paths;
    }

    private claimedSceneBinding_(type: string, path: string, flip = true): string {
        if (!this.sampledTypes_.has(type)) return path;
        const base = sceneBindingBase(path), texture = type === 'texture';
        const prefix = assetPairKey(type, ''), suffix = this.textureCacheKey_('', flip);
        let claimed = path, oldest = Infinity;
        const claims = texture ? this.textureRefs_.pathClaims() : this.genericRefs_.pathClaims();
        for (const [key, age] of claims) {
            if (age >= oldest || (texture ? !key.endsWith(suffix) : !key.startsWith(prefix))) continue;
            const candidate = texture ? key.slice(0, -suffix.length) : key.slice(prefix.length);
            if (sceneBindingBase(candidate) === base) { claimed = candidate; oldest = age; }
        }
        return claimed;
    }

    private projectTextureImport_(ref: string): ParsedTextureImportSettings | undefined {
        const name = bindingRecord(ref), asset = this.assetIdentity_(name ?? ref);
        return this.textureImportResolver_?.(ref) ?? (name ? this.textureImportResolver_?.(name) : undefined)
            ?? (asset !== ref && asset !== name ? this.textureImportResolver_?.(asset) : undefined)
            ?? this.manifestRecord_(name ?? ref)?.asset.textureImport;
    }

    /** Refresh the old owner's sampler at the new locator. An explicit project importer takes precedence. */
    private replacementBinding_(type: string, ref: string, profile?: string): string | undefined {
        if (!this.sampledTypes_.has(type)) return;
        const current = this.handleLoadKey_(type, ref);
        if (profile === undefined && sceneBindingProfile(current) === undefined) return;
        if (type === 'texture' && this.projectTextureImport_(ref)) return current;
        return this.sceneBinding_(type, sceneBindingBase(current), profile ?? (type === 'texture' ? '{}' : '[]'));
    }

    /** A held upload carries its sampler across scene publication, pool revival and device recovery. */
    private textureBinding_(ref: string, file?: string, inputs = this.sceneTextureImports_.current) {
        const profile = sceneBindingProfile(ref);
        if (profile !== undefined) return { path: ref, settings: JSON.parse(profile) as ParsedTextureImportSettings };
        const held = atlasBindingSettings(ref);
        if (held) return { path: ref, settings: held };
        const name = bindingRecord(ref);
        const record = this.manifestRecord_(name ?? ref);
        const texture = record?.asset.type === 'texture' ? record : undefined;
        const asset = this.assetIdentity_(name ?? ref);
        const importer = this.projectTextureImport_(ref);
        const fallback = importer ? undefined : inputs.settings.get(asset);
        const settings = importer ?? fallback;
        const path = file ?? this.resolveLoadPath_(ref);
        const atlas = texture?.asset.metadata?.atlasFrame || this.atlasFrameIn_(this.catalog, ref, path);
        const base = atlas ? path : name !== undefined ? ref : texture ? manifestBindingKey(texture.key, path) : path;
        if (fallback) return { path: this.sceneBinding_('texture', base, atlasTextureSettingsKey(fallback)), settings };
        return { path: atlas ? atlasPageBinding(base, settings) : base, settings };
    }

    private sceneTextureReader_(inputs: SceneTextureInputs): NonNullable<SceneAssetResult['textureReader']> {
        const known = this.sceneTextureReaders_.get(inputs);
        if (known) return known;
        const reader: NonNullable<SceneAssetResult['textureReader']> = {
            acquireTexture: async (ref, flip = true, resolution) => {
                if (inputs === this.sceneTextureImports_.current) return this.acquireTexture(ref, flip, resolution);
                const { result, lease, releaseSize } = await this.acquireTextureVariant_(ref, flip, resolution, inputs);
                return this.textureLease_(lease, result, lease.key, releaseSize);
            },
            acquireSpine: (skeleton, atlas) => inputs === this.sceneTextureImports_.current
                ? this.acquireSpine(skeleton, atlas) : this.acquireSpineLease_(skeleton, atlas, undefined, inputs),
            fetchText: ref => this.fetchText(ref),
            fetchBinary: ref => this.fetchBinary(ref),
        };
        this.sceneTextureReaders_.set(inputs, reader);
        return reader;
    }

    /**
     * One era of one cached asset, under the KEY that identifies it — the
     * path for everything whose identity is a path, and the PAIR for spine,
     * whose skeleton with another atlas is another asset. One ownership
     * algorithm, differing only in what it calls one asset.
     */
    private async acquirePrepared_<T>(
        loader: AssetLoader<T>, key: string, ref: string, prepare: (ctx: LoadContext) => Promise<T>, parent?: AssetDependencyOwner,
        inputs = this.sceneTextureImports_.current,
    ): Promise<AssetLease<T>> {
        this.assertLoading_();
        const epoch = this.resetEpoch_;
        const type = loader.type;
        const { ready, unclaim } = this.genericCacheFor_(type).acquire(key, parent, owner =>
            this.prepared_(async ctx => ({ value: await prepare(ctx), owner, loader }), owner, inputs),
        );
        try {
            const era = await ready;
            if (epoch !== this.resetEpoch_) {
                this.retire_(era);
                throw new Error(`Assets were released while "${ref}" was loading; it has no owner. Load it again.`);
            }
            const lease = this.genericRefs_.acquireLoad(assetPairKey(type, key), era, era);
            if (!lease) {
                unclaim?.();
                return this.acquirePrepared_(loader, key, ref, prepare, parent, inputs);
            }
            const result = era.value as T;
            const handle = (result as { handle?: unknown } | null)?.handle;
            if (typeof handle === 'number' && era.loader.fieldBinding !== 'source') this.recordHandlePath_(type, handle, key, era.loader);
            return this.typedLease_(type, lease, result, unclaim);
        } catch (error) {
            unclaim?.();
            throw error;
        }
    }

    /** The cache of current eras for one loader type. A load that lands
     *  after its own deadline was never handed to anyone, so this is the last
     *  place that knows it and what it acquired. */
    private genericCacheFor_(type: string): PreparedAssetCache {
        let cache = this.genericCache_.get(type);
        if (!cache) {
            cache = new PreparedAssetCache(type, era => this.retire_(era));
            this.genericCache_.set(type, cache);
        }
        return cache;
    }

    /**
     * What THIS realm publishes for a ref-bound asset — the answer a runtime
     * lookup reads, and the only copy of it.
     *
     * By the ref as spelled or the path it resolves to: a slot answers to both,
     * so a lookup site need not know which spelling a scene serialized.
     *
     * @internal
     */
    resolveRegistryAsset<T>(type: string, ref: string, owner?: AssetScope | null, scene?: AssetScope | null): T | undefined {
        const slot = this.ownedRegistrySlot_(owner, type, ref) ?? this.ownedRegistrySlot_(scene, type, ref)
            ?? this.publishedSlot_(type, ref);
        return slot?.published as T | undefined;
    }

    /** @internal Whether entity playback can encounter more than one sampler for this kind of named asset. */
    hasScopedRegistryAssets(type: string): boolean { return this.sampledTypes_.has(type) && !!this.loaders_.get(type)?.registry; }

    private ownedRegistrySlot_(scope: AssetScope | null | undefined, type: string, ref: string) {
        if (!scope || !this.hasScopedRegistryAssets(type)) return;
        const direct = this.registrySlots_.ownedSlot(scope, type, ref);
        if (direct) return direct;
        const identity = this.registryIdentity_(ref);
        return identity === ref ? undefined : this.registrySlots_.ownedSlot(scope, type, identity);
    }

    /** A named registry entry stays distinct when multiple records ship the same file. */
    private registryIdentity_(ref: string): string {
        const record = this.manifestRecord_(ref);
        return record ? record.asset.address ?? record.key : this.assetIdentity_(ref);
    }

    private publishedSlot_(type: string, ref: string) {
        const direct = this.registrySlots_.slot(type, ref);
        if (direct?.published != null) return direct;
        const identity = this.registryIdentity_(ref);
        return identity === ref ? direct : this.registrySlots_.slot(type, identity);
    }

    private namedBinding_(type: string, ref: string) {
        const era = this.loaders_.get(type)?.registry ? undefined : this.currentPrepared_(type, ref);
        return era?.loader.fieldBinding === 'source' ? era.owner : this.publishedSlot_(type, ref);
    }

    /** @internal Resolve a live field through its loader type and the owning scope. */
    leaseForBinding(scope: AssetScope, type: string, value: unknown): AssetLease | undefined {
        if (typeof value === 'number') return scope.bindingLease(type, value);
        if (typeof value !== 'string' || !value) return undefined;
        return scope.bindingLease(type, value, this.ownedRegistrySlot_(scope, type, value) ?? this.namedBinding_(type, value));
    }

    /** @internal Changes when a registry type publishes, replaces or withdraws an era. */
    registryAssetVersion(type: string): number {
        return this.registrySlots_.version(type);
    }

    /**
     * What the current era of a ref-bound asset took — the dependency graph as a
     * PROJECTION of acquisitions, never a table anyone maintains.
     *
     * @internal
     */
    dependenciesOf(type: string, ref: string): readonly DependencyReceipt[] {
        const own = this.registrySlots_.dependenciesOf(type, ref);
        if (own.length > 0) return own;
        const byIdentity = this.registrySlots_.dependenciesOf(type, this.registryIdentity_(ref));
        if (byIdentity.length > 0) return byIdentity;
        return this.currentPrepared_(type, ref)?.edges ?? [];
    }

    private currentPrepared_(type: string, ref: string): PreparedLoad<unknown> | undefined {
        const cache = this.genericCache_.get(type);
        if (!cache) return;
        if (type === 'spine') {
            const pair = cache.get(ref) ?? cache.get(this.spineBinding_(ref));
            if (pair?.loader === this.spineLoader_) return pair;
        }
        const path = this.handleLoadKey_(type, ref);
        if (this.loaders_.get(type) !== this.spineLoader_) return cache.get(path);
        const atlas = this.spineAtlasOf_(path);
        return atlas ? cache.get(this.spineBinding_(assetPairKey(path, atlas))) : undefined;
    }

    /**
     * Asset types whose stored handle a live rebind can replace. Fields that
     * use registry names and file references keep their authored spelling.
     *
     * @internal
     */
    handleBoundTypes(): string[] {
        const types: string[] = [];
        for (const [type, loader] of this.loaders_) {
            if (loader.load && loader.fieldBinding !== 'source') types.push(type);
        }
        return types;
    }

    /** @internal Whether an asynchronous replacement still holds the value published for this ref. */
    isCurrentBindingLease(type: string, ref: string, lease: AssetLease): boolean {
        if (type === 'texture') return this.getTexture(ref) === lease.value;
        const era = this.currentPrepared_(type, ref);
        return era !== undefined && era.value === lease.value;
    }

    /**
     * Every asset of this realm whose CURRENT era took `ref` — the reverse of
     * {@link dependenciesOf}, walked from the eras so there is no table to keep.
     * By canonical identity: a receipt says what the acquisition ASKED for (a
     * `@uuid:` ref, a document-relative path) and a change names a file.
     *
     * @internal
     */
    dependentsOfSource(ref: string): AssetIdentity[] {
        const canonical = cachedPaths(path => this.graphPath_(path));
        const target = canonical(ref);
        return matchingDependents(this.eras_(), edge => isInvalidatable(edge) && canonical(edge.path) === target);
    }

    /**
     * Every asset of this realm that ACQUIRED this one — the edge to follow once
     * the walk is past the file that changed. A source read is NOT one: those
     * bytes are exactly as their reader read them, and what ended here is this
     * asset's own generation.
     *
     * @internal
     */
    dependentsOfAsset(asset: AssetIdentity): AssetIdentity[] {
        const canonical = cachedPaths(path => this.graphPath_(path));
        const target = canonical(asset.path);
        return matchingDependents(this.eras_(), edge => edge.kind === 'owned' && edge.type === asset.type && canonical(edge.path) === target);
    }

    /** Every live era of this realm, held by a registry slot or a prepared load. */
    private eras_(): AssetWithReceipts[] {
        const eras = this.registrySlots_.eras();
        const seen = new Set<PreparedLoad<unknown>>();
        for (const cache of this.genericCache_.values()) {
            for (const era of cache.values()) seen.add(era);
        }
        // Invalidating removes residency, not ownership. A failed refresh can
        // keep an outgoing recipe in a graph; its nested dependencies must still
        // lead back to that graph when their sources recover.
        for (const [, generations] of this.genericRefs_.entries()) {
            for (const { value } of generations) seen.add(value);
        }
        for (const { owner, edges } of seen) {
            eras.push({ type: owner.type, path: owner.key, edges });
        }
        return eras;
    }

    /**
     * Everything this realm publishes of one type. What a schedule analysis
     * reads to learn what the graphs THIS app loaded reach for.
     *
     * @internal
     */
    publishedRegistryAssets<T>(type: string): T[] {
        return this.registrySlots_.publishedOf(type) as T[];
    }

    /**
     * The slot table's view of one registry-backed loader — the LoadContext
     * bound in, so the table stays about ownership and knows nothing about how
     * any particular kind of asset is parsed.
     */
    private registryKind_<T>(type: string, inputs = this.sceneTextureImports_.current): RegistryAssetKind<T> | null {
        const loader = this.loaders_.get(type) as AssetLoader<T> | undefined;
        const registry = loader?.registry;
        if (!registry) return null;
        // The locator is resolved HERE, once per era: the slot holds an identity,
        // and where that asset is served from is a property of the revision the
        // preparation runs in.
        return {
            prepare: (key, owner) => {
                const identity = sceneBindingBase(key);
                const profile = sceneBindingProfile(key);
                const readInputs = profile !== undefined && profile !== inputs.signature ? SceneTextureInputs.fromSignature(profile) : inputs;
                return this.prepared_(ctx => {
                    const path = this.resolveLoadPath_(identity);
                    const file = path === identity ? this.manifestRecord_(identity)?.asset.path ?? path : path;
                    return registry.prepare(file, ctx, owner);
                }, owner, readInputs);
            },
        };
    }

    private bakePrefab_(path: string, ctx: RecordingContext,
                        overrides: readonly PrefabOverride[] = []): Promise<PreparedPrefab> {
        return preparePrefabFromSource({
            loadPrefab: async (ref) => (await ctx.acquireAsset<PrefabResult>('prefab', ref)).value,
            preloadSceneAssets: (scene, progress, options) => this.preloadSceneAssets_(scene, progress, options, ctx.recorder, ctx.textureInputs),
            resolveSceneAssetPaths: (scene, result) => this.resolveSceneAssetPaths(scene, result),
            trackSceneAssetReferences: (scene, entities, world) => this.trackSceneAssetReferences(scene, entities, world),
            resolveRef: ref => this.resolveRef(ref),
            entityScopes: this.entityScopes,
        }, path, overrides);
    }

    /**
     * Run one preparation: what the loader takes IS the result's ownership and
     * IS the graph's edges. A transaction, because an acquisition on the way to
     * a value that never arrives has no owner — the thing that would have held
     * it does not exist.
     */
    private async prepared_<T extends object>(
        work: (ctx: RecordingContext) => Promise<T>, owner?: AssetDependencyOwner, inputs = this.sceneTextureImports_.current,
    ): Promise<T & Preparation> {
        this.assertLoading_();
        const recorder = new DependencyRecorder(owner);
        this.preparations_.add(recorder);
        try {
            return recorder.commit(await work(this.recordingContext_(recorder, inputs)));
        } catch (e) {
            throw recorder.abort(e);
        } finally { this.preparations_.delete(recorder); }
    }

    /** The load context one preparation sees: every door that takes something
     *  reports it, and the plain readers stay plain. */
    private recordingContext_(recorder: DependencyRecorder, inputs: SceneTextureInputs): RecordingContext {
        const base = this.getLoadContext_();
        const textures = this.sceneTextureReader_(inputs);
        const model = this.manifestModel_, root = this.remoteRoot_;
        const owner = recorder.owner?.key;
        const epoch = this.resetEpoch_;
        const attempt = async <T>(ref: string, work: () => Promise<T>): Promise<T> => {
            try { this.assertLoading_(epoch); return await work(); }
            catch (error) { recorder.failed(ref, error); throw preparationFailureReason(error); }
        };
        const read = async <T>(ref: string, work: () => Promise<T>): Promise<T> => {
            const result = await attempt(ref, work);
            this.assertLoading_(epoch);
            return result;
        };
        const readSource = <T>(ref: string, fetch: (path: string) => Promise<T>) => {
            recorder.read(ref);
            const record = this.manifestRecord_(ref);
            const resolved = record || assetRefId(ref) !== null ? this.resolveLoadPath_(ref) : ref;
            // A ref that resolves to itself is either unresolved (read the record's path) or already where the bytes are: a URL a
            // loader was handed by resolveLoadPath_, which the record's project path would send to the page's own folder.
            const located = /^[a-z][a-z0-9+.-]*:\/\//i.test(ref);
            const path = resolved === ref && record && !located ? record.asset.path : resolved;
            return read(ref, () => fetch(base.catalog.getBuildPath(path)));
        };
        const take = async <T>(ref: string, work: () => Promise<AssetLease<T>>, type?: string): Promise<AssetLease<T>> => {
            // Own first: if teardown crossed this await, rollback must still
            // return the receipt before the obsolete loader sees its value.
            const lease = recorder.own(ref, await attempt(ref, work), type);
            this.assertLoading_(epoch);
            return lease;
        };
        const forMaterial = async <T>(type: string, ref: string, acquire: () => Promise<AssetLease<T>>): Promise<AssetLease<T>> => {
            if (recorder.owner?.type !== 'material' || (type !== 'texture' && type !== 'material')) return acquire();
            const use = this.surfaceUses_.use(this.surfaceKey_('material', recorder.owner.key));
            if (!use) return acquire();
            const claim = this.surfaceUses_.claim(this.surfaceKey_(type, ref), use);
            try { return claim.keep(await acquire()); }
            finally { claim.release(); }
        };
        const acquireAsset = <T>(type: string, ref: string) =>
            take(ref, () => forMaterial(type, ref, () => this.acquireTypedLease_<T>(type, ref, recorder.owner, 'direct', inputs)), type);
        return {
            ...base,
            get resourceManager() { return base.resourceManager ??= requireResourceManager(); },
            recorder, textureInputs: inputs,
            assetTypeOf: ref => {
                // An absent candidate can outrank the selected fallback once it appears.
                recorder.read(ref);
                return this.hostAssetType_?.(ref) ?? base.catalog.assetTypeOf(ref);
            },
            sourceAddressOf: ref => {
                // Registry slots own logical addresses and handle-backed loaders can own record keys.
                // Two documents can ship identical bytes while naming different siblings.
                const staged = this.stagedPaths_.get(ref) ?? pathWithinRemoteRoot(ref, root);
                const own = owner ? model?.recordForRef(bindingRecord(owner) ?? owner) : undefined;
                const record = owner && own && (own.asset.path === staged || bindingFile(owner) === ref)
                    ? own : model?.recordForRef(staged);
                return record?.asset.address ?? base.catalog.addressOf(staged) ?? base.catalog.addressOf(ref)
                    ?? record?.asset.path ?? (assetRefId(ref) === null ? ref : this.resolveRef(ref) ?? ref);
            },
            loadText: path => read(path, () => base.loadText(path)),
            loadBinary: path => read(path, () => base.loadBinary(path)),
            loadTexture: (path, flipY) => read(path, () => inputs === this.sceneTextureImports_.current
                ? base.loadTexture(path, flipY) : this.loadTextureVariant_(path, flipY ?? true, inputs)),
            decodePixels: path => read(path, () => base.decodePixels!(path)),
            acquireTexture: async (path, flipY, resolution) =>
                take(path, () => forMaterial('texture', path, () => textures.acquireTexture(path, flipY, resolution)), 'texture'),
            acquireAsset,
            resolveRef: ref => this.resolveRef(ref),
            preparePrefab: ref => acquireAsset<PreparedPrefab>('prepared-prefab', ref),
            createOwnedTexture: async (width, height, pixels, flipY) => {
                this.assertLoading_(epoch);
                const lease = await base.createOwnedTexture!(width, height, pixels, flipY);
                recorder.own(`composed:${lease.value.handle}`, lease);
                this.assertLoading_(epoch);
                return lease;
            },
            readSource: ref => readSource(ref, base.loadText),
            readBinarySource: ref => readSource(ref, base.loadBinary),
        };
    }

    private getLoadContext_(): AssetLoadServices {
        if (this.loadContext_) return this.loadContext_;
        const self = this;
        const catalog = this.catalog;
        const model = this.manifestModel_;
        const root = this.remoteRoot_;
        const readSharedFile = model ? manifestFileReads(model, root) : undefined;
        this.loadContext_ = {
            readSharedFile,
            backend: this.backend,
            catalog,
            getAtlasFrame: ref => self.atlasFrameIn_(catalog, ref),
            resolveStreamTail: path => {
                const file = bindingFile(path);
                const local = pathWithinRemoteRoot(file, root);
                const ref = bindingRecord(path) ?? local;
                const record = model?.recordForRef(ref);
                const own = record && (catalog.getStreamTail(`${UUID_REF_PREFIX}${record.key}`)
                    ?? catalog.getStreamTail(record.asset.address ?? record.key) ?? record.asset.streamTail);
                const shared = record && model?.sharesFile(record.asset.path);
                const tail = own ?? (shared ? null : catalog.getStreamTail(file) ?? catalog.getStreamTail(local));
                return tail && root && model?.remoteAssetPath(ref) ? { ...tail, path: remoteAssetUrl(tail.path, root) } : tail;
            },
            resourceManager: getResourceManager(),
            async loadTexture(path: string, flipY?: boolean): Promise<TextureResult> {
                if (flipY === false) {
                    return self.loadTextureRaw(path);
                }
                return self.loadTexture(path);
            },
            acquireTexture: (path, flipY, resolution) => self.acquireTexture(path, flipY, resolution),
            noteAssetProblems(asset: string, problems: readonly string[]): void {
                const path = self.assetIdentity_(asset);
                const same = (self.assetProblems_.get(path) ?? []).join('\n') === problems.join('\n');
                if (problems.length === 0) self.assetProblems_.delete(path);
                else self.assetProblems_.set(path, [...problems]);
                if (!same) self.assetProblemListener_?.(path, problems);
            },
            async acquireAsset<T>(type: string, ref: string): Promise<AssetLease<T>> {
                return self.acquireTyped<T>(type, ref);
            },
            async loadText(path: string): Promise<string> {
                const read = () => self.backend.fetchText(self.backend.resolveUrl(path));
                return readSharedFile ? readSharedFile(path, 'text', read) : read();
            },
            async loadBinary(path: string): Promise<ArrayBuffer> {
                const read = () => self.backend.fetchBinary(self.backend.resolveUrl(path));
                return readSharedFile ? readSharedFile(path, 'binary', read, buffer => buffer.slice(0)) : read();
            },
            async decodePixels(path: string) {
                // The platform's one decode path: the runtime-injected pixel
                // decoder when present (wechat / playable), else fetch→bitmap.
                const file = catalog.getBuildPath(self.resolveLoadPath_(path));
                const ready = self.backend.prepareFile?.(file);
                if (ready) await ready;
                const decoder = self.textureLoader_.pixelDecoder;
                if (decoder) return decoder(file, false);
                return fetchDecodePixels(self.backend.resolveUrl(file));
            },
            async createTextureFromPixels(width, height, pixels, flipY) {
                return self.textureLoader_.loadFromPixels(width, height, pixels, flipY, TextureContent.Retained);
            },
            async createOwnedTexture(width, height, pixels, flipY) {
                return self.ownedTextureLease_(
                    await self.textureLoader_.loadFromPixels(width, height, pixels, flipY, TextureContent.Retained),
                );
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
