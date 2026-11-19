// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
vi.mock('../src/render/material', () => {
    const materials = new Map();
    return {
        Material: {
            get: vi.fn((id: number) => materials.get(id)),
            getRenderState: vi.fn((id: number) => materials.get(id)),
            getUniforms: vi.fn((id: number) => materials.get(id)?.uniforms ?? new Map()),
            _materials: materials,
        },
        isTextureRef: vi.fn(
            (v: any) => typeof v === 'object' && v !== null && '__textureRef' in v,
        ),
        classifyUniformArity: (value: any) => {
            if (typeof value === 'number') return { arity: 1, values: [value, 0, 0, 0] };
            if (Array.isArray(value)) {
                const arity = Math.max(1, Math.min(value.length, 4));
                return {
                    arity,
                    values: [value[0] ?? 0, value[1] ?? 0, value[2] ?? 0, value[3] ?? 0],
                };
            }
            if ('w' in value) return { arity: 4, values: [value.x, value.y, value.z, value.w] };
            if ('z' in value) return { arity: 3, values: [value.x, value.y, value.z, 0] };
            return { arity: 2, values: [value.x, value.y, 0, 0] };
        },
    };
});

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Draw, initDrawAPI, shutdownDrawAPI, beginPresentedDraw, endPresentedDraw, BlendMode } from '../src/render/draw';
import { Material, isTextureRef } from '../src/render/material';
import type { ESEngineModule } from '../src/wasm';

// =============================================================================
// Mock WASM module for Draw API
// =============================================================================

function createDrawMockModule() {
    let nextAddr = 256;
    const heapBuffer = new ArrayBuffer(1024 * 1024);

    const mock = {
        _malloc: vi.fn((size: number) => {
            const addr = nextAddr;
            nextAddr += size;
            return addr;
        }),
        _free: vi.fn(),
        HEAPF32: new Float32Array(heapBuffer),
        HEAPU32: new Uint32Array(heapBuffer),
        draw_triangles: vi.fn(),

        draw_begin: vi.fn(),
        draw_end: vi.fn(),
        draw_deferEnd: vi.fn(),
        draw_line: vi.fn(),
        draw_line3D: vi.fn(),
        draw_line3DScreen: vi.fn(),
        draw_line3DScreenOffset: vi.fn(),
        draw_rect: vi.fn(),
        draw_rectOutline: vi.fn(),
        draw_circle: vi.fn(),
        draw_circleOutline: vi.fn(),
        draw_texture: vi.fn(),
        draw_textureRotated: vi.fn(),
        draw_setLayer: vi.fn(),
        draw_setDepth: vi.fn(),
        draw_setBlendMode: vi.fn(),
        draw_setDepthTest: vi.fn(),
        draw_getDrawCallCount: vi.fn(() => 42),
        draw_getPrimitiveCount: vi.fn(() => 128),
        draw_mesh: vi.fn(),
        draw_meshWithUniforms: vi.fn(),
        // Reflected-material route: false = no #pragma-param layout, use the
        // legacy uniform stream (most cases below exercise the legacy encoding).
        draw_meshWithMaterial: vi.fn(() => false),
    };

    return mock;
}

type MockModule = ReturnType<typeof createDrawMockModule>;

// =============================================================================
// Tests
// =============================================================================

describe('Draw API', () => {
    let mock: MockModule;

    beforeEach(() => {
        mock = createDrawMockModule();
        initDrawAPI(mock as unknown as ESEngineModule);
    });

    afterEach(() => {
        shutdownDrawAPI();
        (Material as any)._materials.clear();
    });

    // =========================================================================
    // initDrawAPI / shutdownDrawAPI
    // =========================================================================

    describe('Draw.triangles', () => {
        const square = { positions: [0, 0, 10, 0, 10, 10, 0, 10], indices: [0, 1, 2, 0, 2, 3], colors: [1, 0, 0, 1, 0, 1, 0, 1, 0, 0, 1, 1, 1, 1, 1, 0.5] };

        it('copies positions, colours and indices into the heap and submits them in one call', () => {
            Draw.triangles(square, { tint: { r: 1, g: 1, b: 1, a: 0.5 }, transform: [2, 0, 0, 2, 5, 6] });
            expect(mock.draw_triangles).toHaveBeenCalledTimes(1);
            const [pAt, verts, cAt, iAt, count, r, g, b, a, xx, xy, yx, yy, tx, ty] = mock.draw_triangles.mock.calls[0] as number[];
            expect(verts).toBe(4);
            expect(count).toBe(6);
            expect([...mock.HEAPF32.subarray(pAt / 4, pAt / 4 + 8)]).toEqual(square.positions);
            expect([...mock.HEAPF32.subarray(cAt / 4, cAt / 4 + 16)]).toEqual(square.colors);
            expect([...mock.HEAPU32.subarray(iAt / 4, iAt / 4 + 6)]).toEqual(square.indices);
            expect([r, g, b, a]).toEqual([1, 1, 1, 0.5]);
            expect([xx, xy, yx, yy, tx, ty]).toEqual([2, 0, 0, 2, 5, 6]);
        });

        it('draws white where a mesh gives no colours, at the identity where it gives no transform', () => {
            Draw.triangles({ positions: square.positions, indices: square.indices });
            const call = mock.draw_triangles.mock.calls[0] as number[];
            expect(call[2]).toBe(0);
            expect(call.slice(5, 9)).toEqual([1, 1, 1, 1]);
            expect(call.slice(9)).toEqual([1, 0, 0, 1, 0, 0]);
        });

        it('submits nothing for a mesh with no whole triangle', () => {
            Draw.triangles({ positions: [0, 0, 1, 1], indices: [0, 1] });
            Draw.triangles({ positions: [], indices: [] });
            expect(mock.draw_triangles).not.toHaveBeenCalled();
        });

        /** The engine's GPU meshes, as an engine that has them answers: ids from 7, a copy drawn is its transform and tint. */
        const withGpuMeshes = () => Object.assign(mock, {
            draw_createTriangleMesh: vi.fn(() => 7),
            draw_destroyTriangleMesh: vi.fn(),
            draw_triangleMesh: vi.fn(),
        });

        it('puts a mesh on the GPU once, and draws each copy as its transform and tint alone', () => {
            const gpu = withGpuMeshes();
            const buffer = Draw.createTriangles(square);
            expect(gpu.draw_createTriangleMesh).toHaveBeenCalledTimes(1);
            const [pAt, verts, cAt, iAt, count] = gpu.draw_createTriangleMesh.mock.calls[0] as number[];
            expect([verts, count]).toEqual([4, 6]);
            expect([...mock.HEAPF32.subarray(pAt / 4, pAt / 4 + 8)]).toEqual(square.positions);
            expect([...mock.HEAPF32.subarray(cAt / 4, cAt / 4 + 16)]).toEqual(square.colors);
            expect([...mock.HEAPU32.subarray(iAt / 4, iAt / 4 + 6)]).toEqual(square.indices);
            const heap = mock.HEAPF32.slice();
            const allocated = mock._malloc.mock.calls.length;
            for (let i = 0; i < 20; i++) Draw.triangles(buffer, { tint: { r: 1, g: 0.5, b: 1, a: 0.25 }, transform: [2, 0, 0, 2, i, 3] });
            expect(mock._malloc.mock.calls.length).toBe(allocated);
            expect(mock.HEAPF32).toEqual(heap);
            expect(mock.draw_triangles).not.toHaveBeenCalled();
            expect(gpu.draw_triangleMesh).toHaveBeenCalledTimes(20);
            expect(gpu.draw_triangleMesh.mock.calls[5]).toEqual([7, 1, 0.5, 1, 0.25, 2, 0, 0, 2, 5, 3]);
        });

        it('gives a GPU mesh back once, and not to an engine that never held it', () => {
            const gpu = withGpuMeshes();
            const buffer = Draw.createTriangles(square);
            buffer.release();
            buffer.release();
            Draw.triangles(buffer);
            expect(gpu.draw_destroyTriangleMesh).toHaveBeenCalledTimes(1);
            expect(gpu.draw_destroyTriangleMesh).toHaveBeenCalledWith(7);
            expect(gpu.draw_triangleMesh).not.toHaveBeenCalled();
            expect(mock._free).not.toHaveBeenCalled();

            const kept = Draw.createTriangles(square);
            shutdownDrawAPI();
            const next = createDrawMockModule();
            initDrawAPI(next as unknown as ESEngineModule);
            kept.release();
            expect(gpu.draw_destroyTriangleMesh).toHaveBeenCalledTimes(1);
        });

        it('draws many copies in one call, as the records the engine reads: the affine, then the tint a byte a channel', () => {
            const gpu = Object.assign(withGpuMeshes(), { draw_triangleMeshMany: vi.fn() });
            const buffer = Draw.createTriangles(square);
            const copies = new Float32Array([
                1, 0, 0, 1, 10, 20, 1, 0.5, 0, 1,
                0, 2, -2, 0, 30, 40, 2, -1, 1, 0.25,
                9, 9, 9, 9, 9, 9, 9, 9, 9, 9,
            ]);
            Draw.trianglesMany(buffer, copies, 2);
            expect(gpu.draw_triangleMesh).not.toHaveBeenCalled();
            expect(gpu.draw_triangleMeshMany).toHaveBeenCalledTimes(1);
            const [id, at, count] = gpu.draw_triangleMeshMany.mock.calls[0] as number[];
            expect([id, count]).toEqual([7, 2]);
            expect([...mock.HEAPF32.subarray(at / 4, at / 4 + 6)]).toEqual([1, 0, 0, 1, 10, 20]);
            expect(mock.HEAPU32[at / 4 + 6]).toBe((255 | (128 << 8) | (0 << 16) | (255 << 24)) >>> 0);
            expect([...mock.HEAPF32.subarray(at / 4 + 7, at / 4 + 13)]).toEqual([0, 2, -2, 0, 30, 40]);
            // Out of range is clamped, as the engine clamps a colour it packs itself.
            expect(mock.HEAPU32[at / 4 + 13]).toBe((255 | (0 << 8) | (255 << 16) | (64 << 24)) >>> 0);

            // Every copy the array holds when no count is given; one kept block however often it is drawn.
            const allocated = mock._malloc.mock.calls.length;
            for (let i = 0; i < 10; i++) Draw.trianglesMany(buffer, copies);
            expect(gpu.draw_triangleMeshMany.mock.calls[10][2]).toBe(3);
            expect(mock._malloc.mock.calls.length).toBe(allocated);
        });

        it('draws many copies a call each on an engine without the one call, and nothing from a released buffer', () => {
            const gpu = withGpuMeshes();
            const buffer = Draw.createTriangles(square);
            Draw.trianglesMany(buffer, [1, 0, 0, 1, 10, 20, 1, 0.5, 0, 1, 0, 2, -2, 0, 30, 40, 1, 1, 1, 0.25]);
            expect(gpu.draw_triangleMesh.mock.calls).toEqual([
                [7, 1, 0.5, 0, 1, 1, 0, 0, 1, 10, 20],
                [7, 1, 1, 1, 0.25, 0, 2, -2, 0, 30, 40],
            ]);
            buffer.release();
            Draw.trianglesMany(buffer, [1, 0, 0, 1, 0, 0, 1, 1, 1, 1]);
            expect(gpu.draw_triangleMesh).toHaveBeenCalledTimes(2);
        });

        it('draws many copies of a mesh kept in engine memory through draw_triangles', () => {
            const buffer = Draw.createTriangles(square);
            Draw.trianglesMany(buffer, [1, 0, 0, 1, 10, 20, 1, 0.5, 0, 1, 0, 2, -2, 0, 30, 40, 1, 1, 1, 0.25]);
            expect(mock.draw_triangles).toHaveBeenCalledTimes(2);
            expect((mock.draw_triangles.mock.calls[1] as number[]).slice(5)).toEqual([1, 1, 1, 0.25, 0, 2, -2, 0, 30, 40]);
        });

        it('keeps a mesh in engine memory when the engine will not put it on the GPU', () => {
            const gpu = withGpuMeshes();
            gpu.draw_createTriangleMesh.mockReturnValue(0);
            const buffer = Draw.createTriangles(square);
            Draw.triangles(buffer);
            expect(gpu.draw_triangleMesh).not.toHaveBeenCalled();
            expect(mock.draw_triangles).toHaveBeenCalledTimes(1);
        });

        it('copies a mesh into the engine once on an engine without GPU meshes, and draws it by reference with nothing copied', () => {
            const buffer = Draw.createTriangles(square);
            expect(buffer.live).toBe(true);
            expect(buffer.vertexCount).toBe(4);
            const allocated = mock._malloc.mock.calls.length;
            const heap = mock.HEAPF32.slice();
            for (let i = 0; i < 20; i++) Draw.triangles(buffer, { transform: [1, 0, 0, 1, i, 0] });
            expect(mock._malloc.mock.calls.length).toBe(allocated);
            expect(mock.HEAPF32).toEqual(heap);
            expect(mock.draw_triangles).toHaveBeenCalledTimes(20);
            const [pAt, verts, cAt, iAt, count] = mock.draw_triangles.mock.calls[0] as number[];
            expect([verts, count]).toEqual([4, 6]);
            expect([...mock.HEAPF32.subarray(pAt / 4, pAt / 4 + 8)]).toEqual(square.positions);
            expect([...mock.HEAPF32.subarray(cAt / 4, cAt / 4 + 16)]).toEqual(square.colors);
            expect([...mock.HEAPU32.subarray(iAt / 4, iAt / 4 + 6)]).toEqual(square.indices);
        });

        it('draws nothing from a released buffer in engine memory, and frees it once', () => {
            const buffer = Draw.createTriangles(square);
            buffer.release();
            buffer.release();
            expect(buffer.live).toBe(false);
            Draw.triangles(buffer);
            expect(mock.draw_triangles).not.toHaveBeenCalled();
            expect(mock._free).toHaveBeenCalledTimes(1);
        });

        it('lets a buffer go with the engine that held it: not drawn, not freed into the next one', () => {
            const buffer = Draw.createTriangles(square);
            shutdownDrawAPI();
            const next = createDrawMockModule();
            initDrawAPI(next as unknown as ESEngineModule);
            expect(buffer.live).toBe(false);
            Draw.triangles(buffer);
            buffer.release();
            expect(next.draw_triangles).not.toHaveBeenCalled();
            expect(next._free).not.toHaveBeenCalled();
        });

        it('keeps one heap block, grown only for a larger mesh', () => {
            const before = mock._malloc.mock.calls.length;
            for (let i = 0; i < 50; i++) Draw.triangles(square);
            expect(mock._malloc.mock.calls.length - before).toBe(1);
        });
    });

    describe('initDrawAPI', () => {
        it('should allocate viewProjection, transform, and uniforms buffers', () => {
            expect(mock._malloc).toHaveBeenCalledTimes(3);
            expect(mock._malloc).toHaveBeenNthCalledWith(1, 16 * 4);
            expect(mock._malloc).toHaveBeenNthCalledWith(2, 16 * 4);
            expect(mock._malloc).toHaveBeenNthCalledWith(3, 256 * 4);
        });
    });

    describe('shutdownDrawAPI', () => {
        it('should free all allocated buffers', () => {
            shutdownDrawAPI();
            expect(mock._free).toHaveBeenCalledTimes(3);
        });

        it('should handle double shutdown gracefully', () => {
            shutdownDrawAPI();
            shutdownDrawAPI();
            expect(mock._free).toHaveBeenCalledTimes(3);
        });
    });

    // =========================================================================
    // Uninitialized guard
    // =========================================================================

    describe('uninitialized guard', () => {
        it('should throw when Draw.begin called after shutdown', () => {
            shutdownDrawAPI();
            expect(() => Draw.begin(new Float32Array(16))).toThrow(
                'Draw API not initialized',
            );
        });

        it('should return 0 for getDrawCallCount when uninitialized', () => {
            shutdownDrawAPI();
            expect(Draw.getDrawCallCount()).toBe(0);
        });

        it('should return 0 for getPrimitiveCount when uninitialized', () => {
            shutdownDrawAPI();
            expect(Draw.getPrimitiveCount()).toBe(0);
        });
    });

    // =========================================================================
    // Draw.begin / Draw.end
    // =========================================================================

    describe('Draw.begin', () => {
        it('should copy viewProjection to HEAPF32 and call draw_begin', () => {
            const vp = new Float32Array(16);
            for (let i = 0; i < 16; i++) vp[i] = i + 1;

            Draw.begin(vp);

            const vpPtr = mock._malloc.mock.results[0].value;
            const offset = vpPtr / 4;
            for (let i = 0; i < 16; i++) {
                expect(mock.HEAPF32[offset + i]).toBe(i + 1);
            }
            expect(mock.draw_begin).toHaveBeenCalledWith(vpPtr, 0, 0);
        });

        it('passes the camera viewport used by screen-sized world lines', () => {
            Draw.begin(new Float32Array(16), 800, 600);
            const vpPtr = mock._malloc.mock.results[0].value;
            expect(mock.draw_begin).toHaveBeenCalledWith(vpPtr, 800, 600);
        });
    });

    describe('Draw.end', () => {
        it('should call draw_end', () => {
            Draw.end();
            expect(mock.draw_end).toHaveBeenCalledOnce();
        });
    });

    // =========================================================================
    // Draw.line
    // =========================================================================

    describe('Draw.line', () => {
        it('should pass all parameters to draw_line', () => {
            const from = { x: 1, y: 2 };
            const to = { x: 3, y: 4 };
            const color = { r: 0.1, g: 0.2, b: 0.3, a: 0.4 };

            Draw.line(from, to, color, 2.5);

            expect(mock.draw_line).toHaveBeenCalledWith(
                1, 2, 3, 4, 0.1, 0.2, 0.3, 0.4, 2.5,
            );
        });

        it('should default thickness to 1', () => {
            Draw.line({ x: 0, y: 0 }, { x: 1, y: 1 }, { r: 1, g: 1, b: 1, a: 1 });

            expect(mock.draw_line).toHaveBeenCalledWith(
                0, 0, 1, 1, 1, 1, 1, 1, 1,
            );
        });
    });

    describe('endPresentedDraw', () => {
        it('starts collection after opening the draw session, with an older-core fallback', () => {
            const calls: string[] = [];
            mock.draw_begin.mockImplementation(() => { calls.push('begin'); });
            Object.assign(mock, { draw_deferBegin: () => { calls.push('defer'); } });
            beginPresentedDraw(new Float32Array(16), 800, 600);
            expect(calls).toEqual(['begin', 'defer']);
        });

        it('defers submission to the owning renderer pass', () => {
            endPresentedDraw();
            expect(mock.draw_deferEnd).toHaveBeenCalledOnce();
            expect(mock.draw_end).not.toHaveBeenCalled();
        });
    });

    describe('Draw.line3DScreen', () => {
        it('passes world endpoints and pixel thickness to the native primitive', () => {
            Draw.line3DScreen(
                { x: 1, y: 2, z: 3 }, { x: 4, y: 5, z: 6 },
                { r: 0.1, g: 0.2, b: 0.3, a: 0.4 }, 1.75,
            );
            expect(mock.draw_line3DScreen).toHaveBeenCalledWith(
                1, 2, 3, 4, 5, 6, 0.1, 0.2, 0.3, 0.4, 1.75,
            );
        });
    });

    describe('Draw.line3DScreenOffset', () => {
        it('passes one world anchor and framebuffer offsets to the native primitive', () => {
            Draw.line3DScreenOffset(
                { x: 1, y: 2, z: 3 }, { x: -4, y: 5 }, { x: 6, y: -7 },
                { r: 0.1, g: 0.2, b: 0.3, a: 0.4 }, 2,
            );
            expect(mock.draw_line3DScreenOffset).toHaveBeenCalledWith(
                1, 2, 3, -4, 5, 6, -7, 0.1, 0.2, 0.3, 0.4, 2,
            );
        });
    });

    // =========================================================================
    // Draw.rect
    // =========================================================================

    describe('Draw.rect', () => {
        it('should pass all parameters to draw_rect', () => {
            const pos = { x: 10, y: 20 };
            const size = { x: 100, y: 200 };
            const color = { r: 1, g: 0, b: 0, a: 1 };

            Draw.rect(pos, size, color, false);

            expect(mock.draw_rect).toHaveBeenCalledWith(
                10, 20, 100, 200, 1, 0, 0, 1, false,
            );
        });

        it('should default filled to true', () => {
            Draw.rect({ x: 0, y: 0 }, { x: 1, y: 1 }, { r: 1, g: 1, b: 1, a: 1 });

            expect(mock.draw_rect).toHaveBeenCalledWith(
                0, 0, 1, 1, 1, 1, 1, 1, true,
            );
        });
    });

    // =========================================================================
    // Draw.rectOutline
    // =========================================================================

    describe('Draw.rectOutline', () => {
        it('should pass all parameters to draw_rectOutline', () => {
            Draw.rectOutline(
                { x: 5, y: 10 },
                { x: 50, y: 60 },
                { r: 0, g: 1, b: 0, a: 0.5 },
                3,
            );

            expect(mock.draw_rectOutline).toHaveBeenCalledWith(
                5, 10, 50, 60, 0, 1, 0, 0.5, 3,
            );
        });

        it('should default thickness to 1', () => {
            Draw.rectOutline(
                { x: 0, y: 0 },
                { x: 1, y: 1 },
                { r: 1, g: 1, b: 1, a: 1 },
            );

            expect(mock.draw_rectOutline).toHaveBeenCalledWith(
                0, 0, 1, 1, 1, 1, 1, 1, 1,
            );
        });
    });

    // =========================================================================
    // Draw.circle
    // =========================================================================

    describe('Draw.circle', () => {
        it('should pass all parameters to draw_circle', () => {
            Draw.circle(
                { x: 50, y: 50 },
                25,
                { r: 0, g: 0, b: 1, a: 1 },
                false,
                16,
            );

            expect(mock.draw_circle).toHaveBeenCalledWith(
                50, 50, 25, 0, 0, 1, 1, false, 16,
            );
        });

        it('should default filled to true and segments to 32', () => {
            Draw.circle({ x: 0, y: 0 }, 10, { r: 1, g: 1, b: 1, a: 1 });

            expect(mock.draw_circle).toHaveBeenCalledWith(
                0, 0, 10, 1, 1, 1, 1, true, 32,
            );
        });
    });

    // =========================================================================
    // Draw.circleOutline
    // =========================================================================

    describe('Draw.circleOutline', () => {
        it('should pass all parameters to draw_circleOutline', () => {
            Draw.circleOutline(
                { x: 30, y: 40 },
                15,
                { r: 1, g: 1, b: 0, a: 1 },
                2,
                24,
            );

            expect(mock.draw_circleOutline).toHaveBeenCalledWith(
                30, 40, 15, 1, 1, 0, 1, 2, 24,
            );
        });

        it('should default thickness to 1 and segments to 32', () => {
            Draw.circleOutline({ x: 0, y: 0 }, 5, { r: 1, g: 1, b: 1, a: 1 });

            expect(mock.draw_circleOutline).toHaveBeenCalledWith(
                0, 0, 5, 1, 1, 1, 1, 1, 32,
            );
        });
    });

    // =========================================================================
    // Draw.texture
    // =========================================================================

    describe('Draw.texture', () => {
        it('should pass all parameters to draw_texture', () => {
            Draw.texture(
                { x: 100, y: 200 },
                { x: 64, y: 64 },
                7,
                { r: 0.5, g: 0.5, b: 0.5, a: 0.8 },
            );

            expect(mock.draw_texture).toHaveBeenCalledWith(
                100, 200, 64, 64, 7, 0.5, 0.5, 0.5, 0.8,
            );
        });

        it('should default tint to white', () => {
            Draw.texture({ x: 0, y: 0 }, { x: 32, y: 32 }, 5);

            expect(mock.draw_texture).toHaveBeenCalledWith(
                0, 0, 32, 32, 5, 1, 1, 1, 1,
            );
        });
    });

    // =========================================================================
    // Draw.textureRotated
    // =========================================================================

    describe('Draw.textureRotated', () => {
        it('should pass all parameters to draw_textureRotated', () => {
            Draw.textureRotated(
                { x: 50, y: 60 },
                { x: 128, y: 128 },
                Math.PI / 4,
                9,
                { r: 0.9, g: 0.8, b: 0.7, a: 0.6 },
            );

            expect(mock.draw_textureRotated).toHaveBeenCalledWith(
                50, 60, 128, 128, Math.PI / 4, 9, 0.9, 0.8, 0.7, 0.6,
            );
        });

        it('should default tint to white', () => {
            Draw.textureRotated({ x: 0, y: 0 }, { x: 16, y: 16 }, 1.0, 3);

            expect(mock.draw_textureRotated).toHaveBeenCalledWith(
                0, 0, 16, 16, 1.0, 3, 1, 1, 1, 1,
            );
        });
    });

    // =========================================================================
    // State management
    // =========================================================================

    describe('state management', () => {
        it('setLayer should call draw_setLayer', () => {
            Draw.setLayer(5);
            expect(mock.draw_setLayer).toHaveBeenCalledWith(5);
        });

        it('setDepth should call draw_setDepth', () => {
            Draw.setDepth(0.75);
            expect(mock.draw_setDepth).toHaveBeenCalledWith(0.75);
        });

        it('setBlendMode should call draw_setBlendMode', () => {
            Draw.setBlendMode(BlendMode.Additive);
            expect(mock.draw_setBlendMode).toHaveBeenCalledWith(BlendMode.Additive);
        });

        it('setDepthTest should call draw_setDepthTest', () => {
            Draw.setDepthTest(true);
            expect(mock.draw_setDepthTest).toHaveBeenCalledWith(true);
        });

        it('restores actual native depth state across nested scopes and exceptions', () => {
            let flags = 3;
            const states: number[] = [];
            Object.assign(mock, {
                draw_getDepthState: () => flags,
                draw_setDepthState: (v: number) => { flags = v; states.push(v); },
            });
            expect(() => Draw.withDepthState({ test: false, write: false }, () => {
                expect(flags).toBe(0);
                expect(Draw.withDepthState({ test: true, write: false }, () => {
                    expect(flags).toBe(1);
                })).toBe(true);
                expect(flags).toBe(0);
                throw new Error('draw failed');
            })).toThrow('draw failed');
            expect(flags).toBe(3);
            expect(states).toEqual([0, 1, 0, 3]);
        });

        it('lets callers fall back without drawing or changing state on older cores', () => {
            const draw = vi.fn();
            expect(Draw.withDepthState({ test: true, write: false }, draw)).toBe(false);
            expect(draw).not.toHaveBeenCalled();
            expect(mock.draw_setDepthTest).not.toHaveBeenCalled();
        });
    });

    // =========================================================================
    // Statistics
    // =========================================================================

    describe('statistics', () => {
        it('getDrawCallCount should return WASM value', () => {
            expect(Draw.getDrawCallCount()).toBe(42);
        });

        it('getPrimitiveCount should return WASM value', () => {
            expect(Draw.getPrimitiveCount()).toBe(128);
        });

        it('getDrawCallCount should return 0 when uninitialized', () => {
            shutdownDrawAPI();
            expect(Draw.getDrawCallCount()).toBe(0);
        });

        it('getPrimitiveCount should return 0 when uninitialized', () => {
            shutdownDrawAPI();
            expect(Draw.getPrimitiveCount()).toBe(0);
        });
    });

    // =========================================================================
    // Draw.drawMesh
    // =========================================================================

    describe('Draw.drawMesh', () => {
        it('should copy transform to HEAPF32 and call draw_mesh', () => {
            const transform = new Float32Array(16);
            for (let i = 0; i < 16; i++) transform[i] = (i + 1) * 0.1;

            const geometry = 1;
            const shader = 2;

            Draw.drawMesh(geometry as any, shader as any, transform);

            const tPtr = mock._malloc.mock.results[1].value;
            const offset = tPtr / 4;
            for (let i = 0; i < 16; i++) {
                expect(mock.HEAPF32[offset + i]).toBeCloseTo((i + 1) * 0.1);
            }
            expect(mock.draw_mesh).toHaveBeenCalledWith(geometry, shader, tPtr);
        });
    });

    // =========================================================================
    // Draw.drawMeshWithMaterial
    // =========================================================================

    describe('Draw.drawMeshWithMaterial', () => {
        const transform = new Float32Array(16);
        const geometry = 1 as any;

        beforeEach(() => {
            for (let i = 0; i < 16; i++) transform[i] = i;
        });

        it('should return early when material is invalid', () => {
            Draw.drawMeshWithMaterial(geometry, 999 as any, transform);

            expect(mock.draw_mesh).not.toHaveBeenCalled();
            expect(mock.draw_meshWithUniforms).not.toHaveBeenCalled();
        });

        it('routes through the reflected material path when the engine reports a layout', () => {
            const materials = (Material as any)._materials;
            materials.set(21, {
                shader: 10,
                uniforms: new Map([['u_rect', { x: 1, y: 2, z: 3, w: 4 }]]),
                blendMode: BlendMode.Additive,
                depthTest: true,
                dirty_: true,
                cachedBuffer_: null,
                cachedIdx_: 0,
            });
            mock.draw_meshWithMaterial.mockReturnValueOnce(true);

            Draw.drawMeshWithMaterial(geometry, 21 as any);

            expect(mock.draw_meshWithMaterial).toHaveBeenCalledWith(geometry, 21);
            // The engine material store owns render state + params on this path —
            // no legacy session-state writes, no uniform-stream encoding.
            expect(mock.draw_setBlendMode).not.toHaveBeenCalled();
            expect(mock.draw_setDepthTest).not.toHaveBeenCalled();
            expect(mock.draw_mesh).not.toHaveBeenCalled();
            expect(mock.draw_meshWithUniforms).not.toHaveBeenCalled();
        });

        it('falls back to the legacy stream when there is no reflected layout', () => {
            const materials = (Material as any)._materials;
            materials.set(22, {
                shader: 10,
                uniforms: new Map([['u_time', 1.5]]),
                blendMode: BlendMode.Normal,
                depthTest: false,
                dirty_: true,
                cachedBuffer_: null,
                cachedIdx_: 0,
            });

            Draw.drawMeshWithMaterial(geometry, 22 as any, transform);

            expect(mock.draw_meshWithMaterial).toHaveBeenCalledWith(geometry, 22);
            expect(mock.draw_meshWithUniforms).toHaveBeenCalled();
        });

        it('legacy draw uses the identity transform when omitted', () => {
            const materials = (Material as any)._materials;
            materials.set(23, {
                shader: 10,
                uniforms: new Map(),
                blendMode: BlendMode.Normal,
                depthTest: false,
                dirty_: true,
                cachedBuffer_: null,
                cachedIdx_: 0,
            });

            Draw.drawMeshWithMaterial(geometry, 23 as any);

            expect(mock.draw_mesh).toHaveBeenCalled();
            const transformP = mock.draw_mesh.mock.calls[0][2];
            const t = mock.HEAPF32.subarray(transformP / 4, transformP / 4 + 16);
            expect(Array.from(t)).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
        });

        it('should call drawMesh when material has no uniforms', () => {
            const materials = (Material as any)._materials;
            materials.set(1, {
                shader: 10,
                uniforms: new Map(),
                blendMode: BlendMode.Normal,
                depthTest: false,
                dirty_: true,
                cachedBuffer_: null,
                cachedIdx_: 0,
            });

            Draw.drawMeshWithMaterial(geometry, 1 as any, transform);

            expect(mock.draw_setBlendMode).toHaveBeenCalledWith(BlendMode.Normal);
            expect(mock.draw_setDepthTest).toHaveBeenCalledWith(false);
            expect(mock.draw_mesh).toHaveBeenCalled();
            expect(mock.draw_meshWithUniforms).not.toHaveBeenCalled();
        });

        it('should set blend mode and depth test from material', () => {
            const materials = (Material as any)._materials;
            materials.set(2, {
                shader: 10,
                uniforms: new Map(),
                blendMode: BlendMode.Additive,
                depthTest: true,
                dirty_: true,
                cachedBuffer_: null,
                cachedIdx_: 0,
            });

            Draw.drawMeshWithMaterial(geometry, 2 as any, transform);

            expect(mock.draw_setBlendMode).toHaveBeenCalledWith(BlendMode.Additive);
            expect(mock.draw_setDepthTest).toHaveBeenCalledWith(true);
        });

        it('should encode number uniform (type 1)', () => {
            const materials = (Material as any)._materials;
            materials.set(3, {
                shader: 10,
                uniforms: new Map([['u_time', 1.5]]),
                blendMode: BlendMode.Normal,
                depthTest: false,
                dirty_: true,
                cachedBuffer_: null,
                cachedIdx_: 0,
            });

            Draw.drawMeshWithMaterial(geometry, 3 as any, transform);

            expect(mock.draw_meshWithUniforms).toHaveBeenCalled();
            const args = mock.draw_meshWithUniforms.mock.calls[0];
            expect(args[0]).toBe(geometry);
            expect(args[1]).toBe(10);

            const uniformsP = args[3];
            const uOffset = uniformsP / 4;
            expect(mock.HEAPF32[uOffset]).toBe(1);
            expect(mock.HEAPF32[uOffset + 1]).toBe(0);
            expect(mock.HEAPF32[uOffset + 2]).toBe(1.5);
            expect(args[4]).toBe(3);
        });

        it('should encode Vec2 uniform (type 2)', () => {
            const materials = (Material as any)._materials;
            materials.set(4, {
                shader: 10,
                uniforms: new Map([['u_offset', { x: 1.0, y: 2.0 }]]),
                blendMode: BlendMode.Normal,
                depthTest: false,
                dirty_: true,
                cachedBuffer_: null,
                cachedIdx_: 0,
            });

            Draw.drawMeshWithMaterial(geometry, 4 as any, transform);

            expect(mock.draw_meshWithUniforms).toHaveBeenCalled();
            const uniformsP = mock.draw_meshWithUniforms.mock.calls[0][3];
            const uOffset = uniformsP / 4;
            expect(mock.HEAPF32[uOffset]).toBe(2);
            expect(mock.HEAPF32[uOffset + 1]).toBe(4);
            expect(mock.HEAPF32[uOffset + 2]).toBe(1.0);
            expect(mock.HEAPF32[uOffset + 3]).toBe(2.0);
        });

        it('should encode Vec3 uniform (type 3)', () => {
            const materials = (Material as any)._materials;
            materials.set(5, {
                shader: 10,
                uniforms: new Map([['u_vec0', { x: 1.0, y: 2.0, z: 3.0 }]]),
                blendMode: BlendMode.Normal,
                depthTest: false,
                dirty_: true,
                cachedBuffer_: null,
                cachedIdx_: 0,
            });

            Draw.drawMeshWithMaterial(geometry, 5 as any, transform);

            expect(mock.draw_meshWithUniforms).toHaveBeenCalled();
            const uniformsP = mock.draw_meshWithUniforms.mock.calls[0][3];
            const uOffset = uniformsP / 4;
            expect(mock.HEAPF32[uOffset]).toBe(3);
            expect(mock.HEAPF32[uOffset + 1]).toBe(10);
            expect(mock.HEAPF32[uOffset + 2]).toBe(1.0);
            expect(mock.HEAPF32[uOffset + 3]).toBe(2.0);
            expect(mock.HEAPF32[uOffset + 4]).toBe(3.0);
        });

        it('should encode Vec4 uniform (type 4)', () => {
            const materials = (Material as any)._materials;
            materials.set(6, {
                shader: 10,
                uniforms: new Map([['u_color', { x: 1.0, y: 2.0, z: 3.0, w: 4.0 }]]),
                blendMode: BlendMode.Normal,
                depthTest: false,
                dirty_: true,
                cachedBuffer_: null,
                cachedIdx_: 0,
            });

            Draw.drawMeshWithMaterial(geometry, 6 as any, transform);

            expect(mock.draw_meshWithUniforms).toHaveBeenCalled();
            const uniformsP = mock.draw_meshWithUniforms.mock.calls[0][3];
            const uOffset = uniformsP / 4;
            expect(mock.HEAPF32[uOffset]).toBe(4);
            expect(mock.HEAPF32[uOffset + 1]).toBe(1);
            expect(mock.HEAPF32[uOffset + 2]).toBe(1.0);
            expect(mock.HEAPF32[uOffset + 3]).toBe(2.0);
            expect(mock.HEAPF32[uOffset + 4]).toBe(3.0);
            expect(mock.HEAPF32[uOffset + 5]).toBe(4.0);
        });

        it('should encode TextureRef uniform (type 10)', () => {
            const materials = (Material as any)._materials;
            materials.set(7, {
                shader: 10,
                uniforms: new Map([
                    ['u_texture0', { __textureRef: true, textureId: 42, slot: 0 }],
                ]),
                blendMode: BlendMode.Normal,
                depthTest: false,
                dirty_: true,
                cachedBuffer_: null,
                cachedIdx_: 0,
            });

            Draw.drawMeshWithMaterial(geometry, 7 as any, transform);

            expect(mock.draw_meshWithUniforms).toHaveBeenCalled();
            const uniformsP = mock.draw_meshWithUniforms.mock.calls[0][3];
            const uOffset = uniformsP / 4;
            expect(mock.HEAPF32[uOffset]).toBe(10);
            expect(mock.HEAPF32[uOffset + 1]).toBe(14);
            expect(mock.HEAPF32[uOffset + 2]).toBe(0);
            expect(mock.HEAPF32[uOffset + 3]).toBe(42);
        });

        it('should encode array uniform', () => {
            const materials = (Material as any)._materials;
            materials.set(8, {
                shader: 10,
                uniforms: new Map([['u_param0', [1.0, 2.0, 3.0]]]),
                blendMode: BlendMode.Normal,
                depthTest: false,
                dirty_: true,
                cachedBuffer_: null,
                cachedIdx_: 0,
            });

            Draw.drawMeshWithMaterial(geometry, 8 as any, transform);

            expect(mock.draw_meshWithUniforms).toHaveBeenCalled();
            const uniformsP = mock.draw_meshWithUniforms.mock.calls[0][3];
            const uOffset = uniformsP / 4;
            expect(mock.HEAPF32[uOffset]).toBe(3);
            expect(mock.HEAPF32[uOffset + 1]).toBe(5);
            expect(mock.HEAPF32[uOffset + 2]).toBe(1.0);
            expect(mock.HEAPF32[uOffset + 3]).toBe(2.0);
            expect(mock.HEAPF32[uOffset + 4]).toBe(3.0);
        });

        it('should use cached buffer when not dirty', () => {
            const materials = (Material as any)._materials;
            const cachedBuf = new Float32Array([1, 0, 1.5]);
            materials.set(9, {
                shader: 10,
                uniforms: new Map([['u_time', 1.5]]),
                blendMode: BlendMode.Normal,
                depthTest: false,
                dirty_: false,
                cachedBuffer_: cachedBuf,
                cachedIdx_: 3,
            });

            Draw.drawMeshWithMaterial(geometry, 9 as any, transform);

            expect(mock.draw_meshWithUniforms).toHaveBeenCalled();
            const args = mock.draw_meshWithUniforms.mock.calls[0];
            expect(args[4]).toBe(3);
        });

        it('should log warning for unknown uniform name', () => {
            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

            const materials = (Material as any)._materials;
            materials.set(10, {
                shader: 10,
                uniforms: new Map([['u_unknown_xyz', 1.0]]),
                blendMode: BlendMode.Normal,
                depthTest: false,
                dirty_: true,
                cachedBuffer_: null,
                cachedIdx_: 0,
            });

            Draw.drawMeshWithMaterial(geometry, 10 as any, transform);

            expect(warnSpy).toHaveBeenCalledWith(
                expect.stringContaining('Unknown uniform name "u_unknown_xyz"'),
            );

            warnSpy.mockRestore();
        });

        it('should skip unknown uniform and fall back to draw_mesh when no valid uniforms', () => {
            vi.spyOn(console, 'warn').mockImplementation(() => {});

            const materials = (Material as any)._materials;
            materials.set(11, {
                shader: 10,
                uniforms: new Map([['u_unknown_only', 1.0]]),
                blendMode: BlendMode.Normal,
                depthTest: false,
                dirty_: true,
                cachedBuffer_: null,
                cachedIdx_: 0,
            });

            Draw.drawMeshWithMaterial(geometry, 11 as any, transform);

            expect(mock.draw_mesh).toHaveBeenCalled();
            expect(mock.draw_meshWithUniforms).not.toHaveBeenCalled();

            vi.restoreAllMocks();
        });

        it('should auto-assign texture slot when slot is undefined', () => {
            const materials = (Material as any)._materials;
            materials.set(12, {
                shader: 10,
                uniforms: new Map([
                    ['u_texture0', { __textureRef: true, textureId: 100 }],
                ]),
                blendMode: BlendMode.Normal,
                depthTest: false,
                dirty_: true,
                cachedBuffer_: null,
                cachedIdx_: 0,
            });

            Draw.drawMeshWithMaterial(geometry, 12 as any, transform);

            expect(mock.draw_meshWithUniforms).toHaveBeenCalled();
            const uniformsP = mock.draw_meshWithUniforms.mock.calls[0][3];
            const uOffset = uniformsP / 4;
            expect(mock.HEAPF32[uOffset]).toBe(10);
            expect(mock.HEAPF32[uOffset + 2]).toBe(0);
            expect(mock.HEAPF32[uOffset + 3]).toBe(100);
        });

        it('should encode multiple uniforms of different types', () => {
            const materials = (Material as any)._materials;
            materials.set(13, {
                shader: 10,
                uniforms: new Map<string, any>([
                    ['u_time', 2.5],
                    ['u_offset', { x: 1.0, y: 2.0 }],
                ]),
                blendMode: BlendMode.Normal,
                depthTest: false,
                dirty_: true,
                cachedBuffer_: null,
                cachedIdx_: 0,
            });

            Draw.drawMeshWithMaterial(geometry, 13 as any, transform);

            expect(mock.draw_meshWithUniforms).toHaveBeenCalled();
            const args = mock.draw_meshWithUniforms.mock.calls[0];
            expect(args[4]).toBe(7);
        });
    });
});
