/**
 * @file    component.ts
 * @brief   Component definition and builtin components
 */

import { Entity, Vec2, Vec3, Color, Quat, INVALID_TEXTURE } from './types';
import {
    RigidBody, BoxCollider, CircleCollider, CapsuleCollider,
    type RigidBodyData, type BoxColliderData, type CircleColliderData, type CapsuleColliderData,
} from './physics/PhysicsComponents';

// =============================================================================
// Component Definition
// =============================================================================

export interface ComponentDef<T> {
    readonly _id: symbol;
    readonly _name: string;
    readonly _default: T;
    readonly _builtin: false;
    create(data?: Partial<T>): T;
}

let componentCounter = 0;

function createComponentDef<T extends object>(
    name: string,
    defaults: T
): ComponentDef<T> {
    const id = ++componentCounter;
    return {
        _id: Symbol(`Component_${id}_${name}`),
        _name: name,
        _default: defaults,
        _builtin: false as const,
        create(data?: Partial<T>): T {
            return { ...defaults, ...data };
        }
    };
}

function getComponentRegistry(): Map<string, ComponentDef<any>> {
    if (typeof window === 'undefined') return new Map();
    return (window.__esengine_componentRegistry ??= new Map());
}

export function defineComponent<T extends object>(
    name: string,
    defaults: T
): ComponentDef<T> {
    const registry = getComponentRegistry();
    const existing = registry.get(name);
    if (existing) return existing as ComponentDef<T>;

    const def = createComponentDef(name, defaults);
    registry.set(name, def);
    registerToEditor(name, defaults as Record<string, unknown>, false);
    return def;
}

export function defineTag(name: string): ComponentDef<{}> {
    const registry = getComponentRegistry();
    const existing = registry.get(name);
    if (existing) return existing as ComponentDef<{}>;

    const def = createComponentDef(name, {});
    registry.set(name, def);
    registerToEditor(name, {}, true);
    return def;
}

export function getUserComponent(name: string): ComponentDef<any> | undefined {
    return getComponentRegistry().get(name);
}

export function clearUserComponents(): void {
    getComponentRegistry().clear();
}

function registerToEditor(
    name: string,
    defaults: Record<string, unknown>,
    isTag: boolean
): void {
    if (typeof window !== 'undefined' && window.__esengine_registerComponent) {
        window.__esengine_registerComponent(name, defaults, isTag);
    }
}

// =============================================================================
// Builtin Component Definition (C++ backed)
// =============================================================================

export interface BuiltinComponentDef<T> {
    readonly _id: symbol;
    readonly _name: string;
    readonly _cppName: string;
    readonly _builtin: true;
    readonly _default: T;
}

function defineBuiltin<T>(name: string, defaults: T): BuiltinComponentDef<T> {
    return {
        _id: Symbol(`Builtin_${name}`),
        _name: name,
        _cppName: name,
        _builtin: true,
        _default: defaults
    };
}

// =============================================================================
// Component Type Union
// =============================================================================

export type AnyComponentDef = ComponentDef<any> | BuiltinComponentDef<any>;

export function isBuiltinComponent(comp: AnyComponentDef): comp is BuiltinComponentDef<any> {
    return comp._builtin === true;
}

// =============================================================================
// Builtin Component Types
// =============================================================================

export interface LocalTransformData {
    position: Vec3;
    rotation: Quat;
    scale: Vec3;
}

export interface WorldTransformData {
    position: Vec3;
    rotation: Quat;
    scale: Vec3;
}

export interface SpriteData {
    texture: number;
    color: Color;
    size: Vec2;
    uvOffset: Vec2;
    uvScale: Vec2;
    layer: number;
    flipX: boolean;
    flipY: boolean;
    material: number;
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
    showFrustum: boolean;
}

export interface CanvasData {
    designResolution: Vec2;
    pixelsPerUnit: number;
    scaleMode: number;
    matchWidthOrHeight: number;
    backgroundColor: Color;
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

export interface SpineAnimationData {
    skeletonPath: string;
    atlasPath: string;
    skin: string;
    animation: string;
    timeScale: number;
    loop: boolean;
    playing: boolean;
    flipX: boolean;
    flipY: boolean;
    color: Color;
    layer: number;
    skeletonScale: number;
    material: number;
}

// =============================================================================
// Builtin Component Instances
// =============================================================================

export const LocalTransform = defineBuiltin<LocalTransformData>('LocalTransform', {
    position: { x: 0, y: 0, z: 0 },
    rotation: { w: 1, x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 }
});

export const WorldTransform = defineBuiltin<WorldTransformData>('WorldTransform', {
    position: { x: 0, y: 0, z: 0 },
    rotation: { w: 1, x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 }
});

export const Sprite = defineBuiltin<SpriteData>('Sprite', {
    texture: INVALID_TEXTURE,
    color: { r: 1, g: 1, b: 1, a: 1 },
    size: { x: 32, y: 32 },
    uvOffset: { x: 0, y: 0 },
    uvScale: { x: 1, y: 1 },
    layer: 0,
    flipX: false,
    flipY: false,
    material: 0
});

export const Camera = defineBuiltin<CameraData>('Camera', {
    projectionType: 0,
    fov: 60,
    orthoSize: 5,
    nearPlane: 0.1,
    farPlane: 1000,
    aspectRatio: 1.77,
    isActive: true,
    priority: 0,
    showFrustum: true
});

export const Canvas = defineBuiltin<CanvasData>('Canvas', {
    designResolution: { x: 1920, y: 1080 },
    pixelsPerUnit: 100,
    scaleMode: 1,
    matchWidthOrHeight: 0.5,
    backgroundColor: { r: 0, g: 0, b: 0, a: 1 }
});

export const Velocity = defineBuiltin<VelocityData>('Velocity', {
    linear: { x: 0, y: 0, z: 0 },
    angular: { x: 0, y: 0, z: 0 }
});

export const Parent = defineBuiltin<ParentData>('Parent', {
    entity: 0 as Entity
});

export const Children = defineBuiltin<ChildrenData>('Children', {
    entities: []
});

export const SpineAnimation = defineBuiltin<SpineAnimationData>('SpineAnimation', {
    skeletonPath: '',
    atlasPath: '',
    skin: '',
    animation: '',
    timeScale: 1.0,
    loop: true,
    playing: true,
    flipX: false,
    flipY: false,
    color: { r: 1, g: 1, b: 1, a: 1 },
    layer: 0,
    skeletonScale: 1.0,
    material: 0
});

export {
    RigidBody, BoxCollider, CircleCollider, CapsuleCollider,
    type RigidBodyData, type BoxColliderData, type CircleColliderData, type CapsuleColliderData,
};

// =============================================================================
// Type Helpers
// =============================================================================

export type ComponentData<C> =
    C extends BuiltinComponentDef<infer T> ? T :
    C extends ComponentDef<infer T> ? T :
    never;

// =============================================================================
// Component Defaults Registry
// =============================================================================

const builtinComponents: Record<string, BuiltinComponentDef<any>> = {
    LocalTransform,
    WorldTransform,
    Sprite,
    Camera,
    Canvas,
    Velocity,
    Parent,
    Children,
    SpineAnimation,
    RigidBody,
    BoxCollider,
    CircleCollider,
    CapsuleCollider,
};

export function getComponentDefaults(typeName: string): Record<string, unknown> | null {
    const builtin = builtinComponents[typeName];
    if (builtin) return { ...builtin._default };

    const userComp = getUserComponent(typeName);
    if (userComp) return { ...userComp._default };

    return null;
}
