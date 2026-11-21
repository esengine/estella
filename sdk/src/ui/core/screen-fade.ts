// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    screen-fade.ts
 * @brief   The screen faded to a colour: a Fade track and a cutscene's fade to black.
 *
 * @details A `ScreenFade` on any entity says how far the screen is faded (`amount`, 0 to 1) and to what `color`. A
 *          timeline fades in or out by keying `amount` on an ordinary property track; a script sets it. The strongest
 *          fade there is is drawn as one screen-filling colour over everything, 2D and 3D alike: a canvas of its own,
 *          made while there is a fade and gone when there is none, that does not take the pointer.
 */
import type { App } from '../../app/app';
import type { Color, Entity } from '../../types';
import { defineComponent, Canvas, Name, RuntimeOnly, Transform, registerComponent } from '../../ecs/component';
import { Schedule, defineSystem } from '../../ecs/system';
import { playModeOnly } from '../../ecs/env';
import { UINode } from './ui-node';
import { UIVisual } from './ui-visual';
import { percent } from './dimension';
import { UIPointerEvents, UIVisualType } from '../../wasm/wasm.generated';

export interface ScreenFadeData {
    /** How far the screen is faded, 0 (clear) to 1 (the colour). */
    amount: number;
    /** The colour faded to. */
    color: Color;
}

export const ScreenFade = defineComponent<ScreenFadeData>('ScreenFade', {
    amount: 0,
    color: { r: 0, g: 0, b: 0, a: 1 },
}, {
    fields: {
        amount: { min: 0, max: 1, step: 0.01, slider: true, tooltip: 'How far the screen is faded: 0 clear, 1 the colour. Key it on a timeline to fade.' },
        color: { tooltip: 'The colour the screen fades to.' },
    },
});

/** The strongest fade among `fades`: its amount (0 to 1) and colour. */
export function strongestFade(fades: readonly ScreenFadeData[]): { amount: number; color: Color } | null {
    let best: ScreenFadeData | null = null;
    for (const f of fades) if (f.amount > 0 && (!best || f.amount > best.amount)) best = f;
    if (!best) return null;
    return { amount: Math.min(1, best.amount), color: best.color };
}

/** @internal Composed once by UIPlugin: keeps the fade's canvas while any ScreenFade fades, in play. */
export function installScreenFade(app: App): () => void {
    registerComponent('ScreenFade', ScreenFade);
    const world = app.world;
    let overlay: Entity | null = null;
    const drop = () => {
        if (overlay !== null && world.valid(overlay)) world.despawn(overlay);
        overlay = null;
    };
    app.addSystemToSchedule(Schedule.PostUpdate, defineSystem([], () => {
        const fades: ScreenFadeData[] = [];
        for (const e of world.getEntitiesWithComponents([ScreenFade])) fades.push(world.get(e, ScreenFade));
        const fade = strongestFade(fades);
        if (!fade) { drop(); return; }
        const color = { r: fade.color.r, g: fade.color.g, b: fade.color.b, a: fade.amount * (fade.color.a ?? 1) };
        if (overlay === null || !world.valid(overlay)) {
            // Made last, so it is the last canvas drawn: over the game and its own UI.
            overlay = world.spawn('ScreenFade');
            world.insert(overlay, RuntimeOnly);
            world.insert(overlay, Name, { value: 'Screen Fade' });
            world.insert(overlay, Transform, {});
            world.insert(overlay, Canvas, {});
            world.insert(overlay, UINode, { width: percent(100), height: percent(100), pointerEvents: UIPointerEvents.None });
            world.insert(overlay, UIVisual, { visualType: UIVisualType.SolidColor, color });
            return;
        }
        const visual = world.get(overlay, UIVisual);
        const c = visual.color;
        if (c.r !== color.r || c.g !== color.g || c.b !== color.b || c.a !== color.a) world.set(overlay, UIVisual, { ...visual, color });
    }, { name: 'ScreenFadeSystem' }), { runIf: playModeOnly });
    return drop;
}
