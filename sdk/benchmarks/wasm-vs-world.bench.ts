// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, bench, beforeAll } from 'vitest';
import { World } from '../src/ecs/world';
import { defineComponent, Transform, Sprite, Camera } from '../src/ecs/component';
import { RigidBody, BoxCollider, CircleCollider } from '../src/physics/PhysicsComponents';
import { convertForWasm } from '../src/ecs/bridge/BuiltinBridge';
import type { CppRegistry, ESEngineModule } from '../src/wasm';
import { loadWasmModule } from '../tests/helpers/loadWasm';

let wasmModule: ESEngineModule;

beforeAll(async () => {
    wasmModule = await loadWasmModule();
});

// The embind payloads are built from the components' own defaults — the same
// source BuiltinBridge inserts from. Hand-written copies of the C++ structs are
// what these used to be, and they had drifted: Camera's four viewport scalars
// became one Vec4 and every case touching it silently measured nothing.
const wasmData = (def: { _default: unknown; colorKeys: readonly string[] }) =>
    convertForWasm({ ...(def._default as Record<string, unknown>) }, def.colorKeys);

// The SDK-side shape (colors as r/g/b/a) is the component's default as authored;
// the wasm one is that run through the same conversion the bridge uses.
const sdkData = (def: { _default: unknown }) => ({ ...(def._default as Record<string, unknown>) });

const SPRITE_SDK = sdkData(Sprite);
const TRANSFORM_DATA = wasmData(Transform);
const SPRITE_DATA = wasmData(Sprite);
const CAMERA_DATA = wasmData(Camera);
const RIGIDBODY_DATA = wasmData(RigidBody);
const BOXCOLLIDER_DATA = wasmData(BoxCollider);
const CIRCLECOLLIDER_DATA = wasmData(CircleCollider);

const Velocity = defineComponent('BenchVelocity', {
    linear: { x: 0, y: 0, z: 0 },
    angular: { x: 0, y: 0, z: 0 },
});

const VELOCITY_DATA = {
    linear: { x: 5, y: 0, z: 0 },
    angular: { x: 0, y: 0, z: 1 },
};

const TRANSFORM_WASM = {
    position: { x: 1, y: 2, z: 0 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    scale: { x: 1, y: 1, z: 1 },
    worldPosition: { x: 0, y: 0, z: 0 },
    worldRotation: { x: 0, y: 0, z: 0, w: 1 },
    worldScale: { x: 1, y: 1, z: 1 },
};

describe('World wrapper vs direct WASM - spawn', () => {
    bench('direct WASM: registry.create()', () => {
        const reg = new wasmModule.Registry();
        for (let i = 0; i < 100; i++) reg.create();
        reg.delete();
    });

    bench('World wrapper: world.spawn()', () => {
        const world = new World();
        const reg = new wasmModule.Registry();
        world.connectCpp(reg as unknown as CppRegistry, wasmModule);
        for (let i = 0; i < 100; i++) world.spawn();
        reg.delete();
    });
});

describe('World wrapper vs direct WASM - has (no color)', () => {
    bench('direct WASM: hasTransform x1000', () => {
        const reg = new wasmModule.Registry();
        const e = reg.create();
        reg.addTransform(e, TRANSFORM_WASM);
        for (let i = 0; i < 1000; i++) reg.hasTransform(e);
        reg.delete();
    });

    bench('World wrapper: world.has(Transform) x1000', () => {
        const world = new World();
        const reg = new wasmModule.Registry();
        world.connectCpp(reg as unknown as CppRegistry, wasmModule);
        const e = world.spawn();
        world.insert(e, Transform, TRANSFORM_WASM as any);
        for (let i = 0; i < 1000; i++) world.has(e, Transform);
        reg.delete();
    });
});

describe('World wrapper vs direct WASM - get (no color)', () => {
    bench('direct WASM: getTransform x100', () => {
        const reg = new wasmModule.Registry();
        const e = reg.create();
        reg.addTransform(e, TRANSFORM_WASM);
        for (let i = 0; i < 100; i++) reg.getTransform(e);
        reg.delete();
    });

    bench('World wrapper: world.get(Transform) x100', () => {
        const world = new World();
        const reg = new wasmModule.Registry();
        world.connectCpp(reg as unknown as CppRegistry, wasmModule);
        const e = world.spawn();
        world.insert(e, Transform, TRANSFORM_WASM as any);
        for (let i = 0; i < 100; i++) world.get(e, Transform);
        reg.delete();
    });
});

describe('World wrapper vs direct WASM - get (with color conversion)', () => {
    bench('direct WASM: getSprite x100 (no conversion)', () => {
        const reg = new wasmModule.Registry();
        const e = reg.create();
        reg.addSprite(e, SPRITE_DATA);
        for (let i = 0; i < 100; i++) reg.getSprite(e);
        reg.delete();
    });

    bench('World wrapper: world.get(Sprite) x100 (color conversion)', () => {
        const world = new World();
        const reg = new wasmModule.Registry();
        world.connectCpp(reg as unknown as CppRegistry, wasmModule);
        const e = world.spawn();
        world.insert(e, Sprite, SPRITE_SDK as any);
        for (let i = 0; i < 100; i++) world.get(e, Sprite);
        reg.delete();
    });
});

describe('World wrapper vs direct WASM - insert', () => {
    bench('direct WASM: addTransform', () => {
        const reg = new wasmModule.Registry();
        const e = reg.create();
        reg.addTransform(e, TRANSFORM_WASM);
        reg.delete();
    });

    bench('World wrapper: world.insert(Transform)', () => {
        const world = new World();
        const reg = new wasmModule.Registry();
        world.connectCpp(reg as unknown as CppRegistry, wasmModule);
        const e = world.spawn();
        world.insert(e, Transform, TRANSFORM_WASM as any);
        reg.delete();
    });
});

describe('World wrapper vs direct WASM - tryGet', () => {
    bench('direct WASM: has+get Transform x100', () => {
        const reg = new wasmModule.Registry();
        const e = reg.create();
        reg.addTransform(e, TRANSFORM_WASM);
        for (let i = 0; i < 100; i++) {
            if (reg.hasTransform(e)) reg.getTransform(e);
        }
        reg.delete();
    });

    bench('World wrapper: world.tryGet(Transform) x100', () => {
        const world = new World();
        const reg = new wasmModule.Registry();
        world.connectCpp(reg as unknown as CppRegistry, wasmModule);
        const e = world.spawn();
        world.insert(e, Transform, TRANSFORM_WASM as any);
        for (let i = 0; i < 100; i++) world.tryGet(e, Transform);
        reg.delete();
    });
});

describe('World wrapper vs direct WASM - pre-resolved getter', () => {
    bench('direct WASM: getTransform x100', () => {
        const reg = new wasmModule.Registry();
        const e = reg.create();
        reg.addTransform(e, TRANSFORM_WASM);
        for (let i = 0; i < 100; i++) reg.getTransform(e);
        reg.delete();
    });

    bench('World pre-resolved getter: x100', () => {
        const world = new World();
        const reg = new wasmModule.Registry();
        world.connectCpp(reg as unknown as CppRegistry, wasmModule);
        const e = world.spawn();
        world.insert(e, Transform, TRANSFORM_WASM as any);
        const getter = world.resolveGetter(Transform)!;
        for (let i = 0; i < 100; i++) getter(e);
        reg.delete();
    });
});

describe('Ptr-based getter vs embind getter - Transform', () => {
    bench('embind: getTransform x100', () => {
        const reg = new wasmModule.Registry();
        const e = reg.create();
        reg.addTransform(e, TRANSFORM_WASM);
        for (let i = 0; i < 100; i++) reg.getTransform(e);
        reg.delete();
    });

    bench('ptr-based: resolveGetter(Transform) x100', () => {
        const world = new World();
        const reg = new wasmModule.Registry();
        world.connectCpp(reg as unknown as CppRegistry, wasmModule);
        const e = world.spawn();
        world.insert(e, Transform, TRANSFORM_WASM as any);
        const getter = world.resolveGetter(Transform)!;
        for (let i = 0; i < 100; i++) getter(e);
        reg.delete();
    });
});

describe('Ptr-based getter vs embind getter - Sprite', () => {
    bench('embind: getSprite x100', () => {
        const reg = new wasmModule.Registry();
        const e = reg.create();
        reg.addSprite(e, SPRITE_DATA);
        for (let i = 0; i < 100; i++) reg.getSprite(e);
        reg.delete();
    });

    bench('ptr-based: resolveGetter(Sprite) x100', () => {
        const world = new World();
        const reg = new wasmModule.Registry();
        world.connectCpp(reg as unknown as CppRegistry, wasmModule);
        const e = world.spawn();
        world.insert(e, Sprite, SPRITE_SDK as any);
        const getter = world.resolveGetter(Sprite)!;
        for (let i = 0; i < 100; i++) getter(e);
        reg.delete();
    });
});

describe('Ptr-based multi-entity query - Transform + Sprite', () => {
    bench('embind: 100 entities x get Transform+Sprite', () => {
        const reg = new wasmModule.Registry();
        const entities: number[] = [];
        for (let i = 0; i < 100; i++) {
            const e = reg.create();
            reg.addTransform(e, TRANSFORM_WASM);
            reg.addSprite(e, SPRITE_DATA);
            entities.push(e);
        }
        for (const e of entities) {
            reg.getTransform(e);
            reg.getSprite(e);
        }
        reg.delete();
    });

    bench('ptr-based: 100 entities x resolveGetter Transform+Sprite', () => {
        const world = new World();
        const reg = new wasmModule.Registry();
        world.connectCpp(reg as unknown as CppRegistry, wasmModule);
        const entities: number[] = [];
        for (let i = 0; i < 100; i++) {
            const e = world.spawn();
            world.insert(e, Transform, TRANSFORM_WASM as any);
            world.insert(e, Sprite, SPRITE_SDK as any);
            entities.push(e);
        }
        const getT = world.resolveGetter(Transform)!;
        const getS = world.resolveGetter(Sprite)!;
        for (const e of entities) {
            getT(e);
            getS(e);
        }
        reg.delete();
    });
});

describe('Ptr-based getter vs embind - Velocity', () => {
    bench('embind: getVelocity x100', () => {
        const reg = new wasmModule.Registry();
        const e = reg.create();
        (reg as any).addVelocity(e, VELOCITY_DATA);
        for (let i = 0; i < 100; i++) (reg as any).getVelocity(e);
        reg.delete();
    });

    bench('ptr-based: resolveGetter(Velocity) x100', () => {
        const world = new World();
        const reg = new wasmModule.Registry();
        world.connectCpp(reg as unknown as CppRegistry, wasmModule);
        const e = world.spawn();
        world.insert(e, Velocity, VELOCITY_DATA as any);
        const getter = world.resolveGetter(Velocity)!;
        for (let i = 0; i < 100; i++) getter(e);
        reg.delete();
    });
});

describe('Ptr-based getter vs embind - Camera', () => {
    bench('embind: getCamera x100', () => {
        const reg = new wasmModule.Registry();
        const e = reg.create();
        (reg as any).addCamera(e, CAMERA_DATA);
        for (let i = 0; i < 100; i++) (reg as any).getCamera(e);
        reg.delete();
    });

    bench('ptr-based: resolveGetter(Camera) x100', () => {
        const world = new World();
        const reg = new wasmModule.Registry();
        world.connectCpp(reg as unknown as CppRegistry, wasmModule);
        const e = world.spawn();
        world.insert(e, Camera, CAMERA_DATA as any);
        const getter = world.resolveGetter(Camera)!;
        for (let i = 0; i < 100; i++) getter(e);
        reg.delete();
    });
});

describe('Ptr-based getter vs embind - RigidBody', () => {
    bench('embind: getRigidBody x100', () => {
        const reg = new wasmModule.Registry();
        const e = reg.create();
        (reg as any).addRigidBody(e, RIGIDBODY_DATA);
        for (let i = 0; i < 100; i++) (reg as any).getRigidBody(e);
        reg.delete();
    });

    bench('ptr-based: resolveGetter(RigidBody) x100', () => {
        const world = new World();
        const reg = new wasmModule.Registry();
        world.connectCpp(reg as unknown as CppRegistry, wasmModule);
        const e = world.spawn();
        world.insert(e, RigidBody, RIGIDBODY_DATA as any);
        const getter = world.resolveGetter(RigidBody)!;
        for (let i = 0; i < 100; i++) getter(e);
        reg.delete();
    });
});

describe('Ptr-based getter vs embind - BoxCollider', () => {
    bench('embind: getBoxCollider x100', () => {
        const reg = new wasmModule.Registry();
        const e = reg.create();
        (reg as any).addBoxCollider(e, BOXCOLLIDER_DATA);
        for (let i = 0; i < 100; i++) (reg as any).getBoxCollider(e);
        reg.delete();
    });

    bench('ptr-based: resolveGetter(BoxCollider) x100', () => {
        const world = new World();
        const reg = new wasmModule.Registry();
        world.connectCpp(reg as unknown as CppRegistry, wasmModule);
        const e = world.spawn();
        world.insert(e, BoxCollider, BOXCOLLIDER_DATA as any);
        const getter = world.resolveGetter(BoxCollider)!;
        for (let i = 0; i < 100; i++) getter(e);
        reg.delete();
    });
});

describe('Ptr-based getter vs embind - CircleCollider', () => {
    bench('embind: getCircleCollider x100', () => {
        const reg = new wasmModule.Registry();
        const e = reg.create();
        (reg as any).addCircleCollider(e, CIRCLECOLLIDER_DATA);
        for (let i = 0; i < 100; i++) (reg as any).getCircleCollider(e);
        reg.delete();
    });

    bench('ptr-based: resolveGetter(CircleCollider) x100', () => {
        const world = new World();
        const reg = new wasmModule.Registry();
        world.connectCpp(reg as unknown as CppRegistry, wasmModule);
        const e = world.spawn();
        world.insert(e, CircleCollider, CIRCLECOLLIDER_DATA as any);
        const getter = world.resolveGetter(CircleCollider)!;
        for (let i = 0; i < 100; i++) getter(e);
        reg.delete();
    });
});

// =============================================================================
// Ptr-based SET (write) benchmarks
// =============================================================================

describe('Ptr-based setter vs embind - Transform write', () => {
    bench('embind: addTransform (set) x100', () => {
        const reg = new wasmModule.Registry();
        const e = reg.create();
        reg.addTransform(e, TRANSFORM_WASM);
        for (let i = 0; i < 100; i++) reg.addTransform(e, TRANSFORM_WASM);
        reg.delete();
    });

    bench('ptr-based: resolveSetter(Transform) x100', () => {
        const world = new World();
        const reg = new wasmModule.Registry();
        world.connectCpp(reg as unknown as CppRegistry, wasmModule);
        const e = world.spawn();
        world.insert(e, Transform, TRANSFORM_WASM as any);
        const setter = world.resolveSetter(Transform)!;
        for (let i = 0; i < 100; i++) setter(e, TRANSFORM_WASM);
        reg.delete();
    });
});

describe('Ptr-based setter vs embind - Sprite write', () => {
    bench('embind: addSprite (set) x100', () => {
        const reg = new wasmModule.Registry();
        const e = reg.create();
        reg.addSprite(e, SPRITE_DATA);
        for (let i = 0; i < 100; i++) reg.addSprite(e, SPRITE_DATA);
        reg.delete();
    });

    bench('ptr-based: resolveSetter(Sprite) x100', () => {
        const world = new World();
        const reg = new wasmModule.Registry();
        world.connectCpp(reg as unknown as CppRegistry, wasmModule);
        const e = world.spawn();
        world.insert(e, Sprite, SPRITE_SDK as any);
        const setter = world.resolveSetter(Sprite)!;
        for (let i = 0; i < 100; i++) setter(e, SPRITE_SDK);
        reg.delete();
    });
});

describe('Ptr-based setter vs embind - Velocity write', () => {
    bench('embind: addVelocity (set) x100', () => {
        const reg = new wasmModule.Registry();
        const e = reg.create();
        (reg as any).addVelocity(e, VELOCITY_DATA);
        for (let i = 0; i < 100; i++) (reg as any).addVelocity(e, VELOCITY_DATA);
        reg.delete();
    });

    bench('ptr-based: resolveSetter(Velocity) x100', () => {
        const world = new World();
        const reg = new wasmModule.Registry();
        world.connectCpp(reg as unknown as CppRegistry, wasmModule);
        const e = world.spawn();
        world.insert(e, Velocity, VELOCITY_DATA as any);
        const setter = world.resolveSetter(Velocity)!;
        for (let i = 0; i < 100; i++) setter(e, VELOCITY_DATA);
        reg.delete();
    });
});

describe('Ptr-based setter vs embind - RigidBody write', () => {
    bench('embind: addRigidBody (set) x100', () => {
        const reg = new wasmModule.Registry();
        const e = reg.create();
        (reg as any).addRigidBody(e, RIGIDBODY_DATA);
        for (let i = 0; i < 100; i++) (reg as any).addRigidBody(e, RIGIDBODY_DATA);
        reg.delete();
    });

    bench('ptr-based: resolveSetter(RigidBody) x100', () => {
        const world = new World();
        const reg = new wasmModule.Registry();
        world.connectCpp(reg as unknown as CppRegistry, wasmModule);
        const e = world.spawn();
        world.insert(e, RigidBody, RIGIDBODY_DATA as any);
        const setter = world.resolveSetter(RigidBody)!;
        for (let i = 0; i < 100; i++) setter(e, RIGIDBODY_DATA);
        reg.delete();
    });
});

// =============================================================================
// Ptr-based HAS benchmarks
// =============================================================================

describe('Ptr-based has vs embind - Transform', () => {
    bench('embind: hasTransform x1000', () => {
        const reg = new wasmModule.Registry();
        const e = reg.create();
        reg.addTransform(e, TRANSFORM_WASM);
        for (let i = 0; i < 1000; i++) reg.hasTransform(e);
        reg.delete();
    });

    bench('ptr-based: resolveHas(Transform) x1000', () => {
        const world = new World();
        const reg = new wasmModule.Registry();
        world.connectCpp(reg as unknown as CppRegistry, wasmModule);
        const e = world.spawn();
        world.insert(e, Transform, TRANSFORM_WASM as any);
        const has = world.resolveHas(Transform)!;
        for (let i = 0; i < 1000; i++) has(e);
        reg.delete();
    });
});

describe('Ptr-based has vs embind - Sprite', () => {
    bench('embind: hasSprite x1000', () => {
        const reg = new wasmModule.Registry();
        const e = reg.create();
        reg.addSprite(e, SPRITE_DATA);
        for (let i = 0; i < 1000; i++) reg.hasSprite(e);
        reg.delete();
    });

    bench('ptr-based: resolveHas(Sprite) x1000', () => {
        const world = new World();
        const reg = new wasmModule.Registry();
        world.connectCpp(reg as unknown as CppRegistry, wasmModule);
        const e = world.spawn();
        world.insert(e, Sprite, SPRITE_SDK as any);
        const has = world.resolveHas(Sprite)!;
        for (let i = 0; i < 1000; i++) has(e);
        reg.delete();
    });
});

// =============================================================================
// Full Mut query cycle: read + modify + write-back
// =============================================================================

describe('Mut query write-back: embind vs ptr-based', () => {
    bench('embind: get+set Transform x100', () => {
        const reg = new wasmModule.Registry();
        const e = reg.create();
        reg.addTransform(e, TRANSFORM_WASM);
        for (let i = 0; i < 100; i++) {
            const t = reg.getTransform(e);
            t.position.x += 1;
            reg.addTransform(e, t);
        }
        reg.delete();
    });

    bench('ptr-based: get+set Transform x100', () => {
        const world = new World();
        const reg = new wasmModule.Registry();
        world.connectCpp(reg as unknown as CppRegistry, wasmModule);
        const e = world.spawn();
        world.insert(e, Transform, TRANSFORM_WASM as any);
        const getter = world.resolveGetter(Transform)!;
        const setter = world.resolveSetter(Transform)!;
        for (let i = 0; i < 100; i++) {
            const t = getter(e) as any;
            t.position.x += 1;
            setter(e, t);
        }
        reg.delete();
    });
});

describe('World wrapper overhead - full entity lifecycle', () => {
    bench('direct WASM: create + addTransform + addSprite + getTransform + destroy', () => {
        const reg = new wasmModule.Registry();
        for (let i = 0; i < 50; i++) {
            const e = reg.create();
            reg.addTransform(e, TRANSFORM_WASM);
            reg.addSprite(e, SPRITE_DATA);
            reg.getTransform(e);
            reg.getSprite(e);
            reg.destroy(e);
        }
        reg.delete();
    });

    bench('World wrapper: spawn + insert x2 + get x2 + despawn', () => {
        const world = new World();
        const reg = new wasmModule.Registry();
        world.connectCpp(reg as unknown as CppRegistry, wasmModule);
        for (let i = 0; i < 50; i++) {
            const e = world.spawn();
            world.insert(e, Transform, TRANSFORM_WASM as any);
            world.insert(e, Sprite, SPRITE_SDK as any);
            world.get(e, Transform);
            world.get(e, Sprite);
            world.despawn(e);
        }
        reg.delete();
    });
});
