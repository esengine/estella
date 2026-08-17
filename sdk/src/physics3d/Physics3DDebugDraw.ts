// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    Physics3DDebugDraw.ts
 * @brief   The 3D world's shapes, drawn by the running game.
 * @details The editor gizmo answers "is this box the size I meant" while a scene
 *          is being authored. This answers the other question — "why did the
 *          player get stuck there" — which only the running game can be asked,
 *          and which the editor hides its own overlays for.
 *
 *          Geometry comes from the same seam the gizmo projects
 *          ({@link readCollider3DShapes}), so the two can never disagree about
 *          which shape the solver built.
 */
import type { App } from '../app/app';
import type { Color } from '../types';
import { Transform } from '../ecs/component';
import type { TransformData } from '../ecs/component.generated';
import { Draw } from '../render/draw';
import { defineResource } from '../ecs/resource';
import { registerDrawCallback } from '../render/customDraw';
import { RigidBody3D, CharacterController3D } from './Physics3DComponents';
import type { RigidBody3DData } from './Physics3DComponents';
import {
    readCollider3DShapes, collider3DWireframe, placeCollider3DWireframe,
} from './ColliderShape3D';

export interface Physics3DDebugDrawConfig {
    enabled: boolean;
    showColliders: boolean;
    showContacts: boolean;
}

/** Off until a game turns it on: a debug overlay costs a line per edge per frame. */
export const Physics3DDebugDraw = defineResource<Physics3DDebugDrawConfig>({
    enabled: false,
    showColliders: true,
    showContacts: false,
}, 'Physics3DDebugDraw');

const STATIC_COLOR: Color = { r: 0.2, g: 0.4, b: 1.0, a: 0.8 };
const DYNAMIC_COLOR: Color = { r: 0.2, g: 1.0, b: 0.2, a: 0.8 };
const KINEMATIC_COLOR: Color = { r: 0.2, g: 1.0, b: 1.0, a: 0.8 };
const SENSOR_COLOR: Color = { r: 1.0, g: 1.0, b: 0.2, a: 0.6 };
const CHARACTER_COLOR: Color = { r: 1.0, g: 0.6, b: 0.1, a: 0.9 };
const CONTACT_COLOR: Color = { r: 1.0, g: 0.2, b: 0.2, a: 1.0 };
/** World units. The 3D world is authored at 100 units to the metre, so this is
 *  about a centimetre — thin enough not to hide the shape it outlines. */
const LINE_THICKNESS = 2;
const CONTACT_CROSS = 8;

function bodyTypeColor(bodyType: number): Color {
    switch (bodyType) {
        case 0: return STATIC_COLOR;
        case 1: return KINEMATIC_COLOR;
        default: return DYNAMIC_COLOR;
    }
}

interface Contact3D { pointX: number; pointY: number; pointZ: number }

export function drawPhysics3DDebug(app: App, contacts?: readonly Contact3D[]): void {
    const config = app.getResource<Physics3DDebugDrawConfig>(Physics3DDebugDraw);
    if (!config || !config.enabled) return;

    if (config.showColliders) {
        const world = app.world as unknown as Parameters<typeof readCollider3DShapes>[0];
        for (const entity of app.world.getEntitiesWithComponents([Transform])) {
            const instances = readCollider3DShapes(world, entity as number);
            if (instances.length === 0) continue;
            const t = app.world.get(entity, Transform) as TransformData;
            const body = app.world.has(entity, RigidBody3D)
                ? app.world.get(entity, RigidBody3D) as RigidBody3DData : null;

            for (const inst of instances) {
                // What the solver did NOT build is not drawn here: the running
                // game is not the place to see geometry that collides with
                // nothing, and the editor already shows it while it is authored.
                if (!inst.active) continue;
                const color = inst.component === 'CharacterController3D' ? CHARACTER_COLOR
                    : inst.isSensor ? SENSOR_COLOR
                        : bodyTypeColor(body?.bodyType ?? 2);
                const lines = placeCollider3DWireframe(
                    collider3DWireframe(inst.shape),
                    t.worldPosition, t.worldRotation);
                for (const line of lines) {
                    for (let i = 0; i + 1 < line.length; i++) {
                        Draw.line3D(line[i]!, line[i + 1]!, color, LINE_THICKNESS);
                    }
                }
            }
        }
    }

    if (config.showContacts && contacts) {
        for (const c of contacts) {
            const at = { x: c.pointX, y: c.pointY, z: c.pointZ };
            for (const axis of [{ x: CONTACT_CROSS, y: 0, z: 0 },
                                { x: 0, y: CONTACT_CROSS, z: 0 },
                                { x: 0, y: 0, z: CONTACT_CROSS }]) {
                Draw.line3D({ x: at.x - axis.x, y: at.y - axis.y, z: at.z - axis.z },
                            { x: at.x + axis.x, y: at.y + axis.y, z: at.z + axis.z },
                            CONTACT_COLOR, LINE_THICKNESS);
            }
        }
    }
}

/** Installed by the 3D physics plugin; the resource decides whether it draws. */
export function setupPhysics3DDebugDraw(app: App, contacts: () => readonly Contact3D[]): void {
    app.insertResource(Physics3DDebugDraw, {
        enabled: false, showColliders: true, showContacts: false,
    });
    registerDrawCallback('physics3d-debug-draw', () => {
        drawPhysics3DDebug(app, contacts());
    });
}
