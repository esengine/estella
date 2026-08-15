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
import { Schedule } from '../src/ecs/system';
import { simulationBasePlugins } from '../src/app/pluginSets';
import { setPlatform } from '../src/platform/base';
import { webAdapter } from '../src/platform/web';

const SCHEDULES = Object.entries(Schedule).filter(([, v]) => typeof v === 'number') as [string, Schedule][];

const build = (): App => {
    const app = App.new();
    for (const plugin of simulationBasePlugins()) app.addPlugin(plugin);
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

    // The escape hatch is still there and still costs everything: a system that
    // takes the World without declaring conflicts with every other system, so a
    // regression shows up as a schedule that cannot be batched at all.
    it('has no system that conflicts with everything', () => {
        const app = build();
        for (const [, schedule] of SCHEDULES) {
            const systems = app.scheduleBatches(schedule).flat();
            if (systems.length < 2) continue;
            const found = app.scheduleAmbiguities(schedule);
            expect(found.filter((f) => f.over.includes('the World itself'))).toEqual([]);
        }
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
