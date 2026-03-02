import { B as BuiltinComponentDef, R as ResourceDef, A as App, P as Plugin } from '../shared/app.js';
import { V as Vec2, a as Entity } from '../shared/wasm.js';

interface RigidBodyData {
    bodyType: number;
    gravityScale: number;
    linearDamping: number;
    angularDamping: number;
    fixedRotation: boolean;
    bullet: boolean;
    enabled: boolean;
}
interface BoxColliderData {
    halfExtents: Vec2;
    offset: Vec2;
    density: number;
    friction: number;
    restitution: number;
    isSensor: boolean;
    enabled: boolean;
    categoryBits: number;
    maskBits: number;
}
interface CircleColliderData {
    radius: number;
    offset: Vec2;
    density: number;
    friction: number;
    restitution: number;
    isSensor: boolean;
    enabled: boolean;
    categoryBits: number;
    maskBits: number;
}
interface CapsuleColliderData {
    radius: number;
    halfHeight: number;
    offset: Vec2;
    density: number;
    friction: number;
    restitution: number;
    isSensor: boolean;
    enabled: boolean;
    categoryBits: number;
    maskBits: number;
}
declare const RigidBody: BuiltinComponentDef<RigidBodyData>;
declare const BoxCollider: BuiltinComponentDef<BoxColliderData>;
declare const CircleCollider: BuiltinComponentDef<CircleColliderData>;
declare const CapsuleCollider: BuiltinComponentDef<CapsuleColliderData>;
declare const BodyType: {
    readonly Static: 0;
    readonly Kinematic: 1;
    readonly Dynamic: 2;
};
type BodyType = (typeof BodyType)[keyof typeof BodyType];

/**
 * @file    PhysicsModuleLoader.ts
 * @brief   Loads and initializes the Physics WASM module (standalone or side module)
 */
interface PhysicsWasmModule {
    _physics_init(gx: number, gy: number, timestep: number, substeps: number): void;
    _physics_shutdown(): void;
    _physics_createBody(entityId: number, bodyType: number, x: number, y: number, angle: number, gravityScale: number, linearDamping: number, angularDamping: number, fixedRotation: number, bullet: number): void;
    _physics_destroyBody(entityId: number): void;
    _physics_hasBody(entityId: number): number;
    _physics_addBoxShape(entityId: number, halfW: number, halfH: number, offX: number, offY: number, density: number, friction: number, restitution: number, isSensor: number, categoryBits: number, maskBits: number): void;
    _physics_addCircleShape(entityId: number, radius: number, offX: number, offY: number, density: number, friction: number, restitution: number, isSensor: number, categoryBits: number, maskBits: number): void;
    _physics_addCapsuleShape(entityId: number, radius: number, halfHeight: number, offX: number, offY: number, density: number, friction: number, restitution: number, isSensor: number, categoryBits: number, maskBits: number): void;
    _physics_step(dt: number): void;
    _physics_setBodyTransform(entityId: number, x: number, y: number, angle: number): void;
    _physics_getDynamicBodyCount(): number;
    _physics_getDynamicBodyTransforms(): number;
    _physics_collectEvents(): void;
    _physics_getCollisionEnterCount(): number;
    _physics_getCollisionEnterBuffer(): number;
    _physics_getCollisionExitCount(): number;
    _physics_getCollisionExitBuffer(): number;
    _physics_getSensorEnterCount(): number;
    _physics_getSensorEnterBuffer(): number;
    _physics_getSensorExitCount(): number;
    _physics_getSensorExitBuffer(): number;
    _physics_applyForce(entityId: number, forceX: number, forceY: number): void;
    _physics_applyImpulse(entityId: number, impulseX: number, impulseY: number): void;
    _physics_setLinearVelocity(entityId: number, vx: number, vy: number): void;
    _physics_getLinearVelocity(entityId: number): number;
    _physics_setGravity(gx: number, gy: number): void;
    _physics_getGravity(): number;
    _physics_setAngularVelocity(entityId: number, omega: number): void;
    _physics_getAngularVelocity(entityId: number): number;
    _physics_applyTorque(entityId: number, torque: number): void;
    _physics_applyAngularImpulse(entityId: number, impulse: number): void;
    _physics_updateBodyProperties(entityId: number, bodyType: number, gravityScale: number, linearDamping: number, angularDamping: number, fixedRotation: number, bullet: number): void;
    HEAPF32: Float32Array;
    HEAPU8: Uint8Array;
    HEAPU32: Uint32Array;
    _malloc(size: number): number;
    _free(ptr: number): void;
}
type PhysicsModuleFactory = (config?: Record<string, unknown>) => Promise<PhysicsWasmModule>;
declare function loadPhysicsModule(wasmUrl: string, factory?: PhysicsModuleFactory): Promise<PhysicsWasmModule>;
interface ESEngineMainModule {
    loadDynamicLibrary(binary: Uint8Array, opts: {
        loadAsync: boolean;
        allowUndefined: boolean;
    }): Promise<void>;
    cwrap(name: string, returnType: string | null, argTypes: string[]): (...args: unknown[]) => unknown;
    HEAPF32: Float32Array;
    HEAPU8: Uint8Array;
    HEAPU32: Uint32Array;
    _malloc(size: number): number;
    _free(ptr: number): void;
}
declare function loadPhysicsSideModule(wasmBinary: ArrayBuffer, mainModule: ESEngineMainModule): Promise<PhysicsWasmModule>;

interface PhysicsDebugDrawConfig {
    enabled: boolean;
    showColliders: boolean;
    showVelocity: boolean;
    showContacts: boolean;
}
declare const PhysicsDebugDraw: ResourceDef<PhysicsDebugDrawConfig>;
interface VelocityProvider {
    getLinearVelocity(entity: number): {
        x: number;
        y: number;
    };
}
declare function drawPhysicsDebug(app: App, physicsApiRes: ResourceDef<VelocityProvider>, physicsEventsRes: ResourceDef<PhysicsEventsData>): void;
declare function setupPhysicsDebugDraw(app: App, physicsApiRes: ResourceDef<VelocityProvider>, physicsEventsRes: ResourceDef<PhysicsEventsData>): void;

interface PhysicsPluginConfig {
    gravity?: Vec2;
    fixedTimestep?: number;
    subStepCount?: number;
    collisionLayerMasks?: number[];
}
interface CollisionEnterEvent {
    entityA: Entity;
    entityB: Entity;
    normalX: number;
    normalY: number;
    contactX: number;
    contactY: number;
}
interface SensorEvent {
    sensorEntity: Entity;
    visitorEntity: Entity;
}
interface PhysicsEventsData {
    collisionEnters: CollisionEnterEvent[];
    collisionExits: Array<{
        entityA: Entity;
        entityB: Entity;
    }>;
    sensorEnters: SensorEvent[];
    sensorExits: SensorEvent[];
}
declare const PhysicsEvents: ResourceDef<PhysicsEventsData>;
declare const PhysicsAPI: ResourceDef<Physics>;
declare class PhysicsPlugin implements Plugin {
    private config_;
    private wasmUrl_;
    private factory_?;
    constructor(wasmUrl: string, config?: PhysicsPluginConfig, factory?: PhysicsModuleFactory);
    build(app: App): void;
}
declare class Physics {
    private module_;
    constructor(app: App);
    /** @internal */
    static _fromModule(module: PhysicsWasmModule): Physics;
    applyForce(entity: Entity, force: Vec2): void;
    applyImpulse(entity: Entity, impulse: Vec2): void;
    setLinearVelocity(entity: Entity, velocity: Vec2): void;
    getLinearVelocity(entity: Entity): Vec2;
    setGravity(gravity: Vec2): void;
    getGravity(): Vec2;
    setAngularVelocity(entity: Entity, omega: number): void;
    getAngularVelocity(entity: Entity): number;
    applyTorque(entity: Entity, torque: number): void;
    applyAngularImpulse(entity: Entity, impulse: number): void;
    static setDebugDraw(app: App, enabled: boolean): void;
    static setDebugDrawConfig(app: App, config: Partial<PhysicsDebugDrawConfig>): void;
}

export { BodyType, BoxCollider, CapsuleCollider, CircleCollider, Physics, PhysicsAPI, PhysicsDebugDraw, PhysicsEvents, PhysicsPlugin, RigidBody, drawPhysicsDebug, loadPhysicsModule, loadPhysicsSideModule, setupPhysicsDebugDraw };
export type { BoxColliderData, CapsuleColliderData, CircleColliderData, CollisionEnterEvent, ESEngineMainModule, PhysicsDebugDrawConfig, PhysicsEventsData, PhysicsModuleFactory, PhysicsPluginConfig, PhysicsWasmModule, RigidBodyData, SensorEvent };
