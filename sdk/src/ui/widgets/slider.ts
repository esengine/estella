// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { Entity } from '../../types';
import type { World } from '../../world';

import { UINode, type UINodeData } from '../core/ui-node';
import { px, percent } from '../core/dimension';
import { UIVisual, UIVisualType, type UIVisualData } from '../core/ui-visual';

import { spawnUIEntity, FILL_AXIS, type UINodeInit, type UIVisualInit } from './helpers';
import { themeColors } from '../theme/tokens';
import { markThemed } from '../theme/theme-style';

export interface SliderOptions {
    world: World;
    parent?: Entity;
    node?: UINodeInit;
    min?: number;
    max?: number;
    value?: number;
    /**
     * Optional quantization step. `0` (default) = continuous.
     */
    step?: number;
    /** Handle width in pixels. Default 12. */
    handleWidth?: number;

    trackVisual?: UIVisualInit;
    fillVisual?: UIVisualInit;
    handleVisual?: UIVisualInit;

    onChange?: (value: number, entity: Entity) => void;
}

export interface SliderHandle {
    readonly entity: Entity;
    readonly trackEntity: Entity;
    readonly fillEntity: Entity;
    readonly handleEntity: Entity;
    getValue(): number;
    setValue(value: number): void;
    /**
     * Translate a track-local x position (pixels from left) to a slider
     * value, clamped and optionally snapped to `step`. Caller wires
     * this to their drag / click handlers — v1 has no built-in input.
     */
    valueAtLocalX(localX: number, trackWidth: number): number;
    dispose(): void;
}

/**
 * Horizontal slider composed of a track, a fill bar, and a handle thumb.
 * Interaction (drag, click-to-snap) is not wired here — use
 * `valueAtLocalX()` with your own pointer handler, or call `setValue`
 * directly.
 */
export function createSlider(opts: SliderOptions): SliderHandle {
    const min = opts.min ?? 0;
    const max = opts.max ?? 1;
    const step = opts.step ?? 0;
    const handleWidth = opts.handleWidth ?? 12;
    let value = clampAndSnap(opts.value ?? min, min, max, step);

    const c = themeColors();

    // Slider fill is a horizontal Filled bar growing from the left — the same
    // partial-fill primitive progress uses, shared via FILL_AXIS.
    const [fillMethod, fillOrigin] = FILL_AXIS.right;

    const track = spawnUIEntity({
        world: opts.world,
        parent: opts.parent,
        node: opts.node ?? { fill: true },
        visual: opts.trackVisual ?? { color: c.track },
    });
    if (!opts.trackVisual) markThemed(opts.world, track, { visual: 'track' });

    const fill = spawnUIEntity({
        world: opts.world,
        parent: track,
        node: { fill: true },
        visual: {
            visualType: UIVisualType.Filled,
            fillMethod,
            fillOrigin,
            fillAmount: fraction(value, min, max),
            ...(opts.fillVisual ?? { color: c.primary }),
        },
    });
    if (!opts.fillVisual) markThemed(opts.world, fill, { visual: 'primary' });

    const handle = spawnUIEntity({
        world: opts.world,
        parent: track,
        node: handleNodeAt(fraction(value, min, max), handleWidth),
        visual: opts.handleVisual ?? { color: c.onPrimary },
    });
    if (!opts.handleVisual) markThemed(opts.world, handle, { visual: 'onPrimary' });

    // Value -> visuals: the fill's Filled amount is the value fraction (a
    // render-time crop, no relayout); the handle's left inset tracks it,
    // centered via a -half-width margin.
    function writeVisuals(t: number): void {
        const vis = opts.world.get(fill, UIVisual) as UIVisualData;
        vis.fillAmount = t;
        opts.world.insert(fill, UIVisual, vis);

        const handleNode = opts.world.get(handle, UINode) as UINodeData;
        handleNode.insetLeft = percent(t * 100);
        opts.world.insert(handle, UINode, handleNode);
    }

    function setValue(next: number): void {
        const v = clampAndSnap(next, min, max, step);
        if (v === value) return;
        value = v;
        writeVisuals(fraction(value, min, max));
        opts.onChange?.(value, track);
    }

    function valueAtLocalX(localX: number, trackWidth: number): number {
        if (trackWidth <= 0) return min;
        const t = clamp(localX / trackWidth, 0, 1);
        return clampAndSnap(min + t * (max - min), min, max, step);
    }

    return {
        entity: track,
        trackEntity: track,
        fillEntity: fill,
        handleEntity: handle,
        getValue: () => value,
        setValue,
        valueAtLocalX,
        dispose: () => {
            if (opts.world.valid(track)) opts.world.despawn(track);
        },
    };
}

function fraction(value: number, min: number, max: number): number {
    if (max <= min) return 0;
    return clamp((value - min) / (max - min), 0, 1);
}

// Handle: absolute, full height, fixed width, centered at the value fraction
// (left inset = t%, shifted left by half its width).
function handleNodeAt(t: number, width: number): UINodeInit {
    return {
        position: 1, // Absolute
        insetTop: px(0),
        insetBottom: px(0),
        insetLeft: percent(t * 100),
        marginLeft: px(-width / 2),
        width: px(width),
    };
}

function clamp(value: number, lo: number, hi: number): number {
    return value < lo ? lo : value > hi ? hi : value;
}

function clampAndSnap(value: number, min: number, max: number, step: number): number {
    const clamped = clamp(value, min, max);
    if (step <= 0) return clamped;
    const snapped = Math.round((clamped - min) / step) * step + min;
    return clamp(snapped, min, max);
}
