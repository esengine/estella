/**
 * @file    proxy.ts
 * @brief   Component proxy for zero-copy WASM memory access
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */

import { Schema, SchemaType, InferSchema } from './types';

// =============================================================================
// Type Size Constants
// =============================================================================

const TYPE_SIZES: Record<string, number> = {
    f32: 4,
    f64: 8,
    i32: 4,
    u32: 4,
    bool: 1,
    Vec2: 8,   // 2 * f32
    Vec3: 12,  // 3 * f32
    Vec4: 16,  // 4 * f32
    Color: 16, // 4 * f32
    Quat: 16,  // 4 * f32
    Entity: 4, // u32
    String: 4, // pointer (not fully supported yet)
};

// =============================================================================
// Schema Layout
// =============================================================================

export interface FieldLayout {
    offset: number;
    size: number;
    type: string;
}

export interface SchemaLayout {
    fields: Record<string, FieldLayout>;
    stride: number;
}

export function computeSchemaLayout<S extends Schema>(schema: S): SchemaLayout {
    const fields: Record<string, FieldLayout> = {};
    let offset = 0;

    for (const key in schema) {
        const type = schema[key] as SchemaType;
        const tag = type._tag;
        const size = TYPE_SIZES[tag] ?? 4;

        // Align to natural boundary
        const alignment = Math.min(size, 4);
        offset = Math.ceil(offset / alignment) * alignment;

        fields[key] = { offset, size, type: tag };
        offset += size;
    }

    // Align stride to 4 bytes
    const stride = Math.ceil(offset / 4) * 4;

    return { fields, stride };
}

// =============================================================================
// Component Proxy
// =============================================================================

/**
 * @brief Proxy for direct memory access to component data
 *
 * @details Creates property getters/setters that read/write directly
 *          to WASM linear memory without crossing the JS/WASM boundary.
 */
export function createComponentProxy<S extends Schema>(
    layout: SchemaLayout,
    heapBuffer: ArrayBuffer,
    byteOffset: number
): InferSchema<S> {
    const view = new DataView(heapBuffer, byteOffset, layout.stride);
    const proxy: Record<string, unknown> = {};

    for (const [key, field] of Object.entries(layout.fields)) {
        switch (field.type) {
            case 'f32':
                Object.defineProperty(proxy, key, {
                    get: () => view.getFloat32(field.offset, true),
                    set: (v: number) => view.setFloat32(field.offset, v, true),
                    enumerable: true,
                });
                break;

            case 'f64':
                Object.defineProperty(proxy, key, {
                    get: () => view.getFloat64(field.offset, true),
                    set: (v: number) => view.setFloat64(field.offset, v, true),
                    enumerable: true,
                });
                break;

            case 'i32':
                Object.defineProperty(proxy, key, {
                    get: () => view.getInt32(field.offset, true),
                    set: (v: number) => view.setInt32(field.offset, v, true),
                    enumerable: true,
                });
                break;

            case 'u32':
            case 'Entity':
                Object.defineProperty(proxy, key, {
                    get: () => view.getUint32(field.offset, true),
                    set: (v: number) => view.setUint32(field.offset, v, true),
                    enumerable: true,
                });
                break;

            case 'bool':
                Object.defineProperty(proxy, key, {
                    get: () => view.getUint8(field.offset) !== 0,
                    set: (v: boolean) => view.setUint8(field.offset, v ? 1 : 0),
                    enumerable: true,
                });
                break;

            case 'Vec2':
                Object.defineProperty(proxy, key, {
                    get: () => ({
                        x: view.getFloat32(field.offset, true),
                        y: view.getFloat32(field.offset + 4, true),
                    }),
                    set: (v: { x: number; y: number }) => {
                        view.setFloat32(field.offset, v.x, true);
                        view.setFloat32(field.offset + 4, v.y, true);
                    },
                    enumerable: true,
                });
                break;

            case 'Vec3':
                Object.defineProperty(proxy, key, {
                    get: () => ({
                        x: view.getFloat32(field.offset, true),
                        y: view.getFloat32(field.offset + 4, true),
                        z: view.getFloat32(field.offset + 8, true),
                    }),
                    set: (v: { x: number; y: number; z: number }) => {
                        view.setFloat32(field.offset, v.x, true);
                        view.setFloat32(field.offset + 4, v.y, true);
                        view.setFloat32(field.offset + 8, v.z, true);
                    },
                    enumerable: true,
                });
                break;

            case 'Vec4':
            case 'Color':
            case 'Quat':
                Object.defineProperty(proxy, key, {
                    get: () => ({
                        x: view.getFloat32(field.offset, true),
                        y: view.getFloat32(field.offset + 4, true),
                        z: view.getFloat32(field.offset + 8, true),
                        w: view.getFloat32(field.offset + 12, true),
                    }),
                    set: (v: { x: number; y: number; z: number; w: number }) => {
                        view.setFloat32(field.offset, v.x, true);
                        view.setFloat32(field.offset + 4, v.y, true);
                        view.setFloat32(field.offset + 8, v.z, true);
                        view.setFloat32(field.offset + 12, v.w, true);
                    },
                    enumerable: true,
                });
                break;
        }
    }

    return proxy as InferSchema<S>;
}

// =============================================================================
// Component Writer
// =============================================================================

/**
 * @brief Writes initial component data to WASM memory
 */
export function writeComponentData<S extends Schema>(
    layout: SchemaLayout,
    heapBuffer: ArrayBuffer,
    byteOffset: number,
    data: Partial<InferSchema<S>>
): void {
    const view = new DataView(heapBuffer, byteOffset, layout.stride);

    for (const [key, field] of Object.entries(layout.fields)) {
        const value = (data as Record<string, unknown>)[key];
        if (value === undefined) continue;

        switch (field.type) {
            case 'f32':
                view.setFloat32(field.offset, value as number, true);
                break;
            case 'f64':
                view.setFloat64(field.offset, value as number, true);
                break;
            case 'i32':
                view.setInt32(field.offset, value as number, true);
                break;
            case 'u32':
            case 'Entity':
                view.setUint32(field.offset, value as number, true);
                break;
            case 'bool':
                view.setUint8(field.offset, (value as boolean) ? 1 : 0);
                break;
            case 'Vec2': {
                const v = value as { x: number; y: number };
                view.setFloat32(field.offset, v.x, true);
                view.setFloat32(field.offset + 4, v.y, true);
                break;
            }
            case 'Vec3': {
                const v = value as { x: number; y: number; z: number };
                view.setFloat32(field.offset, v.x, true);
                view.setFloat32(field.offset + 4, v.y, true);
                view.setFloat32(field.offset + 8, v.z, true);
                break;
            }
            case 'Vec4':
            case 'Color':
            case 'Quat': {
                const v = value as { x: number; y: number; z: number; w: number };
                view.setFloat32(field.offset, v.x, true);
                view.setFloat32(field.offset + 4, v.y, true);
                view.setFloat32(field.offset + 8, v.z, true);
                view.setFloat32(field.offset + 12, v.w, true);
                break;
            }
        }
    }
}
