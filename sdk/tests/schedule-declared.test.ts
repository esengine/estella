// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The engine's OWN schedules, judged by what its systems declare.
 *
 *        schedule-ambiguity.test.ts proves the analysis works on systems written
 *        for it. This asks the question of the real stack, which is where it was
 *        useless until recently: every gameplay system took the World and said
 *        nothing, so all nine pairs it reported were "the World itself" — a
 *        finding with no action attached, hiding the one real collision.
 *
 *        Now the answer is a list short enough to be a rule: nothing in the
 *        engine's own schedules may touch the same data with nobody having
 *        decided the order.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { App } from '../src/app/app';
import { Schedule, defineSystem, GetWorld } from '../src/ecs/system';
import { simulationBasePlugins } from '../src/app/pluginSets';
import { StatsPlugin } from '../src/stats';
import { registerCharacterControllerSystem } from '../src/physics/CharacterController';
import { setPlatform } from '../src/platform/base';
import { webAdapter } from '../src/platform/web';

const SCHEDULES = Object.entries(Schedule).filter(([, v]) => typeof v === 'number') as [string, Schedule][];

/**
 * The base stack plus the two systems that declare but are not in it: the stats
 * overlay is opt-in, and the character controller is registered by hand next to
 * physics. Left out, their claims were the only ones nothing was holding.
 */
const build = (): App => {
    const app = App.new();
    for (const plugin of simulationBasePlugins()) app.addPlugin(plugin);
    app.addPlugin(new StatsPlugin({ overlay: false }));
    registerCharacterControllerSystem(app);
    return app;
};

beforeAll(() => {
    setPlatform(webAdapter);
});

describe('the engine stack', () => {
    it.each(SCHEDULES)('leaves nothing unordered in %s', (_name, schedule) => {
        const found = build().scheduleAmbiguities(schedule);
        expect(found.map((f) => `${f.a} <-> ${f.b} over ${f.over.join(', ')}`)).toEqual([]);
    });

    // An undeclared system conflicts with EVERYTHING, so a probe touching
    // nothing still collides with it — which is how a schedule holding a single
    // system (FixedUpdate: the character controller, alone) gets judged at all.
    it.each(SCHEDULES)('has nobody holding the World silently in %s', (_name, schedule) => {
        const app = build();
        app.addSystemToSchedule(schedule,
            defineSystem([GetWorld()], () => { }, { name: 'DeclarationProbe', touches: {} }));
        const found = app.scheduleAmbiguities(schedule);
        expect(found.filter((f) => f.over.includes('the World itself'))).toEqual([]);
    });

    // What the declarations bought, in the one number that shows it: before
    // them, Update's four systems needed four batches — nothing could ever run
    // beside anything.
    it('can batch Update rather than running it entirely one at a time', () => {
        const app = build();
        const batches = app.scheduleBatches(Schedule.Update);
        expect(batches.flat().length).toBeGreaterThan(batches.length);
    });
});
