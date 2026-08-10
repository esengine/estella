// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    CameraBounds.ts
 * @brief   The world rectangle an orthographic camera may not look outside of —
 *          what keeps a level's edge at the edge of the screen instead of
 *          showing the void beyond it.
 *
 * A constraint on where the camera IS, not on what moved it: a followed camera,
 * a scripted one and a blended one all end their frame inside the same
 * rectangle, because the clamp runs after they have all had their say. Each
 * axis is independent and opts in by naming a real interval (max > min), so a
 * component left at its defaults constrains nothing.
 */
import { defineComponent, Transform, Camera, ProjectionType } from '../ecs/component';
import type { World } from '../ecs/world';

export interface CameraBoundsData {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
}

export const CameraBounds = defineComponent<CameraBoundsData>('CameraBounds', {
    minX: 0,
    minY: 0,
    maxX: 0,
    maxY: 0,
});

/**
 * Where the camera's centre may sit on one axis. Pure: the view's half extent is
 * held inside [min, max], and when the interval is narrower than the view there
 * is no such position — the whole of it is shown centred, which reads as a level
 * too small to scroll rather than as a camera stuck against one wall.
 */
export function clampCameraAxis(
    centre: number,
    halfExtent: number,
    min: number,
    max: number,
): number {
    if (!(max > min)) return centre;
    if (max - min <= halfExtent * 2) return (min + max) / 2;
    return Math.min(Math.max(centre, min + halfExtent), max - halfExtent);
}

/** Hold every bounded camera inside its rectangle (called by the bounds system). */
export function cameraBoundsUpdate(world: World): void {
    for (const e of world.getEntitiesWithComponents([CameraBounds, Camera, Transform])) {
        const camera = world.get(e, Camera);
        // The half extents of a perspective camera depend on how far away the
        // thing being framed is, which is not a property of the camera; leaving
        // it alone beats clamping it against a number that means nothing here.
        if (camera.projectionType !== ProjectionType.Orthographic) continue;
        const bounds = world.get(e, CameraBounds);
        const transform = world.get(e, Transform);
        const halfHeight = camera.orthoSize;
        const halfWidth = halfHeight * (camera.aspectRatio > 0 ? camera.aspectRatio : 1);
        const x = clampCameraAxis(transform.position.x, halfWidth, bounds.minX, bounds.maxX);
        const y = clampCameraAxis(transform.position.y, halfHeight, bounds.minY, bounds.maxY);
        if (x === transform.position.x && y === transform.position.y) continue;
        world.set(e, Transform, {
            ...transform,
            position: { ...transform.position, x, y },
        });
    }
}
