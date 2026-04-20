/**
 * @file    core-runtime.ts
 * @brief   ECS runtime surface: types, components, world, app, systems,
 *          queries, events, commands, resources, input, env.
 *
 * Re-exported wholesale by `core.ts`. External consumers should import
 * from `esengine` (the package root), not from this file directly.
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
    getAllRegisteredComponents,
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

// =============================================================================
// Input
// =============================================================================

export {
    Input,
    InputState,
    InputPlugin,
    inputPlugin,
    type TouchPoint,
} from './input';

export { GestureDetector, type SwipeDirection } from './gesture';

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
// Transactions (editor undo/redo)
// =============================================================================

export {
    Transaction,
    TransactionManager,
    type TransactionOp,
    type TransactionManagerOptions,
} from './transaction';

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
