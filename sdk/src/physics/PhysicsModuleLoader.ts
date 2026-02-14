/**
 * @file    PhysicsModuleLoader.ts
 * @brief   Loads and initializes the Physics WASM module (standalone or side module)
 */

export interface PhysicsWasmModule {
    _physics_init(gx: number, gy: number, timestep: number, substeps: number): void;
    _physics_shutdown(): void;

    _physics_createBody(entityId: number, bodyType: number, x: number, y: number, angle: number,
        gravityScale: number, linearDamping: number, angularDamping: number,
        fixedRotation: number, bullet: number): void;
    _physics_destroyBody(entityId: number): void;
    _physics_hasBody(entityId: number): number;

    _physics_addBoxShape(entityId: number, halfW: number, halfH: number,
        offX: number, offY: number,
        density: number, friction: number, restitution: number, isSensor: number): void;
    _physics_addCircleShape(entityId: number, radius: number,
        offX: number, offY: number,
        density: number, friction: number, restitution: number, isSensor: number): void;
    _physics_addCapsuleShape(entityId: number, radius: number, halfHeight: number,
        offX: number, offY: number,
        density: number, friction: number, restitution: number, isSensor: number): void;

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
        _physics_init: cwrap('physics_init', null, ['number', 'number', 'number', 'number']) as PhysicsWasmModule['_physics_init'],
        _physics_shutdown: cwrap('physics_shutdown', null, []) as PhysicsWasmModule['_physics_shutdown'],

        _physics_createBody: cwrap('physics_createBody', null, ['number', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number']) as PhysicsWasmModule['_physics_createBody'],
        _physics_destroyBody: cwrap('physics_destroyBody', null, ['number']) as PhysicsWasmModule['_physics_destroyBody'],
        _physics_hasBody: cwrap('physics_hasBody', 'number', ['number']) as PhysicsWasmModule['_physics_hasBody'],

        _physics_addBoxShape: cwrap('physics_addBoxShape', null, ['number', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number']) as PhysicsWasmModule['_physics_addBoxShape'],
        _physics_addCircleShape: cwrap('physics_addCircleShape', null, ['number', 'number', 'number', 'number', 'number', 'number', 'number', 'number']) as PhysicsWasmModule['_physics_addCircleShape'],
        _physics_addCapsuleShape: cwrap('physics_addCapsuleShape', null, ['number', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number']) as PhysicsWasmModule['_physics_addCapsuleShape'],

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

        get HEAPF32() { return mainModule.HEAPF32; },
        get HEAPU8() { return mainModule.HEAPU8; },
        get HEAPU32() { return mainModule.HEAPU32; },
        _malloc: mainModule._malloc.bind(mainModule),
        _free: mainModule._free.bind(mainModule),
    } as PhysicsWasmModule;
}
