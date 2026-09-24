// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  What the quick-game hosts needed that no other vendor did, each found
 *        by running a package on vivo's engine: a window measured in physical
 *        pixels, WebAssembly behind a switch, and a WebGL2 context that offers
 *        an extension WebGL2 does not have.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { MiniGamePlatformAdapter } from '../src/platform/minigame/adapter';
import type { MiniGameGlobal, MiniGameProfile } from '../src/platform/minigame/api';
import { quickgameProfile } from '../src/platform/quickgame/profile';
import { hideCoreExtensions } from '../src/runtime/miniGameRuntime';

const EMPTY_WASM = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]).buffer;

afterEach(() => { delete (globalThis as { qg?: unknown }).qg; });

describe('the quick-game hosts', () => {
  it('size the screen from a window already in physical pixels', () => {
    const host = (): MiniGameGlobal => ({
      createCanvas: () => ({ width: 0, height: 0 }),
      getSystemInfoSync: () => ({ windowWidth: 2340, windowHeight: 1080, pixelRatio: 2.75 }),
    } as unknown as MiniGameGlobal);
    const screen = (over: Partial<MiniGameProfile>) =>
      new MiniGamePlatformAdapter({ id: 'x', hostLabel: 'x', global: host(), ...over } as MiniGameProfile).createScreenCanvas();
    expect(screen({ windowInPhysicalPixels: true })).toMatchObject({ width: 2340, height: 1080 });
    expect(screen({})).toMatchObject({ width: 6435, height: 2970 });
  });

  it('turn WebAssembly on before the engine is instantiated', async () => {
    const order: string[] = [];
    (globalThis as { qg?: unknown }).qg = {
      setWasmTaskCompile: (on: boolean) => order.push(`switch ${on}`),
      getFileSystemManager: () => ({ readFileSync: (p: string) => { order.push(`read ${p}`); return EMPTY_WASM; } }),
    };
    const res = await quickgameProfile.instantiateWasm!('wasm/esengine.wxgame.wasm', {});
    expect(order).toEqual(['switch true', 'read wasm/esengine.wxgame.wasm']);
    expect(res.instance).toBeInstanceOf(WebAssembly.Instance);
  });

  it('withhold from a WebGL2 context the WebGL1 extensions it made core', () => {
    const vao = { createVertexArrayOES: vi.fn() };
    const other = {};
    const gl = { getExtension: (name: string) => (name === 'OES_vertex_array_object' ? vao : other) };
    hideCoreExtensions(gl as unknown as WebGLRenderingContext);
    expect(gl.getExtension('OES_vertex_array_object')).toBeNull();
    expect(gl.getExtension('ANGLE_instanced_arrays')).toBeNull();
    expect(gl.getExtension('EXT_color_buffer_float')).toBe(other);
  });
});
