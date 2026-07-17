// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { Entity } from '../../types';
import type { World } from '../../world';

import { px, percent } from '../core/dimension';
import { UIVisualType } from '../core/ui-visual';
import { UIEventType, type UIEventQueue } from '../core/events';

import { spawnUIEntity, FILL_AXIS, type UINodeInit, type UIVisualInit } from '../core/compose';
import { makeWidgetInteractable } from '../input/interactable';
import { themeColors } from '../theme/tokens';
import { markThemed } from '../theme/theme-style';
import { UISlider, sliderClamp, sliderFraction, type UISliderData } from '../behavior/slider';

export interface SliderOptions {
    world: World;
    events: UIEventQueue;
    parent?: Entity;
    node?: UINodeInit;
    min?: number;
    max?: number;
    value?: number;
    /**
     * Optional quantization step. `0` (default) = continuous. Also the
     * keyboard nudge; a continuous slider nudges by 1% of the range.
     */
    step?: number;
    /** Handle width in pixels. Default 12. */
    handleWidth?: number;
    /** Start disabled. */
    disabled?: boolean;
    /** Participate in Tab traversal + arrow-key nudging. Default true. */
    focusable?: boolean;
    tabIndex?: number;

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
    dispose(): void;
}

/**
 * Horizontal slider composed of a track, a fill bar, and a handle thumb.
 * State + input live in the {@link UISlider} component and its behavior
 * system: pointer drag (press-capture on the track), arrow keys / Home / End
 * while focused, and value→visual sync for any writer — this handle, a
 * binding, or the editor inspector.
 */
export function createSlider(opts: SliderOptions): SliderHandle {
    const { world, events } = opts;
    const min = opts.min ?? 0;
    const max = opts.max ?? 1;
    const step = opts.step ?? 0;
    const handleWidth = opts.handleWidth ?? 12;
    const value = sliderClamp(opts.value ?? min, { min, max, step });
    const frac = sliderFraction({ min, max, value });

    const c = themeColors();

    // Slider fill is a horizontal Filled bar growing from the left — the same
    // partial-fill primitive progress uses, shared via FILL_AXIS.
    const [fillMethod, fillOrigin] = FILL_AXIS.right;

    const track = spawnUIEntity({
        world,
        parent: opts.parent,
        node: opts.node ?? { fill: true },
        visual: opts.trackVisual ?? { color: c.track },
    });
    if (!opts.trackVisual) markThemed(world, track, { visual: 'track' });
    makeWidgetInteractable(world, track, {
        disabled: opts.disabled,
        focusable: opts.focusable,
        tabIndex: opts.tabIndex,
    });

    const fill = spawnUIEntity({
        world,
        parent: track,
        node: { fill: true },
        visual: {
            visualType: UIVisualType.Filled,
            fillMethod,
            fillOrigin,
            fillAmount: frac,
            ...(opts.fillVisual ?? { color: c.primary }),
        },
    });
    if (!opts.fillVisual) markThemed(world, fill, { visual: 'primary' });

    const handle = spawnUIEntity({
        world,
        parent: track,
        node: handleNodeAt(frac, handleWidth),
        visual: opts.handleVisual ?? { color: c.onPrimary },
    });
    if (!opts.handleVisual) markThemed(world, handle, { visual: 'onPrimary' });

    world.insert(track, UISlider, { min, max, step, value, fill, handle });

    const offChange = opts.onChange
        ? events.on(track, UIEventType.Change, (ev) => {
              opts.onChange!((ev.data as { value: number }).value, track);
          })
        : undefined;

    return {
        entity: track,
        trackEntity: track,
        fillEntity: fill,
        handleEntity: handle,
        getValue: () => (world.get(track, UISlider) as UISliderData).value,
        setValue: (next: number) => {
            const d = world.get(track, UISlider) as UISliderData;
            const v = sliderClamp(next, d);
            if (v !== d.value) {
                d.value = v;
                world.insert(track, UISlider, d);
            }
        },
        dispose: () => {
            offChange?.();
            if (world.valid(track)) world.despawn(track);
        },
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
