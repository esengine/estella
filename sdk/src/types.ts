// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
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

/**
 * Bit widths of the packed Entity representation. MUST match the C++ split
 * (`PackedId<22, 10>` via `Entity::Layout` in core/Types.hpp / PackedId.hpp).
 */
export const ENTITY_INDEX_BITS = 22;
export const ENTITY_GEN_BITS = 10;
/** Number of representable indices (2^INDEX_BITS) — used for overflow-safe packing. */
const ENTITY_INDEX_COUNT = 2 ** ENTITY_INDEX_BITS;
export const ENTITY_INDEX_MASK = ENTITY_INDEX_COUNT - 1;
export const ENTITY_GEN_MASK = (1 << ENTITY_GEN_BITS) - 1;

/** Index portion (low ENTITY_INDEX_BITS) of an Entity handle. */
export function entityIndex(e: Entity): number {
    // `& MASK` is correct even for e > 2^31: the low INDEX_BITS survive the
    // int32 coercion, and MASK (2^22-1) is well within int32 range.
    return e & ENTITY_INDEX_MASK;
}

/** Generation portion (high ENTITY_GEN_BITS) of an Entity handle. */
export function entityGeneration(e: Entity): number {
    // `>>>` reads e as unsigned 32-bit, so this is correct for the full u32 range.
    return (e >>> ENTITY_INDEX_BITS) & ENTITY_GEN_MASK;
}

/** Construct an Entity from an index + generation pair. */
export function makeEntity(index: number, generation: number): Entity {
    // Build via multiply + `>>> 0` rather than `<<`: `gen << 22` would overflow
    // int32 (go negative) for high generations. The product is < 2^32, and
    // `>>> 0` coerces it to the same unsigned value C++ stores in Entity::raw.
    return (((generation & ENTITY_GEN_MASK) * ENTITY_INDEX_COUNT + (index & ENTITY_INDEX_MASK)) >>> 0) as Entity;
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
