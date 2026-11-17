// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect, vi, afterEach } from 'vitest';
import { IDENT_FRAGMENT, IDENT_SECONDS, IDENT_VERTEX, playIdent } from '../src/runtime/ident';
import { startIdent } from '../src/runtime/miniGameRuntime';

interface Call { name: string; args: unknown[] }

const CAPS = { BLEND: 3042, DEPTH_TEST: 2929, STENCIL_TEST: 2960, SCISSOR_TEST: 3089, CULL_FACE: 2884, RASTERIZER_DISCARD: 35977 };
const PARAMS = { CURRENT_PROGRAM: 35725, VERTEX_ARRAY_BINDING: 34229, ARRAY_BUFFER_BINDING: 34964, READ_FRAMEBUFFER_BINDING: 36010, DRAW_FRAMEBUFFER_BINDING: 36006, VIEWPORT: 2978, COLOR_WRITEMASK: 3107 };

interface GlState { [param: number]: unknown; on: Set<number> }

function fakeGl(links = true): { gl: WebGL2RenderingContext; calls: Call[]; live: Set<object>; state: GlState; atDraw: GlState[] } {
    const calls: Call[] = [], live = new Set<object>(), atDraw: GlState[] = [];
    const state: GlState = { on: new Set(), [PARAMS.CURRENT_PROGRAM]: null, [PARAMS.VERTEX_ARRAY_BINDING]: null, [PARAMS.ARRAY_BUFFER_BINDING]: null,
        [PARAMS.READ_FRAMEBUFFER_BINDING]: null, [PARAMS.DRAW_FRAMEBUFFER_BINDING]: null, [PARAMS.VIEWPORT]: new Int32Array([0, 0, 1, 1]), [PARAMS.COLOR_WRITEMASK]: [true, true, true, true] };
    const made = (kind: string) => (...args: unknown[]): object => { const thing = { kind }; live.add(thing); calls.push({ name: `create${kind}`, args }); return thing; };
    const gone = (kind: string) => (thing: object | null): void => { if (thing) live.delete(thing); calls.push({ name: `delete${kind}`, args: [thing] }); };
    const set = (name: string, param: number) => (...args: unknown[]): void => { calls.push({ name, args }); state[param] = args[args.length - 1]; };
    const target = {
        VERTEX_SHADER: 35633, FRAGMENT_SHADER: 35632, ARRAY_BUFFER: 34962, STATIC_DRAW: 35044, FLOAT: 5126, TRIANGLES: 4, LINK_STATUS: 35714,
        FRAMEBUFFER: 36160, READ_FRAMEBUFFER: 36008, DRAW_FRAMEBUFFER: 36009, ...CAPS, ...PARAMS,
        createProgram: made('Program'), createShader: made('Shader'), createBuffer: made('Buffer'), createVertexArray: made('VertexArray'),
        deleteProgram: gone('Program'), deleteShader: gone('Shader'), deleteBuffer: gone('Buffer'), deleteVertexArray: gone('VertexArray'),
        getProgramParameter: () => links,
        getUniformLocation: (_program: object, name: string) => ({ uniform: name }),
        getParameter: (param: number) => state[param],
        isEnabled: (cap: number) => state.on.has(cap),
        enable: (cap: number) => { calls.push({ name: 'enable', args: [cap] }); state.on.add(cap); },
        disable: (cap: number) => { calls.push({ name: 'disable', args: [cap] }); state.on.delete(cap); },
        useProgram: set('useProgram', PARAMS.CURRENT_PROGRAM),
        bindVertexArray: set('bindVertexArray', PARAMS.VERTEX_ARRAY_BINDING),
        viewport: (...args: number[]) => { calls.push({ name: 'viewport', args }); state[PARAMS.VIEWPORT] = new Int32Array(args); },
        colorMask: (...args: boolean[]) => { calls.push({ name: 'colorMask', args }); state[PARAMS.COLOR_WRITEMASK] = args; },
        bindBuffer: (kind: number, buffer: unknown) => { calls.push({ name: 'bindBuffer', args: [kind, buffer] }); if (kind === 34962) state[PARAMS.ARRAY_BUFFER_BINDING] = buffer; },
        bindFramebuffer: (kind: number, fb: unknown) => {
            calls.push({ name: 'bindFramebuffer', args: [kind, fb] });
            if (kind !== 36009) state[PARAMS.READ_FRAMEBUFFER_BINDING] = fb;
            if (kind !== 36008) state[PARAMS.DRAW_FRAMEBUFFER_BINDING] = fb;
        },
        drawArrays: (...args: unknown[]) => { calls.push({ name: 'drawArrays', args }); atDraw.push({ ...state, on: new Set(state.on) }); },
    };
    const gl = new Proxy(target, {
        get(from, name: string) {
            if (name in from) return (from as Record<string, unknown>)[name];
            return (...args: unknown[]): void => { calls.push({ name, args }); };
        },
    });
    return { gl: gl as unknown as WebGL2RenderingContext, calls, live, state, atDraw };
}

afterEach(() => { vi.useRealTimers(); });

describe('the ident drawn straight onto a context', () => {
    it('is one shader in the language every WebGL takes, with no version line to refuse', () => {
        expect(IDENT_FRAGMENT.startsWith('precision mediump float;')).toBe(true);
        expect(IDENT_FRAGMENT).toContain('gl_FragColor=');
        expect(IDENT_FRAGMENT + IDENT_VERTEX).not.toContain('#version');
        expect(IDENT_VERTEX).toContain('attribute vec2 a;');
    });

    it('draws a frame at once and another each time the host gives it one, with the clock running', () => {
        const { gl, calls, atDraw } = fakeGl();
        const steps: (() => void)[] = [];
        let at = 1000;
        const run = playIdent(gl, () => ({ width: 640, height: 360 }), (step) => { steps.push(step); }, () => at)!;
        expect(calls.filter((c) => c.name === 'drawArrays')).toHaveLength(1);
        at = 1500;
        steps.shift()!();
        const draws = calls.filter((c) => c.name === 'drawArrays');
        expect(draws).toHaveLength(2);
        expect(draws[0]!.args).toEqual([4, 0, 3]);
        const clocks = calls.filter((c) => c.name === 'uniform1f').map((c) => c.args[1]);
        expect(clocks).toEqual([0, 0.5]);
        expect([...atDraw.pop()![PARAMS.VIEWPORT] as Int32Array]).toEqual([0, 0, 640, 360]);
        run.stop();
    });

    it('follows a surface that changes size under it', () => {
        const { gl, calls } = fakeGl();
        const steps: (() => void)[] = [];
        const size = { width: 300, height: 600 };
        const run = playIdent(gl, () => size, (step) => { steps.push(step); }, () => 0)!;
        size.width = 600;
        size.height = 300;
        steps.shift()!();
        expect(calls.filter((c) => c.name === 'uniform2f').map((c) => c.args.slice(1))).toEqual([[300, 600], [600, 300]]);
        run.stop();
    });

    it('draws over whatever the context was doing and hands every binding and switch back as it found it', () => {
        const { gl, state, atDraw } = fakeGl();
        const engine = { program: { kind: 'engine' }, vertices: { kind: 'engineVao' }, array: { kind: 'engineBuffer' }, target: { kind: 'engineFbo' } };
        Object.assign(state, {
            [PARAMS.CURRENT_PROGRAM]: engine.program, [PARAMS.VERTEX_ARRAY_BINDING]: engine.vertices, [PARAMS.ARRAY_BUFFER_BINDING]: engine.array,
            [PARAMS.READ_FRAMEBUFFER_BINDING]: engine.target, [PARAMS.DRAW_FRAMEBUFFER_BINDING]: engine.target,
            [PARAMS.VIEWPORT]: new Int32Array([0, 0, 256, 128]), [PARAMS.COLOR_WRITEMASK]: [true, true, true, false],
        });
        state.on.add(CAPS.BLEND).add(CAPS.DEPTH_TEST).add(CAPS.SCISSOR_TEST);
        const steps: (() => void)[] = [];
        const run = playIdent(gl, () => ({ width: 640, height: 360 }), (step) => { steps.push(step); }, () => 0)!;
        steps.shift()!();
        const drawn = atDraw.pop()!;
        expect(drawn[PARAMS.DRAW_FRAMEBUFFER_BINDING]).toBeNull();
        expect([...drawn[PARAMS.VIEWPORT] as Int32Array]).toEqual([0, 0, 640, 360]);
        expect(drawn.on.size).toBe(0);
        expect(drawn[PARAMS.COLOR_WRITEMASK]).toEqual([true, true, true, true]);
        expect(state[PARAMS.CURRENT_PROGRAM]).toBe(engine.program);
        expect(state[PARAMS.VERTEX_ARRAY_BINDING]).toBe(engine.vertices);
        expect(state[PARAMS.ARRAY_BUFFER_BINDING]).toBe(engine.array);
        expect(state[PARAMS.READ_FRAMEBUFFER_BINDING]).toBe(engine.target);
        expect(state[PARAMS.DRAW_FRAMEBUFFER_BINDING]).toBe(engine.target);
        expect([...state[PARAMS.VIEWPORT] as Int32Array]).toEqual([0, 0, 256, 128]);
        expect(state[PARAMS.COLOR_WRITEMASK]).toEqual([true, true, true, false]);
        expect([...state.on].sort()).toEqual([CAPS.BLEND, CAPS.DEPTH_TEST, CAPS.SCISSOR_TEST].sort());
        run.stop();
    });

    it('leaves nothing of its own when stopped, and draws no frame after', () => {
        const { gl, calls, live } = fakeGl();
        const steps: (() => void)[] = [];
        const run = playIdent(gl, () => ({ width: 8, height: 8 }), (step) => { steps.push(step); }, () => 0)!;
        expect(live.size).toBe(5);
        run.stop();
        run.stop();
        expect(live.size).toBe(0);
        const before = calls.filter((c) => c.name === 'drawArrays').length;
        steps.shift()!();
        expect(calls.filter((c) => c.name === 'drawArrays')).toHaveLength(before);
    });

    it('is over when its length has passed, whether or not a frame ever came', async () => {
        vi.useFakeTimers();
        const { gl } = fakeGl();
        const run = playIdent(gl, () => ({ width: 8, height: 8 }), () => {}, () => 0)!;
        let over = false;
        void run.finished.then(() => { over = true; });
        await vi.advanceTimersByTimeAsync(IDENT_SECONDS * 1000 - 50);
        expect(over).toBe(false);
        await vi.advanceTimersByTimeAsync(60);
        expect(over).toBe(true);
        run.stop();
    });

    it('plays nothing and leaves nothing behind on a context that will not link it', () => {
        const { gl, calls, live } = fakeGl(false);
        expect(playIdent(gl, () => ({ width: 8, height: 8 }), () => {}, () => 0)).toBeNull();
        expect(live.size).toBe(0);
        expect(calls.some((c) => c.name === 'drawArrays')).toBe(false);
    });
});

describe('the ident on a mini-game’s display canvas', () => {
    it('asks for the context the engine will ask for, so the engine is given the same one', () => {
        const { gl } = fakeGl();
        const asked: unknown[][] = [];
        const canvas = { width: 720, height: 1280, getContext: (...args: unknown[]) => { asked.push(args); return gl; } };
        const run = startIdent(canvas)!;
        expect(asked).toHaveLength(1);
        expect(asked[0]![0]).toBe('webgl2');
        expect(asked[0]![1]).toEqual(expect.objectContaining({}));
        run.stop();
    });

    it('is skipped, not fatal, on a host with no WebGL2 or one that throws', () => {
        expect(startIdent({ width: 1, height: 1, getContext: () => null })).toBeNull();
        expect(startIdent({ width: 1, height: 1, getContext: () => { throw new Error('no'); } })).toBeNull();
    });
});
