/**
 * @file    types.ts
 * @brief   ESEngine C++ Module Type Definitions
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */

// =============================================================================
// Core Types
// =============================================================================

export type Entity = number;

// =============================================================================
// Math Types
// =============================================================================

export interface Vec2 { x: number; y: number; }
export interface Vec3 { x: number; y: number; z: number; }
export interface Vec4 { x: number; y: number; z: number; w: number; }
export interface UVec2 { x: number; y: number; }
export interface Quat { w: number; x: number; y: number; z: number; }
export type Mat4 = number[];

// =============================================================================
// Enums
// =============================================================================

export const enum ProjectionType {
    Perspective = 0,
    Orthographic = 1
}

export const enum CanvasScaleMode {
    FixedWidth = 0,
    FixedHeight = 1,
    Expand = 2,
    Shrink = 3,
    Match = 4
}

export const enum TextureFormat {
    RGB8 = 0,
    RGBA8 = 1
}

export const enum CppSchedule {
    Startup = 0,
    PreUpdate = 1,
    Update = 2,
    PostUpdate = 3,
    PreRender = 4,
    Render = 5,
    PostRender = 6,
}

// =============================================================================
// Components
// =============================================================================

export interface CppCamera {
    projectionType: ProjectionType;
    fov: number;
    orthoSize: number;
    nearPlane: number;
    farPlane: number;
    aspectRatio: number;
    isActive: boolean;
    priority: number;
}

export interface CppCanvas {
    designResolution: UVec2;
    pixelsPerUnit: number;
    scaleMode: CanvasScaleMode;
    matchWidthOrHeight: number;
    backgroundColor: Vec4;
}

export interface CppParent {
    entity: number;
}

export interface CppChildren {
    entities: Entity[];
}

export interface CppSprite {
    texture: number;
    color: Vec4;
    size: Vec2;
    uvOffset: Vec2;
    uvScale: Vec2;
    layer: number;
    flipX: boolean;
    flipY: boolean;
}

export interface CppLocalTransform {
    position: Vec3;
    rotation: Quat;
    scale: Vec3;
}

export interface CppWorldTransform {
    matrix: Mat4;
    position: Vec3;
    rotation: Quat;
    scale: Vec3;
}

export interface CppVelocity {
    linear: Vec3;
    angular: Vec3;
}

// =============================================================================
// Registry
// =============================================================================

export interface CppRegistry {
    create(): Entity;
    destroy(entity: Entity): void;
    valid(entity: Entity): boolean;
    entityCount(): number;

    hasCamera(entity: Entity): boolean;
    getCamera(entity: Entity): CppCamera;
    addCamera(entity: Entity, component: CppCamera): void;
    removeCamera(entity: Entity): void;

    hasCanvas(entity: Entity): boolean;
    getCanvas(entity: Entity): CppCanvas;
    addCanvas(entity: Entity, component: CppCanvas): void;
    removeCanvas(entity: Entity): void;

    hasParent(entity: Entity): boolean;
    getParent(entity: Entity): CppParent;
    addParent(entity: Entity, component: CppParent): void;
    removeParent(entity: Entity): void;

    hasChildren(entity: Entity): boolean;
    getChildren(entity: Entity): CppChildren;
    addChildren(entity: Entity, component: CppChildren): void;
    removeChildren(entity: Entity): void;

    hasSprite(entity: Entity): boolean;
    getSprite(entity: Entity): CppSprite;
    addSprite(entity: Entity, component: CppSprite): void;
    removeSprite(entity: Entity): void;

    hasLocalTransform(entity: Entity): boolean;
    getLocalTransform(entity: Entity): CppLocalTransform;
    addLocalTransform(entity: Entity, component: CppLocalTransform): void;
    removeLocalTransform(entity: Entity): void;

    hasWorldTransform(entity: Entity): boolean;
    getWorldTransform(entity: Entity): CppWorldTransform;
    addWorldTransform(entity: Entity, component: CppWorldTransform): void;
    removeWorldTransform(entity: Entity): void;

    hasVelocity(entity: Entity): boolean;
    getVelocity(entity: Entity): CppVelocity;
    addVelocity(entity: Entity, component: CppVelocity): void;
    removeVelocity(entity: Entity): void;

    // Schema Components (Script-defined, direct memory access)
    registerSchemaPool(name: string, stride: number): number;
    getSchemaPoolId(name: string): number;
    addSchemaComponent(poolId: number, entity: Entity): number;
    hasSchemaComponent(poolId: number, entity: Entity): boolean;
    getSchemaComponentOffset(poolId: number, entity: Entity): number;
    removeSchemaComponent(poolId: number, entity: Entity): void;
    getSchemaPoolBasePtr(poolId: number): number;
    getSchemaPoolStride(poolId: number): number;
    querySchema(poolId: number): Entity[];

    [key: string]: unknown;
}

// =============================================================================
// Resources
// =============================================================================

export type ShaderHandle = number;
export type TextureHandle = number;

export interface CppResourceManager {
    init(): void;
    shutdown(): void;
    createShader(vertSrc: string, fragSrc: string): ShaderHandle;
    createTexture(width: number, height: number, pixelsPtr: number, pixelsLen: number, format: TextureFormat): TextureHandle;
    releaseShader(handle: ShaderHandle): void;
    releaseTexture(handle: TextureHandle): void;
}

// =============================================================================
// App
// =============================================================================

export interface CppTime {
    delta: number;
    elapsed: number;
    frameCount: number;
}

export interface CppAppConfig {
    title: string;
    width: number;
    height: number;
    vsync: boolean;
}

export interface CppApp {
    run(): void;
    quit(): void;
    registry(): CppRegistry;
    time(): CppTime;
    width(): number;
    height(): number;
}

// =============================================================================
// Query
// =============================================================================

export interface EntityVector {
    size(): number;
    get(index: number): Entity;
}

// =============================================================================
// Module
// =============================================================================

export interface ESEngineModule {
    ResourceManager: new () => CppResourceManager;
    AppConfig: new () => CppAppConfig;

    Camera: new () => CppCamera;
    Canvas: new () => CppCanvas;
    Parent: new () => CppParent;
    Children: new () => CppChildren;
    Sprite: new () => CppSprite;
    LocalTransform: new () => CppLocalTransform;
    WorldTransform: new () => CppWorldTransform;
    Velocity: new () => CppVelocity;

    Schedule: typeof CppSchedule;
    TextureFormat: typeof TextureFormat;
    ProjectionType: typeof ProjectionType;
    CanvasScaleMode: typeof CanvasScaleMode;

    createApp(): CppApp;
    createAppWithConfig(config: CppAppConfig): CppApp;
    getApp(): CppApp;

    queryLocalTransform(registry: CppRegistry): EntityVector;
    queryLocalTransformSprite(registry: CppRegistry): EntityVector;

    HEAPU8: Uint8Array;
    _malloc(size: number): number;
    _free(ptr: number): void;

    setJSSystemsCallback(callback: (schedule: number, dt: number) => void): void;

    [key: string]: unknown;
}

export type CreateModuleFn = () => Promise<ESEngineModule>;
