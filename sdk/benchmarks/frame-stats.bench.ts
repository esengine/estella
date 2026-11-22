// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { afterAll, bench, describe } from 'vitest';
import { App } from '../src/app/app';
import { frameStatsReport } from '../src/runtime/frameStats';

describe('Profiler - 100 frame reports', () => {
    for (const count of [0, 1000, 50000]) {
        const app = App.new();
        for (let i = 0; i < count; i++) app.world.spawn();
        afterAll(() => app.quit());

        bench(`${count} entities`, () => {
            for (let i = 0; i < 100; i++) {
                if (frameStatsReport(app).entities !== count) throw new Error('Incorrect entity count');
            }
        });
    }
});
