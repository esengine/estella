/**
 * @file    index.ts
 * @brief   ESEngine SDK - Main entry point
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
    type LocalTransformData,
    type WorldTransformData,
    type SpriteData,
    type CameraData,
    type CanvasData,
    type VelocityData,
    type ParentData,
    type ChildrenData,
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
    TextBaseline,
    TextRenderer,
    TextPlugin,
    textPlugin,
    type TextData,
    type TextRenderResult,
} from './ui';
