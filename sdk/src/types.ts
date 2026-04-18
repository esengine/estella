/**
 * @file    types.ts
 * @brief   Core type definitions for ESEngine SDK
 */

// =============================================================================
// Entity
// =============================================================================

/**
 * Entity identifier — a packed u32 with layout `[generation(12) | index(20)]`,
 * matching the C++ `Entity` type in `src/esengine/core/Types.hpp`.
 *
 * The 20-bit index is the slot in the registry (up to 1,048,575 live entities);
 * the 12-bit generation is bumped each time an index is recycled (up to 4,095
 * generations per slot before wrap). Comparing two raw Entity values thus
 * detects stale handles: a handle from a despawned entity will have a
 * different (generation, index) pair than any current live entity that reuses
 * the index, so `rawA !== rawB` reliably distinguishes them.
 *
 * The value is transported across the WASM boundary as a plain u32 and used
 * directly as a Map/Set key on the JS side.
 */
export type Entity = number;

/** Bit widths of the packed Entity representation (must match C++). */
export const ENTITY_INDEX_BITS = 20;
export const ENTITY_GEN_BITS = 12;
export const ENTITY_INDEX_MASK = (1 << ENTITY_INDEX_BITS) - 1;
export const ENTITY_GEN_MASK = (1 << ENTITY_GEN_BITS) - 1;

/** 20-bit index portion of an Entity handle. */
export function entityIndex(e: Entity): number {
    return e & ENTITY_INDEX_MASK;
}

/** 12-bit generation portion of an Entity handle. */
export function entityGeneration(e: Entity): number {
    return (e >>> ENTITY_INDEX_BITS) & ENTITY_GEN_MASK;
}

/** Construct an Entity from an index + generation pair. */
export function makeEntity(index: number, generation: number): Entity {
    return (((generation & ENTITY_GEN_MASK) << ENTITY_INDEX_BITS) | (index & ENTITY_INDEX_MASK)) as Entity;
}

/**
 * JS-side invalid-entity sentinel.
 *
 * NOTE: this is `0` for legacy serialization compatibility — scenes written
 * before this packing was documented use `0` to mean "no entity reference".
 * C++ uses `0xFFFFFFFF` as its sentinel; producers/consumers at the WASM
 * boundary must translate between the two. New code should prefer
 * `isValidEntity()` over comparing against this constant directly.
 */
export const INVALID_ENTITY = 0 as Entity;

/** True when the handle is neither the JS nor C++ invalid sentinel. */
export function isValidEntity(e: Entity): boolean {
    return e !== INVALID_ENTITY && e !== 0xFFFFFFFF;
}

export type TextureHandle = number;
export const INVALID_TEXTURE = 0 as TextureHandle;

export type FontHandle = number;
export const INVALID_FONT = 0 as FontHandle;

export const INVALID_MATERIAL = 0;

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
