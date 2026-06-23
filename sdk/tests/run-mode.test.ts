// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    run-mode.test.ts
 * @brief   Editor/runtime + edit/play run mode (env.ts) gates gameplay systems.
 *
 * RC12 §E4: gameplay (simulation-advancing) systems gate on `playModeOnly`,
 * whose state now lives on AppContext. In editor edit mode they freeze while
 * edit-safe systems (no gate) keep ticking; in play mode or standalone runtime
 * they run.
 */
import { describe, expect, it, afterEach } from 'vitest';
import { App } from '../src/app';
import { Schedule, defineSystem } from '../src/system';
import { setEditorMode, setPlayMode, isEditor, isPlayMode, isRuntime, playModeOnly } from '../src/env';
import { getDefaultContext } from '../src/context';

function namedSystem(name: string, trace: string[]) {
    return defineSystem([], () => { trace.push(name); }, { name });
}

// Run mode lives on the (process-shared default) AppContext; reset so state
// never leaks into other test files.
afterEach(() => {
    setEditorMode(false);
    setPlayMode(false);
});

describe('run mode (env.ts over AppContext)', () => {
    it('defaults to standalone runtime: not editor, playModeOnly true', () => {
        expect(isEditor()).toBe(false);
        expect(isRuntime()).toBe(true);
        expect(isPlayMode()).toBe(false);
        expect(playModeOnly()).toBe(true);
    });

    it('editor edit mode freezes playModeOnly; play mode re-enables it', () => {
        setEditorMode(true);
        expect(isEditor()).toBe(true);
        expect(playModeOnly()).toBe(false); // edit mode → gameplay frozen

        setPlayMode(true);
        expect(playModeOnly()).toBe(true); // play mode → gameplay runs
    });

    it('state is backed by AppContext (not a separate module global)', () => {
        setEditorMode(true);
        setPlayMode(true);
        expect(getDefaultContext().editorMode).toBe(true);
        expect(getDefaultContext().playMode).toBe(true);

        getDefaultContext().reset();
        expect(isEditor()).toBe(false);
        expect(isPlayMode()).toBe(false);
    });

    it('scheduler skips gameplay (playModeOnly) systems in edit mode, keeps edit-safe ticking', async () => {
        const app = App.new();
        const trace: string[] = [];
        app.addSystemToSchedule(Schedule.Update, namedSystem('Gameplay', trace), { runIf: playModeOnly });
        app.addSystemToSchedule(Schedule.Update, namedSystem('Render', trace)); // edit-safe (no gate)

        // Editor edit mode → only the edit-safe system runs.
        setEditorMode(true);
        setPlayMode(false);
        await app.tick(1 / 60);
        expect(trace).toEqual(['Render']);

        // Play mode → both run.
        trace.length = 0;
        setPlayMode(true);
        await app.tick(1 / 60);
        expect(trace.sort()).toEqual(['Gameplay', 'Render']);
    });

    it('standalone runtime runs gameplay systems regardless of play flag', async () => {
        const app = App.new();
        const trace: string[] = [];
        app.addSystemToSchedule(Schedule.Update, namedSystem('Gameplay', trace), { runIf: playModeOnly });

        // editorMode false (default) → playModeOnly true even with playMode false.
        await app.tick(1 / 60);
        expect(trace).toEqual(['Gameplay']);
    });
});
