// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A host that reviews a game by its first rendered frame hears about it
 *        once, after that frame — Bilibili's `bl.launchSuccess`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { App } from '../src/app/app';
import { AppContext, setDefaultContext } from '../src/ecs/context';
import { reportFirstFrame } from '../src/runtime/miniGameRuntime';

beforeEach(() => setDefaultContext(new AppContext()));

describe('reportFirstFrame', () => {
    it('tells the host after the first frame, and only then', async () => {
        const app = App.new();
        const launchSuccess = vi.fn();
        reportFirstFrame(app, { launchSuccess });
        expect(launchSuccess).not.toHaveBeenCalled();
        await app.tick(1 / 60);
        await app.tick(1 / 60);
        expect(launchSuccess).toHaveBeenCalledTimes(1);
    });

    it('adds nothing for a host without the call', () => {
        const app = { addSystemToSchedule: vi.fn() };
        reportFirstFrame(app as never, {});
        expect(app.addSystemToSchedule).not.toHaveBeenCalled();
    });

    it('does not let a throwing host take the frame down', async () => {
        const app = App.new();
        reportFirstFrame(app, { launchSuccess: () => { throw new Error('host broke'); } });
        await expect(app.tick(1 / 60)).resolves.not.toThrow();
    });
});
