/**
 * @file    index.ts
 * @brief   Public API exports for the ECS framework
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */

// =============================================================================
// Types
// =============================================================================

export {
    Type,
    Entity,
    Vec2,
    Vec3,
    Vec4,
    Color,
    Quat,
    INVALID_ENTITY,
    quat,
    type Schema,
    type SchemaType,
    type InferSchema,
    type InferType,
} from './types';

// =============================================================================
// Component
// =============================================================================

export {
    defineComponent,
    defineTag,
    type ComponentDef,
    type ComponentInstance,
    type ComponentInstances,
} from './component';

// =============================================================================
// Proxy (Zero-copy WASM memory access)
// =============================================================================

export {
    computeSchemaLayout,
    createComponentProxy,
    writeComponentData,
    type FieldLayout,
    type SchemaLayout,
} from './proxy';

// =============================================================================
// Query
// =============================================================================

export {
    Query,
    With,
    Without,
    QueryInstance,
    type QueryDescriptor,
    type QueryResult,
} from './query';

// =============================================================================
// Resource
// =============================================================================

export {
    defineResource,
    Res,
    ResMut,
    ResInstance,
    ResMutInstance,
    Time,
    Input,
    type ResourceDef,
    type ResDescriptor,
    type ResMutDescriptor,
    type TimeData,
    type InputState,
} from './resource';

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
    defineSystem,
    runIf,
    type SystemDef,
    type SystemParam,
    type InferParam,
    type InferParams,
} from './system';

// =============================================================================
// Schedule
// =============================================================================

export {
    Schedule,
    defineSystemSet,
    type SystemSet,
    type SystemOrdering,
} from './schedule';

// =============================================================================
// World
// =============================================================================

export { World } from './world';

// =============================================================================
// App
// =============================================================================

export {
    App,
    type Plugin,
    type AppConfig,
} from './app';

// =============================================================================
// Builtin Components (C++ backed)
// =============================================================================

export {
    LocalTransform,
    WorldTransform,
    Sprite,
    Camera,
    Canvas,
    Velocity,
    Parent,
    Children,
    isBuiltinComponent,
    type BuiltinComponentDef,
    type LocalTransformData,
    type SpriteData,
    type CameraData,
    type CanvasData,
    type VelocityData,
} from './builtin';

// =============================================================================
// Plugins
// =============================================================================

export {
    DefaultPlugins,
    TimePlugin,
    InputPlugin,
} from './plugins/default';

export {
    createWasmPlugin,
    loadWasmModule,
    WasmModule,
    Assets,
    type WasmPluginOptions,
    type WasmModuleData,
} from './plugins/wasm';

// =============================================================================
// C++ Integration
// =============================================================================

export type { CppRegistry, AnyComponentDef } from './world';
