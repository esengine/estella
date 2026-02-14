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
    registerComponent,
    getComponent,
    type ComponentDef,
    type BuiltinComponentDef,
    type AnyComponentDef,
    type ComponentData,
    LocalTransform,
    WorldTransform,
    Sprite,
    Camera,
    Canvas,
    Velocity,
    Parent,
    Children,
    BitmapText,
    SpineAnimation,
    Name,
    ProjectionType,
    ClearFlags,
    ScaleMode,
    type LocalTransformData,
    type WorldTransformData,
    type SpriteData,
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
} from './component';

export {
    RigidBody,
    BoxCollider,
    CircleCollider,
    CapsuleCollider,
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

export {
    Input,
    InputState,
    InputPlugin,
    inputPlugin,
} from './input';

// =============================================================================
// Query
// =============================================================================

export {
    Query,
    Mut,
    QueryInstance,
    type QueryDescriptor,
    type QueryResult,
    type MutWrapper,
} from './query';

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
    SystemRunner,
    type SystemDef,
    type SystemParam,
    type InferParam,
    type InferParams,
} from './system';

// =============================================================================
// World
// =============================================================================

export { World } from './world';

// =============================================================================
// App
// =============================================================================

export {
    App,
    flushPendingSystems,
    type Plugin,
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
    UIMask,
    createMaskProcessor,
    TextRenderer,
    worldRectToScreen,
    intersectRects,
    invertMatrix4,
    screenToWorld,
    pointInWorldRect,
    Interactable,
    UIInteraction,
    Button,
    ButtonState,
    UIEvents,
    UIEventQueue,
    UICameraInfo,
    ScreenSpace,
    computeUIRectLayout,
    TextInput,
    type TextData,
    type UIRectData,
    type UIMaskData,
    type TextRenderResult,
    type ScreenRect,
    type InteractableData,
    type UIInteractionData,
    type ButtonTransition,
    type ButtonData,
    type UIEvent,
    type UIEventType,
    type UICameraData,
    type LayoutRect,
    type LayoutResult,
    type TextInputData,
} from './ui';

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
    AssetServer,
    AsyncCache,
    Assets,
    AssetPlugin,
    assetPlugin,
    MaterialLoader,
    registerEmbeddedAssets,
    type TextureInfo,
    type SliceBorder,
    type SpineLoadResult,
    type SpineDescriptor,
    type FileLoadOptions,
    type AssetBundle,
    type AddressableResultMap,
    type AddressableManifest,
    type AddressableManifestGroup,
    type AddressableManifestAsset,
    type AssetsData,
    type LoadedMaterial,
    type ShaderLoader,
} from './asset';

// =============================================================================
// Scene
// =============================================================================

export {
    loadSceneData,
    loadSceneWithAssets,
    loadComponent,
    updateCameraAspectRatio,
    findEntityByName,
    registerComponentAssetFields,
    type SceneData,
    type SceneEntityData,
    type SceneComponentData,
    type SceneLoadOptions,
} from './scene';

// =============================================================================
// Prefab
// =============================================================================

export {
    instantiatePrefab,
    type PrefabData,
    type PrefabEntityData,
    type PrefabOverride,
    type InstantiatePrefabOptions,
    type InstantiatePrefabResult,
} from './prefab';

export { Prefabs, PrefabServer, PrefabsPlugin, prefabsPlugin } from './prefabServer';

// =============================================================================
// Runtime Loader
// =============================================================================

export {
    loadRuntimeScene,
    type RuntimeAssetProvider,
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
    initPostProcessAPI,
    shutdownPostProcessAPI,
} from './postprocess';

// =============================================================================
// Renderer API
// =============================================================================

export {
    Renderer,
    RenderStage,
    initRendererAPI,
    shutdownRendererAPI,
    type RenderTargetHandle,
    type RenderStats,
} from './renderer';

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
    type RenderParams,
    type CameraRenderParams,
    type MaskProcessorFn,
    type SpineRendererFn,
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
} from './env';

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
// GL Debug
// =============================================================================

export {
    GLDebug,
    initGLDebugAPI,
    shutdownGLDebugAPI,
} from './glDebug';
