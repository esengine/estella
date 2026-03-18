/**
 * @file    component.ts
 * @brief   Component definition and builtin components
 */

import { Entity, Vec2, Vec3, Color, Quat } from './types';
import { DEFAULT_DESIGN_WIDTH, DEFAULT_DESIGN_HEIGHT, DEFAULT_PIXELS_PER_UNIT, DEFAULT_SPRITE_SIZE } from './defaults';
import { COMPONENT_META, type AssetFieldMeta, type SpineFieldMeta } from './component.generated';
import { getDefaultContext } from './context';
import type {
    RigidBodyData, BoxColliderData, CircleColliderData, CapsuleColliderData,
} from './physics/PhysicsComponents';

// =============================================================================
// Self-Describing Component Types
// =============================================================================

export interface AssetRef {
    type: string;
    path: string;
}

export interface ComponentMetadata {
    assetFields?: AssetFieldMeta[];
    spineFields?: SpineFieldMeta;
    entityFields?: string[];
    discoverAssets?: (data: Record<string, unknown>) => AssetRef[];
}

// =============================================================================
// Component Definition
// =============================================================================

export interface ComponentDef<T> {
    readonly _id: symbol;
    readonly _name: string;
    readonly _default: T;
    readonly _builtin: false;
    readonly assetFields: readonly AssetFieldMeta[];
    readonly spineFields?: SpineFieldMeta;
    readonly entityFields: readonly string[];
    readonly colorKeys: readonly string[];
    readonly animatableFields: readonly string[];
    readonly discoverAssets?: (data: Record<string, unknown>) => AssetRef[];
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

function classifyKeys(obj: object): { flatKeys: string[]; objectKeys: string[]; arrayKeys: string[] } | null {
    const flatKeys: string[] = [];
    const objectKeys: string[] = [];
    const arrayKeys: string[] = [];
    let hasNested = false;
    for (const key in obj) {
        const val = (obj as Record<string, unknown>)[key];
        if (val !== null && typeof val === 'object') {
            hasNested = true;
            if (Array.isArray(val)) {
                arrayKeys.push(key);
            } else {
                objectKeys.push(key);
            }
        } else {
            flatKeys.push(key);
        }
    }
    return hasNested ? { flatKeys, objectKeys, arrayKeys } : null;
}

function createComponentDef<T extends object>(
    name: string,
    defaults: T,
    metadata?: ComponentMetadata,
): ComponentDef<T> {
    const id = ++componentCounter;
    const keyInfo = classifyKeys(defaults);
    const defaultsRec = defaults as Record<string, unknown>;
    return {
        _id: Symbol(`Component_${id}_${name}`),
        _name: name,
        _default: defaults,
        _builtin: false as const,
        assetFields: metadata?.assetFields ?? [],
        spineFields: metadata?.spineFields,
        entityFields: metadata?.entityFields ?? [],
        colorKeys: detectColorKeys(defaults),
        animatableFields: [],
        discoverAssets: metadata?.discoverAssets,
        create(data?: Partial<T>): T {
            if (keyInfo) {
                const result = { ...defaultsRec };
                for (const k of keyInfo.objectKeys) result[k] = { ...(defaultsRec[k] as object) };
                for (const k of keyInfo.arrayKeys) result[k] = (defaultsRec[k] as unknown[]).slice();
                if (data) Object.assign(result, data);
                return result as T;
            }
            return data ? { ...defaults, ...data } : { ...defaults };
        }
    };
}

export function getComponentRegistry(): Map<string, ComponentDef<any>> {
    return getDefaultContext().componentRegistry;
}

export function defineComponent<T extends object>(
    name: string,
    defaults: T,
    metadata?: ComponentMetadata,
): ComponentDef<T> {
    const existing = componentRegistry.get(name) ?? getComponentRegistry().get(name);
    if (existing) return existing as ComponentDef<T>;

    const def = createComponentDef(name, defaults, metadata);
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
    getDefaultContext().editorBridge?.registerComponent(name, defaults, isTag);
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
    readonly assetFields: readonly AssetFieldMeta[];
    readonly spineFields?: SpineFieldMeta;
    readonly entityFields: readonly string[];
    readonly colorKeys: readonly string[];
    readonly animatableFields: readonly string[];
    readonly discoverAssets?: (data: Record<string, unknown>) => AssetRef[];
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

function detectColorKeys(defaults: unknown): readonly string[] {
    if (defaults === null || typeof defaults !== 'object') return [];
    const keys: string[] = [];
    for (const key of Object.keys(defaults as Record<string, unknown>)) {
        const val = (defaults as Record<string, unknown>)[key];
        if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
            const rec = val as Record<string, unknown>;
            if ('r' in rec && 'g' in rec && 'b' in rec && 'a' in rec) {
                keys.push(key);
            }
        }
    }
    return keys;
}

export function defineBuiltin<T>(name: string, defaults: T, metadata?: ComponentMetadata): BuiltinComponentDef<T> {
    const meta = COMPONENT_META[name];
    const def: BuiltinComponentDef<T> = {
        _id: Symbol(`Builtin_${name}`),
        _name: name,
        _cppName: name,
        _builtin: true,
        _default: defaults,
        assetFields: metadata?.assetFields ?? meta?.assetFields ?? [],
        spineFields: metadata?.spineFields ?? meta?.spine,
        entityFields: metadata?.entityFields ?? meta?.entityFields ?? [],
        colorKeys: meta?.colorFields ?? detectColorKeys(defaults),
        animatableFields: meta?.animatableFields ?? [],
        discoverAssets: metadata?.discoverAssets,
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
    pivot: Vec2;
    uvOffset: Vec2;
    uvScale: Vec2;
    layer: number;
    flipX: boolean;
    flipY: boolean;
    tileSize: Vec2;
    tileSpacing: Vec2;
    material: number;
    enabled: boolean;
}

export const ShapeType = {
    Circle: 0,
    Capsule: 1,
    RoundedRect: 2,
} as const;

export type ShapeType = (typeof ShapeType)[keyof typeof ShapeType];

export interface ShapeRendererData {
    shapeType: number;
    color: Color;
    size: Vec2;
    cornerRadius: number;
    layer: number;
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

function metaDefaults<T>(name: string, overrides?: Partial<T>): T {
    const base = COMPONENT_META[name]?.defaults ?? {};
    return (overrides ? { ...base, ...overrides } : { ...base }) as T;
}

export const Transform = defineBuiltin<TransformData>('Transform',
    metaDefaults<TransformData>('Transform')
);
export const LocalTransform = Transform;
export const WorldTransform = Transform;

export const Sprite = defineBuiltin<SpriteData>('Sprite',
    metaDefaults<SpriteData>('Sprite', {
        size: { x: DEFAULT_SPRITE_SIZE.x, y: DEFAULT_SPRITE_SIZE.y },
    })
);

export const ShapeRenderer = defineBuiltin<ShapeRendererData>('ShapeRenderer',
    metaDefaults<ShapeRendererData>('ShapeRenderer')
);

export const Camera = defineBuiltin<CameraData>('Camera',
    metaDefaults<CameraData>('Camera', {
        projectionType: ProjectionType.Orthographic,
        orthoSize: 540,
        aspectRatio: 1.77,
        isActive: true,
        showFrustum: false,
    })
);

export const Canvas = defineBuiltin<CanvasData>('Canvas',
    metaDefaults<CanvasData>('Canvas', {
        designResolution: { x: DEFAULT_DESIGN_WIDTH, y: DEFAULT_DESIGN_HEIGHT },
        pixelsPerUnit: DEFAULT_PIXELS_PER_UNIT,
        scaleMode: ScaleMode.FixedHeight,
    })
);

export const Velocity = defineBuiltin<VelocityData>('Velocity',
    metaDefaults<VelocityData>('Velocity')
);

export const Parent = defineBuiltin<ParentData>('Parent',
    metaDefaults<ParentData>('Parent')
);

export const Children = defineBuiltin<ChildrenData>('Children',
    metaDefaults<ChildrenData>('Children')
);

export const BitmapText = defineBuiltin<BitmapTextData>('BitmapText',
    metaDefaults<BitmapTextData>('BitmapText')
);

export const SpineAnimation = defineBuiltin<SpineAnimationData>('SpineAnimation',
    metaDefaults<SpineAnimationData>('SpineAnimation')
);

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

export const ParticleEmitter = defineBuiltin<ParticleEmitterData>('ParticleEmitter',
    metaDefaults<ParticleEmitterData>('ParticleEmitter')
);

export const Disabled = defineTag('Disabled');

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

