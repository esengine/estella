/**
 * ESEngine TypeScript SDK
 *
 * A lightweight 2D game engine for Web and WeChat MiniGames.
 */

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

// ECS - Entity
export {
  generateEntityId,
  recycleEntityId,
  isValidEntity,
  resetEntityIds,
} from './ecs/Entity';

// ECS - Registry
export { Registry } from './ecs/Registry';

// ECS - Components
export {
  Transform,
  Velocity,
  Sprite,
  Name,
  Active,
  Visible,
  Static,
  createTransform,
  createVelocity,
  createSprite,
  createName,
  createActive,
  createVisible,
  createStatic,
  TransformType,
  VelocityType,
  SpriteType,
  NameType,
  ActiveType,
  VisibleType,
  StaticType,
} from './ecs/Components';

// ECS - View
export { View, View2, View3, View4 } from './ecs/View';

// ECS - System
export { System, SystemGroup } from './ecs/System';

// Math utilities
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

// Input
export { Input } from './input/Input';

// Platform
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

// Renderer
export { Renderer, RendererMode, DrawQuadOptions } from './renderer/Renderer';
