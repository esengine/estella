/**
 * @file    PhysicsModuleLoader.ts
 * @brief   Loads and initializes the standalone Physics WASM module
 */

export interface PhysicsWasmModule {
    physics_init(gx: number, gy: number, timestep: number, substeps: number): void;
    physics_shutdown(): void;

    physics_createBody(entityId: number, bodyType: number, x: number, y: number, angle: number,
        gravityScale: number, linearDamping: number, angularDamping: number,
        fixedRotation: boolean, bullet: boolean): void;
    physics_destroyBody(entityId: number): void;
    physics_hasBody(entityId: number): boolean;

    physics_addBoxShape(entityId: number, halfW: number, halfH: number,
        offX: number, offY: number,
        density: number, friction: number, restitution: number, isSensor: boolean): void;
    physics_addCircleShape(entityId: number, radius: number,
        offX: number, offY: number,
        density: number, friction: number, restitution: number, isSensor: boolean): void;
    physics_addCapsuleShape(entityId: number, radius: number, halfHeight: number,
        offX: number, offY: number,
        density: number, friction: number, restitution: number, isSensor: boolean): void;

    physics_step(dt: number): void;

    physics_setBodyTransform(entityId: number, x: number, y: number, angle: number): void;
    physics_getDynamicBodyCount(): number;
    physics_getDynamicBodyTransforms(): number;

    physics_getCollisionEvents(): CollisionEventsRaw;

    physics_applyForce(entityId: number, forceX: number, forceY: number): void;
    physics_applyImpulse(entityId: number, impulseX: number, impulseY: number): void;
    physics_setLinearVelocity(entityId: number, vx: number, vy: number): void;
    physics_getLinearVelocity(entityId: number): { x: number; y: number };

    HEAPF32: Float32Array;
    HEAPU8: Uint8Array;
    HEAPU32: Uint32Array;
    _malloc(size: number): number;
    _free(ptr: number): void;
}

interface EmscriptenVector<T> {
    size(): number;
    get(index: number): T;
    delete(): void;
}

export interface CollisionEventRaw {
    entityA: number;
    entityB: number;
    normalX: number;
    normalY: number;
    contactX: number;
    contactY: number;
}

export interface SensorEventRaw {
    sensorEntity: number;
    visitorEntity: number;
}

export interface CollisionEventsRaw {
    enters: EmscriptenVector<CollisionEventRaw>;
    exits: EmscriptenVector<CollisionEventRaw>;
    sensorEnters: EmscriptenVector<SensorEventRaw>;
    sensorExits: EmscriptenVector<SensorEventRaw>;
}

export type PhysicsModuleFactory = (config?: Record<string, unknown>) => Promise<PhysicsWasmModule>;

export async function loadPhysicsModule(
    wasmUrl: string,
    factory?: PhysicsModuleFactory
): Promise<PhysicsWasmModule> {
    if (factory) {
        return factory();
    }

    const moduleFactory = (await import(/* webpackIgnore: true */ wasmUrl)).default as PhysicsModuleFactory;
    return moduleFactory();
}
