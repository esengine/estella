// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { App } from '../app/app';
import type { Color } from '../types';
import type { TransformData, CanvasData } from '../ecs/component';
import type { ResourceDef } from '../ecs/resource';
import type { RigidBodyData } from './PhysicsComponents';
import type { PhysicsEventsData } from './PhysicsPlugin';
import { Transform, Canvas } from '../ecs/component';
import { Draw } from '../render/draw';
import { defineResource } from '../ecs/resource';
import { registerDrawCallback } from '../render/customDraw';
import { RigidBody, BodyType } from './PhysicsComponents';
import { readColliderShapes, shapeCenter, colliderShapeOutline } from './ColliderShape';

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
            // One projection for every shape: read the collider(s), take the offset+rotation
            // centre, and stroke the world-space outline. Same geometry the per-type branches
            // produced, now shared with the editor gizmo (see ColliderShape).
            for (const { shape, isSensor } of readColliderShapes(app.world, entity)) {
                const color = isSensor ? SENSOR_COLOR : bodyTypeColor(rb.bodyType);
                const center = shapeCenter(shape, { x: wx, y: wy }, angle, ppu);
                const outline = colliderShapeOutline(shape, center, angle, ppu);
                for (const pl of outline.polylines) {
                    for (let i = 0; i + 1 < pl.length; i++) {
                        Draw.line(pl[i], pl[i + 1], color, DEBUG_LINE_THICKNESS);
                    }
                }
                for (const circ of outline.circles) {
                    Draw.circleOutline(circ.c, circ.r, color, DEBUG_LINE_THICKNESS, CIRCLE_SEGMENTS);
                }
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
