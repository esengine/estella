// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * The pipeline encodes a linear frame for the display, so a new App on a renderer
 * that outlived the last one must find it running, effects or no effects.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initPostProcessAPI, shutdownPostProcessAPI } from '../src/postprocess/PostProcessAPI';

function core(running: boolean) {
    const calls: string[] = [];
    let up = running;
    return {
        calls,
        postprocess_isInitialized: () => up,
        postprocess_init: () => { calls.push('init'); up = true; return true; },
        postprocess_shutdown: () => { calls.push('shutdown'); up = false; },
    };
}

describe('a new App on a renderer that outlived the last', () => {
    // What one test owes must not reach the next: a core with nothing to shut down clears it.
    beforeEach(() => { initPostProcessAPI({} as never); shutdownPostProcessAPI(); });
    afterEach(() => shutdownPostProcessAPI());

    it('brings back a pipeline the last App shut down', () => {
        const engine = core(true);
        initPostProcessAPI(engine as never);
        shutdownPostProcessAPI();
        expect(engine.calls).toEqual(['shutdown']);
        initPostProcessAPI(engine as never);
        expect(engine.calls).toEqual(['shutdown', 'init']);
        expect(engine.postprocess_isInitialized()).toBe(true);
    });

    it('leaves a running one alone: the first boot, where the renderer started it', () => {
        const engine = core(true);
        initPostProcessAPI(engine as never);
        expect(engine.calls).toEqual([]);
    });

    it('starts nothing on a first boot: the renderer starts its own, and one started early would be a second', () => {
        const engine = core(false);
        initPostProcessAPI(engine as never);
        expect(engine.calls).toEqual([]);
    });

    it('asks nothing of a core built without post-processing', () => {
        expect(() => initPostProcessAPI({} as never)).not.toThrow();
    });
});
