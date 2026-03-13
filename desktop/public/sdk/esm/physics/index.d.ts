import { B as BuiltinComponentDef, p as ComponentDef, R as ResourceDef, A as App, P as Plugin } from '../shared/app.js';
import { V as Vec2, E as Entity } from '../shared/wasm.js';

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
    radius: number;
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
interface SegmentColliderData {
    point1: Vec2;
    point2: Vec2;
    density: number;
    friction: number;
    restitution: number;
    isSensor: boolean;
    enabled: boolean;
    categoryBits: number;
    maskBits: number;
}
interface PolygonColliderData {
    vertices: Vec2[];
    radius: number;
    density: number;
    friction: number;
    restitution: number;
    isSensor: boolean;
    enabled: boolean;
    categoryBits: number;
    maskBits: number;
}
interface ChainColliderData {
    points: Vec2[];
    isLoop: boolean;
    friction: number;
    restitution: number;
    categoryBits: number;
    maskBits: number;
    enabled: boolean;
}
declare const RigidBody: BuiltinComponentDef<RigidBodyData>;
declare const BoxCollider: BuiltinComponentDef<BoxColliderData>;
declare const CircleCollider: BuiltinComponentDef<CircleColliderData>;
declare const CapsuleCollider: BuiltinComponentDef<CapsuleColliderData>;
declare const SegmentCollider: BuiltinComponentDef<SegmentColliderData>;
declare const PolygonCollider: ComponentDef<PolygonColliderData>;
declare const ChainCollider: ComponentDef<ChainColliderData>;
interface RevoluteJointData {
    connectedEntity: number;
    anchorA: Vec2;
    anchorB: Vec2;
    enableMotor: boolean;
    motorSpeed: number;
    maxMotorTorque: number;
    enableLimit: boolean;
    lowerAngle: number;
    upperAngle: number;
    collideConnected: boolean;
    enabled: boolean;
}
declare const RevoluteJoint: ComponentDef<RevoluteJointData>;
interface DistanceJointData {
    connectedEntity: number;
    anchorA: Vec2;
    anchorB: Vec2;
    length: number;
    enableSpring: boolean;
    hertz: number;
    dampingRatio: number;
    enableLimit: boolean;
    minLength: number;
    maxLength: number;
    enableMotor: boolean;
    maxMotorForce: number;
    motorSpeed: number;
    collideConnected: boolean;
    enabled: boolean;
}
declare const DistanceJoint: ComponentDef<DistanceJointData>;
interface PrismaticJointData {
    connectedEntity: number;
    anchorA: Vec2;
    anchorB: Vec2;
    axis: Vec2;
    enableSpring: boolean;
    hertz: number;
    dampingRatio: number;
    enableLimit: boolean;
    lowerTranslation: number;
    upperTranslation: number;
    enableMotor: boolean;
    maxMotorForce: number;
    motorSpeed: number;
    collideConnected: boolean;
    enabled: boolean;
}
declare const PrismaticJoint: ComponentDef<PrismaticJointData>;
interface WeldJointData {
    connectedEntity: number;
    anchorA: Vec2;
    anchorB: Vec2;
    linearHertz: number;
    angularHertz: number;
    linearDampingRatio: number;
    angularDampingRatio: number;
    collideConnected: boolean;
    enabled: boolean;
}
declare const WeldJoint: ComponentDef<WeldJointData>;
interface WheelJointData {
    connectedEntity: number;
    anchorA: Vec2;
    anchorB: Vec2;
    axis: Vec2;
    enableSpring: boolean;
    hertz: number;
    dampingRatio: number;
    enableLimit: boolean;
    lowerTranslation: number;
    upperTranslation: number;
    enableMotor: boolean;
    maxMotorTorque: number;
    motorSpeed: number;
    collideConnected: boolean;
    enabled: boolean;
}
declare const WheelJoint: ComponentDef<WheelJointData>;
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
    _physics_init(gx: number, gy: number, timestep: number, substeps: number, contactHertz: number, contactDampingRatio: number, contactSpeed: number): void;
    _physics_shutdown(): void;
    _physics_createBody(entityId: number, bodyType: number, x: number, y: number, angle: number, gravityScale: number, linearDamping: number, angularDamping: number, fixedRotation: number, bullet: number): void;
    _physics_destroyBody(entityId: number): void;
    _physics_hasBody(entityId: number): number;
    _physics_addBoxShape(entityId: number, halfW: number, halfH: number, offX: number, offY: number, radius: number, density: number, friction: number, restitution: number, isSensor: number, categoryBits: number, maskBits: number): void;
    _physics_addCircleShape(entityId: number, radius: number, offX: number, offY: number, density: number, friction: number, restitution: number, isSensor: number, categoryBits: number, maskBits: number): void;
    _physics_addCapsuleShape(entityId: number, radius: number, halfHeight: number, offX: number, offY: number, density: number, friction: number, restitution: number, isSensor: number, categoryBits: number, maskBits: number): void;
    _physics_addSegmentShape(entityId: number, x1: number, y1: number, x2: number, y2: number, density: number, friction: number, restitution: number, isSensor: number, categoryBits: number, maskBits: number): void;
    _physics_addPolygonShape(entityId: number, verticesPtr: number, vertexCount: number, radius: number, density: number, friction: number, restitution: number, isSensor: number, categoryBits: number, maskBits: number): void;
    _physics_addChainShape(entityId: number, pointsPtr: number, pointCount: number, isLoop: number, friction: number, restitution: number, categoryBits: number, maskBits: number): void;
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
    _physics_createRevoluteJoint(entityIdA: number, entityIdB: number, anchorAx: number, anchorAy: number, anchorBx: number, anchorBy: number, enableMotor: number, motorSpeed: number, maxMotorTorque: number, enableLimit: number, lowerAngle: number, upperAngle: number, collideConnected: number): number;
    _physics_destroyJoint(entityId: number): void;
    _physics_hasJoint(entityId: number): number;
    _physics_setRevoluteMotorSpeed(entityId: number, speed: number): void;
    _physics_setRevoluteMaxMotorTorque(entityId: number, torque: number): void;
    _physics_enableRevoluteMotor(entityId: number, enable: number): void;
    _physics_enableRevoluteLimit(entityId: number, enable: number): void;
    _physics_setRevoluteLimits(entityId: number, lower: number, upper: number): void;
    _physics_getRevoluteAngle(entityId: number): number;
    _physics_getRevoluteMotorTorque(entityId: number): number;
    _physics_createDistanceJoint(entityIdA: number, entityIdB: number, anchorAx: number, anchorAy: number, anchorBx: number, anchorBy: number, length: number, enableSpring: number, hertz: number, dampingRatio: number, enableLimit: number, minLength: number, maxLength: number, enableMotor: number, maxMotorForce: number, motorSpeed: number, collideConnected: number): number;
    _physics_createPrismaticJoint(entityIdA: number, entityIdB: number, anchorAx: number, anchorAy: number, anchorBx: number, anchorBy: number, axisX: number, axisY: number, enableSpring: number, hertz: number, dampingRatio: number, enableLimit: number, lowerTranslation: number, upperTranslation: number, enableMotor: number, maxMotorForce: number, motorSpeed: number, collideConnected: number): number;
    _physics_createWeldJoint(entityIdA: number, entityIdB: number, anchorAx: number, anchorAy: number, anchorBx: number, anchorBy: number, linearHertz: number, angularHertz: number, linearDampingRatio: number, angularDampingRatio: number, collideConnected: number): number;
    _physics_createWheelJoint(entityIdA: number, entityIdB: number, anchorAx: number, anchorAy: number, anchorBx: number, anchorBy: number, axisX: number, axisY: number, enableSpring: number, hertz: number, dampingRatio: number, enableLimit: number, lowerTranslation: number, upperTranslation: number, enableMotor: number, maxMotorTorque: number, motorSpeed: number, collideConnected: number): number;
    _physics_raycast(originX: number, originY: number, dirX: number, dirY: number, maxDistance: number, maskBits: number): number;
    _physics_getRaycastBuffer(): number;
    _physics_overlapCircle(centerX: number, centerY: number, radius: number, maskBits: number): number;
    _physics_getOverlapBuffer(): number;
    _physics_setAwake(entityId: number, awake: number): void;
    _physics_isAwake(entityId: number): number;
    _physics_shapeCastCircle(centerX: number, centerY: number, radius: number, translationX: number, translationY: number, maskBits: number): number;
    _physics_shapeCastBox(centerX: number, centerY: number, halfW: number, halfH: number, angle: number, translationX: number, translationY: number, maskBits: number): number;
    _physics_shapeCastCapsule(center1X: number, center1Y: number, center2X: number, center2Y: number, radius: number, translationX: number, translationY: number, maskBits: number): number;
    _physics_getShapeCastBuffer(): number;
    _physics_overlapAABB(minX: number, minY: number, maxX: number, maxY: number, maskBits: number): number;
    _physics_getBodyMass(entityId: number): number;
    _physics_getBodyInertia(entityId: number): number;
    _physics_getBodyCenterOfMass(entityId: number): number;
    _physics_getDistanceJointLength(entityId: number): number;
    _physics_getDistanceJointCurrentLength(entityId: number): number;
    _physics_setDistanceJointLength(entityId: number, length: number): void;
    _physics_enableDistanceJointSpring(entityId: number, enable: number): void;
    _physics_enableDistanceJointLimit(entityId: number, enable: number): void;
    _physics_setDistanceJointLimits(entityId: number, minLength: number, maxLength: number): void;
    _physics_enableDistanceJointMotor(entityId: number, enable: number): void;
    _physics_setDistanceJointMotorSpeed(entityId: number, speed: number): void;
    _physics_setDistanceJointMaxMotorForce(entityId: number, force: number): void;
    _physics_getDistanceJointMotorForce(entityId: number): number;
    _physics_getPrismaticJointTranslation(entityId: number): number;
    _physics_getPrismaticJointSpeed(entityId: number): number;
    _physics_enablePrismaticJointSpring(entityId: number, enable: number): void;
    _physics_enablePrismaticJointLimit(entityId: number, enable: number): void;
    _physics_setPrismaticJointLimits(entityId: number, lower: number, upper: number): void;
    _physics_enablePrismaticJointMotor(entityId: number, enable: number): void;
    _physics_setPrismaticJointMotorSpeed(entityId: number, speed: number): void;
    _physics_setPrismaticJointMaxMotorForce(entityId: number, force: number): void;
    _physics_getPrismaticJointMotorForce(entityId: number): number;
    _physics_enableWheelJointSpring(entityId: number, enable: number): void;
    _physics_enableWheelJointLimit(entityId: number, enable: number): void;
    _physics_setWheelJointLimits(entityId: number, lower: number, upper: number): void;
    _physics_enableWheelJointMotor(entityId: number, enable: number): void;
    _physics_setWheelJointMotorSpeed(entityId: number, speed: number): void;
    _physics_setWheelJointMaxMotorTorque(entityId: number, torque: number): void;
    _physics_getWheelJointMotorTorque(entityId: number): number;
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
    contactHertz?: number;
    contactDampingRatio?: number;
    contactSpeed?: number;
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
interface RaycastHit {
    entity: Entity;
    point: Vec2;
    normal: Vec2;
    fraction: number;
}
type ShapeCastHit = RaycastHit;
interface MassData {
    mass: number;
    inertia: number;
    centerOfMass: Vec2;
}
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
    createRevoluteJoint(entityA: Entity, entityB: Entity, anchorA: Vec2, anchorB: Vec2, options?: {
        enableMotor?: boolean;
        motorSpeed?: number;
        maxMotorTorque?: number;
        enableLimit?: boolean;
        lowerAngle?: number;
        upperAngle?: number;
        collideConnected?: boolean;
    }): boolean;
    destroyJoint(entity: Entity): void;
    setRevoluteMotorSpeed(entity: Entity, speed: number): void;
    setRevoluteMaxMotorTorque(entity: Entity, torque: number): void;
    enableRevoluteMotor(entity: Entity, enable: boolean): void;
    enableRevoluteLimit(entity: Entity, enable: boolean): void;
    setRevoluteLimits(entity: Entity, lower: number, upper: number): void;
    getRevoluteAngle(entity: Entity): number;
    getRevoluteMotorTorque(entity: Entity): number;
    raycast(origin: Vec2, direction: Vec2, maxDistance: number, maskBits?: number, ppu?: number): RaycastHit[];
    overlapCircle(center: Vec2, radius: number, maskBits?: number, ppu?: number): Entity[];
    setAwake(entity: Entity, awake: boolean): void;
    isAwake(entity: Entity): boolean;
    shapeCastCircle(center: Vec2, radius: number, translation: Vec2, maskBits?: number, ppu?: number): ShapeCastHit[];
    shapeCastBox(center: Vec2, halfExtents: Vec2, angle: number, translation: Vec2, maskBits?: number, ppu?: number): ShapeCastHit[];
    shapeCastCapsule(center1: Vec2, center2: Vec2, radius: number, translation: Vec2, maskBits?: number, ppu?: number): ShapeCastHit[];
    overlapAABB(min: Vec2, max: Vec2, maskBits?: number, ppu?: number): Entity[];
    getMass(entity: Entity): number;
    getInertia(entity: Entity): number;
    getCenterOfMass(entity: Entity, ppu?: number): Vec2;
    getMassData(entity: Entity, ppu?: number): MassData;
    getDistanceJointLength(entity: Entity, ppu?: number): number;
    getDistanceJointCurrentLength(entity: Entity, ppu?: number): number;
    setDistanceJointLength(entity: Entity, length: number, ppu?: number): void;
    enableDistanceJointSpring(entity: Entity, enable: boolean): void;
    enableDistanceJointLimit(entity: Entity, enable: boolean): void;
    setDistanceJointLimits(entity: Entity, minLength: number, maxLength: number, ppu?: number): void;
    enableDistanceJointMotor(entity: Entity, enable: boolean): void;
    setDistanceJointMotorSpeed(entity: Entity, speed: number): void;
    setDistanceJointMaxMotorForce(entity: Entity, force: number): void;
    getDistanceJointMotorForce(entity: Entity): number;
    getPrismaticJointTranslation(entity: Entity, ppu?: number): number;
    getPrismaticJointSpeed(entity: Entity, ppu?: number): number;
    enablePrismaticJointSpring(entity: Entity, enable: boolean): void;
    enablePrismaticJointLimit(entity: Entity, enable: boolean): void;
    setPrismaticJointLimits(entity: Entity, lower: number, upper: number, ppu?: number): void;
    enablePrismaticJointMotor(entity: Entity, enable: boolean): void;
    setPrismaticJointMotorSpeed(entity: Entity, speed: number): void;
    setPrismaticJointMaxMotorForce(entity: Entity, force: number): void;
    getPrismaticJointMotorForce(entity: Entity): number;
    enableWheelJointSpring(entity: Entity, enable: boolean): void;
    enableWheelJointLimit(entity: Entity, enable: boolean): void;
    setWheelJointLimits(entity: Entity, lower: number, upper: number, ppu?: number): void;
    enableWheelJointMotor(entity: Entity, enable: boolean): void;
    setWheelJointMotorSpeed(entity: Entity, speed: number): void;
    setWheelJointMaxMotorTorque(entity: Entity, torque: number): void;
    getWheelJointMotorTorque(entity: Entity): number;
    private readUniqueEntityBuffer_;
    private readShapeCastBuffer_;
    static setDebugDraw(app: App, enabled: boolean): void;
    static setDebugDrawConfig(app: App, config: Partial<PhysicsDebugDrawConfig>): void;
}

export { BodyType, BoxCollider, CapsuleCollider, ChainCollider, CircleCollider, DistanceJoint, Physics, PhysicsAPI, PhysicsDebugDraw, PhysicsEvents, PhysicsPlugin, PolygonCollider, PrismaticJoint, RevoluteJoint, RigidBody, SegmentCollider, WeldJoint, WheelJoint, drawPhysicsDebug, loadPhysicsModule, loadPhysicsSideModule, setupPhysicsDebugDraw };
export type { BoxColliderData, CapsuleColliderData, ChainColliderData, CircleColliderData, CollisionEnterEvent, DistanceJointData, ESEngineMainModule, MassData, PhysicsDebugDrawConfig, PhysicsEventsData, PhysicsModuleFactory, PhysicsPluginConfig, PhysicsWasmModule, PolygonColliderData, PrismaticJointData, RaycastHit, RevoluteJointData, RigidBodyData, SegmentColliderData, SensorEvent, ShapeCastHit, WeldJointData, WheelJointData };
