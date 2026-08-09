// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
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
    getComponentFieldMeta,
    getReplicatedFields,
    getComponentRegistry,
    getUserComponents,
    getUserComponentFingerprint,
    enumOptions,
    type ComponentDef,
    type BuiltinComponentDef,
    type AnyComponentDef,
    type ComponentData,
    type ComponentMetadata,
    type FieldMeta,
    Transform,
    LocalTransform,
    WorldTransform,
    Sprite,
    ShapeRenderer,
    ShapeType,
    Light2D,
    Light2DType,
    ShadowCaster2D,
    TrailRenderer,
    Mesh2D,
    type Mesh2DData,
    type Mesh2DGeometry,
    Camera,
    Canvas,
    Velocity,
    Parent,
    Children,
    BitmapText,
    SpineAnimation,
    DragonBonesAnimation,
    Name,
    Disabled,
    RuntimeOnly,
    SceneOwner,
    Marker,
    ProjectionType,
    ClearFlags,
    ScaleMode,
    type TransformData,
    type LocalTransformData,
    type WorldTransformData,
    type SpriteData,
    type ShapeRendererData,
    type Light2DData,
    type ShadowCaster2DData,
    type CameraData,
    type CanvasData,
    type VelocityData,
    type ParentData,
    type ChildrenData,
    type BitmapTextData,
    type TrailRendererData,
    type SpineAnimationData,
    type DragonBonesAnimationData,
    type RigidBodyData,
    type BoxColliderData,
    type CircleColliderData,
    type CapsuleColliderData,
    type NameData,
    type SceneOwnerData,
    type MarkerData,
    ParticleEmitter,
    EmitterShape,
    SimulationSpace,
    SubEmitterTrigger,
    ParticleEasing,
    type ParticleEmitterData,
    ParticleForceField,
    ForceFieldType,
    type ParticleForceFieldData,
    PostProcessVolume,
    type PostProcessVolumeData,
} from './ecs/component';

export {
    RigidBody,
    BoxCollider,
    CircleCollider,
    CapsuleCollider,
    SegmentCollider,
    PolygonCollider,
    ChainCollider,
    OneWayPlatform,
    RevoluteJoint,
    DistanceJoint,
    PrismaticJoint,
    WeldJoint,
    WheelJoint,
    MotorJoint,
    BodyType,
} from './physics/PhysicsComponents';

export {
    CharacterController,
    type CharacterControllerData,
} from './physics/CharacterController';

export {
    readColliderShapes,
    shapeOffset,
    shapeCenter,
    colliderShapeOutline,
    CAPSULE_ARC_SEGMENTS,
    type ColliderShape,
    type ColliderInstance,
    type ColliderOutline,
} from './physics/ColliderShape';

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
} from './ecs/resource';

export { Storage } from './util/storage';

// =============================================================================
// Input
// =============================================================================

export {
    Input,
    InputState,
    InputPlugin,
    inputPlugin,
    inputEventCallbacks,
    GamepadButton,
    GamepadAxis,
    type TouchPoint,
} from './input/input';

export type { GamepadSnapshot } from './platform/types';

export {
    InputRouter,
    inputRouter,
    type InputHandler,
    type Modifiers,
} from './input/inputRouter';

export { GestureDetector, type SwipeDirection } from './input/gesture';

// =============================================================================
// Input Map (named actions — UE Enhanced Input / Unity Input System analog)
// =============================================================================

export {
    defineInputMap,
    loadInputMapAsset,
    InputMap,
    Key,
    MouseButton,
    GpButton,
    GpAxis,
    Keys1D,
    Keys2D,
    Stick,
    Button,
    Axis1D,
    Axis2D,
    type Binding,
    type ActionDef,
    type ActionType,
    type InputMapAsset,
    type ListenOptions,
} from './input/inputMap';

// =============================================================================
// Query
// =============================================================================

export {
    Query,
    Mut,
    Added,
    Changed,
    Removed,
    With,
    Without,
    And,
    Or,
    Not,
    QueryInstance,
    RemovedQueryInstance,
    type FilterExpr,
    type QueryBuilder,
    type QueryDescriptor,
    type QueryResult,
    type MutWrapper,
    type AddedWrapper,
    type ChangedWrapper,
    type RemovedQueryDescriptor,
} from './ecs/query';

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
} from './ecs/event';

// The per-entity, string-named channel (the other half of the story above:
// `defineEvent` is the global typed bus, this is "what happened to THIS
// entity"). `ui/` re-exports the same objects as UIEventQueue / UIEvents.
export {
    EntityEventQueue,
    EntityEvents,
    type EntityEvent,
    type EntityEventHandler,
} from './ecs/entityEvents';

// Authored event → action wiring (the data form of `events.on(e, 'click', …)`).
export {
    EventBinding,
    eventBindingPlugin,
    EventBindingPlugin,
    resolveBindingTarget,
    type EventBindingRow,
    type EventBindingData,
} from './eventBinding';

// =============================================================================
// Commands
// =============================================================================

export {
    Commands,
    CommandsInstance,
    EntityCommands,
    type CommandsDescriptor,
} from './ecs/commands';

// =============================================================================
// Transactions (editor undo/redo)
// =============================================================================

export {
    Transaction,
    TransactionManager,
    type TransactionOp,
    type TransactionManagerOptions,
} from './ecs/transaction';

// =============================================================================
// System
// =============================================================================

export {
    Schedule,
    defineSystem,
    defineSystemSet,
    addSystem,
    addStartupSystem,
    addSystemToSchedule,
    addSystemSetToSchedule,
    GetWorld,
    SystemRunner,
    type GetWorldDescriptor,
    type SystemDef,
    type SystemParam,
    type SystemOptions,
    type SystemSet,
    type SystemSetOptions,
    type InferParam,
    type InferParams,
} from './ecs/system';

// =============================================================================
// Behavior (per-entity scripted behavior → one ECS system)
// =============================================================================

export {
    defineBehavior,
    type BehaviorDef,
    type BehaviorContext,
} from './behavior';

// =============================================================================
// World
// =============================================================================

export { World } from './ecs/world';
export { PTR_LAYOUTS } from './wasm/ptrLayouts.generated';
export type { PtrLayout } from './wasm/ptrLayouts.generated';
export { writePtrField, readPtrField } from './ecs/bridge/BuiltinBridge';
export type { BuiltinBridge } from './ecs/bridge/BuiltinBridge';

// =============================================================================
// App
// =============================================================================

export {
    App,
    flushPendingSystems,
    type Plugin,
    type PluginDependency,
    type WebAppOptions,
    type RenderSurfaceSource,
} from './app/app';

// =============================================================================
// Subsystem observability
// =============================================================================

export { SubsystemRegistry } from './app/subsystems';
export type {
    SubsystemStatus,
    SubsystemPhase,
    SubsystemActivity,
    SubsystemEvent,
} from './app/subsystems';

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
    setFxEditPreview,
    isFxEditPreview,
    fxPreviewOrPlayMode,
} from './ecs/env';

export type { RunCondition } from './app/app';

export { probeRegistrations } from './hotReload';
export type { ProbedRegistrations } from './hotReload';
