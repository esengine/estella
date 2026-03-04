import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Entity } from '../src/types';
import type { PhysicsWasmModule } from '../src/physics/PhysicsModuleLoader';
import type { TransformData, ParentData } from '../src/component';
import { Transform, Parent } from '../src/component';
import { syncDynamicTransforms } from '../src/physics/PhysicsPlugin';
import { createMockModule } from './mocks/wasm';
import { World } from '../src/world';

// =============================================================================
// Helpers
// =============================================================================

function buildPhysicsBuffer(bodies: Array<{ entity: number; x: number; y: number; angle: number }>): {
    buffer: ArrayBuffer;
    HEAPF32: Float32Array;
    HEAPU32: Uint32Array;
    ptr: number;
    count: number;
} {
    const count = bodies.length;
    const byteLength = count * 4 * 4;
    const ptr = 256;
    const totalBytes = ptr + byteLength;
    const buffer = new ArrayBuffer(totalBytes);
    const f32 = new Float32Array(buffer);
    const u32 = new Uint32Array(buffer);

    for (let i = 0; i < count; i++) {
        const base = (ptr >> 2) + i * 4;
        u32[base] = bodies[i].entity;
        f32[base + 1] = bodies[i].x;
        f32[base + 2] = bodies[i].y;
        f32[base + 3] = bodies[i].angle;
    }

    return { buffer, HEAPF32: f32, HEAPU32: u32, ptr, count };
}

function createMockPhysicsModule(buf: ReturnType<typeof buildPhysicsBuffer>): PhysicsWasmModule {
    return {
        _physics_getDynamicBodyCount: () => buf.count,
        _physics_getDynamicBodyTransforms: () => buf.ptr,
        HEAPF32: buf.HEAPF32,
        HEAPU32: buf.HEAPU32,
        HEAPU8: new Uint8Array(buf.buffer),
        _malloc: vi.fn(),
        _free: vi.fn(),
    } as unknown as PhysicsWasmModule;
}

function defaultTransform(): TransformData {
    return {
        position: { x: 0, y: 0, z: 0 },
        rotation: { w: 1, x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        worldPosition: { x: 0, y: 0, z: 0 },
        worldRotation: { w: 1, x: 0, y: 0, z: 0 },
        worldScale: { x: 1, y: 1, z: 1 },
    } as TransformData;
}

function createTestApp() {
    const mod = createMockModule();
    const world = new World();
    world.connectCpp(mod.getRegistry(), mod);
    return {
        world,
        wasmModule: mod,
        get physicsModule() { return null; },
    } as any;
}

// =============================================================================
// Tests
// =============================================================================

describe('syncDynamicTransforms', () => {
    const PPU = 100;

    it('should update position from physics coordinates (× PPU)', () => {
        const app = createTestApp();
        const e1 = app.world.spawn();
        app.world.insert(e1, Transform, defaultTransform());

        const buf = buildPhysicsBuffer([
            { entity: e1 as number, x: 3.5, y: 7.2, angle: 0 },
        ]);
        const physMod = createMockPhysicsModule(buf);
        const parentedBodies = new Set<Entity>();

        syncDynamicTransforms(app, physMod, PPU, parentedBodies);

        const t = app.world.get(e1, Transform) as TransformData;
        expect(t.position.x).toBeCloseTo(350);
        expect(t.position.y).toBeCloseTo(720);
    });

    it('should update rotation quaternion from physics angle', () => {
        const app = createTestApp();
        const e1 = app.world.spawn();
        app.world.insert(e1, Transform, defaultTransform());

        const angle = Math.PI / 4;
        const buf = buildPhysicsBuffer([
            { entity: e1 as number, x: 0, y: 0, angle },
        ]);
        const physMod = createMockPhysicsModule(buf);

        syncDynamicTransforms(app, physMod, PPU, new Set());

        const t = app.world.get(e1, Transform) as TransformData;
        const half = angle * 0.5;
        expect(t.rotation.w).toBeCloseTo(Math.cos(half));
        expect(t.rotation.x).toBeCloseTo(0);
        expect(t.rotation.y).toBeCloseTo(0);
        expect(t.rotation.z).toBeCloseTo(Math.sin(half));
    });

    it('should handle multiple bodies in one call', () => {
        const app = createTestApp();
        const e1 = app.world.spawn();
        const e2 = app.world.spawn();
        const e3 = app.world.spawn();
        app.world.insert(e1, Transform, defaultTransform());
        app.world.insert(e2, Transform, defaultTransform());
        app.world.insert(e3, Transform, defaultTransform());

        const buf = buildPhysicsBuffer([
            { entity: e1 as number, x: 1, y: 2, angle: 0 },
            { entity: e2 as number, x: 3, y: 4, angle: 0 },
            { entity: e3 as number, x: 5, y: 6, angle: 0 },
        ]);
        const physMod = createMockPhysicsModule(buf);

        syncDynamicTransforms(app, physMod, PPU, new Set());

        expect((app.world.get(e1, Transform) as TransformData).position.x).toBeCloseTo(100);
        expect((app.world.get(e2, Transform) as TransformData).position.x).toBeCloseTo(300);
        expect((app.world.get(e3, Transform) as TransformData).position.x).toBeCloseTo(500);
    });

    it('should skip invalid entities', () => {
        const app = createTestApp();
        const e1 = app.world.spawn();
        app.world.insert(e1, Transform, defaultTransform());

        const buf = buildPhysicsBuffer([
            { entity: 9999, x: 1, y: 2, angle: 0 },
            { entity: e1 as number, x: 5, y: 6, angle: 0 },
        ]);
        const physMod = createMockPhysicsModule(buf);

        syncDynamicTransforms(app, physMod, PPU, new Set());

        const t = app.world.get(e1, Transform) as TransformData;
        expect(t.position.x).toBeCloseTo(500);
        expect(t.position.y).toBeCloseTo(600);
    });

    it('should do nothing when count is zero', () => {
        const app = createTestApp();
        const e1 = app.world.spawn();
        app.world.insert(e1, Transform, { ...defaultTransform(), position: { x: 42, y: 99, z: 0 } });

        const buf = buildPhysicsBuffer([]);
        const physMod = createMockPhysicsModule(buf);

        syncDynamicTransforms(app, physMod, PPU, new Set());

        const t = app.world.get(e1, Transform) as TransformData;
        expect(t.position.x).toBeCloseTo(42);
        expect(t.position.y).toBeCloseTo(99);
    });

    it('should handle large body count (benchmark-like)', () => {
        const app = createTestApp();
        const BODY_COUNT = 500;
        const entities: Entity[] = [];

        for (let i = 0; i < BODY_COUNT; i++) {
            const e = app.world.spawn();
            app.world.insert(e, Transform, defaultTransform());
            entities.push(e);
        }

        const bodies = entities.map((e, i) => ({
            entity: e as number,
            x: i * 0.5,
            y: i * 0.3,
            angle: i * 0.01,
        }));
        const buf = buildPhysicsBuffer(bodies);
        const physMod = createMockPhysicsModule(buf);

        syncDynamicTransforms(app, physMod, PPU, new Set());

        const t0 = app.world.get(entities[0], Transform) as TransformData;
        expect(t0.position.x).toBeCloseTo(0);
        expect(t0.position.y).toBeCloseTo(0);

        const tLast = app.world.get(entities[BODY_COUNT - 1], Transform) as TransformData;
        expect(tLast.position.x).toBeCloseTo((BODY_COUNT - 1) * 0.5 * PPU);
        expect(tLast.position.y).toBeCloseTo((BODY_COUNT - 1) * 0.3 * PPU);
    });
});

describe('syncDynamicTransforms — fast path', () => {
    const PPU = 100;

    it('should produce correct results via fast path (no parentedBodies)', () => {
        const app = createTestApp();

        const bodies = [
            { x: 1.5, y: 2.5, angle: 0.3 },
            { x: -0.7, y: 4.1, angle: -1.2 },
            { x: 10, y: 0, angle: Math.PI },
        ];

        const entities: Entity[] = [];
        for (const b of bodies) {
            const e = app.world.spawn();
            app.world.insert(e, Transform, defaultTransform());
            entities.push(e);
        }

        const buf = buildPhysicsBuffer(bodies.map((b, i) => ({ entity: entities[i] as number, ...b })));
        syncDynamicTransforms(app, createMockPhysicsModule(buf), PPU, new Set());

        for (let i = 0; i < bodies.length; i++) {
            const t = app.world.get(entities[i], Transform) as TransformData;
            expect(t.position.x).toBeCloseTo(bodies[i].x * PPU, 3);
            expect(t.position.y).toBeCloseTo(bodies[i].y * PPU, 3);

            const half = bodies[i].angle * 0.5;
            expect(t.rotation.w).toBeCloseTo(Math.cos(half), 3);
            expect(t.rotation.z).toBeCloseTo(Math.sin(half), 3);
        }
    });

    it('should fall back to slow path when parentedBodies is non-empty', () => {
        const app = createTestApp();
        const e1 = app.world.spawn();
        app.world.insert(e1, Transform, defaultTransform());

        const buf = buildPhysicsBuffer([
            { entity: e1 as number, x: 2, y: 3, angle: 0.5 },
        ]);
        const physMod = createMockPhysicsModule(buf);
        const parentedBodies = new Set<Entity>([e1]);

        syncDynamicTransforms(app, physMod, PPU, parentedBodies);

        const t = app.world.get(e1, Transform) as TransformData;
        expect(t.position.x).toBeCloseTo(200);
        expect(t.position.y).toBeCloseTo(300);
    });
});
