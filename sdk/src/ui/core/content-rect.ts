// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ui/core/content-rect.ts
 * @brief   `ContentRect` — the rectangle world content occupies, and how renderers follow it.
 *
 * A `Sprite` has a size and pivot, a `Text` a box and a box pivot, and an entity that draws nothing has neither. `ContentRect` is the
 * one rectangle for all of them: write it, and the sprite and text on the same entity follow ({@link applyContentRect}); a clip
 * mask takes its box from it (C++, `RenderFrameMask`); a pointer can be tested against it ({@link contentRectContains}).
 *
 * It is for content placed by its `Transform` (an imported scene, a hand-built HUD). `UINode` remains the engine's box layout; an
 * entity with both keeps the layout's box for clipping.
 */
import { defineBuiltin, Sprite, Transform } from '../../ecs/component';
import type { ContentRectData } from '../../ecs/component.generated';
import type { World } from '../../ecs/world';
import type { Entity } from '../../types';
import { Text } from './text';

export type { ContentRectData };

export const ContentRect = defineBuiltin<ContentRectData>('ContentRect', {
    size: { x: 100, y: 100 },
    pivot: { x: 0.5, y: 0.5 },
});

const same = (a: { x: number; y: number }, b: { x: number; y: number }): boolean => a.x === b.x && a.y === b.y;

/**
 * Make the sprite and text on @p entity follow its `ContentRect`. Only what differs is written, so calling it again is free. Call it
 * after adding a `Sprite` or `Text` to an entity that already has a rect; the plugin calls it whenever a rect changes.
 */
export function applyContentRect(world: World, entity: Entity): void {
    const rect = world.tryGet(entity, ContentRect);
    if (!rect) return;
    if (world.has(entity, Sprite)) {
        const s = world.get(entity, Sprite);
        if (!same(s.size, rect.size) || !same(s.pivot, rect.pivot)) {
            world.set(entity, Sprite, { ...s, size: { x: rect.size.x, y: rect.size.y }, pivot: { x: rect.pivot.x, y: rect.pivot.y } });
        }
    }
    if (world.has(entity, Text)) {
        const t = world.get(entity, Text);
        if (t.boxWidth !== rect.size.x || t.boxHeight !== rect.size.y || !t.boxPivot || !same(t.boxPivot, rect.pivot)) {
            world.set(entity, Text, {
                ...t, boxWidth: rect.size.x, boxHeight: rect.size.y, boxPivot: { x: rect.pivot.x, y: rect.pivot.y },
            });
        }
    }
}

/** The corners-in-local-space test: whether the entity-space point (relative to its pivot, unscaled) is inside the rectangle. */
export function localPointInRect(rect: ContentRectData, x: number, y: number): boolean {
    const left = -rect.pivot.x * rect.size.x;
    const bottom = -rect.pivot.y * rect.size.y;
    return x >= left && x <= left + rect.size.x && y >= bottom && y <= bottom + rect.size.y;
}

/**
 * Whether the world point (@p worldX, @p worldY) is inside the entity's rectangle, with its transform's position, rotation and scale
 * applied. False for an entity without a rect, or with a scale of zero.
 */
export function contentRectContains(world: World, entity: Entity, worldX: number, worldY: number): boolean {
    const rect = world.tryGet(entity, ContentRect);
    if (!rect) return false;
    world.ensureTransformsComposed();
    const t = world.get(entity, Transform);
    const sx = t.worldScale.x, sy = t.worldScale.y;
    if (sx === 0 || sy === 0) return false;
    const dx = worldX - t.worldPosition.x, dy = worldY - t.worldPosition.y;
    // rotation about z only: the flat case a rectangle has
    const { z, w } = t.worldRotation;
    const angle = 2 * Math.atan2(z, w);
    const cos = Math.cos(-angle), sin = Math.sin(-angle);
    return localPointInRect(rect, (dx * cos - dy * sin) / sx, (dx * sin + dy * cos) / sy);
}
