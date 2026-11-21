// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The project's fixed timestep is the app's FixedUpdate step whether or not physics is installed.
 */
import { describe, expect, it } from 'vitest';
import { App } from '../src/app/app';
import { applyFixedTimestep } from '../src/runtime/runtimeLoader';

describe('the project fixed timestep', () => {
    it('becomes the FixedUpdate step of an app with no physics', () => {
        const app = App.new();
        expect(app.getFixedTimestep()).toBeCloseTo(1 / 60, 9);
        applyFixedTimestep(app, { fixedTimestep: 0.02 });
        expect(app.getFixedTimestep()).toBe(0.02);
    });

    it('leaves the app its own step when the project says nothing usable', () => {
        const app = App.new();
        for (const bad of [undefined, {}, { fixedTimestep: 0 }, { fixedTimestep: -1 }, { fixedTimestep: Number.NaN }]) {
            applyFixedTimestep(app, bad as { fixedTimestep?: number } | undefined);
            expect(app.getFixedTimestep()).toBeCloseTo(1 / 60, 9);
        }
    });
});
