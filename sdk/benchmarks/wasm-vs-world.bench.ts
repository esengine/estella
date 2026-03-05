import { describe, bench, beforeAll } from 'vitest';
import path from 'path';
import { World } from '../src/world';
import { defineBuiltin } from '../src/component';
import type { CppRegistry, ESEngineModule } from '../src/wasm';

let wasmModule: ESEngineModule;

const WASM_DIR = path.resolve(__dirname, '../../desktop/public/wasm');

beforeAll(async () => {
    const jsPath = path.join(WASM_DIR, 'esengine.js');
    const mod = await import(jsPath);
    wasmModule = await mod.default({
        locateFile(p: string) {
            return path.join(WASM_DIR, p);
        },
    });
});

const Transform = defineBuiltin('Transform', {
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    scale: { x: 1, y: 1, z: 1 },
    worldPosition: { x: 0, y: 0, z: 0 },
    worldRotation: { x: 0, y: 0, z: 0, w: 1 },
    worldScale: { x: 1, y: 1, z: 1 },
});

const Sprite = defineBuiltin('Sprite', {
    texture: 0,
    color: { r: 1, g: 1, b: 1, a: 1 },
    size: { x: 100, y: 100 },
    uvOffset: { x: 0, y: 0 },
    uvScale: { x: 1, y: 1 },
    layer: 0,
    flipX: false,
    flipY: false,
    material: 0,
    enabled: true,
});

const Velocity = defineBuiltin('Velocity', {
    linear: { x: 0, y: 0, z: 0 },
    angular: { x: 0, y: 0, z: 0 },
});

const Camera = defineBuiltin('Camera', {
    projectionType: 0,
    fov: 60,
    orthoSize: 5,
    nearPlane: 0.1,
    farPlane: 1000,
    aspectRatio: 0,
    isActive: false,
    priority: 0,
    viewportX: 0,
    viewportY: 0,
    viewportW: 1,
    viewportH: 1,
    clearFlags: 3,
});

const UIRect = defineBuiltin('UIRect', {
    anchorMin: { x: 0.5, y: 0.5 },
    anchorMax: { x: 0.5, y: 0.5 },
    offsetMin: { x: 0, y: 0 },
    offsetMax: { x: 0, y: 0 },
    size: { x: 100, y: 100 },
    pivot: { x: 0.5, y: 0.5 },
});

const RigidBody = defineBuiltin('RigidBody', {
    bodyType: 2,
    gravityScale: 1,
    linearDamping: 0,
    angularDamping: 0,
    fixedRotation: false,
    bullet: false,
    enabled: true,
});

const BoxCollider = defineBuiltin('BoxCollider', {
    halfExtents: { x: 0.5, y: 0.5 },
    offset: { x: 0, y: 0 },
    density: 1,
    friction: 0.3,
    restitution: 0,
    isSensor: false,
    enabled: true,
    categoryBits: 0x0001,
    maskBits: 0xFFFF,
});

const CircleCollider = defineBuiltin('CircleCollider', {
    radius: 0.5,
    offset: { x: 0, y: 0 },
    density: 1,
    friction: 0.3,
    restitution: 0,
    isSensor: false,
    enabled: true,
    categoryBits: 0x0001,
    maskBits: 0xFFFF,
});

const VELOCITY_DATA = {
    linear: { x: 5, y: 0, z: 0 },
    angular: { x: 0, y: 0, z: 1 },
};

const CAMERA_DATA = {
    projectionType: 1,
    fov: 60,
    orthoSize: 5,
    nearPlane: 0.1,
    farPlane: 1000,
    aspectRatio: 1.777,
    isActive: true,
    priority: 0,
    viewportX: 0,
    viewportY: 0,
    viewportW: 1,
    viewportH: 1,
    clearFlags: 3,
};

const UIRECT_DATA = {
    anchorMin: { x: 0, y: 0 },
    anchorMax: { x: 1, y: 1 },
    offsetMin: { x: 10, y: 10 },
    offsetMax: { x: -10, y: -10 },
    size: { x: 200, y: 100 },
    pivot: { x: 0.5, y: 0.5 },
};

const RIGIDBODY_DATA = {
    bodyType: 2,
    gravityScale: 1,
    linearDamping: 0.1,
    angularDamping: 0.05,
    fixedRotation: false,
    bullet: false,
    enabled: true,
};

const BOXCOLLIDER_DATA = {
    halfExtents: { x: 0.5, y: 0.5 },
    offset: { x: 0, y: 0 },
    density: 1,
    friction: 0.3,
    restitution: 0.2,
    isSensor: false,
    enabled: true,
    categoryBits: 0x0001,
    maskBits: 0xFFFF,
};

const CIRCLECOLLIDER_DATA = {
    radius: 0.5,
    offset: { x: 0, y: 0 },
    density: 1,
    friction: 0.3,
    restitution: 0.2,
    isSensor: false,
    enabled: true,
    categoryBits: 0x0001,
    maskBits: 0xFFFF,
};

const TRANSFORM_WASM = {
    position: { x: 1, y: 2, z: 0 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    scale: { x: 1, y: 1, z: 1 },
    worldPosition: { x: 0, y: 0, z: 0 },
    worldRotation: { x: 0, y: 0, z: 0, w: 1 },
    worldScale: { x: 1, y: 1, z: 1 },
};

const SPRITE_SDK = {
    texture: 0,
    color: { r: 1, g: 1, b: 1, a: 1 },
    size: { x: 100, y: 100 },
    uvOffset: { x: 0, y: 0 },
    uvScale: { x: 1, y: 1 },
    layer: 0,
    flipX: false,
    flipY: false,
    material: 0,
    enabled: true,
};

const SPRITE_WASM = {
    texture: 0,
    color: { x: 1, y: 1, z: 1, w: 1 },
    size: { x: 100, y: 100 },
    uvOffset: { x: 0, y: 0 },
    uvScale: { x: 1, y: 1 },
    layer: 0,
    flipX: false,
    flipY: false,
    material: 0,
    enabled: true,
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
        reg.addSprite(e, SPRITE_WASM);
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
        reg.addSprite(e, SPRITE_WASM);
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
            reg.addSprite(e, SPRITE_WASM);
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

describe('Ptr-based getter vs embind - UIRect', () => {
    bench('embind: getUIRect x100', () => {
        const reg = new wasmModule.Registry();
        const e = reg.create();
        (reg as any).addUIRect(e, UIRECT_DATA);
        for (let i = 0; i < 100; i++) (reg as any).getUIRect(e);
        reg.delete();
    });

    bench('ptr-based: resolveGetter(UIRect) x100', () => {
        const world = new World();
        const reg = new wasmModule.Registry();
        world.connectCpp(reg as unknown as CppRegistry, wasmModule);
        const e = world.spawn();
        world.insert(e, UIRect, UIRECT_DATA as any);
        const getter = world.resolveGetter(UIRect)!;
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

describe('World wrapper overhead - full entity lifecycle', () => {
    bench('direct WASM: create + addTransform + addSprite + getTransform + destroy', () => {
        const reg = new wasmModule.Registry();
        for (let i = 0; i < 50; i++) {
            const e = reg.create();
            reg.addTransform(e, TRANSFORM_WASM);
            reg.addSprite(e, SPRITE_WASM);
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
