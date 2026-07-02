// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    PhysicsModuleLoader.ts
 * @brief   Loads and initializes the Physics WASM module (standalone or side module)
 */

export interface PhysicsWasmModule {
    _physics_init(gx: number, gy: number, timestep: number, substeps: number,
                  contactHertz: number, contactDampingRatio: number, contactSpeed: number): void;
    /** World-level tuning (sleeping/continuous/restitution threshold/max speed). */
    _physics_setWorldConfig(enableSleep: number, enableContinuous: number,
                            restitutionThreshold: number, maxLinearSpeed: number): void;
    _physics_shutdown(): void;

    _physics_createBody(entityId: number, bodyType: number, x: number, y: number, angle: number,
        gravityScale: number, linearDamping: number, angularDamping: number,
        fixedRotation: number, bullet: number): void;
    _physics_destroyBody(entityId: number): void;
    _physics_hasBody(entityId: number): number;
    /** Enable/disable a body in place (keeps shapes/velocity/joints). */
    _physics_setBodyEnabled(entityId: number, enabled: number): void;
    /** Destroy all of an entity's shapes, keeping the body, for in-place rebuild. */
    _physics_clearShapes(entityId: number): void;

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
    /** High-speed impact events: [entityA, entityB, px, py, nx, ny, approachSpeed]. */
    _physics_getHitEventCount(): number;
    _physics_getHitEventBuffer(): number;
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

    _physics_moveCharacter(px: number, py: number, c1x: number, c1y: number, c2x: number, c2y: number,
        radius: number, velX: number, velY: number, dt: number, upX: number, upY: number, floorCos: number,
        maskBits: number, selfEntity: number): number;
    _physics_getMoveCharacterBuffer(): number;

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
