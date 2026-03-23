/**
 * @file    core.ts
 * @brief   ESEngine SDK - Core exports (no platform initialization)
 */

// =============================================================================
// Defaults
// =============================================================================

export {
    DEFAULT_DESIGN_WIDTH,
    DEFAULT_DESIGN_HEIGHT,
    DEFAULT_PIXELS_PER_UNIT,
    DEFAULT_TEXT_CANVAS_SIZE,
    DEFAULT_SPRITE_SIZE,
    DEFAULT_FONT_FAMILY,
    DEFAULT_FONT_SIZE,
    DEFAULT_LINE_HEIGHT,
    DEFAULT_MAX_DELTA_TIME,
    DEFAULT_FALLBACK_DT,
    DEFAULT_GRAVITY,
    DEFAULT_FIXED_TIMESTEP,
    DEFAULT_SPINE_SKIN,
    applyRuntimeConfig,
} from './defaults';

// =============================================================================
// Types
// =============================================================================

export {
    type Entity,
    INVALID_ENTITY,
    type TextureHandle,
    INVALID_TEXTURE,
    type FontHandle,
    INVALID_FONT,
    INVALID_MATERIAL,
    type Vec2,
    type Vec3,
    type Vec4,
    type Color,
    type Quat,
    vec2,
    vec3,
    vec4,
    color,
    quat,
} from './types';

// =============================================================================
// Components
// =============================================================================

export {
    defineComponent,
    defineTag,
    isBuiltinComponent,
    getComponentDefaults,
    getUserComponent,
    clearUserComponents,
    unregisterComponent,
    registerComponent,
    getComponent,
    type ComponentDef,
    type BuiltinComponentDef,
    type AnyComponentDef,
    type ComponentData,
    Transform,
    LocalTransform,
    WorldTransform,
    Sprite,
    ShapeRenderer,
    ShapeType,
    Camera,
    Canvas,
    Velocity,
    Parent,
    Children,
    BitmapText,
    SpineAnimation,
    Name,
    Disabled,
    SceneOwner,
    ProjectionType,
    ClearFlags,
    ScaleMode,
    type TransformData,
    type LocalTransformData,
    type WorldTransformData,
    type SpriteData,
    type ShapeRendererData,
    type CameraData,
    type CanvasData,
    type VelocityData,
    type ParentData,
    type ChildrenData,
    type BitmapTextData,
    type SpineAnimationData,
    type RigidBodyData,
    type BoxColliderData,
    type CircleColliderData,
    type CapsuleColliderData,
    type NameData,
    type SceneOwnerData,
    ParticleEmitter,
    EmitterShape,
    SimulationSpace,
    ParticleEasing,
    type ParticleEmitterData,
    PostProcessVolume,
    type PostProcessVolumeData,
} from './component';

export {
    RigidBody,
    BoxCollider,
    CircleCollider,
    CapsuleCollider,
    SegmentCollider,
    PolygonCollider,
    ChainCollider,
    RevoluteJoint,
    BodyType,
} from './physics/PhysicsComponents';

// =============================================================================
// Resources
// =============================================================================

export {
    defineResource,
    Res,
    ResMut,
    Time,
    type ResourceDef,
    type ResDescriptor,
    type ResMutDescriptor,
    type ResMutInstance,
    type TimeData,
} from './resource';

export { Storage } from './storage';

export {
    Input,
    InputState,
    InputPlugin,
    inputPlugin,
    type TouchPoint,
} from './input';

// =============================================================================
// Gesture
// =============================================================================

export { GestureDetector, type SwipeDirection } from './gesture';

// =============================================================================
// Filters
// =============================================================================

export { Filters } from './filters';

export {
    SpriteFilter,
    type OutlineFilterOptions,
    type DropShadowFilterOptions,
} from './spriteFilter';

// =============================================================================
// Graphics
// =============================================================================

export { Graphics } from './graphics';

// =============================================================================
// Entity Utils
// =============================================================================

export { setEntityVisible, isEntityVisible, setEntityActive, isEntityActive } from './entityUtils';
export { CacheBitmap, type BitmapCache } from './cacheBitmap';
export {
    CacheAsBitmap,
    getCacheForEntity,
    setCacheForEntity,
    removeCacheForEntity,
    clearAllCaches,
    type CacheAsBitmapData,
} from './cacheAsBitmap';
export { pointInHitArea, type HitAreaShape } from './hitArea';

// =============================================================================
// Screen
// =============================================================================

export { ScreenInfo, ScreenOrientation } from './screen';

// =============================================================================
// Network
// =============================================================================

export { GameSocket, WeChatSocket, createSocket, type GameSocketOptions, type SocketReadyState } from './net';

// =============================================================================
// Texture
// =============================================================================

export { TextureFilter, TextureWrap, setTextureFilter, setTextureWrap, setTextureParams } from './textureParams';

// =============================================================================
// Camera
// =============================================================================

export { CameraUtils } from './camera/Camera';

// =============================================================================
// Query
// =============================================================================

export {
    Query,
    Mut,
    Added,
    Changed,
    Removed,
    QueryInstance,
    RemovedQueryInstance,
    type QueryBuilder,
    type QueryDescriptor,
    type QueryResult,
    type MutWrapper,
    type AddedWrapper,
    type ChangedWrapper,
    type RemovedQueryDescriptor,
} from './query';

// =============================================================================
// Events
// =============================================================================

export {
    defineEvent,
    EventWriter,
    EventReader,
    EventRegistry,
    EventWriterInstance,
    EventReaderInstance,
    type EventDef,
    type EventWriterDescriptor,
    type EventReaderDescriptor,
} from './event';

// =============================================================================
// Commands
// =============================================================================

export {
    Commands,
    CommandsInstance,
    EntityCommands,
    type CommandsDescriptor,
} from './commands';

// =============================================================================
// System
// =============================================================================

export {
    Schedule,
    defineSystem,
    addSystem,
    addStartupSystem,
    addSystemToSchedule,
    GetWorld,
    SystemRunner,
    type GetWorldDescriptor,
    type SystemDef,
    type SystemParam,
    type SystemOptions,
    type InferParam,
    type InferParams,
} from './system';

// =============================================================================
// World
// =============================================================================

export { World } from './world';
export { PTR_LAYOUTS } from './ptrLayouts.generated';
export type { PtrLayout } from './ptrLayouts.generated';
export { writePtrField, readPtrField } from './ecs/BuiltinBridge';
export type { BuiltinBridge } from './ecs/BuiltinBridge';

// =============================================================================
// App
// =============================================================================

export {
    App,
    flushPendingSystems,
    type Plugin,
    type PluginDependency,
    type WebAppOptions,
} from './app';

// =============================================================================
// WASM Types
// =============================================================================

export type {
    ESEngineModule,
    CppRegistry,
    CppResourceManager,
} from './wasm';

// =============================================================================
// UI
// =============================================================================

export {
    Text,
    TextAlign,
    TextVerticalAlign,
    TextOverflow,
    UIRect,
    UIRenderer,
    UIVisualType,
    UILayoutGeneration,
    UIMask,
    TextRenderer,
    textPlugin,
    DefaultImageResolver,
    setImageResolver,
    getImageResolver,
    parseRichText,
    type ImageResolver,
    type ResolvedImage,
    type RichTextRun,
    type TextSegment,
    type ImageSegment,
    CollectionView,
    CollectionItem,
    SelectionMode,
    setCollectionAdapter,
    getCollectionAdapter,
    removeCollectionAdapter,
    collectionViewPlugin,
    CollectionViewPlugin,
    registerLayoutProvider,
    getLayoutProvider,
    ScrollAlign,
    ItemPool,
    LinearLayout,
    GridLayout,
    FanLayout,
    LinearLayoutProvider,
    GridLayoutProvider,
    FanLayoutProvider,
    computeFanPositions,
    collectionGetItemEntity,
    collectionRefreshItems,
    collectionRefreshItem,
    collectionInsertItems,
    collectionRemoveItems,
    type CollectionViewData,
    type CollectionItemData,
    type CollectionAdapter,
    type LayoutProvider,
    type CollectionLayoutResult,
    type LinearLayoutData,
    type GridLayoutData,
    type FanLayoutData,
    intersectRects,
    invertMatrix4,
    screenToWorld,
    pointInWorldRect,
    pointInOBB,
    quaternionToAngle2D,
    Interactable,
    UIInteraction,
    Selectable,
    type SelectableData,
    AnimOverride,
    Button,
    ButtonState,
    UIEvents,
    UIEventQueue,
    makeInteractable,
    UICameraInfo,
    computeUIRectLayout,
    computeFillAnchors,
    computeHandleAnchors,
    computeFillSize,
    applyDirectionalFill,
    syncFillSpriteSize,
    TextInput,
    Image,
    ImageType,
    FillMethod,
    FillOrigin,
    Toggle,
    ProgressBar,
    ProgressBarDirection,
    Draggable,
    DragState,
    ScrollView,
    Slider,
    SliderDirection,
    FillDirection,
    Focusable,
    FocusManager,
    FocusManagerState,
    SafeArea,
    Dropdown,
    type TextData,
    type UIRectData,
    type UIMaskData,
    type MaskMode,
    type TextRenderResult,
    type ScreenRect,
    type InteractableData,
    type UIInteractionData,
    type ButtonTransition,
    type ButtonData,
    type UIEvent,
    type UIEventType,
    type UIEventHandler,
    type Unsubscribe,
    type UICameraData,
    type LayoutRect,
    type LayoutResult,
    type TextInputData,
    type UIRendererData,
    type UILayoutGenerationData,
    type ImageData,
    type ToggleTransition,
    type ToggleData,
    type ProgressBarData,
    type DraggableData,
    type DragStateData,
    type ScrollViewData,
    type SliderData,
    type FocusableData,
    type SafeAreaData,
    type DropdownData,
    UI,
    initUIBuilder,
    UIThemeRes,
    DARK_THEME,
    withChildEntity,
    setEntityColor,
    setEntityEnabled,
    colorScale,
    colorWithAlpha,
    EntityStateMap,
    type UITheme,
    type UIEntityDef,
    type ButtonOptions,
    type SliderOptions,
    type ToggleOptions,
    type ProgressBarOptions,
    type ScrollViewOptions,
    type TextInputOptions,
    type DropdownOptions,
    type LabelOptions,
    type PanelOptions,
    type FlexOptions,
    type UINode,
} from './ui';

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
    MaterialLoader,
    AssetRefCounter,
    type AddressableManifest,
    type AddressableManifestGroup,
    type AddressableManifestAsset,
    type AssetsData,
    type TextureInfo,
    type SpineLoadResult,
    type LoadedMaterial,
    type ShaderLoader,
    type AssetRefInfo,
} from './asset';

// =============================================================================
// Scene
// =============================================================================

export {
    loadSceneData,
    loadSceneWithAssets,
    loadComponent,
    remapEntityFields,
    updateCameraAspectRatio,
    findEntityByName,
    getComponentAssetFields,
    getComponentAssetFieldDescriptors,
    getComponentSpineFieldDescriptor,
    type AssetFieldType,
    type SceneData,
    type SceneEntityData,
    type SceneComponentData,
    type SceneLoadOptions,
    type SceneLoadProgressCallback,
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
    remapComponentEntityRefs,
    cloneComponents,
    cloneComponentData,
    collectNestedPrefabPaths,
    preloadNestedPrefabs,
    type ProcessedEntity,
    type FlattenContext,
    type FlattenResult,
    type ComponentData as PrefabComponentData,
} from './prefab/index';

export { Prefabs, PrefabServer, PrefabsPlugin, prefabsPlugin } from './prefabServer';

// =============================================================================
// Runtime Loader
// =============================================================================

export {
    loadRuntimeScene,
    createRuntimeSceneConfig,
    initRuntime,
    type RuntimeAssetProvider,
    type LoadRuntimeSceneOptions,
    type RuntimeInitConfig,
} from './runtimeLoader';

// =============================================================================
// Preview
// =============================================================================

export { PreviewPlugin, WebAssetProvider } from './preview';

// =============================================================================
// Platform (base functions only)
// =============================================================================

export {
    getPlatform,
    getPlatformType,
    isPlatformInitialized,
    isWeChat,
    isWeb,
    platformFetch,
    platformReadFile,
    platformReadTextFile,
    platformFileExists,
    platformInstantiateWasm,
    type PlatformAdapter,
    type PlatformType,
    type PlatformRequestOptions,
    type PlatformResponse,
} from './platform';

// =============================================================================
// Draw API
// =============================================================================

export {
    Draw,
    BlendMode,
    initDrawAPI,
    shutdownDrawAPI,
    type DrawAPI,
} from './draw';

// =============================================================================
// Material API
// =============================================================================

export {
    Material,
    ShaderSources,
    initMaterialAPI,
    shutdownMaterialAPI,
    registerMaterialCallback,
    isTextureRef,
    type ShaderHandle,
    type MaterialHandle,
    type MaterialOptions,
    type MaterialAssetData,
    type UniformValue,
    type TextureRef,
} from './material';

// =============================================================================
// Geometry API
// =============================================================================

export {
    Geometry,
    DataType,
    initGeometryAPI,
    shutdownGeometryAPI,
    type GeometryHandle,
    type GeometryOptions,
    type VertexAttributeDescriptor,
} from './geometry';

// =============================================================================
// PostProcess API
// =============================================================================

export {
    PostProcess,
    PostProcessStack,
    initPostProcessAPI,
    shutdownPostProcessAPI,
    type EffectDef,
    type EffectUniformDef,
    type PostProcessEffectData,
    getEffectDef,
    getEffectTypes,
    getAllEffectDefs,
    syncPostProcessVolume,
    cleanupPostProcessVolume,
    cleanupAllPostProcessVolumes,
} from './postprocess';

// =============================================================================
// Renderer API
// =============================================================================

export {
    Renderer,
    RenderStage,
    SubmitSkipFlags,
    initRendererAPI,
    shutdownRendererAPI,
    type RenderTargetHandle,
    type RenderStats,
} from './renderer';

export {
    FlushReason,
    RenderType,
    type DrawCallInfo,
    type FrameCaptureData,
} from './frameCapture';

// =============================================================================
// RenderTexture API
// =============================================================================

export {
    RenderTexture,
    type RenderTextureHandle,
    type RenderTextureOptions,
} from './renderTexture';

// =============================================================================
// Render Pipeline
// =============================================================================

export {
    RenderPipeline,
    type Viewport,
    type RenderParams,
    type CameraRenderParams,
} from './renderPipeline';

// =============================================================================
// Custom Draw Callbacks
// =============================================================================

export {
    registerDrawCallback,
    unregisterDrawCallback,
    clearDrawCallbacks,
    type DrawCallback,
} from './customDraw';

// =============================================================================
// Environment
// =============================================================================

export {
    setEditorMode,
    isEditor,
    isRuntime,
    setPlayMode,
    isPlayMode,
    playModeOnly,
} from './env';

export type { RunCondition } from './app';

// =============================================================================
// Physics
// =============================================================================

export type {
    PhysicsWasmModule,
    PhysicsModuleFactory,
    PhysicsPluginConfig,
    PhysicsEventsData,
    CollisionEnterEvent,
    SensorEvent,
} from './physics';

// =============================================================================
// Logger
// =============================================================================

export {
    Logger,
    getLogger,
    setLogLevel,
    debug,
    info,
    warn,
    error,
    LogLevel,
    type LogEntry,
    type LogHandler,
} from './logger';

// =============================================================================
// GL Debug
// =============================================================================

export {
    GLDebug,
    initGLDebugAPI,
    shutdownGLDebugAPI,
} from './glDebug';

// =============================================================================
// WASM Error Handling
// =============================================================================

export { setWasmErrorHandler } from './wasmError';

// =============================================================================
// Animation
// =============================================================================

export {
    Tween,
    TweenHandle,
    EasingType,
    TweenTarget,
    TweenState,
    LoopMode,
    initTweenAPI,
    shutdownTweenAPI,
    SpriteAnimator,
    spriteAnimatorSystemUpdate,
    registerAnimClip,
    unregisterAnimClip,
    getAnimClip,
    clearAnimClips,
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
    extractAnimClipTexturePaths,
    type AnimClipAssetData,
    onAnimEvent,
    onAnimEventGlobal,
    removeAnimEventListeners,
    TweenGroup,
    TweenSequence,
    TweenCompose,
} from './animation';

// =============================================================================
// Audio
// =============================================================================

export {
    Audio,
    AudioPlugin,
    audioPlugin,
    AudioSource,
    AudioListener,
    AudioBus,
    AudioMixer,
    AudioPool,
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
// Particle
// =============================================================================

export {
    Particle,
    initParticleAPI,
    shutdownParticleAPI,
    ParticlePlugin,
    particlePlugin,
} from './particle';

// =============================================================================
// Tilemap
// =============================================================================

export {
    Tilemap,
    TilemapLayer,
    TilemapAPI,
    initTilemapAPI,
    shutdownTilemapAPI,
    TilemapPlugin,
    tilemapPlugin,
    parseTiledMap,
    parseTmjJson,
    loadTiledMap,
    resolveRelativePath,
    getTextureDimensions,
    registerTilemapSource,
    getTilemapSource,
    clearTilemapSourceCache,
    type TilemapData,
    type TilemapLayerData,
    type TiledMapData,
    type TiledLayerData,
    type TiledTilesetData,
    type TextureDimensions,
    type LoadedTilemapSource,
    type LoadedTilemapLayer,
    type LoadedTilemapTileset,
} from './tilemap';

// =============================================================================
// Stats
// =============================================================================

export {
    Stats,
    StatsPlugin,
    statsPlugin,
    StatsCollector,
    FrameHistory,
    defaultFrameStats,
    type FrameStats,
    type FrameSnapshot,
    type StatsPluginOptions,
} from './stats';

export { StatsOverlay, type StatsPosition } from './stats-overlay';

// =============================================================================
// Timer
// =============================================================================

export {
    TimerManager,
    TimerHandle,
    TimerRes,
    timerPlugin,
} from './timer';

// =============================================================================
// Lifecycle
// =============================================================================

export {
    LifecycleManager,
    Lifecycle,
    lifecyclePlugin,
    type LifecycleEvent,
    type LifecycleListener,
    type LifecyclePluginOptions,
} from './lifecycle';

// =============================================================================
// Playable Runtime
// =============================================================================

export {
    initPlayableRuntime,
    type PlayableRuntimeConfig,
} from './playableRuntime';

export {
    RuntimeConfig,
    applyBuildRuntimeConfig,
    type RuntimeBuildConfig,
} from './defaults';

// =============================================================================
// Resource Manager
// =============================================================================

export {
    initResourceManager,
    shutdownResourceManager,
    requireResourceManager,
    getResourceManager,
    evictTextureDimensions,
} from './resourceManager';

// =============================================================================
// Core Plugin
// =============================================================================

export { corePlugin, DEFAULT_UI_CAMERA_INFO } from './corePlugin';

// =============================================================================
// App Context
// =============================================================================

export { AppContext, getDefaultContext, setDefaultContext, type EditorBridge } from './context';
