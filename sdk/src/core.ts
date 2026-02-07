/**
 * @file    core.ts
 * @brief   ESEngine SDK - Core exports (no platform initialization)
 */

// =============================================================================
// Types
// =============================================================================

export {
    type Entity,
    INVALID_ENTITY,
    type TextureHandle,
    INVALID_TEXTURE,
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
    SpineAnimation,
    type LocalTransformData,
    type WorldTransformData,
    type SpriteData,
    type CameraData,
    type CanvasData,
    type VelocityData,
    type ParentData,
    type ChildrenData,
    type SpineAnimationData,
} from './component';

// =============================================================================
// Resources
// =============================================================================

export {
    defineResource,
    Res,
    ResMut,
    Time,
    Input,
    type ResourceDef,
    type ResDescriptor,
    type ResMutDescriptor,
    type ResMutInstance,
    type TimeData,
    type InputState,
} from './resource';

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
    createWebApp,
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
    TextRenderer,
    TextPlugin,
    textPlugin,
    type TextData,
    type UIRectData,
    type TextRenderResult,
} from './ui';

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
    type TextureInfo,
    type SliceBorder,
    type SpineLoadResult,
    type SpineDescriptor,
    type FileLoadOptions,
    type AssetManifest,
    type AssetBundle,
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
    type SceneData,
    type SceneEntityData,
    type SceneComponentData,
    type SceneLoadOptions,
} from './scene';

// =============================================================================
// Preview
// =============================================================================

export { PreviewPlugin } from './preview';

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
// Spine Animation
// =============================================================================

export {
    SpineController,
    createSpineController,
    type SpineEventType,
    type SpineEventCallback,
    type SpineEvent,
    type TrackEntryInfo,
} from './spine';

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
