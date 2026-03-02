import type { App } from '../app';
import type { Color } from '../types';
import type { TransformData, CanvasData } from '../component';
import type { ResourceDef } from '../resource';
import type { RigidBodyData, BoxColliderData, CircleColliderData, CapsuleColliderData } from './PhysicsComponents';
import type { PhysicsEventsData } from './PhysicsPlugin';
import { Transform, Canvas } from '../component';
import { Draw } from '../draw';
import { defineResource } from '../resource';
import { registerDrawCallback } from '../customDraw';
import { RigidBody, BoxCollider, CircleCollider, CapsuleCollider, BodyType } from './PhysicsComponents';

export interface PhysicsDebugDrawConfig {
    enabled: boolean;
    showColliders: boolean;
    showVelocity: boolean;
    showContacts: boolean;
}

export const PhysicsDebugDraw = defineResource<PhysicsDebugDrawConfig>({
    enabled: false,
    showColliders: true,
    showVelocity: false,
    showContacts: false,
}, 'PhysicsDebugDraw');

interface VelocityProvider {
    getLinearVelocity(entity: number): { x: number; y: number };
}

const STATIC_COLOR: Color = { r: 0.2, g: 0.4, b: 1.0, a: 0.7 };
const DYNAMIC_COLOR: Color = { r: 0.2, g: 1.0, b: 0.2, a: 0.7 };
const KINEMATIC_COLOR: Color = { r: 0.2, g: 1.0, b: 1.0, a: 0.7 };
const SENSOR_COLOR: Color = { r: 1.0, g: 1.0, b: 0.2, a: 0.5 };
const VELOCITY_COLOR: Color = { r: 1.0, g: 0.2, b: 0.2, a: 0.8 };
const CONTACT_COLOR: Color = { r: 1.0, g: 0.2, b: 0.2, a: 1.0 };
const DEBUG_LINE_THICKNESS = 1.5;
const CONTACT_POINT_RADIUS = 3;
const VELOCITY_SCALE = 0.5;
const CIRCLE_SEGMENTS = 32;
const CAPSULE_ARC_SEGMENTS = 16;

function quatToAngleZ(q: { w: number; x: number; y: number; z: number }): number {
    return Math.atan2(2 * (q.w * q.z + q.x * q.y), 1 - 2 * (q.y * q.y + q.z * q.z));
}

function bodyTypeColor(bodyType: number): Color {
    switch (bodyType) {
        case BodyType.Static: return STATIC_COLOR;
        case BodyType.Kinematic: return KINEMATIC_COLOR;
        case BodyType.Dynamic: return DYNAMIC_COLOR;
        default: return DYNAMIC_COLOR;
    }
}

function readPixelsPerUnit(app: App): number {
    const entities = app.world.getEntitiesWithComponents([Canvas]);
    for (const entity of entities) {
        const canvas = app.world.get(entity, Canvas) as CanvasData;
        if (canvas && canvas.pixelsPerUnit) {
            return canvas.pixelsPerUnit;
        }
    }
    return 100;
}

function drawRotatedBox(
    cx: number, cy: number,
    halfW: number, halfH: number,
    angle: number, color: Color,
): void {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const corners = [
        { x: -halfW, y: -halfH },
        { x:  halfW, y: -halfH },
        { x:  halfW, y:  halfH },
        { x: -halfW, y:  halfH },
    ];
    const pts = corners.map(c => ({
        x: cx + c.x * cos - c.y * sin,
        y: cy + c.x * sin + c.y * cos,
    }));
    for (let i = 0; i < 4; i++) {
        Draw.line(pts[i], pts[(i + 1) % 4], color, DEBUG_LINE_THICKNESS);
    }
}

function drawCapsule(
    cx: number, cy: number,
    radius: number, halfHeight: number,
    angle: number, color: Color,
): void {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);

    const toWorld = (lx: number, ly: number) => ({
        x: cx + lx * cos - ly * sin,
        y: cy + lx * sin + ly * cos,
    });

    const topLeft = toWorld(-radius, halfHeight);
    const topRight = toWorld(radius, halfHeight);
    const bottomLeft = toWorld(-radius, -halfHeight);
    const bottomRight = toWorld(radius, -halfHeight);

    Draw.line(topLeft, bottomLeft, color, DEBUG_LINE_THICKNESS);
    Draw.line(topRight, bottomRight, color, DEBUG_LINE_THICKNESS);

    for (let i = 0; i < CAPSULE_ARC_SEGMENTS; i++) {
        const a0 = (i / CAPSULE_ARC_SEGMENTS) * Math.PI;
        const a1 = ((i + 1) / CAPSULE_ARC_SEGMENTS) * Math.PI;
        const p0 = toWorld(
            -radius * Math.cos(a0),
            halfHeight + radius * Math.sin(a0),
        );
        const p1 = toWorld(
            -radius * Math.cos(a1),
            halfHeight + radius * Math.sin(a1),
        );
        Draw.line(p0, p1, color, DEBUG_LINE_THICKNESS);
    }

    for (let i = 0; i < CAPSULE_ARC_SEGMENTS; i++) {
        const a0 = Math.PI + (i / CAPSULE_ARC_SEGMENTS) * Math.PI;
        const a1 = Math.PI + ((i + 1) / CAPSULE_ARC_SEGMENTS) * Math.PI;
        const p0 = toWorld(
            -radius * Math.cos(a0),
            -halfHeight + radius * Math.sin(a0),
        );
        const p1 = toWorld(
            -radius * Math.cos(a1),
            -halfHeight + radius * Math.sin(a1),
        );
        Draw.line(p0, p1, color, DEBUG_LINE_THICKNESS);
    }
}

function drawVelocityArrow(
    x: number, y: number,
    vx: number, vy: number,
): void {
    const endX = x + vx * VELOCITY_SCALE;
    const endY = y + vy * VELOCITY_SCALE;
    Draw.line({ x, y }, { x: endX, y: endY }, VELOCITY_COLOR, DEBUG_LINE_THICKNESS);

    const len = Math.sqrt(vx * vx + vy * vy);
    if (len < 1) return;

    const ARROWHEAD_LENGTH = 6;
    const ARROWHEAD_ANGLE = Math.PI / 6;
    const dirX = vx / len;
    const dirY = vy / len;

    const leftX = endX - ARROWHEAD_LENGTH * (dirX * Math.cos(ARROWHEAD_ANGLE) - dirY * Math.sin(ARROWHEAD_ANGLE));
    const leftY = endY - ARROWHEAD_LENGTH * (dirX * Math.sin(ARROWHEAD_ANGLE) + dirY * Math.cos(ARROWHEAD_ANGLE));
    const rightX = endX - ARROWHEAD_LENGTH * (dirX * Math.cos(ARROWHEAD_ANGLE) + dirY * Math.sin(ARROWHEAD_ANGLE));
    const rightY = endY - ARROWHEAD_LENGTH * (-dirX * Math.sin(ARROWHEAD_ANGLE) + dirY * Math.cos(ARROWHEAD_ANGLE));

    Draw.line({ x: endX, y: endY }, { x: leftX, y: leftY }, VELOCITY_COLOR, DEBUG_LINE_THICKNESS);
    Draw.line({ x: endX, y: endY }, { x: rightX, y: rightY }, VELOCITY_COLOR, DEBUG_LINE_THICKNESS);
}

export function drawPhysicsDebug(
    app: App,
    physicsApiRes: ResourceDef<VelocityProvider>,
    physicsEventsRes: ResourceDef<PhysicsEventsData>,
): void {
    const config = app.getResource<PhysicsDebugDrawConfig>(PhysicsDebugDraw);
    if (!config || !config.enabled) return;

    const ppu = readPixelsPerUnit(app);
    const entities = app.world.getEntitiesWithComponents([RigidBody, Transform]);

    let physics: VelocityProvider | null = null;
    if (config.showVelocity && app.hasResource(physicsApiRes)) {
        physics = app.getResource<VelocityProvider>(physicsApiRes);
    }

    for (const entity of entities) {
        const rb = app.world.get(entity, RigidBody) as RigidBodyData;
        if (!rb.enabled) continue;

        const wt = app.world.get(entity, Transform) as TransformData;
        const wx = wt.worldPosition.x;
        const wy = wt.worldPosition.y;
        const angle = quatToAngleZ(wt.worldRotation);

        if (config.showColliders) {
            if (app.world.has(entity, BoxCollider)) {
                const box = app.world.get(entity, BoxCollider) as BoxColliderData;
                const baseColor = box.isSensor ? SENSOR_COLOR : bodyTypeColor(rb.bodyType);
                const offsetX = box.offset.x * ppu;
                const offsetY = box.offset.y * ppu;
                const cosA = Math.cos(angle);
                const sinA = Math.sin(angle);
                const cx = wx + offsetX * cosA - offsetY * sinA;
                const cy = wy + offsetX * sinA + offsetY * cosA;
                drawRotatedBox(cx, cy, box.halfExtents.x * ppu, box.halfExtents.y * ppu, angle, baseColor);
            }

            if (app.world.has(entity, CircleCollider)) {
                const circle = app.world.get(entity, CircleCollider) as CircleColliderData;
                const baseColor = circle.isSensor ? SENSOR_COLOR : bodyTypeColor(rb.bodyType);
                const offsetX = circle.offset.x * ppu;
                const offsetY = circle.offset.y * ppu;
                const cosA = Math.cos(angle);
                const sinA = Math.sin(angle);
                const cx = wx + offsetX * cosA - offsetY * sinA;
                const cy = wy + offsetX * sinA + offsetY * cosA;
                Draw.circleOutline(
                    { x: cx, y: cy },
                    circle.radius * ppu,
                    baseColor,
                    DEBUG_LINE_THICKNESS,
                    CIRCLE_SEGMENTS,
                );
            }

            if (app.world.has(entity, CapsuleCollider)) {
                const capsule = app.world.get(entity, CapsuleCollider) as CapsuleColliderData;
                const baseColor = capsule.isSensor ? SENSOR_COLOR : bodyTypeColor(rb.bodyType);
                const offsetX = capsule.offset.x * ppu;
                const offsetY = capsule.offset.y * ppu;
                const cosA = Math.cos(angle);
                const sinA = Math.sin(angle);
                const cx = wx + offsetX * cosA - offsetY * sinA;
                const cy = wy + offsetX * sinA + offsetY * cosA;
                drawCapsule(cx, cy, capsule.radius * ppu, capsule.halfHeight * ppu, angle, baseColor);
            }
        }

        if (config.showVelocity && physics && rb.bodyType === BodyType.Dynamic) {
            const vel = physics.getLinearVelocity(entity);
            drawVelocityArrow(wx, wy, vel.x * ppu, vel.y * ppu);
        }
    }

    if (config.showContacts && app.hasResource(physicsEventsRes)) {
        const events = app.getResource<PhysicsEventsData>(physicsEventsRes);
        for (const collision of events.collisionEnters) {
            Draw.circle(
                { x: collision.contactX, y: collision.contactY },
                CONTACT_POINT_RADIUS,
                CONTACT_COLOR,
                true,
                CIRCLE_SEGMENTS,
            );
        }
    }
}

export function setupPhysicsDebugDraw(
    app: App,
    physicsApiRes: ResourceDef<VelocityProvider>,
    physicsEventsRes: ResourceDef<PhysicsEventsData>,
): void {
    app.insertResource(PhysicsDebugDraw, {
        enabled: false,
        showColliders: true,
        showVelocity: false,
        showContacts: false,
    });

    registerDrawCallback('physics-debug-draw', () => {
        drawPhysicsDebug(app, physicsApiRes, physicsEventsRes);
    });
}
