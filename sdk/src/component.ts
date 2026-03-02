/**
 * @file    component.ts
 * @brief   Component definition and builtin components
 */

import { Entity, Vec2, Vec3, Color, Quat, INVALID_TEXTURE, INVALID_FONT } from './types';
import { DEFAULT_DESIGN_WIDTH, DEFAULT_DESIGN_HEIGHT, DEFAULT_PIXELS_PER_UNIT } from './defaults';
import type {
    RigidBodyData, BoxColliderData, CircleColliderData, CapsuleColliderData,
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

function deepClone<T>(value: T): T {
    if (value === null || typeof value !== 'object') {
        return value;
    }
    if (Array.isArray(value)) {
        return value.map(deepClone) as T;
    }
    const result: Record<string, unknown> = {};
    for (const key in value) {
        result[key] = deepClone((value as Record<string, unknown>)[key]);
    }
    return result as T;
}

let componentCounter = 0;

function hasNestedObjects(obj: object): boolean {
    for (const key in obj) {
        const val = (obj as Record<string, unknown>)[key];
        if (val !== null && typeof val === 'object') return true;
    }
    return false;
}

function createComponentDef<T extends object>(
    name: string,
    defaults: T
): ComponentDef<T> {
    const id = ++componentCounter;
    const needsDeepClone = hasNestedObjects(defaults);
    return {
        _id: Symbol(`Component_${id}_${name}`),
        _name: name,
        _default: defaults,
        _builtin: false as const,
        create(data?: Partial<T>): T {
            if (needsDeepClone) {
                return data ? { ...deepClone(defaults), ...data } : deepClone(defaults);
            }
            return data ? { ...defaults, ...data } : { ...defaults };
        }
    };
}

export function getComponentRegistry(): Map<string, ComponentDef<any>> {
    const g = globalThis as any;
    return (g.__esengine_componentRegistry ??= new Map());
}

export function defineComponent<T extends object>(
    name: string,
    defaults: T
): ComponentDef<T> {
    const existing = componentRegistry.get(name) ?? getComponentRegistry().get(name);
    if (existing) return existing as ComponentDef<T>;

    const def = createComponentDef(name, defaults);
    getComponentRegistry().set(name, def);
    componentRegistry.set(name, def);
    registerToEditor(name, defaults as Record<string, unknown>, false);
    return def;
}

export function defineTag(name: string): ComponentDef<{}> {
    const existing = componentRegistry.get(name) ?? getComponentRegistry().get(name);
    if (existing) return existing as ComponentDef<{}>;

    const def = createComponentDef(name, {});
    getComponentRegistry().set(name, def);
    componentRegistry.set(name, def);
    registerToEditor(name, {}, true);
    return def;
}

export function getUserComponent(name: string): ComponentDef<any> | undefined {
    return getComponentRegistry().get(name);
}

export function clearUserComponents(): void {
    const userRegistry = getComponentRegistry();
    for (const name of userRegistry.keys()) {
        componentRegistry.delete(name);
    }
    userRegistry.clear();
}

export function unregisterComponent(name: string): void {
    getComponentRegistry().delete(name);
    componentRegistry.delete(name);
}

function registerToEditor(
    name: string,
    defaults: Record<string, unknown>,
    isTag: boolean
): void {
    const g = globalThis as any;
    if (g.__esengine_registerComponent) {
        g.__esengine_registerComponent(name, defaults, isTag);
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

// =============================================================================
// Component Type Union
// =============================================================================

export type AnyComponentDef = ComponentDef<any> | BuiltinComponentDef<any>;

export function isBuiltinComponent(comp: AnyComponentDef): comp is BuiltinComponentDef<any> {
    return comp._builtin === true;
}

const componentRegistry = new Map<string, AnyComponentDef>();

export function registerComponent(name: string, def: AnyComponentDef): void {
    componentRegistry.set(name, def);
}

export function getAllRegisteredComponents(): Map<string, AnyComponentDef> {
    return componentRegistry;
}

export function getComponent(name: string): AnyComponentDef | undefined {
    return componentRegistry.get(name) ?? getUserComponent(name);
}

export function defineBuiltin<T>(name: string, defaults: T): BuiltinComponentDef<T> {
    const def: BuiltinComponentDef<T> = {
        _id: Symbol(`Builtin_${name}`),
        _name: name,
        _cppName: name,
        _builtin: true,
        _default: defaults
    };
    componentRegistry.set(name, def);
    return def;
}

// =============================================================================
// Camera / Canvas Enums
// =============================================================================

export const ProjectionType = {
    Perspective: 0,
    Orthographic: 1,
} as const;

export type ProjectionType = (typeof ProjectionType)[keyof typeof ProjectionType];

export const ClearFlags = {
    None: 0,
    ColorOnly: 1,
    DepthOnly: 2,
    ColorAndDepth: 3,
} as const;

export type ClearFlags = (typeof ClearFlags)[keyof typeof ClearFlags];

export const ScaleMode = {
    FixedWidth: 0,
    FixedHeight: 1,
    Expand: 2,
    Shrink: 3,
    Match: 4,
} as const;

export type ScaleMode = (typeof ScaleMode)[keyof typeof ScaleMode];

// =============================================================================
// Builtin Component Types
// =============================================================================

export interface TransformData {
    position: Vec3;
    rotation: Quat;
    scale: Vec3;
    worldPosition: Vec3;
    worldRotation: Quat;
    worldScale: Vec3;
}

export type LocalTransformData = TransformData;
export type WorldTransformData = TransformData;

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
    enabled: boolean;
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
    /** Editor-only: not synced to C++ Camera component, used for gizmo rendering */
    showFrustum: boolean;
    viewportX: number;
    viewportY: number;
    viewportW: number;
    viewportH: number;
    clearFlags: number;
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
    enabled: boolean;
}

export interface BitmapTextData {
    text: string;
    color: Color;
    fontSize: number;
    align: number;
    spacing: number;
    layer: number;
    font: number;
    enabled: boolean;
}

export interface NameData {
    value: string;
}

export interface SceneOwnerData {
    scene: string;
    persistent: boolean;
}

// =============================================================================
// Builtin Component Instances
// =============================================================================

export const Transform = defineBuiltin<TransformData>('Transform', {
    position: { x: 0, y: 0, z: 0 },
    rotation: { w: 1, x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    worldPosition: { x: 0, y: 0, z: 0 },
    worldRotation: { w: 1, x: 0, y: 0, z: 0 },
    worldScale: { x: 1, y: 1, z: 1 },
});
export const LocalTransform = Transform;
export const WorldTransform = Transform;

export const Sprite = defineBuiltin<SpriteData>('Sprite', {
    texture: INVALID_TEXTURE,
    color: { r: 1, g: 1, b: 1, a: 1 },
    size: { x: 32, y: 32 },
    uvOffset: { x: 0, y: 0 },
    uvScale: { x: 1, y: 1 },
    layer: 0,
    flipX: false,
    flipY: false,
    material: 0,
    enabled: true
});

export const Camera = defineBuiltin<CameraData>('Camera', {
    projectionType: ProjectionType.Orthographic,
    fov: 60,
    orthoSize: 540,
    nearPlane: 0.1,
    farPlane: 1000,
    aspectRatio: 1.77,
    isActive: true,
    priority: 0,
    showFrustum: false,
    viewportX: 0,
    viewportY: 0,
    viewportW: 1,
    viewportH: 1,
    clearFlags: ClearFlags.ColorAndDepth,
});

export const Canvas = defineBuiltin<CanvasData>('Canvas', {
    designResolution: { x: DEFAULT_DESIGN_WIDTH, y: DEFAULT_DESIGN_HEIGHT },
    pixelsPerUnit: DEFAULT_PIXELS_PER_UNIT,
    scaleMode: ScaleMode.FixedHeight,
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

export const BitmapText = defineBuiltin<BitmapTextData>('BitmapText', {
    text: '',
    color: { r: 1, g: 1, b: 1, a: 1 },
    fontSize: 1.0,
    align: 0,
    spacing: 0,
    layer: 0,
    font: INVALID_FONT,
    enabled: true,
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
    material: 0,
    enabled: true
});

// =============================================================================
// ParticleEmitter Enums
// =============================================================================

export const EmitterShape = {
    Point: 0,
    Circle: 1,
    Rectangle: 2,
    Cone: 3,
} as const;

export type EmitterShape = (typeof EmitterShape)[keyof typeof EmitterShape];

export const SimulationSpace = {
    World: 0,
    Local: 1,
} as const;

export type SimulationSpace = (typeof SimulationSpace)[keyof typeof SimulationSpace];

export const ParticleEasing = {
    Linear: 0,
    EaseIn: 1,
    EaseOut: 2,
    EaseInOut: 3,
} as const;

export type ParticleEasing = (typeof ParticleEasing)[keyof typeof ParticleEasing];

// =============================================================================
// ParticleEmitter Component
// =============================================================================

export interface ParticleEmitterData {
    rate: number;
    burstCount: number;
    burstInterval: number;
    duration: number;
    looping: boolean;
    playOnStart: boolean;
    maxParticles: number;
    lifetimeMin: number;
    lifetimeMax: number;
    shape: number;
    shapeRadius: number;
    shapeSize: Vec2;
    shapeAngle: number;
    speedMin: number;
    speedMax: number;
    angleSpreadMin: number;
    angleSpreadMax: number;
    startSizeMin: number;
    startSizeMax: number;
    endSizeMin: number;
    endSizeMax: number;
    sizeEasing: number;
    startColor: Color;
    endColor: Color;
    colorEasing: number;
    rotationMin: number;
    rotationMax: number;
    angularVelocityMin: number;
    angularVelocityMax: number;
    gravity: Vec2;
    damping: number;
    texture: number;
    spriteColumns: number;
    spriteRows: number;
    spriteFPS: number;
    spriteLoop: boolean;
    blendMode: number;
    layer: number;
    material: number;
    simulationSpace: number;
    enabled: boolean;
}

export const ParticleEmitter = defineBuiltin<ParticleEmitterData>('ParticleEmitter', {
    rate: 10,
    burstCount: 0,
    burstInterval: 1,
    duration: 5,
    looping: true,
    playOnStart: true,
    maxParticles: 1000,
    lifetimeMin: 5,
    lifetimeMax: 5,
    shape: EmitterShape.Cone,
    shapeRadius: 100,
    shapeSize: { x: 100, y: 100 },
    shapeAngle: 25,
    speedMin: 500,
    speedMax: 500,
    angleSpreadMin: 0,
    angleSpreadMax: 360,
    startSizeMin: 100,
    startSizeMax: 100,
    endSizeMin: 100,
    endSizeMax: 100,
    sizeEasing: ParticleEasing.Linear,
    startColor: { r: 1, g: 1, b: 1, a: 1 },
    endColor: { r: 1, g: 1, b: 1, a: 0 },
    colorEasing: ParticleEasing.Linear,
    rotationMin: 0,
    rotationMax: 0,
    angularVelocityMin: 0,
    angularVelocityMax: 0,
    gravity: { x: 0, y: 0 },
    damping: 0,
    texture: INVALID_TEXTURE,
    spriteColumns: 1,
    spriteRows: 1,
    spriteFPS: 10,
    spriteLoop: true,
    blendMode: 1,
    layer: 0,
    material: 0,
    simulationSpace: SimulationSpace.World,
    enabled: true,
});

export const Name = defineComponent<NameData>('Name', { value: '' });

export const SceneOwner = defineComponent<SceneOwnerData>('SceneOwner', {
    scene: '',
    persistent: false,
});

export interface PostProcessVolumeData {
    effects: { type: string; enabled: boolean; uniforms: Record<string, number> }[];
    isGlobal: boolean;
    shape: 'box' | 'sphere';
    size: { x: number; y: number };
    priority: number;
    weight: number;
    blendDistance: number;
}

export const PostProcessVolume = defineComponent<PostProcessVolumeData>('PostProcessVolume', {
    effects: [],
    isGlobal: true,
    shape: 'box',
    size: { x: 5, y: 5 },
    priority: 0,
    weight: 1,
    blendDistance: 0,
});

export type {
    RigidBodyData, BoxColliderData, CircleColliderData, CapsuleColliderData,
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

export function getComponentDefaults(typeName: string): Record<string, unknown> | null {
    const comp = getComponent(typeName);
    if (comp) return deepClone(comp._default);
    return null;
}

