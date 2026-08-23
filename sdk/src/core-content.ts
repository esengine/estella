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
    fetchDecodePixels,
    HttpBackend,
    type Backend,
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
    resolveAssetGroup,
    resolveAtlas,
    activeRemoteRoot,
    modeToDelivery,
    folderGroupMode,
    withFolderGroup,
    folderAlwaysInclude,
    withFolderAlwaysInclude,
    withActiveRemoteRoot,
    ASSET_GROUP_MODES,
    type AssetGroupMode,
    type AssetGroupDef,
    type AtlasDef,
    type ResolvedAtlas,
    type BuildProfile,
    type AssetGroupsConfig,
    type ResolvedAssetGroup,
    type AssetsData,
    type TextureInfo,
    type SpineLoadResult,
    type LocaleResult,
    type JsonResult,
    type AssetRefInfo,
    textureImportSettingsFrom,
    type ParsedTextureImportSettings,
} from './asset';

// =============================================================================
// Resource budget (VRAM)
// =============================================================================

export { setTextureBudget, getResourceStats, trimTextureCache, type ResourceStats } from './wasm/resourceManager';

/** A texture whose content is a canvas SOMETHING ELSE draws on, re-taken on
 *  demand — the seam a service outside the engine needs to put another
 *  runtime's pixels (an open data context, a host overlay) on a quad. */
/**
 * The `.esmesh` read/write door. Public because writing one is what an importer
 * does — a glTF cook, a plugin's own format — and reading one has to agree with
 * it exactly. `@beta`.
 *
 * @beta
 */
export {
    MeshChannel, MeshChannelType, MESH_MAX_BONES, packChannels, encodeMesh, decodeMesh,
    encodeChannelTable, type MeshChannelDesc, type MeshData,
} from './asset/meshFormat';
export type { MeshResult } from './asset/loaders/MeshAssetLoader';
/**
 * Stock geometry a `builtin:<id>` mesh ref names. Public because the editor's
 * pickers and Create menu are built from this list. `@beta`.
 *
 * @beta
 */
export {
    BUILTIN_MESH_TEMPLATES, builtinMeshTemplate, isBuiltinMeshRef,
    type BuiltinMeshTemplate,
} from './asset/builtinMeshes';
export { createCanvasTexture, type CanvasTexture } from './asset/canvasTexture';
export type { GlImageSource } from './asset/glTextureUpload';

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
    getComponentSkeletalFieldDescriptor,
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
} from './scene/scene';

/**
 * Structural problems in an authored document, in one vocabulary for scenes and
 * prefabs alike — what every gate that reads one judges by.
 *
 * @experimental Pre-1.0: diagnostic codes may gain members as checks are added.
 */
export { validateScene, sceneErrors } from './scene/validateScene';
export type {
    DocumentDiagnostic,
    DocumentDiagnosticSeverity,
    DocumentEntityId,
    DocumentNode,
} from './document/diagnostics';

/**
 * Every asset a scene references, bucketed by declared type — the input to
 * releasing what a document acquired.
 *
 * @beta Pre-1.0: the type vocabulary follows the loader registry.
 */
export { discoverSceneAssets, type SceneAssetRefs } from './asset/discoverAssets';

// =============================================================================
// Scene Manager
// =============================================================================

export {
    SceneManager,
    SceneManagerState,
    SceneLoadCancelled,
    wrapSceneSystem,
    type SceneConfig,
    type SceneContext,
    type SceneStatus,
    type TransitionOptions,
} from './scene/sceneManager';

export {
    SceneStreaming,
    SceneStreamingController,
    computeStreaming,
    type StreamCell,
    type StreamDecision,
    type StreamPolicy,
    type SceneStreamingConfig,
    type SceneStreamHost,
} from './scene/sceneStreaming';

export { sceneManagerPlugin } from './scene/scenePlugin';

export {
    SceneOrigins,
    enableSceneOrigins,
    sceneOriginsEnabled,
    recordSceneOrigins,
    sceneOriginOf,
} from './scene/sceneOrigins';

export {
    transitionTo,
    type TransitionConfig,
} from './scene/sceneTransition';

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
    validatePrefab,
    expandInstance,
    collapseInstance,
    expandEntry,
    collapseEntry,
    rebuildChildren,
    extractPrefab,
    applyDeltaToSource,
    buildVariant,
    collectExternalEntityRefs,
    type PrefabEntityId,
    type ProcessedEntity,
    type FlattenContext,
    type FlattenResult,
    type ComponentData as PrefabComponentData,
    type MigrationResult,
    type DiffOptions,
    type ValidateResult,
    type StaleOverride,
    type PrefabDiagnostic,
    type PrefabDiagnosticSeverity,
    type ValidatePrefabOptions,
    type AddedEntity,
    type PrefabInstanceDelta,
    type PrefabInstanceEntry,
    type SyncPrefabResolver,
    type ExtractEntity,
    type SourceDelta,
    type ExternalEntityRef,
} from './prefab/index';

export { Prefabs, PrefabServer, PrefabsPlugin, prefabsPlugin, type SpawnOverride } from './prefab/prefabServer';

// =============================================================================
// Runtime Loader
// =============================================================================

export {
    loadRuntimeScene,
    createRuntimeSceneConfig,
    initRuntime,
    sceneUsesI18n,
    sceneUsesPhysics,
    sceneUses3DPhysics,
    type RuntimeAssetSource,
    type LoadRuntimeSceneOptions,
    type RuntimeInitConfig,
} from './runtime/runtimeLoader';

// The packaged-realm assembly (WeChat, native) + the game.config.json contract the
// export pipeline writes and every runtime reads.
export {
    loadPackagedAssetIndex,
    indexPackagedManifest,
    catalogFromManifest,
    createPackagedAssetSource,
    applyAssetRefResolvers,
    registerPackagedSideModules,
    packagedAppOptions,
    packagedRuntimeInit,
    type PackagedAssetIndex,
    type PackagedAssetSourceOptions,
    type PackagedGameConfig,
} from './runtime/packagedRuntime';

// =============================================================================
// Preview
// =============================================================================

export { PreviewPlugin, previewPlugin } from './preview';

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
    SpriteAnimationAPI,
    Animator,
    AnimatorController,
    AnimatorControllerAPI,
    registerAnimatorController,
    getRegisteredAnimatorController,
    clearAnimatorControllerStore,
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
    evaluateAnimatorPath,
    enterStatePath,
    leafStateOf,
    STATE_PATH_SEP,
    type AnimatorSubMachine,
    type AnimatorScope,
    type AnimatorPathEvalResult,
    emptyAnimatorController,
    animatorEdges,
    addAnimatorState,
    removeAnimatorState,
    moveAnimatorState,
    renameAnimatorState,
    setAnimatorInitial,
    setAnimatorStateClip,
    setAnimatorStateProps,
    addAnimatorTransition,
    removeAnimatorTransition,
    updateAnimatorTransition,
    setAnimatorConditions,
    addAnimatorParam,
    removeAnimatorParam,
    updateAnimatorParam,
    type AnimatorEdge,
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
    animClipDrivesPivot,
    animClipFramePivot,
    ANIM_CLIP_FORMAT_VERSION,
    DEFAULT_ANIM_CLIP_PIVOT,
    type AnimClipAssetData,
    type AnimClipFrameData,
    type AnimClipSheetData,
    type AnimClipEventData,
    type AnimClipPivotData,
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
    type AudioBufferStats,
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
    spatialDistance,
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
// Platform services (ads, share, achievements)
// =============================================================================

export {
    Achievements, AchievementsAPI, createLocalAchievements,
    Ads, AdsAPI, createMockAdProvider, createTakeover,
    Identity, IdentityAPI,
    ServicesPlugin, servicesPlugin,
    type AchievementProvider,
    type AdProvider, type MockAdProviderOptions, type Takeover, type TakeoverHost,
    type LoginResult,
} from './services';

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
} from './render/mesh2d';

// =============================================================================
// Tilemap
// =============================================================================

export {
    Tilemap,
    TilemapLayer,
    TilemapAPI,
    Tilemaps,
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
    atlasCells,
    decodeTilemapChunks,
    CHUNK_SIZE,
    tileCollisionOutlines,
    COLLISION_PALETTE_REF,
    COLLISION_BRUSHES,
    isCollisionPaletteRef,
    buildCollisionPaletteModel,
    parseCollisionMaterial,
    collisionRefWithMaterial,
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
    type CollisionBrush,
    type CollisionMaterial,
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
// AI — Navigation (a grid for cells, a polygon mesh for geometry)
// =============================================================================

export {
    NavGrid,
    NavMesh,
    buildNavMesh,
    collectNavGeometry,
    navGeometryReady,
    findPath,
    pathToWorld,
    navGridFromTiles,
    navGridFromTilemapLayer,
    Navigation,
    Nav,
    NavAgent,
    NavVolume,
    setNavDestination,
    stopNavAgent,
    NavPlugin,
    navPlugin,
    NavDebugDraw,
    type NavSurface,
    type NavSurfaceSink,
    type NavQueryOptions,
    type NavPoint,
    type NavGridOptions,
    type NavMeshData,
    type BuildNavMeshOptions,
    type NavGeometry,
    type CollectNavGeometryOptions,
    type Cell,
    type PathfindOptions,
    type BuildNavGridOptions,
    type NavAgentData,
    type NavVolumeData,
    type NavDebugDrawConfig,
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
    // The declared-parameter surface: an action says what it takes, and the
    // projection to/from the canonical `arg` string keeps old data running.
    invokeAction,
    parseActionArg,
    formatActionArg,
    type AiParamDef,
    type AiParamValue,
    type AiParams,
    type AiActionSpec,
    type AiActionInput,
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
    actionRefParams,
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
    facingFromRotation,
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

// =============================================================================
// Timeline (Sequencer)
// =============================================================================

export {
    TimelinePlugin,
    timelinePlugin,
    registerTimelineAsset,
    parseTimelineAsset,
    Timeline,
    TimelineAPI,
    TimelinePlayer,
    type TimelinePlayerData,
} from './timeline';
// Authoring + pure-TS evaluation surface for the editor Sequencer.
export {
    sampleTimeline, sampleTimelineInWorld, evaluateChannel, applyWrapMode,
    serializeTimelineAsset, serializeTimelineToJson, resolveChildEntity, parseAnimationClip,
    TrackType, InterpType, WrapMode, TIMELINE_FORMAT_VERSION,
    type SampleWorld, type SampleDeps, type SampleOptions,
    type TimelineAsset, type Track, type PropertyTrack, type PropertyChannel, type Keyframe,
    type SpriteAnimTrack, type AudioTrack, type ActivationTrack, type SpineTrack, type AnimFramesTrack,
} from './timeline';
