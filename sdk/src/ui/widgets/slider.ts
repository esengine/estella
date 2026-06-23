// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { Entity } from '../../types';
import type { World } from '../../world';

import { UINode, type UINodeData } from '../core/ui-node';
import { px, percent } from '../core/dimension';

import { spawnUIEntity, type UINodeInit, type UIRendererInit } from './helpers';

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

    trackRenderer?: UIRendererInit;
    fillRenderer?: UIRendererInit;
    handleRenderer?: UIRendererInit;

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

const DEFAULT_TRACK: UIRendererInit = { color: { r: 0.15, g: 0.15, b: 0.15, a: 1 } };
const DEFAULT_FILL:  UIRendererInit = { color: { r: 0.25, g: 0.56, b: 0.96, a: 1 } };
const DEFAULT_HANDLE: UIRendererInit = { color: { r: 1,    g: 1,    b: 1,    a: 1 } };

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

    const track = spawnUIEntity({
        world: opts.world,
        parent: opts.parent,
        node: opts.node ?? { fill: true },
        renderer: opts.trackRenderer ?? DEFAULT_TRACK,
    });

    const fill = spawnUIEntity({
        world: opts.world,
        parent: track,
        node: fillNodeAt(fraction(value, min, max)),
        renderer: opts.fillRenderer ?? DEFAULT_FILL,
    });

    const handle = spawnUIEntity({
        world: opts.world,
        parent: track,
        node: handleNodeAt(fraction(value, min, max), handleWidth),
        renderer: opts.handleRenderer ?? DEFAULT_HANDLE,
    });

    // Value -> geometry: the fill's width is the value fraction; the handle's
    // left inset tracks it (centered via a -half-width margin). CSS-box version
    // of the old anchor mutation. (A driver system owns this in the F7 rework.)
    function writeVisuals(t: number): void {
        const fillNode = opts.world.get(fill, UINode) as UINodeData;
        fillNode.width = percent(t * 100);
        opts.world.insert(fill, UINode, fillNode);

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

// Fill: absolute, pinned to the track's left/top/bottom, width = value fraction.
function fillNodeAt(t: number): UINodeInit {
    return {
        position: 1, // Absolute
        insetLeft: px(0),
        insetTop: px(0),
        insetBottom: px(0),
        width: percent(t * 100),
    };
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
