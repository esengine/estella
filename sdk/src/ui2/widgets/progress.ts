import type { Color, Entity } from '../../types';
import type { World } from '../../world';

import { UIRect, type UIRectData } from '../core/ui-rect';

import { spawnUIEntity, type UIRectInit, type UIRendererInit } from './helpers';

export interface ProgressOptions {
    world: World;
    parent?: Entity;
    rect?: UIRectInit;
    /** Background (track) renderer. */
    background?: UIRendererInit;
    /** Fill renderer config (the filled bar). */
    fill?: { color?: Color; sprite?: number };
    /** Direction the fill grows. Default: 'right'. */
    direction?: 'right' | 'left' | 'up' | 'down';
    /** Initial progress 0..1. Default 0. */
    value?: number;
}

export interface ProgressHandle {
    readonly entity: Entity;
    readonly fillEntity: Entity;
    value(): number;
    setValue(v: number): void;
    dispose(): void;
}

/**
 * Linear progress bar. Two entities: a track (background) and a fill
 * child whose rect anchors are rewritten each setValue to grow along
 * the configured direction.
 */
export function createProgress(opts: ProgressOptions): ProgressHandle {
    const { world } = opts;
    const direction = opts.direction ?? 'right';
    let value = clamp01(opts.value ?? 0);

    const track = spawnUIEntity({
        world,
        parent: opts.parent,
        rect: opts.rect,
        renderer: opts.background ?? { color: { r: 0.15, g: 0.15, b: 0.15, a: 1 } },
    });

    const fill = spawnUIEntity({
        world,
        parent: track,
        rect: anchorsForProgress(direction, value),
        renderer: {
            color: opts.fill?.color ?? { r: 0.25, g: 0.56, b: 0.96, a: 1 },
            texture: opts.fill?.sprite ?? 0,
            visualType: opts.fill?.sprite ? 2 /* Image */ : 1 /* SolidColor */,
        },
    });

    function setValue(v: number): void {
        const next = clamp01(v);
        if (next === value) return;
        value = next;
        const rect = world.get(fill, UIRect) as UIRectData;
        const updated = anchorsForProgress(direction, value);
        rect.anchorMin = updated.anchorMin!;
        rect.anchorMax = updated.anchorMax!;
        world.insert(fill, UIRect, rect);
    }

    return {
        entity: track,
        fillEntity: fill,
        value: () => value,
        setValue,
        dispose: () => {
            if (world.valid(track)) world.despawn(track);
        },
    };
}

function clamp01(v: number): number {
    return v < 0 ? 0 : v > 1 ? 1 : v;
}

function anchorsForProgress(
    dir: 'right' | 'left' | 'up' | 'down',
    t: number,
): UIRectInit {
    switch (dir) {
        case 'right':
            return { anchorMin: { x: 0, y: 0 }, anchorMax: { x: t, y: 1 } };
        case 'left':
            return { anchorMin: { x: 1 - t, y: 0 }, anchorMax: { x: 1, y: 1 } };
        case 'up':
            return { anchorMin: { x: 0, y: 0 }, anchorMax: { x: 1, y: t } };
        case 'down':
            return { anchorMin: { x: 0, y: 1 - t }, anchorMax: { x: 1, y: 1 } };
    }
}
