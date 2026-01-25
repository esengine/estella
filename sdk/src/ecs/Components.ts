/**
 * ESEngine TypeScript SDK - Built-in Components
 *
 * Provides standard component types for common game functionality.
 */

import { Vec2, Vec3, Color, color, vec3 } from '../core/Types';

/**
 * Transform component - Position, rotation, and scale in world space.
 */
export interface Transform {
  position: Vec3;
  rotation: Vec3; // Euler angles in radians
  scale: Vec3;
}

/**
 * Create a new Transform with default values.
 */
export function createTransform(
  position: Partial<Vec3> = {},
  rotation: Partial<Vec3> = {},
  scale: Partial<Vec3> = {}
): Transform {
  return {
    position: { x: position.x ?? 0, y: position.y ?? 0, z: position.z ?? 0 },
    rotation: { x: rotation.x ?? 0, y: rotation.y ?? 0, z: rotation.z ?? 0 },
    scale: { x: scale.x ?? 1, y: scale.y ?? 1, z: scale.z ?? 1 },
  };
}

/**
 * Velocity component - Linear and angular velocity.
 */
export interface Velocity {
  linear: Vec3; // Units per second
  angular: Vec3; // Radians per second
}

/**
 * Create a new Velocity with default values.
 */
export function createVelocity(
  linear: Partial<Vec3> = {},
  angular: Partial<Vec3> = {}
): Velocity {
  return {
    linear: { x: linear.x ?? 0, y: linear.y ?? 0, z: linear.z ?? 0 },
    angular: { x: angular.x ?? 0, y: angular.y ?? 0, z: angular.z ?? 0 },
  };
}

/**
 * Sprite component - Visual representation for 2D rendering.
 */
export interface Sprite {
  textureId: number;
  color: Color;
  size: Vec2;
  uvOffset: Vec2;
  uvScale: Vec2;
  layer: number;
}

/**
 * Create a new Sprite with default values.
 */
export function createSprite(
  textureId: number = 0,
  options: {
    color?: Partial<Color>;
    size?: Partial<Vec2>;
    uvOffset?: Partial<Vec2>;
    uvScale?: Partial<Vec2>;
    layer?: number;
  } = {}
): Sprite {
  return {
    textureId,
    color: {
      r: options.color?.r ?? 1,
      g: options.color?.g ?? 1,
      b: options.color?.b ?? 1,
      a: options.color?.a ?? 1,
    },
    size: { x: options.size?.x ?? 1, y: options.size?.y ?? 1 },
    uvOffset: { x: options.uvOffset?.x ?? 0, y: options.uvOffset?.y ?? 0 },
    uvScale: { x: options.uvScale?.x ?? 1, y: options.uvScale?.y ?? 1 },
    layer: options.layer ?? 0,
  };
}

/**
 * Name component - Human-readable identifier.
 */
export interface Name {
  value: string;
}

/**
 * Create a new Name component.
 */
export function createName(value: string): Name {
  return { value };
}

/**
 * Tag components - Empty marker components for filtering.
 */
export interface Active {}
export interface Visible {}
export interface Static {}

/**
 * Create an Active tag.
 */
export function createActive(): Active {
  return {};
}

/**
 * Create a Visible tag.
 */
export function createVisible(): Visible {
  return {};
}

/**
 * Create a Static tag.
 */
export function createStatic(): Static {
  return {};
}

// Component type symbols for type identification
export const TransformType = Symbol('Transform');
export const VelocityType = Symbol('Velocity');
export const SpriteType = Symbol('Sprite');
export const NameType = Symbol('Name');
export const ActiveType = Symbol('Active');
export const VisibleType = Symbol('Visible');
export const StaticType = Symbol('Static');
