// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Material, initMaterialAPI, shutdownMaterialAPI } from '../src/render/material';
import type { ESEngineModule } from '../src/wasm';
import { initResourceManager, shutdownResourceManager } from '../src/wasm/resourceManager';

const SOURCE = `#pragma switch USE_FOG
#pragma switch USE_RIM default(on)
#pragma param u_a float(1)
`;

describe('a material switching to another permutation of its shader', () => {
    let define: ReturnType<typeof vi.fn>;
    let compiled: string[][];

    beforeEach(() => {
        define = vi.fn();
        compiled = [];
        const resourceManager = { createShader: vi.fn().mockReturnValue(1), releaseShader: vi.fn() };
        initResourceManager(resourceManager as never);
        initMaterialAPI({
            getResourceManager: () => resourceManager,
            material_compileEsshader: vi.fn(),
            material_define: define,
            material_setUniform: vi.fn(),
            material_setTexture: vi.fn(),
            material_undefine: vi.fn(),
        } as unknown as ESEngineModule);
    });
    afterEach(() => {
        shutdownMaterialAPI();
        shutdownResourceManager();
    });

    /** A source whose permutations get a handle each, as the loader's does. */
    const program = (features: string[]) => {
        const handles = new Map<string, number>();
        const compile = (f: string[]): number => {
            const key = f.join(',');
            let h = handles.get(key);
            if (h === undefined) {
                h = 100 + handles.size;
                handles.set(key, h);
                compiled.push(f);
                Material.noteProgram(h, f, SOURCE, compile);
            }
            return h;
        };
        return compile(features);
    };

    it('takes the permutation with the switch applied, and keeps the parameters it had', () => {
        const base = program([]);
        const m = Material.create({ shader: base, uniforms: { u_a: 3 } });
        define.mockClear();
        expect(Material.recompile(m, { USE_FOG: true })).toBe(true);
        expect(compiled).toEqual([[], ['USE_FOG']]);
        expect(Material.get(m)!.shader).not.toBe(base);
        expect(define).toHaveBeenCalledTimes(1);
        expect(Material.getUniform(m, 'u_a')).toBe(3);
        expect(Material.getSwitch(m, 'USE_FOG')).toBe(true);
    });

    it('leaves out a switch the shader never declared, and changes nothing when that is all there was', () => {
        const base = program([]);
        const m = Material.create({ shader: base });
        define.mockClear();
        expect(Material.recompile(m, { USE_BATCHING: true })).toBe(false);
        expect(Material.get(m)!.shader).toBe(base);
        expect(define).not.toHaveBeenCalled();
        expect(Material.getSwitch(m, 'USE_BATCHING')).toBe(true);
    });

    it('builds on the permutation it is already in, and can switch back', () => {
        const m = Material.create({ shader: program([]) });
        Material.recompile(m, { USE_FOG: true });
        Material.recompile(m, { USE_RIM: true });
        expect(compiled.at(-1)).toEqual(['USE_FOG', 'USE_RIM']);
        const both = Material.get(m)!.shader;
        Material.recompile(m, { USE_FOG: false });
        expect(compiled.at(-1)).toEqual(['USE_RIM']);
        expect(Material.get(m)!.shader).not.toBe(both);
    });

    it('switches an instance for itself and leaves its parent and siblings on theirs', () => {
        const base = program([]);
        const parent = Material.create({ shader: base });
        const mine = Material.createInstance(parent);
        const sibling = Material.createInstance(parent);
        expect(Material.recompile(mine, { USE_FOG: true })).toBe(true);
        expect(Material.get(parent)!.shader).toBe(base);
        expect(Material.getRenderState(mine)!.shader).not.toBe(base);
        expect(Material.getRenderState(sibling)!.shader).toBe(base);
    });

    it('answers false for a material whose shader was not compiled from a source', () => {
        const m = Material.create({ shader: 1 });
        expect(Material.recompile(m, { USE_FOG: true })).toBe(false);
    });
});
