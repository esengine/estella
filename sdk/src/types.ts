/**
 * @file    types.ts
 * @brief   Core type definitions for ESEngine SDK
 */

// =============================================================================
// Entity
// =============================================================================

export type Entity = number;
export const INVALID_ENTITY = 0 as Entity;

export type TextureHandle = number;
export const INVALID_TEXTURE = 0xFFFFFFFF as TextureHandle;

export type FontHandle = number;
export const INVALID_FONT = 0 as FontHandle;

// =============================================================================
// Math Types
// =============================================================================

export interface Vec2 {
    x: number;
    y: number;
}

export interface Vec3 {
    x: number;
    y: number;
    z: number;
}

export interface Vec4 {
    x: number;
    y: number;
    z: number;
    w: number;
}

export interface Quat {
    w: number;
    x: number;
    y: number;
    z: number;
}

export interface Color {
    r: number;
    g: number;
    b: number;
    a: number;
}

// =============================================================================
// Factory Functions
// =============================================================================

export const vec2 = (x = 0, y = 0): Vec2 => ({ x, y });
export const vec3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });
export const vec4 = (x = 0, y = 0, z = 0, w = 1): Vec4 => ({ x, y, z, w });
export const color = (r = 1, g = 1, b = 1, a = 1): Color => ({ r, g, b, a });
export const quat = (w = 1, x = 0, y = 0, z = 0): Quat => ({ w, x, y, z });
