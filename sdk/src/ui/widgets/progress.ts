// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { Color, Entity } from '../../types';
import type { World } from '../../world';

import {
    UIVisual,
    UIVisualType,
    FillMethod,
    FillOrigin,
    type UIVisualData,
} from '../core/ui-visual';

import { spawnUIEntity, FILL_AXIS, type UINodeInit, type UIVisualInit, type LinearFillDirection } from '../core/compose';
import { themeColors } from '../theme/tokens';
import { markThemed } from '../theme/theme-style';

export interface ProgressOptions {
    world: World;
    parent?: Entity;
    node?: UINodeInit;
    /** Background (track) renderer. */
    background?: UIVisualInit;
    /** Fill renderer config (the filled bar). */
    fill?: { color?: Color; sprite?: number };
    /** Direction the fill grows (linear bars). Default: 'right'. */
    direction?: LinearFillDirection;
    /** Radial gauge: a clockwise wedge from 12 o'clock; `direction` is ignored. */
    radial?: boolean;
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
 * Linear progress bar. Two entities: a track (background) and a fill child
 * that stretches over the track as a {@link UIVisualType.Filled} visual —
 * `setValue` writes `fillAmount`, so the bar is a render-time crop with no
 * per-frame layout pass, and a sprite fill reveals (not stretches). Direction
 * selects the fill axis/origin.
 */
export function createProgress(opts: ProgressOptions): ProgressHandle {
    const { world } = opts;
    const direction = opts.direction ?? 'right';
    let value = clamp01(opts.value ?? 0);
    const c = themeColors();
    const [fillMethod, fillOrigin] = opts.radial
        ? ([FillMethod.Radial360, FillOrigin.Top] as const)
        : FILL_AXIS[direction];

    const track = spawnUIEntity({
        world,
        parent: opts.parent,
        node: opts.node ?? { fill: true },
        visual: opts.background ?? { color: c.track },
    });
    if (!opts.background) markThemed(world, track, { visual: 'track' });

    const fill = spawnUIEntity({
        world,
        parent: track,
        node: { fill: true },
        visual: {
            visualType: UIVisualType.Filled,
            color: opts.fill?.color ?? c.primary,
            texture: opts.fill?.sprite ?? 0,
            fillMethod,
            fillOrigin,
            fillAmount: value,
        },
    });
    if (opts.fill?.color === undefined) markThemed(world, fill, { visual: 'primary' });

    function setValue(v: number): void {
        const next = clamp01(v);
        if (next === value) return;
        value = next;
        const vis = world.get(fill, UIVisual) as UIVisualData;
        vis.fillAmount = value;
        world.insert(fill, UIVisual, vis);
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
