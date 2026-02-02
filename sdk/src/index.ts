/**
 * @file    index.ts
 * @brief   ESEngine TypeScript SDK public API exports
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */

// =============================================================================
// Core
// =============================================================================

// Core types and utilities
export {
  Entity,
  INVALID_ENTITY,
  ComponentType,
  Vec2,
  Vec3,
  Vec4,
  Color,
  Mat4,
  TouchType,
  TouchPoint,
  KeyCode,
  ApplicationConfig,
  RendererStats,
  RendererBackend,
  vec2,
  vec3,
  vec4,
  color,
  mat4Identity,
  mat4Ortho,
} from './core/Types';

// Application
export { Application } from './core/Application';

// WASM Bridge
export {
  ESEngineModule,
  WasmLoadOptions,
  isWasmLoaded,
  getWasmModule,
  setWasmModule,
  loadWasmModule,
  initWasmRenderer,
  allocFloat32Array,
  allocUint8Array,
  freePtr,
  withFloat32Array,
} from './core/WasmBridge';

// =============================================================================
// ECS
// =============================================================================

export {
  generateEntityId,
  recycleEntityId,
  isValidEntity,
  resetEntityIds,
} from './ecs/Entity';

export { Registry } from './ecs/Registry';

export {
  Transform,
  Velocity,
  Sprite,
  Name,
  Active,
  Visible,
  Static,
  Parent,
  Children,
  createTransform,
  createVelocity,
  createSprite,
  createName,
  createActive,
  createVisible,
  createStatic,
  createParent,
  createChildren,
  TransformType,
  VelocityType,
  SpriteType,
  NameType,
  ActiveType,
  VisibleType,
  StaticType,
  ParentType,
  ChildrenType,
} from './ecs/Components';

export { View, View2, View3, View4 } from './ecs/View';

export { System, SystemGroup } from './ecs/System';

// =============================================================================
// Math
// =============================================================================

export {
  PI,
  TWO_PI,
  HALF_PI,
  DEG_TO_RAD,
  RAD_TO_DEG,
  clamp,
  lerp,
  toRadians,
  toDegrees,
  Vec2Math,
  Vec3Math,
  Mat4Math,
} from './math/Math';

// =============================================================================
// Platform
// =============================================================================

export { Input } from './input/Input';

export {
  Platform,
  PlatformCapabilities,
  PlatformConfig,
  TouchCallback,
  KeyCallback,
  ResizeCallback,
} from './platform/Platform';
export { WebPlatform } from './platform/WebPlatform';
export { WxPlatform } from './platform/WxPlatform';

// =============================================================================
// Renderer
// =============================================================================

export { Renderer, RendererMode, DrawQuadOptions } from './renderer/Renderer';

// =============================================================================
// Scene
// =============================================================================

export {
  loadScene,
  loadSceneFromData,
  SceneData,
  EntityData,
  ComponentsData,
  ScriptComponentData,
  TextureLoader,
  ComponentRegistry,
  SceneLoaderOptions,
  SceneLoadResult,
  SCENE_FORMAT_VERSION,
} from './scene/SceneLoader';

// =============================================================================
// Assets & WASM
// =============================================================================

export { AssetLoader, type TextureData, type ShaderData } from './assets';

export type {
  CppRegistry,
  CppApp,
  CppResourceManager,
  TextureHandle,
  ShaderHandle,
} from './wasm';

// =============================================================================
// Framework
// =============================================================================

export * from './framework';
