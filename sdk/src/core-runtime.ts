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
    // The three shapes ComponentMetadata is BUILT from. Exported because a project
    // that declares one has to name them, and a frozen signature may only name
    // types a creator can spell.
    type AssetRef,
    type AssetFieldMeta,
    type SkeletalFieldMeta,
    Transform,
    LocalTransform,
    WorldTransform,
    Sprite,
    ShapeRenderer,
    ShapeType,
    Light,
    LightType,
    ShadowCaster2D,
    TrailRenderer,
    MeshRenderer,
    type MeshRendererData,
    type MeshRendererGeometry,
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
    type LightData,
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

export {
    RigidBody3D,
    BoxCollider3D,
    SphereCollider3D,
    CapsuleCollider3D,
    MeshCollider3D,
    ConvexCollider3D,
    CharacterController3D,
    type RigidBody3DData,
    type BoxCollider3DData,
    type SphereCollider3DData,
    type CapsuleCollider3DData,
    type MeshCollider3DData,
    type ConvexCollider3DData,
    type CharacterController3DData,
} from './physics3d/Physics3DComponents';

export {
    PointJoint3D,
    HingeJoint3D,
    SliderJoint3D,
    DistanceJoint3D,
    FixedJoint3D,
    type PointJoint3DData,
    type HingeJoint3DData,
    type SliderJoint3DData,
    type DistanceJoint3DData,
    type FixedJoint3DData,
    readJoint3D,
    type Joint3DShape,
} from './physics3d/Physics3DJoints';

export {
    Physics3DDebugDraw,
    drawPhysics3DDebug,
    type Physics3DDebugDrawConfig,
} from './physics3d/Physics3DDebugDraw';

export {
    readCollider3DShapes,
    collider3DWireframe,
    placeCollider3DWireframe,
    rotateVec3ByQuat,
    COLLIDER3D_RING_SEGMENTS,
    type Collider3DShape,
    type Collider3DInstance,
    type Collider3DComponent,
} from './physics3d/ColliderShape3D';

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
    Virtual,
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
    type QueryArg,
    type QueryBuilder,
    type QueryDescriptor,
    type QueryResult,
    // What QueryResult is spelled with — computed, never supplied, but a frozen
    // signature may only name types a reader can look up.
    type ComponentsData,
    type UnwrapQueryArg,
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
    type SystemTouches,
    type SystemSet,
    type SystemSetOptions,
    type InferParam,
    type InferParams,
} from './ecs/system';

/**
 * What the schedule can say about itself: which systems' order nobody decided,
 * and how much of it is inherently sequential.
 *
 * @beta
 */
export type { Ambiguity } from './app/ambiguity';

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

// =============================================================================
// App
// =============================================================================

export {
    App,
    addPlugin,
    flushPendingRegistrations,
    type FrameCosts,
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

// The embedding contract — how a HOST instantiates the engine and hands it a
// registry — is `esengine/wasm`, not this entry. A game is written against the
// engine; only something embedding it needs to name the module.

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
