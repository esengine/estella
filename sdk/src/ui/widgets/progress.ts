// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { Color, Entity } from '../../types';
import type { World } from '../../world';

import { UINode, type UINodeData } from '../core/ui-node';
import { px, percent } from '../core/dimension';

import { spawnUIEntity, type UINodeInit, type UIVisualInit } from './helpers';
import { themeColors } from '../theme/tokens';

export interface ProgressOptions {
    world: World;
    parent?: Entity;
    node?: UINodeInit;
    /** Background (track) renderer. */
    background?: UIVisualInit;
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
    const c = themeColors();

    const track = spawnUIEntity({
        world,
        parent: opts.parent,
        node: opts.node ?? { fill: true },
        visual: opts.background ?? { color: c.track },
    });

    const fill = spawnUIEntity({
        world,
        parent: track,
        node: nodeForProgress(direction, value),
        visual: {
            color: opts.fill?.color ?? c.primary,
            texture: opts.fill?.sprite ?? 0,
            visualType: opts.fill?.sprite ? 2 /* Image */ : 1 /* SolidColor */,
        },
    });

    const horizontal = direction === 'right' || direction === 'left';

    function setValue(v: number): void {
        const next = clamp01(v);
        if (next === value) return;
        value = next;
        const node = world.get(fill, UINode) as UINodeData;
        if (horizontal) node.width = percent(value * 100);
        else node.height = percent(value * 100);
        world.insert(fill, UINode, node);
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

// Fill grows along `dir`: pinned to 3 edges, with width/height = value fraction.
function nodeForProgress(
    dir: 'right' | 'left' | 'up' | 'down',
    t: number,
): UINodeInit {
    switch (dir) {
        case 'right':
            return { position: 1, insetLeft: px(0), insetTop: px(0), insetBottom: px(0), width: percent(t * 100) };
        case 'left':
            return { position: 1, insetRight: px(0), insetTop: px(0), insetBottom: px(0), width: percent(t * 100) };
        case 'up':
            return { position: 1, insetLeft: px(0), insetRight: px(0), insetBottom: px(0), height: percent(t * 100) };
        case 'down':
            return { position: 1, insetLeft: px(0), insetRight: px(0), insetTop: px(0), height: percent(t * 100) };
    }
}
