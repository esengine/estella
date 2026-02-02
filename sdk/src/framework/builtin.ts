/**
 * @file    builtin.ts
 * @brief   Built-in component proxies that bridge to C++ Registry
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */

import { Entity, Vec2, Vec3, Vec4, Color, Quat } from './types';

// =============================================================================
// Built-in Component Marker
// =============================================================================

export interface BuiltinComponentDef<T> {
    readonly _id: symbol;
    readonly _name: string;
    readonly _builtin: true;
    readonly _cppName: string;
}

function defineBuiltin<T>(name: string): BuiltinComponentDef<T> {
    return {
        _id: Symbol(`Builtin_${name}`),
        _name: name,
        _builtin: true,
        _cppName: name
    };
}

// =============================================================================
// Built-in Component Types
// =============================================================================

export interface LocalTransformData {
    position: Vec3;
    rotation: Quat;
    scale: Vec3;
}

export interface WorldTransformData {
    matrix: number[];
    position: Vec3;
    rotation: Quat;
    scale: Vec3;
}

export interface SpriteData {
    texture: number;
    color: Vec4;
    size: Vec2;
    uvOffset: Vec2;
    uvScale: Vec2;
    layer: number;
    flipX: boolean;
    flipY: boolean;
}

export interface CameraData {
    projectionType: number;
    fov: number;
    orthoSize: number;
    nearPlane: number;
    farPlane: number;
    aspectRatio: number;
    isActive: boolean;
    priority: number;
}

export interface CanvasData {
    designResolution: Vec2;
    pixelsPerUnit: number;
    scaleMode: number;
    matchWidthOrHeight: number;
    backgroundColor: Vec4;
}

export interface VelocityData {
    linear: Vec3;
    angular: Vec3;
}

export interface ParentData {
    entity: Entity;
}

export interface ChildrenData {
    entities: Entity[];
}

// =============================================================================
// Built-in Component Definitions
// =============================================================================

export const LocalTransform = defineBuiltin<LocalTransformData>('LocalTransform');
export const WorldTransform = defineBuiltin<WorldTransformData>('WorldTransform');
export const Sprite = defineBuiltin<SpriteData>('Sprite');
export const Camera = defineBuiltin<CameraData>('Camera');
export const Canvas = defineBuiltin<CanvasData>('Canvas');
export const Velocity = defineBuiltin<VelocityData>('Velocity');
export const Parent = defineBuiltin<ParentData>('Parent');
export const Children = defineBuiltin<ChildrenData>('Children');

// =============================================================================
// Type Helpers
// =============================================================================

export type BuiltinComponent =
    | typeof LocalTransform
    | typeof WorldTransform
    | typeof Sprite
    | typeof Camera
    | typeof Canvas
    | typeof Velocity
    | typeof Parent
    | typeof Children;

export type BuiltinComponentData<C extends BuiltinComponentDef<unknown>> =
    C extends BuiltinComponentDef<infer T> ? T : never;

export function isBuiltinComponent(comp: unknown): comp is BuiltinComponentDef<unknown> {
    return typeof comp === 'object' && comp !== null && '_builtin' in comp && comp._builtin === true;
}

// =============================================================================
// Default Values
// =============================================================================

export function getBuiltinDefaults<T>(comp: BuiltinComponentDef<T>): T {
    switch (comp._cppName) {
        case 'LocalTransform':
            return {
                position: { x: 0, y: 0, z: 0 },
                rotation: { x: 0, y: 0, z: 0, w: 1 },
                scale: { x: 1, y: 1, z: 1 }
            } as T;

        case 'Sprite':
            return {
                texture: 0,
                color: { x: 1, y: 1, z: 1, w: 1 },
                size: { x: 32, y: 32 },
                uvOffset: { x: 0, y: 0 },
                uvScale: { x: 1, y: 1 },
                layer: 0,
                flipX: false,
                flipY: false
            } as T;

        case 'Camera':
            return {
                projectionType: 0,
                fov: 60,
                orthoSize: 5,
                nearPlane: 0.1,
                farPlane: 1000,
                aspectRatio: 1.77,
                isActive: true,
                priority: 0
            } as T;

        case 'Canvas':
            return {
                designResolution: { x: 1920, y: 1080 },
                pixelsPerUnit: 100,
                scaleMode: 0,
                matchWidthOrHeight: 0.5,
                backgroundColor: { x: 0, y: 0, z: 0, w: 1 }
            } as T;

        case 'Velocity':
            return {
                linear: { x: 0, y: 0, z: 0 },
                angular: { x: 0, y: 0, z: 0 }
            } as T;

        case 'Parent':
            return { entity: 0 } as T;

        case 'Children':
            return { entities: [] } as T;

        default:
            return {} as T;
    }
}
