// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect, vi, afterEach } from 'vitest';
import { IDENT_FRAGMENT, IDENT_SECONDS, IDENT_VERTEX, playIdent } from '../src/runtime/ident';
import { countDraws, startIdent } from '../src/runtime/miniGameRuntime';

interface Call { name: string; args: unknown[] }

function fakeGl(links = true): { gl: WebGL2RenderingContext; calls: Call[]; live: Set<object> } {
    const calls: Call[] = [], live = new Set<object>();
    const made = (kind: string) => (...args: unknown[]): object => { const thing = { kind }; live.add(thing); calls.push({ name: `create${kind}`, args }); return thing; };
    const gone = (kind: string) => (thing: object | null): void => { if (thing) live.delete(thing); calls.push({ name: `delete${kind}`, args: [thing] }); };
    const target = {
        VERTEX_SHADER: 35633, FRAGMENT_SHADER: 35632, ARRAY_BUFFER: 34962, STATIC_DRAW: 35044, FLOAT: 5126, TRIANGLES: 4, LINK_STATUS: 35714,
        createProgram: made('Program'), createShader: made('Shader'), createBuffer: made('Buffer'), createVertexArray: made('VertexArray'),
        deleteProgram: gone('Program'), deleteShader: gone('Shader'), deleteBuffer: gone('Buffer'), deleteVertexArray: gone('VertexArray'),
        getProgramParameter: () => links,
        getUniformLocation: (_program: object, name: string) => ({ uniform: name }),
    };
    const gl = new Proxy(target, {
        get(from, name: string) {
            if (name in from) return (from as Record<string, unknown>)[name];
            return (...args: unknown[]): void => { calls.push({ name, args }); };
        },
    });
    return { gl: gl as unknown as WebGL2RenderingContext, calls, live };
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
        const { gl, calls } = fakeGl();
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
        expect(calls.filter((c) => c.name === 'viewport').pop()!.args).toEqual([0, 0, 640, 360]);
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

    it('hands the context back as it found it: nothing bound, nothing of its own left, and no frame after', () => {
        const { gl, calls, live } = fakeGl();
        const steps: (() => void)[] = [];
        const run = playIdent(gl, () => ({ width: 8, height: 8 }), (step) => { steps.push(step); }, () => 0)!;
        expect(live.size).toBe(5);
        run.stop();
        run.stop();
        expect(live.size).toBe(0);
        const tail = calls.map((c) => c.name);
        expect(tail.slice(tail.lastIndexOf('bindVertexArray'), tail.lastIndexOf('bindVertexArray') + 3)).toEqual(['bindVertexArray', 'bindBuffer', 'useProgram']);
        expect(calls.filter((c) => c.name === 'bindVertexArray').pop()!.args).toEqual([null]);
        expect(calls.filter((c) => c.name === 'useProgram').pop()!.args).toEqual([null]);
        const before = calls.filter((c) => c.name === 'drawArrays').length;
        steps.shift()!();
        expect(calls.filter((c) => c.name === 'drawArrays')).toHaveLength(before);
        const touched = new Set(calls.map((c) => c.name));
        for (const state of ['enable', 'disable', 'blendFunc', 'depthMask', 'colorMask', 'bindFramebuffer', 'pixelStorei', 'activeTexture']) expect(touched.has(state)).toBe(false);
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

describe('counting what the game draws after the ident', () => {
    it('counts the game\'s draws and clears, and hands the context back with nothing of its own on it', () => {
        class Context { drawArrays(): string { return 'drawn'; } clear(): void {} }
        const gl = new Context() as Context & Record<string, unknown>;
        const ownBlit = (): void => {};
        gl.blitFramebuffer = ownBlit;
        const drawn = countDraws(gl);
        expect(gl.drawArrays()).toBe('drawn');
        gl.clear();
        (gl.blitFramebuffer as () => void)();
        expect(drawn.count).toBe(3);
        drawn.release();
        expect(Object.prototype.hasOwnProperty.call(gl, 'drawArrays')).toBe(false);
        expect(Object.prototype.hasOwnProperty.call(gl, 'clear')).toBe(false);
        expect(gl.blitFramebuffer).toBe(ownBlit);
        gl.drawArrays();
        expect(drawn.count).toBe(3);
    });
});
