import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    PhysicsDebugDraw,
    drawPhysicsDebug,
    setupPhysicsDebugDraw,
    type PhysicsDebugDrawConfig,
} from '../src/physics/PhysicsDebugDraw';
import { BodyType } from '../src/physics/PhysicsComponents';
import { defineResource } from '../src/resource';
import type { ResourceDef } from '../src/resource';
import { clearDrawCallbacks, getDrawCallbacks } from '../src/customDraw';
import { clearUserComponents } from '../src/component';

vi.mock('../src/draw', () => ({
    Draw: {
        line: vi.fn(),
        circle: vi.fn(),
        circleOutline: vi.fn(),
        rect: vi.fn(),
        rectOutline: vi.fn(),
    },
}));

import { Draw } from '../src/draw';

interface MockEntity {
    components: Map<string, any>;
}

function createMockApp(entities: MockEntity[] = [], resources: Map<symbol, any> = new Map()) {
    const entityList = entities;
    const resourceMap = resources;
    return {
        world: {
            getEntitiesWithComponents: vi.fn((_comps: any[]) => {
                return entityList.map((_, i) => i);
            }),
            get: vi.fn((entityIdx: number, comp: any) => {
                const entity = entityList[entityIdx];
                return entity?.components.get(comp._name) ?? null;
            }),
            has: vi.fn((entityIdx: number, comp: any) => {
                const entity = entityList[entityIdx];
                return entity?.components.has(comp._name) ?? false;
            }),
        },
        getResource: vi.fn(<T,>(res: ResourceDef<T>): T | null => {
            return resourceMap.get(res._id) ?? null;
        }),
        hasResource: vi.fn((res: ResourceDef<any>) => {
            return resourceMap.has(res._id);
        }),
        insertResource: vi.fn((res: ResourceDef<any>, value: any) => {
            resourceMap.set(res._id, value);
        }),
    } as any;
}

function mockEntity(comps: Record<string, any>): MockEntity {
    const map = new Map<string, any>();
    for (const [name, data] of Object.entries(comps)) {
        map.set(name, data);
    }
    return { components: map };
}

const MockPhysicsAPI = defineResource<any>({}, 'MockPhysicsAPI');
const MockPhysicsEvents = defineResource<any>({}, 'MockPhysicsEvents');

describe('PhysicsDebugDraw resource', () => {
    it('should define resource with correct defaults', () => {
        expect(PhysicsDebugDraw._name).toBe('PhysicsDebugDraw');
        expect(PhysicsDebugDraw._default).toEqual({
            enabled: false,
            showColliders: true,
            showVelocity: false,
            showContacts: false,
        });
    });
});

describe('drawPhysicsDebug', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        clearUserComponents();
    });

    it('should do nothing when config is not present', () => {
        const app = createMockApp();
        drawPhysicsDebug(app, MockPhysicsAPI, MockPhysicsEvents);
        expect(Draw.line).not.toHaveBeenCalled();
        expect(Draw.circleOutline).not.toHaveBeenCalled();
    });

    it('should do nothing when enabled=false', () => {
        const resources = new Map<symbol, any>();
        resources.set(PhysicsDebugDraw._id, {
            enabled: false, showColliders: true, showVelocity: false, showContacts: false,
        });
        const app = createMockApp([], resources);

        drawPhysicsDebug(app, MockPhysicsAPI, MockPhysicsEvents);
        expect(Draw.line).not.toHaveBeenCalled();
    });

    it('should draw box collider when enabled', () => {
        const resources = new Map<symbol, any>();
        resources.set(PhysicsDebugDraw._id, {
            enabled: true, showColliders: true, showVelocity: false, showContacts: false,
        } as PhysicsDebugDrawConfig);

        const entity = mockEntity({
            RigidBody: { bodyType: BodyType.Static, enabled: true },
            Transform: {
                worldPosition: { x: 100, y: 200 },
                worldRotation: { w: 1, x: 0, y: 0, z: 0 },
            },
            BoxCollider: {
                halfExtents: { x: 0.5, y: 0.5 },
                offset: { x: 0, y: 0 },
                isSensor: false,
            },
        });

        const app = createMockApp([entity], resources);
        drawPhysicsDebug(app, MockPhysicsAPI, MockPhysicsEvents);

        expect(Draw.line).toHaveBeenCalledTimes(4);
    });

    it('should draw circle collider when enabled', () => {
        const resources = new Map<symbol, any>();
        resources.set(PhysicsDebugDraw._id, {
            enabled: true, showColliders: true, showVelocity: false, showContacts: false,
        } as PhysicsDebugDrawConfig);

        const entity = mockEntity({
            RigidBody: { bodyType: BodyType.Dynamic, enabled: true },
            Transform: {
                worldPosition: { x: 50, y: 50 },
                worldRotation: { w: 1, x: 0, y: 0, z: 0 },
            },
            CircleCollider: {
                radius: 1.0,
                offset: { x: 0, y: 0 },
                isSensor: false,
            },
        });

        const app = createMockApp([entity], resources);
        drawPhysicsDebug(app, MockPhysicsAPI, MockPhysicsEvents);

        expect(Draw.circleOutline).toHaveBeenCalledTimes(1);
    });

    it('should draw capsule collider when enabled', () => {
        const resources = new Map<symbol, any>();
        resources.set(PhysicsDebugDraw._id, {
            enabled: true, showColliders: true, showVelocity: false, showContacts: false,
        } as PhysicsDebugDrawConfig);

        const entity = mockEntity({
            RigidBody: { bodyType: BodyType.Dynamic, enabled: true },
            Transform: {
                worldPosition: { x: 0, y: 0 },
                worldRotation: { w: 1, x: 0, y: 0, z: 0 },
            },
            CapsuleCollider: {
                radius: 0.25,
                halfHeight: 0.5,
                offset: { x: 0, y: 0 },
                isSensor: false,
            },
        });

        const app = createMockApp([entity], resources);
        drawPhysicsDebug(app, MockPhysicsAPI, MockPhysicsEvents);

        // 2 side lines + 16 top arc segments + 16 bottom arc segments = 34
        expect(Draw.line).toHaveBeenCalledTimes(34);
    });

    it('should skip disabled rigid bodies', () => {
        const resources = new Map<symbol, any>();
        resources.set(PhysicsDebugDraw._id, {
            enabled: true, showColliders: true, showVelocity: false, showContacts: false,
        } as PhysicsDebugDrawConfig);

        const entity = mockEntity({
            RigidBody: { bodyType: BodyType.Dynamic, enabled: false },
            Transform: {
                worldPosition: { x: 0, y: 0 },
                worldRotation: { w: 1, x: 0, y: 0, z: 0 },
            },
            BoxCollider: {
                halfExtents: { x: 0.5, y: 0.5 },
                offset: { x: 0, y: 0 },
                isSensor: false,
            },
        });

        const app = createMockApp([entity], resources);
        drawPhysicsDebug(app, MockPhysicsAPI, MockPhysicsEvents);

        expect(Draw.line).not.toHaveBeenCalled();
    });

    it('should use sensor color for sensor colliders', () => {
        const resources = new Map<symbol, any>();
        resources.set(PhysicsDebugDraw._id, {
            enabled: true, showColliders: true, showVelocity: false, showContacts: false,
        } as PhysicsDebugDrawConfig);

        const entity = mockEntity({
            RigidBody: { bodyType: BodyType.Static, enabled: true },
            Transform: {
                worldPosition: { x: 0, y: 0 },
                worldRotation: { w: 1, x: 0, y: 0, z: 0 },
            },
            BoxCollider: {
                halfExtents: { x: 1, y: 1 },
                offset: { x: 0, y: 0 },
                isSensor: true,
            },
        });

        const app = createMockApp([entity], resources);
        drawPhysicsDebug(app, MockPhysicsAPI, MockPhysicsEvents);

        const calls = (Draw.line as any).mock.calls;
        expect(calls.length).toBe(4);
        const sensorColor = { r: 1.0, g: 1.0, b: 0.2, a: 0.5 };
        expect(calls[0][2]).toEqual(sensorColor);
    });

    it('should draw velocity arrows for dynamic bodies', () => {
        const resources = new Map<symbol, any>();
        resources.set(PhysicsDebugDraw._id, {
            enabled: true, showColliders: false, showVelocity: true, showContacts: false,
        } as PhysicsDebugDrawConfig);
        resources.set(MockPhysicsAPI._id, {
            getLinearVelocity: vi.fn().mockReturnValue({ x: 10, y: 5 }),
        });

        const entity = mockEntity({
            RigidBody: { bodyType: BodyType.Dynamic, enabled: true },
            Transform: {
                worldPosition: { x: 100, y: 200 },
                worldRotation: { w: 1, x: 0, y: 0, z: 0 },
            },
        });

        const app = createMockApp([entity], resources);
        drawPhysicsDebug(app, MockPhysicsAPI, MockPhysicsEvents);

        // velocity line + 2 arrowhead lines = 3
        expect(Draw.line).toHaveBeenCalledTimes(3);
    });

    it('should not draw velocity for static bodies', () => {
        const resources = new Map<symbol, any>();
        resources.set(PhysicsDebugDraw._id, {
            enabled: true, showColliders: false, showVelocity: true, showContacts: false,
        } as PhysicsDebugDrawConfig);
        resources.set(MockPhysicsAPI._id, {
            getLinearVelocity: vi.fn(),
        });

        const entity = mockEntity({
            RigidBody: { bodyType: BodyType.Static, enabled: true },
            Transform: {
                worldPosition: { x: 0, y: 0 },
                worldRotation: { w: 1, x: 0, y: 0, z: 0 },
            },
        });

        const app = createMockApp([entity], resources);
        drawPhysicsDebug(app, MockPhysicsAPI, MockPhysicsEvents);

        expect(Draw.line).not.toHaveBeenCalled();
    });

    it('should draw contact points when showContacts is enabled', () => {
        const resources = new Map<symbol, any>();
        resources.set(PhysicsDebugDraw._id, {
            enabled: true, showColliders: false, showVelocity: false, showContacts: true,
        } as PhysicsDebugDrawConfig);
        resources.set(MockPhysicsEvents._id, {
            collisionEnters: [
                { contactX: 10, contactY: 20 },
                { contactX: 30, contactY: 40 },
            ],
        });

        const app = createMockApp([], resources);
        drawPhysicsDebug(app, MockPhysicsAPI, MockPhysicsEvents);

        expect(Draw.circle).toHaveBeenCalledTimes(2);
    });

    it('should not draw contacts when PhysicsEvents resource is missing', () => {
        const resources = new Map<symbol, any>();
        resources.set(PhysicsDebugDraw._id, {
            enabled: true, showColliders: false, showVelocity: false, showContacts: true,
        } as PhysicsDebugDrawConfig);

        const app = createMockApp([], resources);
        drawPhysicsDebug(app, MockPhysicsAPI, MockPhysicsEvents);

        expect(Draw.circle).not.toHaveBeenCalled();
    });

    it('should use correct body type colors', () => {
        const resources = new Map<symbol, any>();
        resources.set(PhysicsDebugDraw._id, {
            enabled: true, showColliders: true, showVelocity: false, showContacts: false,
        } as PhysicsDebugDrawConfig);

        const staticEntity = mockEntity({
            RigidBody: { bodyType: BodyType.Static, enabled: true },
            Transform: { worldPosition: { x: 0, y: 0 }, worldRotation: { w: 1, x: 0, y: 0, z: 0 } },
            CircleCollider: { radius: 1, offset: { x: 0, y: 0 }, isSensor: false },
        });

        const dynamicEntity = mockEntity({
            RigidBody: { bodyType: BodyType.Dynamic, enabled: true },
            Transform: { worldPosition: { x: 0, y: 0 }, worldRotation: { w: 1, x: 0, y: 0, z: 0 } },
            CircleCollider: { radius: 1, offset: { x: 0, y: 0 }, isSensor: false },
        });

        const kinematicEntity = mockEntity({
            RigidBody: { bodyType: BodyType.Kinematic, enabled: true },
            Transform: { worldPosition: { x: 0, y: 0 }, worldRotation: { w: 1, x: 0, y: 0, z: 0 } },
            CircleCollider: { radius: 1, offset: { x: 0, y: 0 }, isSensor: false },
        });

        const app = createMockApp([staticEntity, dynamicEntity, kinematicEntity], resources);
        drawPhysicsDebug(app, MockPhysicsAPI, MockPhysicsEvents);

        expect(Draw.circleOutline).toHaveBeenCalledTimes(3);
        const calls = (Draw.circleOutline as any).mock.calls;

        const staticColor = { r: 0.2, g: 0.4, b: 1.0, a: 0.7 };
        const dynamicColor = { r: 0.2, g: 1.0, b: 0.2, a: 0.7 };
        const kinematicColor = { r: 0.2, g: 1.0, b: 1.0, a: 0.7 };

        expect(calls[0][2]).toEqual(staticColor);
        expect(calls[1][2]).toEqual(dynamicColor);
        expect(calls[2][2]).toEqual(kinematicColor);
    });

    it('should apply collider offset with rotation', () => {
        const resources = new Map<symbol, any>();
        resources.set(PhysicsDebugDraw._id, {
            enabled: true, showColliders: true, showVelocity: false, showContacts: false,
        } as PhysicsDebugDrawConfig);

        // 90 degree rotation: quat z=sin(45°), w=cos(45°)
        const angle = Math.PI / 2;
        const qW = Math.cos(angle / 2);
        const qZ = Math.sin(angle / 2);

        const entity = mockEntity({
            RigidBody: { bodyType: BodyType.Static, enabled: true },
            Transform: {
                worldPosition: { x: 100, y: 100 },
                worldRotation: { w: qW, x: 0, y: 0, z: qZ },
            },
            CircleCollider: {
                radius: 1,
                offset: { x: 1, y: 0 },
                isSensor: false,
            },
        });

        const app = createMockApp([entity], resources);
        drawPhysicsDebug(app, MockPhysicsAPI, MockPhysicsEvents);

        expect(Draw.circleOutline).toHaveBeenCalledTimes(1);
        const call = (Draw.circleOutline as any).mock.calls[0];
        const center = call[0];
        // offset (1, 0) rotated 90° → (0, 1) * ppu=100
        expect(center.x).toBeCloseTo(100 + 0, 0);
        expect(center.y).toBeCloseTo(100 + 100, 0);
    });
});

describe('setupPhysicsDebugDraw', () => {
    beforeEach(() => {
        clearDrawCallbacks();
    });

    it('should insert default resource and register draw callback', () => {
        const resources = new Map<symbol, any>();
        const app = createMockApp([], resources);

        setupPhysicsDebugDraw(app, MockPhysicsAPI, MockPhysicsEvents);

        expect(app.insertResource).toHaveBeenCalledWith(PhysicsDebugDraw, {
            enabled: false, showColliders: true, showVelocity: false, showContacts: false,
        });

        const callbacks = getDrawCallbacks();
        expect(callbacks.has('physics-debug-draw')).toBe(true);
    });
});
