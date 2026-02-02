/**
 * @file    types.ts
 * @brief   Type system for component schema definitions
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */

import { Entity, Vec2, Vec3, Vec4, Color, INVALID_ENTITY } from '../core/Types';

export { Entity, Vec2, Vec3, Vec4, Color, INVALID_ENTITY };

// =============================================================================
// Quaternion
// =============================================================================

export interface Quat {
    x: number;
    y: number;
    z: number;
    w: number;
}

export function quat(x: number = 0, y: number = 0, z: number = 0, w: number = 1): Quat {
    return { x, y, z, w };
}

// =============================================================================
// Type Markers
// =============================================================================

type TypeTag =
    | 'f32' | 'f64' | 'i32' | 'u32' | 'bool'
    | 'Vec2' | 'Vec3' | 'Vec4' | 'Color' | 'Quat'
    | 'Entity' | 'String';

interface TypeMarker<T extends TypeTag> {
    readonly _tag: T;
}

// =============================================================================
// Type Constants
// =============================================================================

export const Type = {
    f32: { _tag: 'f32' } as TypeMarker<'f32'>,
    f64: { _tag: 'f64' } as TypeMarker<'f64'>,
    i32: { _tag: 'i32' } as TypeMarker<'i32'>,
    u32: { _tag: 'u32' } as TypeMarker<'u32'>,
    bool: { _tag: 'bool' } as TypeMarker<'bool'>,
    Vec2: { _tag: 'Vec2' } as TypeMarker<'Vec2'>,
    Vec3: { _tag: 'Vec3' } as TypeMarker<'Vec3'>,
    Vec4: { _tag: 'Vec4' } as TypeMarker<'Vec4'>,
    Color: { _tag: 'Color' } as TypeMarker<'Color'>,
    Quat: { _tag: 'Quat' } as TypeMarker<'Quat'>,
    Entity: { _tag: 'Entity' } as TypeMarker<'Entity'>,
    String: { _tag: 'String' } as TypeMarker<'String'>,
} as const;

// =============================================================================
// Schema Types
// =============================================================================

export type SchemaType = TypeMarker<TypeTag>;

export type Schema = Record<string, SchemaType>;

// =============================================================================
// Type Inference
// =============================================================================

export type InferType<T extends SchemaType> =
    T extends TypeMarker<'f32'> ? number :
    T extends TypeMarker<'f64'> ? number :
    T extends TypeMarker<'i32'> ? number :
    T extends TypeMarker<'u32'> ? number :
    T extends TypeMarker<'bool'> ? boolean :
    T extends TypeMarker<'Vec2'> ? Vec2 :
    T extends TypeMarker<'Vec3'> ? Vec3 :
    T extends TypeMarker<'Vec4'> ? Vec4 :
    T extends TypeMarker<'Color'> ? Color :
    T extends TypeMarker<'Quat'> ? Quat :
    T extends TypeMarker<'Entity'> ? Entity :
    T extends TypeMarker<'String'> ? string :
    never;

export type InferSchema<S extends Schema> = {
    [K in keyof S]: InferType<S[K]>;
};

// =============================================================================
// Default Values
// =============================================================================

export function getDefaultValue(type: SchemaType): unknown {
    switch (type._tag) {
        case 'f32':
        case 'f64':
        case 'i32':
        case 'u32':
            return 0;
        case 'bool':
            return false;
        case 'Vec2':
            return { x: 0, y: 0 };
        case 'Vec3':
            return { x: 0, y: 0, z: 0 };
        case 'Vec4':
            return { x: 0, y: 0, z: 0, w: 0 };
        case 'Color':
            return { r: 1, g: 1, b: 1, a: 1 };
        case 'Quat':
            return { x: 0, y: 0, z: 0, w: 1 };
        case 'Entity':
            return INVALID_ENTITY;
        case 'String':
            return '';
        default:
            return undefined;
    }
}

export function computeDefaults<S extends Schema>(
    schema: S,
    overrides?: Partial<InferSchema<S>>
): InferSchema<S> {
    const result = {} as InferSchema<S>;

    for (const key in schema) {
        const override = overrides?.[key as keyof typeof overrides];
        if (override !== undefined) {
            (result as Record<string, unknown>)[key] = override;
        } else {
            (result as Record<string, unknown>)[key] = getDefaultValue(schema[key]);
        }
    }

    return result;
}
