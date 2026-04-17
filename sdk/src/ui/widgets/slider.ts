import type { Entity } from '../../types';
import type { World } from '../../world';

import { UIRect, type UIRectData } from '../core/ui-rect';

import { spawnUIEntity, type UIRectInit, type UIRendererInit } from './helpers';

export interface SliderOptions {
    world: World;
    parent?: Entity;
    rect?: UIRectInit;
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
        rect: opts.rect,
        renderer: opts.trackRenderer ?? DEFAULT_TRACK,
    });

    const fill = spawnUIEntity({
        world: opts.world,
        parent: track,
        rect: fillRectAt(fraction(value, min, max)),
        renderer: opts.fillRenderer ?? DEFAULT_FILL,
    });

    const handle = spawnUIEntity({
        world: opts.world,
        parent: track,
        rect: handleRectAt(fraction(value, min, max), handleWidth),
        renderer: opts.handleRenderer ?? DEFAULT_HANDLE,
    });

    function writeVisuals(t: number): void {
        const fillRect = opts.world.get(fill, UIRect) as UIRectData;
        fillRect.anchorMax = { x: t, y: 1 };
        opts.world.insert(fill, UIRect, fillRect);

        const handleRect = opts.world.get(handle, UIRect) as UIRectData;
        handleRect.anchorMin = { x: t, y: 0 };
        handleRect.anchorMax = { x: t, y: 1 };
        opts.world.insert(handle, UIRect, handleRect);
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

function fillRectAt(t: number): UIRectInit {
    return {
        anchorMin: { x: 0, y: 0 },
        anchorMax: { x: t, y: 1 },
        offsetMin: { x: 0, y: 0 },
        offsetMax: { x: 0, y: 0 },
    };
}

function handleRectAt(t: number, width: number): UIRectInit {
    return {
        anchorMin: { x: t, y: 0 },
        anchorMax: { x: t, y: 1 },
        offsetMin: { x: 0, y: 0 },
        offsetMax: { x: 0, y: 0 },
        size: { x: width, y: 0 },
        pivot: { x: 0.5, y: 0.5 },
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
