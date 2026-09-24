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
    spineCullingContractFrom,
    spineManifestContractFrom,
    type SpineCullingRect,
    type SpineCullingContract,
    type SpineManifestContract,
    CompressedTextureFormat,
    compressedUploadDecision,
    RAW_PAYLOAD_UPLOAD,
    type TextureUploadDecision,
    type TextureUploadReason,
    type UploadedGpuFormat,
    textureFormatOf,
    type TextureFormatReport,
    type TextureFormatRecord,
    type ApplyUpdateResult,
    type UpdateStages,
    type UpdateStatus,
} from './asset';

/** When the live bindings that READ the asset graph have caught up with it —
 *  the second barrier of an update, the first being `Assets.applyUpdate`. */
export { LiveBindings, type LiveBindingsData } from './hotUpdateRebind';

// =============================================================================
// Resource budget (VRAM)
// =============================================================================

export { setTextureBudget, setRetainedBudget, getResourceStats, trimTextureCache, type ResourceStats } from './wasm/resourceManager';

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
    encodeChannelTable, type MeshChannelDesc, type MeshData, type MeshMorphTargets,
} from './asset/meshFormat';
export type { MeshResult } from './asset/loaders/MeshAssetLoader';
/**
 * Gives a mesh the second UV set a baked lightmap is read through — no two
 * surfaces on one texel, which the UV set the art is wrapped in does not promise.
 * An import calls it; so would a tool that unwraps geometry it generated.
 *
 * @experimental Pre-1.0: the options will follow what a baker turns out to need.
 */
export {
    unwrapLightmapUV, type UnwrapOptions, type UnwrapResult,
} from './lightmap';
/**
 * Bakes lights into an atlas a `MeshLightmap` reads. Direct light, then what
 * bounced — the term a frame here cannot compute, and the way past its ceiling
 * of sixteen lights.
 *
 * @experimental Pre-1.0: the options will follow what an authoring panel needs.
 */
export {
    bakeLightmap, type BakeOptions, type BakeResult, type BakeSurface, type BakeLight,
    type ProbeGrid, bakeHoldsStill, type BakeMobility, BAKE_DEFAULTS,
    captureReflection, flatSky, type CapturedPanorama, type SkyRadiance,
} from './lightmap';
/**
 * What a scene declares about its baked light: the knobs, and the fingerprint of
 * what the last bake read. The engine never looks at it — a bake is a
 * creation-time act — but every door into one does.
 *
 * @experimental Pre-1.0: the knobs follow what a baker turns out to need.
 */
export {
    BakedLighting, type BakedLightingData, bakeFingerprint, type BakeInputs,
    bakeLightOf, bakeLightForward, type AuthoredLight, type BakeLightContribution,
} from './lightmap';
/**
 * A decal's geometry: the surface under a projector, cut to its box. Ordinary
 * triangles, so nothing downstream — lighting, shadows, instancing, culling,
 * picking — has to learn what a decal is; what wins it against the surface it
 * was cut from is the depth bias its material carries.
 *
 * @experimental Pre-1.0: the cut follows what an authoring panel needs.
 */
export {
    DecalProjector, type DecalProjectorData,
    bakeDecalMesh, receiverFromMesh, clipToProjector, projectorUV,
    DEFAULT_FACING_COSINE, CLIP_EPSILON,
    type DecalReceiver, type DecalBakeOptions, type ClipVertex, type ClipTriangle,
} from './decal';
/**
 * Nine coefficients, as the shader reads them. A panorama import and a probe
 * solve both produce these, and this is the one basis both go through.
 *
 * @experimental Pre-1.0: exported for the importers that write coefficients.
 */
export {
    shBasis, convolveCosine, evalIrradianceSH, SH_BASIS_SCALE, SH_COSINE_BAND,
} from './lightmap';
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
export { AssetScope, type AssetLease } from './asset/AssetLease';
export { createCanvasTexture, type CanvasTexture } from './asset/canvasTexture';
export {
    sheetCols, sheetRows, sheetCellCount, sheetCellRect, sheetCellUv, type SheetGrid,
} from './asset/sheetGrid';
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
    RENAMED_COMPONENT_TYPES,
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

// The scene FILE's own vocabulary: a cook that reads a document has to tell its
// two kinds of entry apart the same way the loader does.
export { isPrefabEntry, type SceneEntry } from './scene/sceneEntry';

/**
 * Structural problems in an authored document, in one vocabulary for scenes and
 * prefabs alike — what every gate that reads one judges by.
 *
 * @experimental Pre-1.0: diagnostic codes may gain members as checks are added.
 */
export { validateScene } from './scene/validateScene';
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

// =============================================================================
// World Residency
// =============================================================================

export {
    StreamedWorld,
    WorldPersistent,
    WorldStreamingSource,
    WorldStreamer,
    WorldStreaming,
    desiredResidency,
    distanceToCell,
    cellAt,
    cellSquare,
    worldResidencyPlugin,
    worldResidencySystem,
    worldResidencyReport,
    persistentEntityRows,
    stableEntityId,
    partitionWorld,
    cutWorld,
    prefabRootOf,
    resolvePrefabRoots,
    cellDocumentPath,
    worldManifestPath,
    registryEntityFields,
    WORLD_DIR,
    type StreamedWorldData,
    type WorldStreamingSourceData,
    type WorldCell,
    type WorldManifest,
    type ResidencySource,
    type ResidencyDecision,
    type CellResidency,
    type WorldStreamHost,
    type WorldStreamerStatus,
    type WorldResidencyReport,
    type PartitionOptions,
    type PartitionedCell,
    type PrefabRoot,
    type WorldPartition,
    type CutWorld,
} from './residency/index';

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
export {
    DEBUG_CHANNEL_PROTOCOL,
    type DebugChannelConfig,
    type DebugChannelMessage,
    type DebugChannelQuery,
} from './runtime/debugChannel';

// =============================================================================
// Preview
// =============================================================================


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
    motionOf,
    selectBlendStop,
    blend1DPair,
    blend2DWeights,
    dominantBlendPoint,
    MotionRegistry,
    blend1DMotionDriver,
    blend2DMotionDriver,
    isBlend1D,
    isBlend2D,
    spriteMotionDriver,
    SPRITE_MOTION,
    SPINE_MOTION,
    type AnimatorMotion,
    type AnimatorClipMotion,
    type AnimatorBlend1DMotion,
    type AnimatorBlend2DMotion,
    type AnimatorBlendPoint,
    type AnimatorBlendStop,
    type MotionContext,
    type MotionDriver,
    type MotionSpan,
    type MotionEvent,
    type RootMotionDelta,
    AnimatorEvent,
    type AnimatorEventPayload,
    type AnimatorEventSink,
    AnimatorRootMotion,
    type AnimatorRootMotionData,
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
    animatorLayerCount,
    animatorLayer,
    animatorScopes,
    layerState,
    setLayerState,
    ANIMATOR_FORMAT_VERSION,
    migrateAnimatorController,
    MaskReach,
    solveAnimatorIK,
    parseAvatar,
    emptyAvatar,
    avatarResolver,
    travelRatio,
    AVATAR_FORMAT_VERSION,
    overlayPose,
    addPoseOver,
    STATE_PATH_SEP,
    type AnimatorSubMachine,
    type AnimatorScope,
    type AnimatorLayer,
    type AnimatorLayerBlend,
    type AnimatorMask,
    type AnimatorIK,
    type AnimatorIKKind,
    type AnimatorAvatar,
    type JointResolver,
    type AnimatorMigration,
    type LayerReach,
    type AnimatorPathEvalResult,
    emptyAnimatorController,
    animatorEdges,
    addAnimatorState,
    removeAnimatorState,
    moveAnimatorState,
    renameAnimatorState,
    setAnimatorInitial,
    setAnimatorStateClip,
    setAnimatorStateMotion,
    setAnimatorStateProps,
    addAnimatorTransition,
    removeAnimatorTransition,
    updateAnimatorTransition,
    setAnimatorConditions,
    addAnimatorLayer,
    removeAnimatorLayer,
    updateAnimatorLayer,
    moveAnimatorLayer,
    addAnimatorIK,
    removeAnimatorIK,
    updateAnimatorIK,
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
    createAnimClipFromTextures,
    extractAnimClipTexturePaths,
    animClipSheetCols,
    animClipSheetRows,
    animClipCellRect,
    animClipCellUv,
    animClipDrivesPivot,
    animClipDrivesSize,
    animClipFramePivot,
    animClipFrameSize,
    ANIM_CLIP_FORMAT_VERSION,
    DEFAULT_ANIM_CLIP_PIVOT,
    type AnimClipAssetData,
    type AnimClipFrameData,
    type AnimClipSheetData,
    type AnimClipEventData,
    type AnimClipPivotData,
    type AnimClipVec2,
    type AnimClipSizing,
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
    BUILTIN_AUDIO_BUSES,
    builtinBusVolume,
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
    type AudioDelivery,
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
// MeshRenderer
// =============================================================================

export {
    MeshRendererAPI,
    MeshRenderers,
    MeshRendererPlugin,
    meshRendererPlugin,
} from './render/meshRenderer';

// =============================================================================
// Tilemap
// =============================================================================


// =============================================================================
// Physics types (the plugin + config surface; simulation lives in the package)
// =============================================================================

export type {
    PhysicsWasmModule,
    PhysicsModuleFactory,
    Physics2DPluginConfig,
    Physics2DEventsData,
    CollisionEnterEvent,
    CollisionHitEvent,
    SensorEvent,
} from './physics';

// =============================================================================
// AI — Navigation (a grid for cells, a polygon mesh for geometry)
// =============================================================================


// =============================================================================
// AI — State machines (pure-TS interpreter, .esfsm data + named registry)
// =============================================================================


// =============================================================================
// AI — Behavior trees (pure-TS interpreter, .esbt data + shared registry)
// =============================================================================


// =============================================================================
// Script graph — the `.esgraph` authoring form: events, an exec wire, data wires
// =============================================================================


// =============================================================================
// AI — Perception (sight/FOV sensing into a Perception component)
// =============================================================================


// =============================================================================
// Gameplay — the NAMES authored content reaches it by; the runtime is
// `esengine/gameplay`. From their own module rather than from './gameplay',
// which would put the components and the solver back.
// =============================================================================

export {
    TPC_SPEED,
    TPC_GROUNDED,
    TPC_JUMP,
    TPC_DODGE,
    TPC_ATTACK,
    DODGE_KEY,
    ATTACK_KEY,
    COMBAT_ATTACK_START,
    COMBAT_HIT,
    COMBAT_ATTACK_END,
} from './gameplay/vocabulary';

/** What a game says about its own run, for the observation seam a packaged game
 *  already has. Core rather than `esengine/gameplay`: every host reads it. */
export { Playthrough, type PlaythroughData, type PlaythroughValue } from './runtime/playthrough';

// =============================================================================
// Timeline (Sequencer)
// =============================================================================

export {
    TimelinePlugin,
    timelinePlugin,
    parseTimelineAsset,
    Timeline,
    TimelineAPI,
    TimelinePlayer,
    TIMELINE_MOTION,
    createTimelineMotionDriver,
    type TimelinePlayerData,
} from './timeline';
// Authoring + pure-TS evaluation surface for the editor Sequencer.
export {
    sampleTimeline, sampleTimelineInWorld, evaluateChannel, applyWrapMode,
    serializeTimelineAsset, serializeTimelineToJson, resolveChildEntity, parseAnimationClip,
    TrackType, InterpType, WrapMode, TIMELINE_FORMAT_VERSION,
    isRootPlacementChannel, sampleRootPlacement, createRootPlacement,
    playheadRuns, runCrosses, collectCustomEvents,
    type RootPlacement, type PlayheadRun,
    type CustomEvent, type CustomEventTrack,
    type SampleWorld, type SampleDeps, type SampleOptions,
    type TimelineAsset, type Track, type PropertyTrack, type PropertyChannel, type Keyframe,
    type SpriteAnimTrack, type AudioTrack, type ActivationTrack, type SpineTrack, type AnimFramesTrack,
} from './timeline';

// =============================================================================
// Gameplay AI — the VERB VOCABULARY only; the runtimes are `esengine/ai`. From
// their own modules rather than from './ai', which would put those back.
// =============================================================================

export {
    aiRegistry,
    registerAction,
    registerCondition,
    registerValue,
    noInput,
    type AiContext,
} from './ai/fsm/AiContext';

export {
    AiRegistry,
    invokeAction,
    type AiAction,
    type AiCondition,
    parseActionArg,
    formatActionArg,
    type AiParamDef,
    type AiParamValue,
    type AiParams,
    type AiActionSpec,
    type AiActionInput,
    type AiOutputDef,
    type AiOutputs,
    type AiValueSpec,
} from './ai/fsm/registry';

export {
    Blackboard,
    evalGuard,
    evalGuards,
} from './ai/fsm/Blackboard';

export type { CompareOp, BlackboardGuard } from './ai/fsm/types';
