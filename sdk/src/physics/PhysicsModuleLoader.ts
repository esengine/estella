/**
 * @file    PhysicsModuleLoader.ts
 * @brief   Loads and initializes the Physics WASM module (standalone or side module)
 */

export interface PhysicsWasmModule {
    _physics_init(gx: number, gy: number, timestep: number, substeps: number,
                  contactHertz: number, contactDampingRatio: number, contactSpeed: number): void;
    _physics_shutdown(): void;

    _physics_createBody(entityId: number, bodyType: number, x: number, y: number, angle: number,
        gravityScale: number, linearDamping: number, angularDamping: number,
        fixedRotation: number, bullet: number): void;
    _physics_destroyBody(entityId: number): void;
    _physics_hasBody(entityId: number): number;

    _physics_addBoxShape(entityId: number, halfW: number, halfH: number,
        offX: number, offY: number, radius: number,
        density: number, friction: number, restitution: number, isSensor: number,
        categoryBits: number, maskBits: number): void;
    _physics_addCircleShape(entityId: number, radius: number,
        offX: number, offY: number,
        density: number, friction: number, restitution: number, isSensor: number,
        categoryBits: number, maskBits: number): void;
    _physics_addCapsuleShape(entityId: number, radius: number, halfHeight: number,
        offX: number, offY: number,
        density: number, friction: number, restitution: number, isSensor: number,
        categoryBits: number, maskBits: number): void;

    _physics_addSegmentShape(entityId: number, x1: number, y1: number, x2: number, y2: number,
        density: number, friction: number, restitution: number, isSensor: number,
        categoryBits: number, maskBits: number): void;
    _physics_addPolygonShape(entityId: number, verticesPtr: number, vertexCount: number, radius: number,
        density: number, friction: number, restitution: number, isSensor: number,
        categoryBits: number, maskBits: number): void;
    _physics_addChainShape(entityId: number, pointsPtr: number, pointCount: number, isLoop: number,
        friction: number, restitution: number,
        categoryBits: number, maskBits: number): void;

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

    _physics_updateBodyProperties(entityId: number, bodyType: number,
        gravityScale: number, linearDamping: number, angularDamping: number,
        fixedRotation: number, bullet: number): void;

    _physics_createRevoluteJoint(entityIdA: number, entityIdB: number,
        anchorAx: number, anchorAy: number, anchorBx: number, anchorBy: number,
        enableMotor: number, motorSpeed: number, maxMotorTorque: number,
        enableLimit: number, lowerAngle: number, upperAngle: number,
        collideConnected: number): number;
    _physics_destroyJoint(entityId: number): void;
    _physics_hasJoint(entityId: number): number;
    _physics_setRevoluteMotorSpeed(entityId: number, speed: number): void;
    _physics_setRevoluteMaxMotorTorque(entityId: number, torque: number): void;
    _physics_enableRevoluteMotor(entityId: number, enable: number): void;
    _physics_enableRevoluteLimit(entityId: number, enable: number): void;
    _physics_setRevoluteLimits(entityId: number, lower: number, upper: number): void;
    _physics_getRevoluteAngle(entityId: number): number;
    _physics_getRevoluteMotorTorque(entityId: number): number;

    _physics_createDistanceJoint(entityIdA: number, entityIdB: number,
        anchorAx: number, anchorAy: number, anchorBx: number, anchorBy: number,
        length: number, enableSpring: number, hertz: number, dampingRatio: number,
        enableLimit: number, minLength: number, maxLength: number,
        enableMotor: number, maxMotorForce: number, motorSpeed: number,
        collideConnected: number): number;
    _physics_createPrismaticJoint(entityIdA: number, entityIdB: number,
        anchorAx: number, anchorAy: number, anchorBx: number, anchorBy: number,
        axisX: number, axisY: number,
        enableSpring: number, hertz: number, dampingRatio: number,
        enableLimit: number, lowerTranslation: number, upperTranslation: number,
        enableMotor: number, maxMotorForce: number, motorSpeed: number,
        collideConnected: number): number;
    _physics_createWeldJoint(entityIdA: number, entityIdB: number,
        anchorAx: number, anchorAy: number, anchorBx: number, anchorBy: number,
        linearHertz: number, angularHertz: number,
        linearDampingRatio: number, angularDampingRatio: number,
        collideConnected: number): number;
    _physics_createWheelJoint(entityIdA: number, entityIdB: number,
        anchorAx: number, anchorAy: number, anchorBx: number, anchorBy: number,
        axisX: number, axisY: number,
        enableSpring: number, hertz: number, dampingRatio: number,
        enableLimit: number, lowerTranslation: number, upperTranslation: number,
        enableMotor: number, maxMotorTorque: number, motorSpeed: number,
        collideConnected: number): number;

    _physics_raycast(originX: number, originY: number, dirX: number, dirY: number,
        maxDistance: number, maskBits: number): number;
    _physics_getRaycastBuffer(): number;
    _physics_overlapCircle(centerX: number, centerY: number, radius: number, maskBits: number): number;
    _physics_getOverlapBuffer(): number;

    _physics_setAwake(entityId: number, awake: number): void;
    _physics_isAwake(entityId: number): number;

    _physics_shapeCastCircle(centerX: number, centerY: number, radius: number,
        translationX: number, translationY: number, maskBits: number): number;
    _physics_shapeCastBox(centerX: number, centerY: number, halfW: number, halfH: number, angle: number,
        translationX: number, translationY: number, maskBits: number): number;
    _physics_shapeCastCapsule(center1X: number, center1Y: number, center2X: number, center2Y: number,
        radius: number, translationX: number, translationY: number, maskBits: number): number;
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

export type PhysicsModuleFactory = (config?: Record<string, unknown>) => Promise<PhysicsWasmModule>;

export async function loadPhysicsModule(
    wasmUrl: string,
    factory?: PhysicsModuleFactory
): Promise<PhysicsWasmModule> {
    if (!factory) {
        throw new Error(
            'PhysicsModuleLoader: factory parameter is required. ' +
            'Pass the Physics WASM factory function explicitly via loadPhysicsModule(url, factory).'
        );
    }
    return factory();
}

export interface ESEngineMainModule {
    loadDynamicLibrary(binary: Uint8Array, opts: { loadAsync: boolean; allowUndefined: boolean }): Promise<void>;
    cwrap(name: string, returnType: string | null, argTypes: string[]): (...args: unknown[]) => unknown;
    HEAPF32: Float32Array;
    HEAPU8: Uint8Array;
    HEAPU32: Uint32Array;
    _malloc(size: number): number;
    _free(ptr: number): void;
}

export async function loadPhysicsSideModule(
    wasmBinary: ArrayBuffer,
    mainModule: ESEngineMainModule
): Promise<PhysicsWasmModule> {
    await mainModule.loadDynamicLibrary(
        new Uint8Array(wasmBinary),
        { loadAsync: true, allowUndefined: true }
    );

    const cwrap = mainModule.cwrap.bind(mainModule);

    return {
        _physics_init: cwrap('physics_init', null, ['number', 'number', 'number', 'number', 'number', 'number', 'number']) as PhysicsWasmModule['_physics_init'],
        _physics_shutdown: cwrap('physics_shutdown', null, []) as PhysicsWasmModule['_physics_shutdown'],

        _physics_createBody: cwrap('physics_createBody', null, ['number', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number']) as PhysicsWasmModule['_physics_createBody'],
        _physics_destroyBody: cwrap('physics_destroyBody', null, ['number']) as PhysicsWasmModule['_physics_destroyBody'],
        _physics_hasBody: cwrap('physics_hasBody', 'number', ['number']) as PhysicsWasmModule['_physics_hasBody'],

        _physics_addBoxShape: cwrap('physics_addBoxShape', null, ['number', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number']) as PhysicsWasmModule['_physics_addBoxShape'],
        _physics_addCircleShape: cwrap('physics_addCircleShape', null, ['number', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number']) as PhysicsWasmModule['_physics_addCircleShape'],
        _physics_addCapsuleShape: cwrap('physics_addCapsuleShape', null, ['number', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number']) as PhysicsWasmModule['_physics_addCapsuleShape'],
        _physics_addSegmentShape: cwrap('physics_addSegmentShape', null, ['number', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number']) as PhysicsWasmModule['_physics_addSegmentShape'],
        _physics_addPolygonShape: cwrap('physics_addPolygonShape', null, ['number', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number']) as PhysicsWasmModule['_physics_addPolygonShape'],
        _physics_addChainShape: cwrap('physics_addChainShape', null, ['number', 'number', 'number', 'number', 'number', 'number', 'number', 'number']) as PhysicsWasmModule['_physics_addChainShape'],

        _physics_step: cwrap('physics_step', null, ['number']) as PhysicsWasmModule['_physics_step'],

        _physics_setBodyTransform: cwrap('physics_setBodyTransform', null, ['number', 'number', 'number', 'number']) as PhysicsWasmModule['_physics_setBodyTransform'],
        _physics_getDynamicBodyCount: cwrap('physics_getDynamicBodyCount', 'number', []) as PhysicsWasmModule['_physics_getDynamicBodyCount'],
        _physics_getDynamicBodyTransforms: cwrap('physics_getDynamicBodyTransforms', 'number', []) as PhysicsWasmModule['_physics_getDynamicBodyTransforms'],

        _physics_collectEvents: cwrap('physics_collectEvents', null, []) as PhysicsWasmModule['_physics_collectEvents'],
        _physics_getCollisionEnterCount: cwrap('physics_getCollisionEnterCount', 'number', []) as PhysicsWasmModule['_physics_getCollisionEnterCount'],
        _physics_getCollisionEnterBuffer: cwrap('physics_getCollisionEnterBuffer', 'number', []) as PhysicsWasmModule['_physics_getCollisionEnterBuffer'],
        _physics_getCollisionExitCount: cwrap('physics_getCollisionExitCount', 'number', []) as PhysicsWasmModule['_physics_getCollisionExitCount'],
        _physics_getCollisionExitBuffer: cwrap('physics_getCollisionExitBuffer', 'number', []) as PhysicsWasmModule['_physics_getCollisionExitBuffer'],
        _physics_getSensorEnterCount: cwrap('physics_getSensorEnterCount', 'number', []) as PhysicsWasmModule['_physics_getSensorEnterCount'],
        _physics_getSensorEnterBuffer: cwrap('physics_getSensorEnterBuffer', 'number', []) as PhysicsWasmModule['_physics_getSensorEnterBuffer'],
        _physics_getSensorExitCount: cwrap('physics_getSensorExitCount', 'number', []) as PhysicsWasmModule['_physics_getSensorExitCount'],
        _physics_getSensorExitBuffer: cwrap('physics_getSensorExitBuffer', 'number', []) as PhysicsWasmModule['_physics_getSensorExitBuffer'],

        _physics_applyForce: cwrap('physics_applyForce', null, ['number', 'number', 'number']) as PhysicsWasmModule['_physics_applyForce'],
        _physics_applyImpulse: cwrap('physics_applyImpulse', null, ['number', 'number', 'number']) as PhysicsWasmModule['_physics_applyImpulse'],
        _physics_setLinearVelocity: cwrap('physics_setLinearVelocity', null, ['number', 'number', 'number']) as PhysicsWasmModule['_physics_setLinearVelocity'],
        _physics_getLinearVelocity: cwrap('physics_getLinearVelocity', 'number', ['number']) as PhysicsWasmModule['_physics_getLinearVelocity'],

        _physics_setGravity: cwrap('physics_setGravity', null, ['number', 'number']) as PhysicsWasmModule['_physics_setGravity'],
        _physics_getGravity: cwrap('physics_getGravity', 'number', []) as PhysicsWasmModule['_physics_getGravity'],

        _physics_setAngularVelocity: cwrap('physics_setAngularVelocity', null, ['number', 'number']) as PhysicsWasmModule['_physics_setAngularVelocity'],
        _physics_getAngularVelocity: cwrap('physics_getAngularVelocity', 'number', ['number']) as PhysicsWasmModule['_physics_getAngularVelocity'],
        _physics_applyTorque: cwrap('physics_applyTorque', null, ['number', 'number']) as PhysicsWasmModule['_physics_applyTorque'],
        _physics_applyAngularImpulse: cwrap('physics_applyAngularImpulse', null, ['number', 'number']) as PhysicsWasmModule['_physics_applyAngularImpulse'],

        _physics_updateBodyProperties: cwrap('physics_updateBodyProperties', null, ['number', 'number', 'number', 'number', 'number', 'number', 'number']) as PhysicsWasmModule['_physics_updateBodyProperties'],

        _physics_createRevoluteJoint: cwrap('physics_createRevoluteJoint', 'number', ['number', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number']) as PhysicsWasmModule['_physics_createRevoluteJoint'],
        _physics_destroyJoint: cwrap('physics_destroyJoint', null, ['number']) as PhysicsWasmModule['_physics_destroyJoint'],
        _physics_hasJoint: cwrap('physics_hasJoint', 'number', ['number']) as PhysicsWasmModule['_physics_hasJoint'],
        _physics_setRevoluteMotorSpeed: cwrap('physics_setRevoluteMotorSpeed', null, ['number', 'number']) as PhysicsWasmModule['_physics_setRevoluteMotorSpeed'],
        _physics_setRevoluteMaxMotorTorque: cwrap('physics_setRevoluteMaxMotorTorque', null, ['number', 'number']) as PhysicsWasmModule['_physics_setRevoluteMaxMotorTorque'],
        _physics_enableRevoluteMotor: cwrap('physics_enableRevoluteMotor', null, ['number', 'number']) as PhysicsWasmModule['_physics_enableRevoluteMotor'],
        _physics_enableRevoluteLimit: cwrap('physics_enableRevoluteLimit', null, ['number', 'number']) as PhysicsWasmModule['_physics_enableRevoluteLimit'],
        _physics_setRevoluteLimits: cwrap('physics_setRevoluteLimits', null, ['number', 'number', 'number']) as PhysicsWasmModule['_physics_setRevoluteLimits'],
        _physics_getRevoluteAngle: cwrap('physics_getRevoluteAngle', 'number', ['number']) as PhysicsWasmModule['_physics_getRevoluteAngle'],
        _physics_getRevoluteMotorTorque: cwrap('physics_getRevoluteMotorTorque', 'number', ['number']) as PhysicsWasmModule['_physics_getRevoluteMotorTorque'],

        _physics_createDistanceJoint: cwrap('physics_createDistanceJoint', 'number', ['number', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number']) as PhysicsWasmModule['_physics_createDistanceJoint'],
        _physics_createPrismaticJoint: cwrap('physics_createPrismaticJoint', 'number', ['number', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number']) as PhysicsWasmModule['_physics_createPrismaticJoint'],
        _physics_createWeldJoint: cwrap('physics_createWeldJoint', 'number', ['number', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number']) as PhysicsWasmModule['_physics_createWeldJoint'],
        _physics_createWheelJoint: cwrap('physics_createWheelJoint', 'number', ['number', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number']) as PhysicsWasmModule['_physics_createWheelJoint'],

        _physics_raycast: cwrap('physics_raycast', 'number', ['number', 'number', 'number', 'number', 'number', 'number']) as PhysicsWasmModule['_physics_raycast'],
        _physics_getRaycastBuffer: cwrap('physics_getRaycastBuffer', 'number', []) as PhysicsWasmModule['_physics_getRaycastBuffer'],
        _physics_overlapCircle: cwrap('physics_overlapCircle', 'number', ['number', 'number', 'number', 'number']) as PhysicsWasmModule['_physics_overlapCircle'],
        _physics_getOverlapBuffer: cwrap('physics_getOverlapBuffer', 'number', []) as PhysicsWasmModule['_physics_getOverlapBuffer'],

        _physics_setAwake: cwrap('physics_setAwake', null, ['number', 'number']) as PhysicsWasmModule['_physics_setAwake'],
        _physics_isAwake: cwrap('physics_isAwake', 'number', ['number']) as PhysicsWasmModule['_physics_isAwake'],

        _physics_shapeCastCircle: cwrap('physics_shapeCastCircle', 'number', ['number', 'number', 'number', 'number', 'number', 'number']) as PhysicsWasmModule['_physics_shapeCastCircle'],
        _physics_shapeCastBox: cwrap('physics_shapeCastBox', 'number', ['number', 'number', 'number', 'number', 'number', 'number', 'number', 'number']) as PhysicsWasmModule['_physics_shapeCastBox'],
        _physics_shapeCastCapsule: cwrap('physics_shapeCastCapsule', 'number', ['number', 'number', 'number', 'number', 'number', 'number', 'number', 'number']) as PhysicsWasmModule['_physics_shapeCastCapsule'],
        _physics_getShapeCastBuffer: cwrap('physics_getShapeCastBuffer', 'number', []) as PhysicsWasmModule['_physics_getShapeCastBuffer'],

        _physics_overlapAABB: cwrap('physics_overlapAABB', 'number', ['number', 'number', 'number', 'number', 'number']) as PhysicsWasmModule['_physics_overlapAABB'],

        _physics_getBodyMass: cwrap('physics_getBodyMass', 'number', ['number']) as PhysicsWasmModule['_physics_getBodyMass'],
        _physics_getBodyInertia: cwrap('physics_getBodyInertia', 'number', ['number']) as PhysicsWasmModule['_physics_getBodyInertia'],
        _physics_getBodyCenterOfMass: cwrap('physics_getBodyCenterOfMass', 'number', ['number']) as PhysicsWasmModule['_physics_getBodyCenterOfMass'],

        _physics_getDistanceJointLength: cwrap('physics_getDistanceJointLength', 'number', ['number']) as PhysicsWasmModule['_physics_getDistanceJointLength'],
        _physics_getDistanceJointCurrentLength: cwrap('physics_getDistanceJointCurrentLength', 'number', ['number']) as PhysicsWasmModule['_physics_getDistanceJointCurrentLength'],
        _physics_setDistanceJointLength: cwrap('physics_setDistanceJointLength', null, ['number', 'number']) as PhysicsWasmModule['_physics_setDistanceJointLength'],
        _physics_enableDistanceJointSpring: cwrap('physics_enableDistanceJointSpring', null, ['number', 'number']) as PhysicsWasmModule['_physics_enableDistanceJointSpring'],
        _physics_enableDistanceJointLimit: cwrap('physics_enableDistanceJointLimit', null, ['number', 'number']) as PhysicsWasmModule['_physics_enableDistanceJointLimit'],
        _physics_setDistanceJointLimits: cwrap('physics_setDistanceJointLimits', null, ['number', 'number', 'number']) as PhysicsWasmModule['_physics_setDistanceJointLimits'],
        _physics_enableDistanceJointMotor: cwrap('physics_enableDistanceJointMotor', null, ['number', 'number']) as PhysicsWasmModule['_physics_enableDistanceJointMotor'],
        _physics_setDistanceJointMotorSpeed: cwrap('physics_setDistanceJointMotorSpeed', null, ['number', 'number']) as PhysicsWasmModule['_physics_setDistanceJointMotorSpeed'],
        _physics_setDistanceJointMaxMotorForce: cwrap('physics_setDistanceJointMaxMotorForce', null, ['number', 'number']) as PhysicsWasmModule['_physics_setDistanceJointMaxMotorForce'],
        _physics_getDistanceJointMotorForce: cwrap('physics_getDistanceJointMotorForce', 'number', ['number']) as PhysicsWasmModule['_physics_getDistanceJointMotorForce'],

        _physics_getPrismaticJointTranslation: cwrap('physics_getPrismaticJointTranslation', 'number', ['number']) as PhysicsWasmModule['_physics_getPrismaticJointTranslation'],
        _physics_getPrismaticJointSpeed: cwrap('physics_getPrismaticJointSpeed', 'number', ['number']) as PhysicsWasmModule['_physics_getPrismaticJointSpeed'],
        _physics_enablePrismaticJointSpring: cwrap('physics_enablePrismaticJointSpring', null, ['number', 'number']) as PhysicsWasmModule['_physics_enablePrismaticJointSpring'],
        _physics_enablePrismaticJointLimit: cwrap('physics_enablePrismaticJointLimit', null, ['number', 'number']) as PhysicsWasmModule['_physics_enablePrismaticJointLimit'],
        _physics_setPrismaticJointLimits: cwrap('physics_setPrismaticJointLimits', null, ['number', 'number', 'number']) as PhysicsWasmModule['_physics_setPrismaticJointLimits'],
        _physics_enablePrismaticJointMotor: cwrap('physics_enablePrismaticJointMotor', null, ['number', 'number']) as PhysicsWasmModule['_physics_enablePrismaticJointMotor'],
        _physics_setPrismaticJointMotorSpeed: cwrap('physics_setPrismaticJointMotorSpeed', null, ['number', 'number']) as PhysicsWasmModule['_physics_setPrismaticJointMotorSpeed'],
        _physics_setPrismaticJointMaxMotorForce: cwrap('physics_setPrismaticJointMaxMotorForce', null, ['number', 'number']) as PhysicsWasmModule['_physics_setPrismaticJointMaxMotorForce'],
        _physics_getPrismaticJointMotorForce: cwrap('physics_getPrismaticJointMotorForce', 'number', ['number']) as PhysicsWasmModule['_physics_getPrismaticJointMotorForce'],

        _physics_enableWheelJointSpring: cwrap('physics_enableWheelJointSpring', null, ['number', 'number']) as PhysicsWasmModule['_physics_enableWheelJointSpring'],
        _physics_enableWheelJointLimit: cwrap('physics_enableWheelJointLimit', null, ['number', 'number']) as PhysicsWasmModule['_physics_enableWheelJointLimit'],
        _physics_setWheelJointLimits: cwrap('physics_setWheelJointLimits', null, ['number', 'number', 'number']) as PhysicsWasmModule['_physics_setWheelJointLimits'],
        _physics_enableWheelJointMotor: cwrap('physics_enableWheelJointMotor', null, ['number', 'number']) as PhysicsWasmModule['_physics_enableWheelJointMotor'],
        _physics_setWheelJointMotorSpeed: cwrap('physics_setWheelJointMotorSpeed', null, ['number', 'number']) as PhysicsWasmModule['_physics_setWheelJointMotorSpeed'],
        _physics_setWheelJointMaxMotorTorque: cwrap('physics_setWheelJointMaxMotorTorque', null, ['number', 'number']) as PhysicsWasmModule['_physics_setWheelJointMaxMotorTorque'],
        _physics_getWheelJointMotorTorque: cwrap('physics_getWheelJointMotorTorque', 'number', ['number']) as PhysicsWasmModule['_physics_getWheelJointMotorTorque'],

        get HEAPF32() { return mainModule.HEAPF32; },
        get HEAPU8() { return mainModule.HEAPU8; },
        get HEAPU32() { return mainModule.HEAPU32; },
        _malloc: mainModule._malloc.bind(mainModule),
        _free: mainModule._free.bind(mainModule),
    } as PhysicsWasmModule;
}
