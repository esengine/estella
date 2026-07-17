// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    core-content.ts
 * @brief   Content surface: scenes, prefabs, assets, animation, audio,
 *          particles, tilemap, physics types.
 *
 * "Content" == data that flows in through the editor + loaders (scenes,
 * prefabs, asset files, anim clips, audio, tilemap source) and the
 * matching runtime APIs. Physics is included because the plugin types
 * are part of the scene/component data surface.
 *
 * Re-exported wholesale by `core.ts`.
 */

// =============================================================================
// Asset Types Registry
// =============================================================================

export {
    type AssetContentType,
    type AddressableAssetType,
    type EditorAssetType,
    type AssetTypeEntry,
    type AssetBuildTransform,
    getAssetTypeEntry,
    getEditorType,
    getAddressableType,
    getAddressableTypeByEditorType,
    isKnownAssetExtension,
    getAllAssetExtensions,
    looksLikeAssetPath,
    getCustomExtensions,
    getWeChatPackOptions,
    getAssetMimeType,
    isCustomExtension,
    toBuildPath,
    registerAssetBuildTransform,
    getAssetBuildTransform,
} from './assetTypes';

// =============================================================================
// Asset
// =============================================================================

export {
    AsyncCache,
    Assets,
    AssetPlugin,
    assetPlugin,
    AssetRefCounter,
    Catalog,
    atlasCatalogFields,
    type CookedAtlasInfo,
    type CatalogData,
    type CatalogEntry,
    decodeImageBitmap,
    decodeImagePixels,
    imageBitmapOptions,
    type DecodedPixels,
    type AddressableManifest,
    type AddressableManifestGroup,
    type AddressableManifestAsset,
    contentHashHex,
    contentHashOf,
    type BundleMode,
    BUNDLE_MODES,
    normalizeBundleMode,
    ManifestModel,
    type AssetsData,
    type TextureInfo,
    type SpineLoadResult,
    type LocaleResult,
    type AssetRefInfo,
} from './asset';

// =============================================================================
// Resource budget (VRAM)
// =============================================================================

export { setTextureBudget, getResourceStats, trimTextureCache, type ResourceStats } from './resourceManager';

// =============================================================================
// Scene
// =============================================================================

export {
    loadSceneData,
    loadSceneWithAssets,
    resetWorldTo,
    loadComponent,
    remapEntityFields,
    updateCameraAspectRatio,
    findEntityByName,
    serializeScene,
    migrateSceneData,
    RETIRED_COMPONENT_TYPES,
    SCENE_FORMAT_VERSION,
    registerSceneComponentCodec,
    getComponentAssetFields,
    getComponentAssetFieldDescriptors,
    getComponentSpineFieldDescriptor,
    type AssetFieldType,
    type SceneData,
    type SceneEntityData,
    type SceneComponentData,
    type SceneMigrationResult,
    type SceneComponentCodec,
    type SceneLoadOptions,
    type SceneLoadProgressCallback,
    type MissingAssetCallback,
    MissingAssetsError,
    type SliceBorder,
} from './scene';

// =============================================================================
// Scene Manager
// =============================================================================

export {
    SceneManager,
    SceneManagerState,
    wrapSceneSystem,
    type SceneConfig,
    type SceneContext,
    type SceneStatus,
    type TransitionOptions,
} from './sceneManager';

export {
    SceneStreaming,
    SceneStreamingController,
    computeStreaming,
    type StreamCell,
    type StreamDecision,
    type StreamPolicy,
    type SceneStreamingConfig,
    type SceneStreamHost,
} from './sceneStreaming';

export { sceneManagerPlugin } from './scenePlugin';

export {
    transitionTo,
    type TransitionConfig,
} from './sceneTransition';

// =============================================================================
// Prefab
// =============================================================================

export {
    instantiatePrefab,
    type PrefabData,
    type PrefabEntityData,
    type PrefabOverride,
    type NestedPrefabRef,
    type InstantiatePrefabOptions,
    type InstantiatePrefabResult,
} from './prefab';

export {
    flattenPrefab,
    applyOverrides,
    bucketOverridesByEntity,
    remapComponentEntityRefs,
    cloneComponents,
    cloneComponentData,
    cloneMetadata,
    collectNestedPrefabPaths,
    preloadNestedPrefabs,
    migratePrefabData,
    PREFAB_FORMAT_VERSION,
    diffAgainstSource,
    applyOverridesToSource,
    validateOverrides,
    expandInstance,
    collapseInstance,
    expandEntry,
    collapseEntry,
    rebuildChildren,
    extractPrefab,
    type PrefabEntityId,
    type ProcessedEntity,
    type FlattenContext,
    type FlattenResult,
    type ComponentData as PrefabComponentData,
    type MigrationResult,
    type DiffOptions,
    type ValidateResult,
    type StaleOverride,
    type AddedEntity,
    type PrefabInstanceDelta,
    type PrefabInstanceEntry,
    type SyncPrefabResolver,
    type ExtractEntity,
} from './prefab/index';

export { Prefabs, PrefabServer, PrefabsPlugin, prefabsPlugin } from './prefabServer';

// =============================================================================
// Runtime Loader
// =============================================================================

export {
    loadRuntimeScene,
    createRuntimeSceneConfig,
    initRuntime,
    sceneUsesI18n,
    type RuntimeAssetSource,
    type LoadRuntimeSceneOptions,
    type RuntimeInitConfig,
} from './runtimeLoader';

// =============================================================================
// Preview
// =============================================================================

export { PreviewPlugin } from './preview';

// =============================================================================
// Animation
// =============================================================================

export {
    Tween,
    TweenAPI,
    TweenHandle,
    EasingType,
    TweenTarget,
    TweenState,
    LoopMode,
    ValueTweenHandle,
    SpriteAnimator,
    SpriteAnimation,
    SpriteAnimationApi,
    Animator,
    AnimatorController,
    AnimatorControllerApi,
    evaluateAnimatorTransitions,
    resolveParams,
    selectBlendClip,
    type AnimatorData,
    type AnimatorBlend1D,
    type AnimatorBlendThreshold,
    type AnimatorSpineMotion,
    type SpineAnimationDriver,
    type AnimatorParam,
    type AnimatorParamType,
    type AnimatorCondition,
    type AnimatorTransition,
    type AnimatorState,
    type AnimatorControllerDef,
    type AnimatorParamValues,
    type AnimatorEvalResult,
    AnimationPlugin,
    animationPlugin,
    type TweenOptions,
    type BezierPoints,
    type SpriteAnimatorData,
    type SpriteAnimClip,
    type SpriteAnimFrame,
    type SpriteAnimEvent,
    type SpriteAnimEventHandler,
    parseAnimClipData,
    parseAnimClipAsset,
    serializeAnimClip,
    createAnimClip,
    extractAnimClipTexturePaths,
    animClipSheetCols,
    animClipSheetRows,
    animClipCellRect,
    animClipCellUv,
    ANIM_CLIP_FORMAT_VERSION,
    type AnimClipAssetData,
    type AnimClipFrameData,
    type AnimClipSheetData,
    TweenGroup,
    TweenSequence,
    type Completable,
    type TweenFactory,
} from './animation';

// =============================================================================
// Audio
// =============================================================================

export {
    Audio,
    AudioAPI,
    AudioPlugin,
    audioPlugin,
    AudioSource,
    AudioListener,
    AudioBus,
    AudioMixer,
    AudioPool,
    parseBusEffects,
    parseAudioProjectConfig,
    applyAudioProjectConfig,
    type AudioProjectConfig,
    type AudioBusDecl,
    type BusEffectDef,
    type FilterEffectDef,
    type ReverbEffectDef,
    type CompressorEffectDef,
    type BusDuckRule,
    AttenuationModel,
    calculateAttenuation,
    calculatePanning,
    type AudioHandle,
    type AudioBufferHandle,
    type PlayConfig,
    type PlatformAudioBackend,
    type AudioBackendInitOptions,
    type AudioPluginConfig,
    type AudioBusConfig,
    type AudioMixerConfig,
    type SpatialAudioConfig,
    type AudioSourceData,
    type AudioListenerData,
    type PooledAudioNode,
} from './audio';

// =============================================================================
// Video
// =============================================================================

export {
    VideoPlayer,
    VideoAPI,
    VideoPlugin,
    videoPlugin,
    Video,
    type VideoHandle,
    type VideoPlayOptions,
    type VideoData,
    type PlatformVideoBackend,
    type VideoStreamHandle,
    type VideoStreamOptions,
} from './video';

// =============================================================================
// Particle
// =============================================================================

export {
    Particle,
    ParticleAPI,
    ParticlePlugin,
    particlePlugin,
} from './particle';

// =============================================================================
// Trail
// =============================================================================

export {
    Trail,
    TrailAPI,
    TrailPlugin,
    trailPlugin,
} from './trail';

// =============================================================================
// Mesh2D
// =============================================================================

export {
    Mesh2DAPI,
    Meshes2D,
    Mesh2DPlugin,
    mesh2dPlugin,
} from './mesh2d';

// =============================================================================
// Tilemap
// =============================================================================

export {
    Tilemap,
    TilemapLayer,
    TilemapAPI,
    Tilemaps,
    initTilemapAPI,
    shutdownTilemapAPI,
    TilemapPlugin,
    tilemapPlugin,
    TilemapLiveSync,
    parseTmjJson,
    parseTmjWithExternals,
    loadTiledMap,
    resolveRelativePath,
    getTextureDimensions,
    registerTilemapSource,
    getTilemapSource,
    clearTilemapSourceCache,
    TILESET_FORMAT_VERSION,
    parseTileset,
    serializeTileset,
    createTileset,
    collidableTileIds,
    resolveTilesetModel,
    decodeTilemapChunks,
    CHUNK_SIZE,
    tileCollisionOutlines,
    tileCellCenter,
    tileCellOutline,
    isNonOrthogonal,
    usesStagger,
    isHexOrientation,
    TileOrientation,
    TB_N,
    TB_E,
    TB_S,
    TB_W,
    TB_NE,
    TB_SE,
    TB_SW,
    TB_NW,
    TERRAIN_NEIGHBORS,
    normalizeCornerMask,
    canonicalMask,
    buildTerrainIndices,
    resolveAutotile,
    packCorners,
    buildWangIndices,
    resolveWang,
    TILE_ID_MASK,
    TILE_FLIP_H,
    TILE_FLIP_V,
    TILE_FLIP_D,
    TILE_FLAGS_MASK,
    encodeTile,
    tileIdOf,
    tileFlagsOf,
    orientationPerm,
    flipFlagsH,
    flipFlagsV,
    rotateFlagsCW,
    singleStamp,
    isEmptyStamp,
    flipStampH,
    flipStampV,
    rotateStampCW,
    type TileFlags,
    type TileStamp,
    type TilemapData,
    type TilemapLayerData,
    type TiledMapData,
    type TiledLayerData,
    type TiledTilesetData,
    type TextureDimensions,
    type LoadedTilemapSource,
    type LoadedTilemapLayer,
    type LoadedTilemapTileset,
    type TilesetAsset,
    type TilesetTile,
    type TilesetCollision,
    type TileCollisionShape,
    type ResolvedTileCollision,
    type ResolvedTileset,
    type TilesetModel,
    type DecodedChunk,
    type TileCollisionPiece,
    type TileGridParams,
    type Vec2Like,
    type TilesetAnimFrame,
    type TerrainMode,
    type TerrainColor,
    type TilesetTerrain,
    type TilesetTileTerrain,
    type TerrainIndex,
    type TerrainIndices,
    type WangIndex,
    type WangIndices,
    type ApplyTilesetRefs,
} from './tilemap';

// =============================================================================
// Physics types (the plugin + config surface; simulation lives in the package)
// =============================================================================

export type {
    PhysicsWasmModule,
    PhysicsModuleFactory,
    PhysicsPluginConfig,
    PhysicsEventsData,
    CollisionEnterEvent,
    CollisionHitEvent,
    SensorEvent,
} from './physics';

// =============================================================================
// AI — Navigation (grid A* today; state machines / behavior trees to come)
// =============================================================================

export {
    NavGrid,
    findPath,
    pathToWorld,
    navGridFromTiles,
    navGridFromTilemapLayer,
    Navigation,
    Nav,
    NavAgent,
    setNavDestination,
    stopNavAgent,
    NavPlugin,
    navPlugin,
    type NavGridOptions,
    type Cell,
    type PathfindOptions,
    type BuildNavGridOptions,
    type NavAgentData,
} from './ai';

// =============================================================================
// AI — State machines (pure-TS interpreter, .esfsm data + named registry)
// =============================================================================

export {
    Blackboard,
    evalGuard,
    evalGuards,
    AiRegistry,
    compileFsm,
    createFsmRunState,
    stepFsm,
    aiRegistry,
    registerAction,
    registerCondition,
    StateMachineAgent,
    registerFsm,
    getFsm,
    clearFsmStore,
    FsmPlugin,
    fsmPlugin,
    StateMachines,
    AiFsm,
    agentBlackboard,
    fsmEdges,
    emptyFsm,
    addState,
    removeState,
    moveState,
    renameState,
    setStateHook,
    actionRefName,
    actionRefArg,
    type FsmActionRef,
    setInitial,
    addTransition,
    removeTransition,
    updateTransition,
    type FsmEdge,
    type CompareOp,
    type BlackboardGuard,
    type FsmTransition,
    type FsmState,
    type FsmDefinition,
    type CompiledFsm,
    type FsmRunState,
    type AiAction,
    type AiCondition,
    type AiContext,
    type StateMachineAgentData,
} from './ai';

// =============================================================================
// AI — Behavior trees (pure-TS interpreter, .esbt data + shared registry)
// =============================================================================

export {
    Status,
    tickBt,
    createBtRunState,
    BehaviorTreeAgent,
    registerBt,
    getBt,
    clearBtStore,
    BtPlugin,
    btPlugin,
    BehaviorTrees,
    AiBt,
    agentBtBlackboard,
    emptyBt,
    ensureBtIds,
    btNodes,
    btEdges,
    maxChildren,
    canHaveChildren,
    addBtChild,
    addBtOrphan,
    removeBtNode,
    moveBtNode,
    setBtNodeField,
    reparentBtNode,
    type BtEdge,
    type BtNodeType,
    type BtNode,
    type BtDefinition,
    type BtRunState,
    type BehaviorTreeAgentData,
} from './ai';

// =============================================================================
// AI — Perception (sight/FOV sensing into a Perception component)
// =============================================================================

export {
    senseTarget,
    facingFromQuat,
    normalizeAngle,
    Perceiver,
    Perception,
    PerceptionTarget,
    PerceptionPlugin,
    perceptionPlugin,
    stepPerception,
    makeLosCheck,
    type SenseResult,
    type PerceiverData,
    type PerceptionData,
} from './ai';
