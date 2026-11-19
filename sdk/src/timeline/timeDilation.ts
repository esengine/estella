// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    timeDilation.ts
 * @brief   Slow motion and fast forward, kept as a component: UE's Time Dilation track.
 *
 * @details A `TimeDilation` on any entity scales how fast the game's time runs (`Time.scale`); a timeline keys its
 *          `scale` on an ordinary property track for a slow-motion beat, a script sets it for a bullet-time power. Several
 *          multiply. They multiply the scale the GAME sets, never replace it: a game paused at 0 stays paused through a
 *          slow-motion beat, and its own scale comes back whole when the dilation ends.
 */
import type { App } from '../app/app';
import { defineComponent, registerComponent } from '../ecs/component';
import { Schedule, defineSystem } from '../ecs/system';
import { Res, Time, type TimeData } from '../ecs/resource';
import { playModeOnly } from '../ecs/env';

export interface TimeDilationData {
    /** How fast time runs: 1 as it is, 0.25 a quarter speed, 2 twice as fast. */
    scale: number;
}

export const TimeDilation = defineComponent<TimeDilationData>('TimeDilation', { scale: 1 }, {
    fields: {
        scale: { min: 0, max: 4, step: 0.05, tooltip: 'How fast the game runs while this is on: 0.25 is slow motion. Key it on a timeline for a slow-motion beat.' },
    },
});

/**
 * Keeps `Time.scale` at the game's own scale times every dilation's. The game's scale is whatever `Time.scale` was
 * last set to by anything but this: told apart from this system's own write by remembering that write.
 */
export function installTimeDilation(app: App): void {
    registerComponent('TimeDilation', TimeDilation);
    const world = app.world;
    let base: number | null = null;
    let wrote = 1;
    app.addSystemToSchedule(Schedule.PostUpdate, defineSystem([Res(Time)], (time: TimeData) => {
        let product = 1, any = false;
        for (const e of world.getEntitiesWithComponents([TimeDilation])) {
            product *= Math.max(0, world.get(e, TimeDilation).scale);
            any = true;
        }
        if (base !== null && time.scale !== wrote) base = time.scale; // the game set its own since
        if (!any || product === 1) {
            if (base !== null) { time.scale = base; base = null; }
            return;
        }
        if (base === null) base = time.scale;
        time.scale = base * product;
        wrote = time.scale;
    }, { name: 'TimeDilationSystem' }), { runIf: playModeOnly });
}
