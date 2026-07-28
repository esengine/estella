// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ui/behavior/slider.ts
 * @brief   UISlider — data-driven slider state + input.
 *
 * The component IS the slider's state (min/max/step/value + its fill/handle
 * entity refs); the system is the single writer of the visuals, re-deriving
 * them whenever `value` differs from what's on screen. Any writer — pointer
 * drag, keyboard, `handle.setValue`, a data binding, the editor inspector —
 * just writes `value`, and change events fire uniformly for all of them.
 */
import { defineComponent } from '../../ecs/component';
import { defineSystem, type SystemDef } from '../../ecs/system';
import { Res } from '../../ecs/resource';
import { Input, type InputState } from '../../input/input';
import { Transform, type TransformData } from '../../ecs/component';
import type { World } from '../../ecs/world';
import type { Entity } from '../../types';
import { UIVisual, type UIVisualData } from '../core/ui-visual';
import { UINode, type UINodeData } from '../core/ui-node';
import { percent } from '../core/dimension';
import { UICameraInfo, type UICameraData } from '../core/ui-camera-info';
import { UIInteraction, type UIInteractionData } from '../input/interactable';
import { Interactable, type InteractableData } from '../input/interactable';
import { Focusable, type FocusableData } from '../input/focusable';
import { UIEventType, type UIEventQueue } from '../core/events';
import { EntityStateMap, getUINodeWidth } from '../util/helpers';

export interface UISliderData {
    min: number;
    max: number;
    /** Quantization step; 0 = continuous. */
    step: number;
    value: number;
    /** The Filled fill bar entity (fillAmount tracks the value fraction). */
    fill: Entity;
    /** The handle thumb entity (insetLeft tracks the value fraction). */
    handle: Entity;
}

export const UISlider = defineComponent<UISliderData>('UISlider', {
    min: 0,
    max: 1,
    step: 0,
    value: 0,
    fill: 0 as Entity,
    handle: 0 as Entity,
}, { entityFields: ['fill', 'handle'] });

export function sliderClamp(v: number, d: { min: number; max: number; step: number }): number {
    const clamped = v < d.min ? d.min : v > d.max ? d.max : v;
    if (d.step <= 0) return clamped;
    const snapped = Math.round((clamped - d.min) / d.step) * d.step + d.min;
    return snapped < d.min ? d.min : snapped > d.max ? d.max : snapped;
}

export function sliderFraction(d: { min: number; max: number; value: number }): number {
    if (d.max <= d.min) return 0;
    const t = (d.value - d.min) / (d.max - d.min);
    return t < 0 ? 0 : t > 1 ? 1 : t;
}

/** Keyboard nudge: explicit step, else 1% of the range. */
function keyStep(d: UISliderData): number {
    return d.step > 0 ? d.step : (d.max - d.min) / 100;
}

/**
 * Pointer drag (press-capture on the track), keyboard (arrows/Home/End while
 * focused), and value→visual sync for every UISlider.
 */
export function createSliderSystem(world: World, events: UIEventQueue): SystemDef {
    // Press on a track captures the drag until release, even off-entity.
    let active: Entity | null = null;
    const shown = new EntityStateMap<number>(); // last value whose visuals were applied

    return defineSystem(
        [Res(Input), Res(UICameraInfo)],
        (input: InputState, camera: UICameraData) => {
            for (const e of world.getEntitiesWithComponents([UISlider])) {
                const d = world.get(e, UISlider) as UISliderData;
                let next = d.value;

                const enabled = !world.has(e, Interactable)
                    || (world.get(e, Interactable) as InteractableData).enabled;

                // Pointer: capture on press, track while held.
                if (enabled && world.has(e, UIInteraction)
                    && (world.get(e, UIInteraction) as UIInteractionData).justPressed) {
                    active = e;
                }
                if (active === e) {
                    if (!input.isMouseButtonDown(0)) {
                        active = null;
                    } else if (camera.valid && world.has(e, Transform)) {
                        const t = world.get(e, Transform) as TransformData;
                        const w = getUINodeWidth(e) * t.worldScale.x;
                        if (w > 0) {
                            const left = t.worldPosition.x - w / 2;
                            next = sliderClamp(
                                d.min + ((camera.worldMouseX - left) / w) * (d.max - d.min), d);
                        }
                    }
                }

                // Keyboard while focused.
                if (enabled && world.has(e, Focusable)
                    && (world.get(e, Focusable) as FocusableData).isFocused) {
                    const s = keyStep(d);
                    if (input.isKeyPressed('ArrowLeft') || input.isKeyPressed('ArrowDown')) {
                        next = sliderClamp(next - s, d);
                    }
                    if (input.isKeyPressed('ArrowRight') || input.isKeyPressed('ArrowUp')) {
                        next = sliderClamp(next + s, d);
                    }
                    if (input.isKeyPressed('Home')) next = d.min;
                    if (input.isKeyPressed('End')) next = d.max;
                }

                if (next !== d.value) {
                    d.value = next;
                    world.insert(e, UISlider, d);
                }

                // Value → visuals + change event, whoever wrote the value.
                if (shown.get(e) !== d.value) {
                    const emitChange = shown.has(e); // first sync is initial paint, not a change
                    shown.set(e, d.value);
                    const frac = sliderFraction(d);
                    if (world.valid(d.fill) && world.has(d.fill, UIVisual)) {
                        const vis = world.get(d.fill, UIVisual) as UIVisualData;
                        if (vis.fillAmount !== frac) {
                            vis.fillAmount = frac;
                            world.insert(d.fill, UIVisual, vis);
                        }
                    }
                    if (world.valid(d.handle) && world.has(d.handle, UINode)) {
                        const n = world.get(d.handle, UINode) as UINodeData;
                        n.insetLeft = percent(frac * 100);
                        world.insert(d.handle, UINode, n);
                    }
                    if (emitChange) events.emit(e, UIEventType.Change, { value: d.value });
                }
            }
            shown.cleanup(world);
        },
        { name: 'UISliderSystem' },
    );
}
