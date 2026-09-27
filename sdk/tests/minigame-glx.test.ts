// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  An engine linked with EmscriptenGLX is started in the order WeChat's
 *        guide requires, and on a host without it is told so and nothing more.
 */
import { describe, it, expect } from 'vitest';
import { startGlx, type GlxModule } from '../src/runtime/miniGameRuntime';

function recordingModule(): GlxModule & { calls: Array<[string, unknown[]]> } {
    const calls: Array<[string, unknown[]]> = [];
    return { calls, ccall: (name, _ret, _types, values) => { calls.push([name, values]); } };
}

describe('startGlx', () => {
    it('inits, publishes the context, then sets up buffers and GL state', () => {
        const m = recordingModule();
        startGlx(m, { isWebGL2: true, platform: 2, ctxid: 5 });
        expect(m.calls).toEqual([
            ['glxInit', [true]],
            ['glxInitBufferDataAndGlState', [2, 2]],
        ]);
        expect(m.wxContextGlobal).toEqual({ isWebGL2: true, platform: 2, ctxid: 5 });
    });

    it('tells a linked engine the host gave no GLX context, and stops there', () => {
        const m = recordingModule();
        startGlx(m, undefined);
        expect(m.calls).toEqual([['glxInit', [false]]]);
        expect(m.wxContextGlobal).toBeUndefined();
    });
});
