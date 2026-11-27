// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ui/behavior/meter.ts
 * @brief   A meter that says how much a blow took: health, stamina, a shield, a boss bar.
 *
 * @details The game writes one number, `value` (0..1). The fill shows it at once when it drops, and a ghost behind the fill (a
 *          second Filled visual, usually in the accent colour) keeps the old amount for a moment, then falls to the new one. Hits
 *          in quick succession keep the ghost up, so a combo reads as one big loss. When the value rises the fill climbs to it
 *          over `riseTime`, and the ghost never shows below the fill. Outside Play the fill and the ghost show the value as it is,
 *          so a meter is placed and judged in the editor at its real amount.
 */
import { defineComponent } from '../../ecs/component';
import { defineSystem, type SystemDef } from '../../ecs/system';
import { Res, Time, type TimeData } from '../../ecs/resource';
import { isPlayMode } from '../../ecs/env';
import type { World } from '../../ecs/world';
import type { Entity } from '../../types';
import { UIVisual, type UIVisualData } from '../core/ui-visual';
import { EntityStateMap } from '../util/helpers';

export interface UIMeterData {
    /** How full it is, 0..1: what the game writes. */
    value: number;
    /** The Filled visual that shows the value (its fillAmount is driven). */
    fill: Entity;
    /** The Filled visual behind the fill that falls to a lowered value a moment later (0 for none). */
    ghost: Entity;
    /** Seconds the ghost holds the old amount after a drop before it falls; another drop within it starts the hold again. */
    holdTime: number;
    /** Seconds the ghost takes to fall to the value once its hold is over, easing out (quick at first, gentle as it arrives). */
    fallTime: number;
    /** Seconds a rise across the whole meter takes the fill (it climbs at that rate); 0 shows a rise at once. */
    riseTime: number;
}

export const UIMeter = defineComponent<UIMeterData>('UIMeter', {
    value: 1,
    fill: 0 as Entity,
    ghost: 0 as Entity,
    holdTime: 0.25,
    fallTime: 0.6,
    riseTime: 0.3,
}, {
    entityFields: ['fill', 'ghost'],
    fields: {
        value: { min: 0, max: 1, step: 0.01, tooltip: 'How full the meter is, 0..1: what the game writes.' },
        fill: { tooltip: 'The Filled UIVisual that shows the value.' },
        ghost: { tooltip: 'A Filled UIVisual behind the fill, usually in the accent colour: it keeps the old amount a moment after a drop, then falls to the new one, so a hit reads as how much it took. Empty for none.' },
        holdTime: { min: 0, step: 0.05, tooltip: 'Seconds the ghost holds after a drop before it falls. Another drop within it starts the hold again, so a combo reads as one loss.' },
        fallTime: { min: 0, step: 0.05, tooltip: 'Seconds the ghost takes to fall to the value, easing out.' },
        riseTime: { min: 0, step: 0.05, tooltip: 'Seconds the fill takes to climb across the whole meter when the value rises. 0 shows a rise at once.' },
    },
});

/** What a meter is showing between frames. */
export interface MeterShown {
    fill: number;
    ghost: number;
    /** Seconds the ghost still holds before it falls. */
    hold: number;
    /** Where the ghost started its fall, and how many seconds it has been falling. */
    from: number;
    fell: number;
}

const clamp01 = (v: number): number => (Number.isFinite(v) ? (v < 0 ? 0 : v > 1 ? 1 : v) : 0);

/**
 * One step of a meter: where its fill and ghost stand after @p dt seconds toward @p d.value. Pure. With no @p shown (a meter seen
 * for the first time) both stand at the value.
 */
export function stepMeter(shown: MeterShown | undefined, d: Pick<UIMeterData, 'value' | 'holdTime' | 'fallTime' | 'riseTime'>, dt: number): MeterShown {
    const v = clamp01(d.value);
    if (!shown) return { fill: v, ghost: v, hold: 0, from: v, fell: 0 };
    let { fill, ghost, hold, from, fell } = shown;
    const step = Math.max(0, dt);
    if (v < fill) {
        // A drop: the fill shows it at once, the ghost keeps the higher of where it was and where the fill was, and holds.
        ghost = Math.max(ghost, fill);
        fill = v;
        hold = Math.max(0, d.holdTime);
        from = ghost;
        fell = 0;
    } else if (v > fill) {
        fill = d.riseTime > 0 ? Math.min(v, fill + step / d.riseTime) : v;
    }
    if (ghost > fill) {
        if (hold > 0) {
            // What is left of this step after the hold runs out is spent falling.
            const left = step - hold;
            hold = Math.max(0, hold - step);
            if (left > 0) fell += left;
        } else {
            fell += step;
        }
        if (hold <= 0) {
            // Eased out (cubic) over fallTime from where the fall began, never below the fill.
            const x = d.fallTime > 0 ? Math.min(1, fell / d.fallTime) : 1;
            const eased = 1 - (1 - x) ** 3;
            ghost = eased >= 1 ? fill : Math.max(fill, from + (fill - from) * eased);
        }
    } else {
        ghost = fill;
        hold = 0;
        from = fill;
        fell = 0;
    }
    return { fill, ghost, hold, from, fell };
}

/** Drives every UIMeter's fill and ghost from its value, on the game's clock. */
export function createMeterSystem(world: World): SystemDef {
    const shown = new EntityStateMap<MeterShown>();
    const setFill = (e: Entity, amount: number): void => {
        if (!e || !world.valid(e) || !world.has(e, UIVisual)) return;
        const visual = world.get(e, UIVisual) as UIVisualData;
        if (Math.abs(visual.fillAmount - amount) < 1e-5) return;
        world.insert(e, UIVisual, { ...visual, fillAmount: amount });
    };
    return defineSystem([Res(Time)], (time: TimeData) => {
        const live = isPlayMode();
        for (const e of world.getEntitiesWithComponents([UIMeter])) {
            const d = world.get(e, UIMeter) as UIMeterData;
            const next = stepMeter(live ? shown.get(e) : undefined, d, time.delta);
            shown.set(e, next);
            setFill(d.fill, next.fill);
            setFill(d.ghost, next.ghost);
        }
        shown.cleanup(world);
    }, { name: 'UIMeterSystem' });
}
