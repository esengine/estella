import { describe, bench, beforeAll } from 'vitest';
import path from 'path';
import { World } from '../src/world';
import { defineBuiltin } from '../src/component';
import type { CppRegistry, ESEngineModule } from '../src/wasm';
import type { PhysicsWasmModule } from '../src/physics/PhysicsModuleLoader';
import { syncDynamicTransforms } from '../src/physics/PhysicsSystem';
import type { Entity } from '../src/types';

let wasmModule: ESEngineModule;
let physicsMod: PhysicsWasmModule;

const WASM_DIR = path.resolve(__dirname, '../../desktop/public/wasm');

beforeAll(async () => {
    const engineJs = path.join(WASM_DIR, 'esengine.js');
    const engineMod = await import(engineJs);
    wasmModule = await engineMod.default({
        locateFile(p: string) { return path.join(WASM_DIR, p); },
    });

    const physicsJs = path.join(WASM_DIR, 'physics.js');
    const physicsFn = await import(physicsJs);
    physicsMod = await physicsFn.default({
        locateFile(p: string) { return path.join(WASM_DIR, p); },
    }) as PhysicsWasmModule;
    physicsMod._physics_init(0, -9.81, 1 / 30, 4, 30, 10, 3);
});

const Transform = defineBuiltin('Transform', {
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    scale: { x: 1, y: 1, z: 1 },
    worldPosition: { x: 0, y: 0, z: 0 },
    worldRotation: { x: 0, y: 0, z: 0, w: 1 },
    worldScale: { x: 1, y: 1, z: 1 },
});

const RigidBody = defineBuiltin('RigidBody', {
    bodyType: 2, gravityScale: 1, linearDamping: 0, angularDamping: 0,
    fixedRotation: false, bullet: false, enabled: true,
});

const PPU = 100;
const INV_PPU = 1 / PPU;

const TRANSFORM_DATA = {
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    scale: { x: 1, y: 1, z: 1 },
    worldPosition: { x: 0, y: 0, z: 0 },
    worldRotation: { x: 0, y: 0, z: 0, w: 1 },
    worldScale: { x: 1, y: 1, z: 1 },
};

const RIGIDBODY_DATA = {
    bodyType: 2, gravityScale: 1, linearDamping: 0.1, angularDamping: 0.05,
    fixedRotation: false, bullet: false, enabled: true,
};

function createBodies(count: number, reg: CppRegistry) {
    const ids: number[] = [];
    for (let i = 0; i < count; i++) {
        const e = reg.create!();
        (reg as any).addTransform(e, TRANSFORM_DATA);
        physicsMod._physics_createBody(e, 2, i * 0.5 * INV_PPU, i * 0.3 * INV_PPU, 0, 1, 0, 0, 0, 0);
        physicsMod._physics_addBoxShape(e, 0.5, 0.5, 0, 0, 0.05, 1, 0.3, 0, 0, 0x0001, 0xFFFF);
        ids.push(e as number);
    }
    return ids;
}

function destroyBodies(ids: number[]) {
    for (const e of ids) physicsMod._physics_destroyBody(e);
}

// =============================================================================
// _physics_step — Box2D simulation cost
// =============================================================================

describe('Physics - _physics_step (Box2D simulation)', () => {
    bench('step (0 bodies)', () => {
        physicsMod._physics_step(1 / 60);
    });

    bench('step (50 bodies)', () => {
        const reg = new wasmModule.Registry();
        const ids = createBodies(50, reg as unknown as CppRegistry);
        physicsMod._physics_step(1 / 60);
        destroyBodies(ids);
        reg.delete();
    });

    bench('step (200 bodies)', () => {
        const reg = new wasmModule.Registry();
        const ids = createBodies(200, reg as unknown as CppRegistry);
        physicsMod._physics_step(1 / 60);
        destroyBodies(ids);
        reg.delete();
    });

    bench('step (500 bodies)', () => {
        const reg = new wasmModule.Registry();
        const ids = createBodies(500, reg as unknown as CppRegistry);
        physicsMod._physics_step(1 / 60);
        destroyBodies(ids);
        reg.delete();
    });
});

// =============================================================================
// syncDynamicTransforms — read from physics, write to ECS
// =============================================================================

describe('Physics - syncDynamicTransforms', () => {
    bench('50 bodies', () => {
        const reg = new wasmModule.Registry();
        const ids = createBodies(50, reg as unknown as CppRegistry);
        physicsMod._physics_step(1 / 60);
        const world = new World();
        world.connectCpp(reg as unknown as CppRegistry, wasmModule);
        syncDynamicTransforms({ world } as any, physicsMod, PPU, new Set());
        destroyBodies(ids);
        reg.delete();
    });

    bench('200 bodies', () => {
        const reg = new wasmModule.Registry();
        const ids = createBodies(200, reg as unknown as CppRegistry);
        physicsMod._physics_step(1 / 60);
        const world = new World();
        world.connectCpp(reg as unknown as CppRegistry, wasmModule);
        syncDynamicTransforms({ world } as any, physicsMod, PPU, new Set());
        destroyBodies(ids);
        reg.delete();
    });

    bench('500 bodies', () => {
        const reg = new wasmModule.Registry();
        const ids = createBodies(500, reg as unknown as CppRegistry);
        physicsMod._physics_step(1 / 60);
        const world = new World();
        world.connectCpp(reg as unknown as CppRegistry, wasmModule);
        syncDynamicTransforms({ world } as any, physicsMod, PPU, new Set());
        destroyBodies(ids);
        reg.delete();
    });
});

// =============================================================================
// Body creation cost
// =============================================================================

describe('Physics - body creation (createBody + addBoxShape)', () => {
    bench('create + shape x50', () => {
        const reg = new wasmModule.Registry();
        const ids: number[] = [];
        for (let i = 0; i < 50; i++) {
            const e = (reg as any).create();
            physicsMod._physics_createBody(e, 2, i * INV_PPU, 0, 0, 1, 0, 0, 0, 0);
            physicsMod._physics_addBoxShape(e, 0.5, 0.5, 0, 0, 0.05, 1, 0.3, 0, 0, 0x0001, 0xFFFF);
            ids.push(e);
        }
        for (const e of ids) physicsMod._physics_destroyBody(e);
        reg.delete();
    });

    bench('create + shape x200', () => {
        const reg = new wasmModule.Registry();
        const ids: number[] = [];
        for (let i = 0; i < 200; i++) {
            const e = (reg as any).create();
            physicsMod._physics_createBody(e, 2, i * INV_PPU, 0, 0, 1, 0, 0, 0, 0);
            physicsMod._physics_addBoxShape(e, 0.5, 0.5, 0, 0, 0.05, 1, 0.3, 0, 0, 0x0001, 0xFFFF);
            ids.push(e);
        }
        for (const e of ids) physicsMod._physics_destroyBody(e);
        reg.delete();
    });
});

// =============================================================================
// collectEvents
// =============================================================================

describe('Physics - collectEvents', () => {
    bench('collectEvents (0 collisions)', () => {
        physicsMod._physics_collectEvents();
        physicsMod._physics_getCollisionEnterCount();
        physicsMod._physics_getCollisionExitCount();
        physicsMod._physics_getSensorEnterCount();
        physicsMod._physics_getSensorExitCount();
    });

    bench('step + collectEvents (50 stacked bodies)', () => {
        const reg = new wasmModule.Registry();
        const ids: number[] = [];
        for (let i = 0; i < 50; i++) {
            const e = (reg as any).create();
            physicsMod._physics_createBody(e, 2, 0, i * 1.1, 0, 1, 0, 0, 0, 0);
            physicsMod._physics_addBoxShape(e, 0.5, 0.5, 0, 0, 0, 1, 0.3, 0.1, 0, 0x0001, 0xFFFF);
            ids.push(e);
        }
        physicsMod._physics_step(1 / 60);
        physicsMod._physics_collectEvents();
        const enterCount = physicsMod._physics_getCollisionEnterCount();
        if (enterCount > 0) {
            const enterPtr = physicsMod._physics_getCollisionEnterBuffer() >> 2;
            for (let i = 0; i < enterCount; i++) {
                const base = enterPtr + i * 6;
                const _a = physicsMod.HEAPU32[base];
                const _b = physicsMod.HEAPU32[base + 1];
            }
        }
        for (const e of ids) physicsMod._physics_destroyBody(e);
        reg.delete();
    });
});

// =============================================================================
// Full physics frame — step + sync + events
// =============================================================================

describe('Physics - full frame (step + sync + events)', () => {
    bench('50 bodies', () => {
        const reg = new wasmModule.Registry();
        const ids = createBodies(50, reg as unknown as CppRegistry);
        const world = new World();
        world.connectCpp(reg as unknown as CppRegistry, wasmModule);
        physicsMod._physics_step(1 / 60);
        syncDynamicTransforms({ world } as any, physicsMod, PPU, new Set());
        physicsMod._physics_collectEvents();
        destroyBodies(ids);
        reg.delete();
    });

    bench('200 bodies', () => {
        const reg = new wasmModule.Registry();
        const ids = createBodies(200, reg as unknown as CppRegistry);
        const world = new World();
        world.connectCpp(reg as unknown as CppRegistry, wasmModule);
        physicsMod._physics_step(1 / 60);
        syncDynamicTransforms({ world } as any, physicsMod, PPU, new Set());
        physicsMod._physics_collectEvents();
        destroyBodies(ids);
        reg.delete();
    });

    bench('500 bodies', () => {
        const reg = new wasmModule.Registry();
        const ids = createBodies(500, reg as unknown as CppRegistry);
        const world = new World();
        world.connectCpp(reg as unknown as CppRegistry, wasmModule);
        physicsMod._physics_step(1 / 60);
        syncDynamicTransforms({ world } as any, physicsMod, PPU, new Set());
        physicsMod._physics_collectEvents();
        destroyBodies(ids);
        reg.delete();
    });
});

// =============================================================================
// addTransform writeback isolation (embind vs ptr)
// =============================================================================

describe('Physics - addTransform writeback (embind vs ptr)', () => {
    bench('registry.addTransform x200 (embind)', () => {
        const reg = new wasmModule.Registry();
        const entities: number[] = [];
        for (let i = 0; i < 200; i++) {
            const e = (reg as any).create();
            (reg as any).addTransform(e, TRANSFORM_DATA);
            entities.push(e);
        }
        for (const e of entities) (reg as any).addTransform(e, TRANSFORM_DATA);
        reg.delete();
    });

    bench('ptr setter x200 (resolvedSetter)', () => {
        const world = new World();
        const reg = new wasmModule.Registry();
        world.connectCpp(reg as unknown as CppRegistry, wasmModule);
        const entities: Entity[] = [];
        for (let i = 0; i < 200; i++) {
            const e = world.spawn();
            world.insert(e, Transform, TRANSFORM_DATA as any);
            entities.push(e);
        }
        const setter = world.resolveSetter(Transform)!;
        for (const e of entities) setter(e, TRANSFORM_DATA);
        reg.delete();
    });
});

// =============================================================================
// Entity query overhead
// =============================================================================

describe('Physics - entity sync query', () => {
    bench('getEntitiesWithComponents([RigidBody, Transform]) x10 (200 entities)', () => {
        const world = new World();
        const reg = new wasmModule.Registry();
        world.connectCpp(reg as unknown as CppRegistry, wasmModule);
        for (let i = 0; i < 200; i++) {
            const e = world.spawn();
            world.insert(e, Transform, TRANSFORM_DATA as any);
            world.insert(e, RigidBody, RIGIDBODY_DATA as any);
        }
        for (let i = 0; i < 10; i++) {
            world.getEntitiesWithComponents([RigidBody, Transform]);
        }
        reg.delete();
    });
});

// =============================================================================
// syncDynamicTransforms — isolated batch vs embind comparison
// =============================================================================

describe('Physics - syncDynamicTransforms (batch vs embind)', () => {
    let reg: CppRegistry;
    let worldBatch: World;
    let worldEmbind: World;

    function ensureSetup() {
        if (reg) return;
        reg = new wasmModule.Registry() as unknown as CppRegistry;
        createBodies(200, reg);
        physicsMod._physics_step(1 / 60);
        worldBatch = new World();
        worldBatch.connectCpp(reg, wasmModule);
        worldEmbind = new World();
        worldEmbind.connectCpp(reg);
    }

    bench('batch sync (200 bodies)', () => {
        ensureSetup();
        syncDynamicTransforms({ world: worldBatch } as any, physicsMod, PPU, new Set());
    });

    bench('embind sync (200 bodies)', () => {
        ensureSetup();
        syncDynamicTransforms({ world: worldEmbind } as any, physicsMod, PPU, new Set());
    });
});

// =============================================================================
// _physics_step — isolated: sleeping vs active bodies
// =============================================================================

describe('Physics - step cost: sleeping vs active (200 bodies)', () => {
    let sleepReg: CppRegistry | null = null;
    let sleepIds: number[] = [];
    let activeReg: CppRegistry | null = null;
    let activeIds: number[] = [];

    function ensureSleepSetup() {
        if (sleepReg) return;
        physicsMod._physics_shutdown();
        physicsMod._physics_init(0, -9.81, 1 / 60, 4, 30, 10, 3);
        sleepReg = new wasmModule.Registry() as unknown as CppRegistry;
        sleepIds = createBodies(200, sleepReg);
        for (let i = 0; i < 120; i++) physicsMod._physics_step(1 / 60);
    }

    function ensureActiveSetup() {
        if (activeReg) return;
        physicsMod._physics_shutdown();
        physicsMod._physics_init(0, -9.81, 1 / 60, 4, 30, 10, 3);
        activeReg = new wasmModule.Registry() as unknown as CppRegistry;
        activeIds = [];
        for (let i = 0; i < 200; i++) {
            const e = (activeReg as any).create();
            (activeReg as any).addTransform(e, TRANSFORM_DATA);
            physicsMod._physics_createBody(e, 2, (i % 20) * 0.5 * INV_PPU, Math.floor(i / 20) * 0.6 * INV_PPU, 0, 1, 0, 0, 0, 0);
            physicsMod._physics_addBoxShape(e, 0.25, 0.25, 0, 0, 0.02, 1, 0.3, 0.1, 0, 0x0001, 0xFFFF);
            activeIds.push(e);
        }
        physicsMod._physics_step(1 / 60);
    }

    bench('sleeping bodies (settled)', () => {
        ensureSleepSetup();
        physicsMod._physics_step(1 / 60);
    });

    bench('active bodies (perturbed each frame)', () => {
        ensureActiveSetup();
        for (let i = 0; i < activeIds.length; i += 10) {
            physicsMod._physics_setLinearVelocity(activeIds[i], (i % 3 - 1) * 0.5, 2);
        }
        physicsMod._physics_step(1 / 60);
    });
});

// =============================================================================
// _physics_step — subStepCount tuning (active bodies)
// =============================================================================

describe('Physics - step tuning: subStepCount (200 active bodies)', () => {
    let setupDone = false;
    let bodyIds: number[] = [];
    let curSubSteps = -1;

    function setupForSubSteps(subSteps: number) {
        if (curSubSteps === subSteps) return;
        physicsMod._physics_shutdown();
        physicsMod._physics_init(0, -9.81, 1 / 60, subSteps, 30, 10, 3);
        const reg = new wasmModule.Registry() as unknown as CppRegistry;
        bodyIds = [];
        for (let i = 0; i < 200; i++) {
            const e = (reg as any).create();
            (reg as any).addTransform(e, TRANSFORM_DATA);
            physicsMod._physics_createBody(e, 2, (i % 20) * 0.5 * INV_PPU, Math.floor(i / 20) * 0.6 * INV_PPU, 0, 1, 0, 0, 0, 0);
            physicsMod._physics_addBoxShape(e, 0.25, 0.25, 0, 0, 0.02, 1, 0.3, 0.1, 0, 0x0001, 0xFFFF);
            bodyIds.push(e);
        }
        physicsMod._physics_step(1 / 60);
        curSubSteps = subSteps;
    }

    function perturbAndStep() {
        for (let i = 0; i < bodyIds.length; i += 10) {
            physicsMod._physics_setLinearVelocity(bodyIds[i], (i % 3 - 1) * 0.5, 2);
        }
        physicsMod._physics_step(1 / 60);
    }

    bench('subSteps=1', () => { setupForSubSteps(1); perturbAndStep(); });
    bench('subSteps=2', () => { setupForSubSteps(2); perturbAndStep(); });
    bench('subSteps=4 (default)', () => { setupForSubSteps(4); perturbAndStep(); });
});

// =============================================================================
// Full physics frame — isolated (step + batch sync + events)
// =============================================================================

describe('Physics - full frame isolated (200 active bodies)', () => {
    let reg: CppRegistry;
    let world: World;
    let bodyIds: number[];
    let ready = false;

    function ensureSetup() {
        if (ready) return;
        physicsMod._physics_shutdown();
        physicsMod._physics_init(0, -9.81, 1 / 60, 4, 30, 10, 3);
        reg = new wasmModule.Registry() as unknown as CppRegistry;
        bodyIds = [];
        for (let i = 0; i < 200; i++) {
            const e = (reg as any).create();
            (reg as any).addTransform(e, TRANSFORM_DATA);
            physicsMod._physics_createBody(e, 2, (i % 20) * 0.5 * INV_PPU, Math.floor(i / 20) * 0.6 * INV_PPU, 0, 1, 0, 0, 0, 0);
            physicsMod._physics_addBoxShape(e, 0.25, 0.25, 0, 0, 0.02, 1, 0.3, 0.1, 0, 0x0001, 0xFFFF);
            bodyIds.push(e);
        }
        world = new World();
        world.connectCpp(reg, wasmModule);
        physicsMod._physics_step(1 / 60);
        ready = true;
    }

    bench('full frame (step + sync + events)', () => {
        ensureSetup();
        for (let i = 0; i < bodyIds.length; i += 10) {
            physicsMod._physics_setLinearVelocity(bodyIds[i], (i % 3 - 1) * 0.5, 2);
        }
        physicsMod._physics_step(1 / 60);
        syncDynamicTransforms({ world } as any, physicsMod, PPU, new Set());
        physicsMod._physics_collectEvents();
    });
});

// =============================================================================
// Trig cost baseline
// =============================================================================

describe('Physics - trig overhead (per-body math)', () => {
    bench('Math.cos + Math.sin x500 (angle→quat)', () => {
        let sumW = 0, sumZ = 0;
        for (let i = 0; i < 500; i++) {
            const half = i * 0.005;
            sumW += Math.cos(half);
            sumZ += Math.sin(half);
        }
        if (sumW + sumZ === -Infinity) throw new Error();
    });

    bench('Math.atan2 x500 (quat→angle)', () => {
        let sum = 0;
        for (let i = 0; i < 500; i++) {
            const w = Math.cos(i * 0.005);
            const z = Math.sin(i * 0.005);
            sum += Math.atan2(2 * w * z, 1 - 2 * z * z);
        }
        if (sum === -Infinity) throw new Error();
    });
});
