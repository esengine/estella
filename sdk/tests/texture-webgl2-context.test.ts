// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * findWebGL2Context — the KTX2 path's context lookup. WeChat MiniGames have no
 * `WebGL2RenderingContext` global, so the old `instanceof` check threw (caught,
 * read as "no context") and every KTX2 texture was refused on-device. The
 * lookup is duck-typed on `texStorage2D` and falls back to a registered-but-
 * not-yet-current context.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { findWebGL2Context } from '../src/asset/loaders/TextureLoader';
import type { ESEngineModule } from '../src/wasm';

type GLObj = ESEngineModule['GL'];

const webgl2Like = (): WebGL2RenderingContext =>
    ({ texStorage2D: () => { /* WebGL2-only surface */ } }) as unknown as WebGL2RenderingContext;
const webgl1Like = (): WebGL2RenderingContext => ({}) as WebGL2RenderingContext;

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('findWebGL2Context (WeChat: no WebGL2RenderingContext global)', () => {
    it('finds the current context with the global ABSENT — the WeChat repro', () => {
        vi.stubGlobal('WebGL2RenderingContext', undefined);
        const ctx = webgl2Like();
        const gl = { currentContext: { GLctx: ctx } } as unknown as GLObj;
        expect(findWebGL2Context(gl)).toBe(ctx);
    });

    it('falls back to a registered context when none is current yet', () => {
        const ctx = webgl2Like();
        const gl = { contexts: [null, { GLctx: ctx }] } as unknown as GLObj;
        expect(findWebGL2Context(gl)).toBe(ctx);
    });

    it('prefers the current context over other registered ones', () => {
        const current = webgl2Like();
        const other = webgl2Like();
        const gl = {
            currentContext: { GLctx: current },
            contexts: [{ GLctx: other }],
        } as unknown as GLObj;
        expect(findWebGL2Context(gl)).toBe(current);
    });

    it('rejects a WebGL1 context and tolerates a missing GL object', () => {
        const gl = { currentContext: { GLctx: webgl1Like() } } as unknown as GLObj;
        expect(findWebGL2Context(gl)).toBeNull();
        expect(findWebGL2Context(undefined)).toBeNull();
    });
});
