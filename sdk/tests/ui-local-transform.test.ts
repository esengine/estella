// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, expect, it, vi } from 'vitest';
import { createLocalTransformReader } from '../src/ui/util/local-transform';
import type { World } from '../src/ecs/world';
import type { Entity } from '../src/types';

function host() {
    const matrix = [2, 0, 0, 0, 1, 3, 0, 0, 0, 0, 1, 0, 10, -5, 0, 1];
    const api = {
        HEAPU8: new Uint8Array(256), _malloc: vi.fn(() => 16), _free: vi.fn(),
        transform_copyFlatRenderMatrix: vi.fn((_registry: unknown, _entity: number, pointer: number) => {
            new Float32Array(api.HEAPU8.buffer, pointer, 16).set(matrix); return true;
        }),
    };
    return { api, matrix };
}
const entity = 1 as Entity;

describe('rendered local transform reader', () => {
    it('inverts shear and translation for points, and only the basis for vectors', () => {
        const { api } = host(), reader = createLocalTransformReader({ getWasmModule: () => api, getCppRegistry: () => ({}) } as unknown as World);
        expect(reader.point(entity, 24, 7)).toEqual({ x: 5, y: 4 });
        expect(reader.vector(entity, 14, 12)).toEqual({ x: 5, y: 4 });
        expect(api._malloc).toHaveBeenCalledTimes(1);
        reader.dispose(); reader.dispose(); expect(api._free).toHaveBeenCalledTimes(1);
    });
    it('reads the current heap after growth instead of the retired typed view', () => {
        const { api, matrix } = host(), reader = createLocalTransformReader({ getWasmModule: () => api, getCppRegistry: () => ({}) } as unknown as World);
        expect(reader.point(entity, 24, 7)).toEqual({ x: 5, y: 4 });
        api.HEAPU8 = new Uint8Array(512); matrix[12] = 20;
        expect(reader.point(entity, 34, 7)).toEqual({ x: 5, y: 4 });
        expect(api._malloc).toHaveBeenCalledTimes(1); reader.dispose();
    });
    it('maps a ray onto the local coordinates of a tilted, sheared surface', () => {
        const { api, matrix } = host(), reader = createLocalTransformReader({ getWasmModule: () => api, getCppRegistry: () => ({}) } as unknown as World);
        matrix[2] = 1; matrix[6] = 2; matrix[14] = -20;
        expect(reader.rayPoint(entity, { origin: { x: 24, y: 7, z: 3 }, dir: { x: 0, y: 0, z: -1 } })).toEqual({ x: 5, y: 4 });
        expect(reader.rayPoint(entity, { origin: { x: 24, y: 7, z: 3 }, dir: { x: 0, y: 0, z: 1 } })).toBeNull();
        expect(reader.rayPoint(entity, { origin: { x: 24, y: 7, z: 3 }, dir: { x: 2, y: 0, z: 1 } })).toBeNull();
        reader.dispose();
    });
    it('releases scratch through its original host when the world changes cores', () => {
        const first = host(), second = host(); let api = first.api;
        const reader = createLocalTransformReader({ getWasmModule: () => api, getCppRegistry: () => ({}) } as unknown as World);
        reader.point(entity, 24, 7); api = second.api; reader.point(entity, 24, 7);
        expect(first.api._free).toHaveBeenCalledTimes(1); expect(first.api._free).toHaveBeenCalledWith(16);
        expect(second.api._free).not.toHaveBeenCalled(); reader.dispose();
        expect(second.api._free).toHaveBeenCalledTimes(1); expect(second.api._free).toHaveBeenCalledWith(16);
    });
    it('rejects singular, missing and nonfinite transforms instead of requesting fallback', () => {
        const { api, matrix } = host(), reader = createLocalTransformReader({ getWasmModule: () => api, getCppRegistry: () => ({}) } as unknown as World);
        matrix[0] = 0; expect(reader.point(entity, 24, 7)).toBeNull();
        matrix[0] = Infinity; expect(reader.vector(entity, 14, 12)).toBeNull();
        api.transform_copyFlatRenderMatrix.mockReturnValue(false); expect(reader.point(entity, 24, 7)).toBeNull();
        expect(reader.point(entity, NaN, 7)).toBeNull(); reader.dispose();
    });
    it('permits the legacy path only when the host lacks the matrix capability', () => {
        const reader = createLocalTransformReader({ getWasmModule: () => ({}), getCppRegistry: () => ({}) } as unknown as World);
        expect(reader.point(entity, 24, 7)).toBeUndefined(); reader.dispose();
    });
});
