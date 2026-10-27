// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Material, initMaterialAPI, shutdownMaterialAPI } from '../src/render/material';
import type { ESEngineModule } from '../src/wasm';
import { initResourceManager, shutdownResourceManager } from '../src/wasm/resourceManager';

function createMock() {
    const resourceManager = { createShader: vi.fn().mockReturnValue(1), releaseShader: vi.fn() };
    return {
        getResourceManager: vi.fn(() => resourceManager),
        resourceManager,
        material_compileEsshader: vi.fn().mockReturnValue(7),
        material_define: vi.fn(),
        material_setUniform: vi.fn(),
        material_setTexture: vi.fn(),
        material_undefine: vi.fn(),
    };
}

describe('writing one uniform of a material', () => {
    let mock: ReturnType<typeof createMock>;

    beforeEach(() => {
        mock = createMock();
        initResourceManager(mock.resourceManager as never);
        initMaterialAPI(mock as unknown as ESEngineModule);
    });
    afterEach(() => {
        shutdownMaterialAPI();
        shutdownResourceManager();
    });

    const made = (uniforms: Record<string, number | { x: number; y: number }> = { u_a: 1, u_b: 2, u_c: { x: 1, y: 2 } }) =>
        Material.create({ shader: 1, uniforms } as never);

    it('sends the one value that changed, not the whole material again', () => {
        const m = made();
        mock.material_define.mockClear();
        mock.material_setUniform.mockClear();
        Material.setUniform(m, 'u_a', 5);
        expect(mock.material_setUniform).toHaveBeenCalledTimes(1);
        expect(mock.material_setUniform).toHaveBeenCalledWith(m, 'u_a', 1, 5, 0, 0, 0);
        expect(mock.material_define).not.toHaveBeenCalled();
        expect(Material.getUniform(m, 'u_a')).toBe(5);
    });

    it('sends nothing for the number the engine already holds', () => {
        const m = made();
        mock.material_setUniform.mockClear();
        Material.setUniform(m, 'u_a', 1);
        Material.setUniform(m, 'u_c', { x: 1, y: 2 });
        expect(mock.material_setUniform).not.toHaveBeenCalled();
    });

    it('sees a reused object that was edited between two writes', () => {
        const m = made();
        const v = { x: 1, y: 2 };
        Material.setUniform(m, 'u_c', v);
        mock.material_setUniform.mockClear();
        v.x = 9;
        Material.setUniform(m, 'u_c', v);
        expect(mock.material_setUniform).toHaveBeenCalledWith(m, 'u_c', 2, 9, 2, 0, 0);
    });

    it('reaches an instance that inherits the value and leaves one that overrides it', () => {
        const parent = made();
        const inheriting = Material.createInstance(parent);
        const overriding = Material.createInstance(parent);
        Material.setUniform(overriding, 'u_a', 7);
        mock.material_setUniform.mockClear();
        Material.setUniform(parent, 'u_a', 3);
        const hit = mock.material_setUniform.mock.calls.map((c) => c[0]);
        expect(hit).toContain(parent);
        expect(hit).toContain(inheriting);
        expect(hit).not.toContain(overriding);
        expect(Material.getUniform(overriding, 'u_a')).toBe(7);
        expect(Material.getUniform(inheriting, 'u_a')).toBe(3);
    });

    it('still takes the whole flush for a texture', () => {
        const m = made();
        mock.material_define.mockClear();
        Material.setUniform(m, 'u_tex', { __textureRef: true, textureId: 4 } as never);
        expect(mock.material_define).toHaveBeenCalled();
        expect(mock.material_setTexture).toHaveBeenCalledWith(m, 'u_tex', 4);
    });

    it('leaves the engine holding exactly what a full flush would, after any sequence of writes', () => {
        // The engine's store, as the mock sees it: the last value written per (material, name), forgotten on undefine.
        const engine = new Map<string, string>();
        mock.material_setUniform.mockImplementation((id: number, name: string, arity: number, a: number, b: number, c: number, d: number) => {
            engine.set(`${id}|${name}`, `${arity}:${a},${b},${c},${d}`);
        });
        mock.material_undefine.mockImplementation((id: number) => {
            for (const key of [...engine.keys()]) if (key.startsWith(`${id}|`)) engine.delete(key);
        });
        const root = made({ u_a: 1, u_b: 2, u_c: { x: 1, y: 2 }, u_d: 4 });
        const c1 = Material.createInstance(root);
        const c2 = Material.createInstance(root);
        const g = Material.createInstance(c1);
        const all = [root, c1, c2, g];
        const names = ['u_a', 'u_b', 'u_c', 'u_d'];
        let seed = 12345;
        const rnd = (n: number): number => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return (seed >>> 16) % n; };
        // One edited-and-rewritten object per material: the same object handed to two materials and then edited is held by both, and which of them
        // sees the edit used to depend on when each next flushed.
        const reusedBy = new Map<number, { x: number; y: number }>(all.map((handle) => [handle, { x: 1, y: 2 }]));
        for (let step = 0; step < 500; step++) {
            const target = all[rnd(all.length)]!;
            const op = rnd(10);
            if (op < 7) {
                const name = names[rnd(names.length)]!;
                if (name === 'u_c') {
                    // Now a fresh object, now one object edited and written again.
                    if (rnd(2)) { const reused = reusedBy.get(target)!; reused.x = rnd(3); reused.y = rnd(3); Material.setUniform(target, name, reused); }
                    else Material.setUniform(target, name, { x: rnd(3), y: rnd(3) });
                } else {
                    Material.setUniform(target, name, rnd(4));
                }
            } else if (op < 9) {
                const uniforms: Record<string, number> = {};
                for (const name of names) if (name !== 'u_c' && rnd(2)) uniforms[name] = rnd(4);
                Material.applyState(target, { uniforms });
            } else {
                Material.setBlendMode(target, rnd(2));
            }
            const incremental = new Map(engine);
            // A full flush of the whole tree: a blend mode that differs from the one it has is what makes the material push itself again.
            const blend = Material.getBlendMode(root);
            Material.setBlendMode(root, blend === 0 ? 1 : 0);
            expect([...engine.entries()].sort()).toEqual([...incremental.entries()].sort());
            Material.setBlendMode(root, blend);
        }
    });
});
