// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/render/material', () => ({
    Material: {
        createFromAsset: vi.fn().mockReturnValue(11),
        setUniform: vi.fn(),
        tex: vi.fn((handle: number) => ({ kind: 'tex', handle })),
        compileShader: vi.fn().mockReturnValue(7),
        release: vi.fn(),
    },
}));

import { MaterialAssetLoader } from '../src/asset/loaders/MaterialAssetLoader';
import { Material } from '../src/render/material';
import type { LoadContext } from '../src/asset/AssetLoader';

const MAT_PATH = 'assets/materials/foo.esmaterial';
const TEX_REF = 'missing.png';

function makeCtx(): LoadContext {
    const materialJson = JSON.stringify({
        type: 'material',
        shader: 'fx.esshader',
        properties: { mainTex: TEX_REF },
    });
    return {
        catalog: { getBuildPath: (p: string) => p },
        loadText: vi.fn(async (p: string) => (p.endsWith('.esmaterial') ? materialJson : '// shader src')),
        acquireTexture: vi.fn().mockRejectedValue(new Error('404 not found')),
    } as unknown as LoadContext;
}

describe('MaterialAssetLoader texture failure', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (Material.createFromAsset as ReturnType<typeof vi.fn>).mockReturnValue(11);
        (Material.compileShader as ReturnType<typeof vi.fn>).mockReturnValue(7);
    });

    it('still resolves the material and leaves the param unbound', async () => {
        const loader = new MaterialAssetLoader();
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        const result = await loader.load(MAT_PATH, makeCtx());

        expect(result.handle).toBe(11);
        expect(Material.setUniform).not.toHaveBeenCalled();
        warnSpy.mockRestore();
    });

    it('warns with the material path and the texture path', async () => {
        const loader = new MaterialAssetLoader();
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        await loader.load(MAT_PATH, makeCtx());

        const combined = warnSpy.mock.calls.map(c => String(c[0])).join('\n');
        expect(combined).toContain(MAT_PATH);
        expect(combined).toContain('assets/materials/missing.png');
        warnSpy.mockRestore();
    });
});

describe('MaterialAssetLoader texture release on unload', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (Material.createFromAsset as ReturnType<typeof vi.fn>).mockReturnValue(11);
        (Material.compileShader as ReturnType<typeof vi.fn>).mockReturnValue(7);
    });

    function makeCtxWithTexture() {
        const materialJson = JSON.stringify({
            type: 'material', shader: 'fx.esshader', properties: { mainTex: TEX_REF },
        });
        const released: Array<{ key: string; generation: number }> = [];
        let generation = 0;
        const ctx = {
            catalog: { getBuildPath: (p: string) => p },
            loadText: vi.fn(async (p: string) => (p.endsWith('.esmaterial') ? materialJson : '// shader src')),
            acquireTexture: vi.fn(async (path: string) => {
                const lease = {
                    key: `texture:${path}`, generation: ++generation, value: { handle: 42 },
                    release: () => released.push({ key: lease.key, generation: lease.generation }),
                };
                return lease;
            }),
        } as unknown as LoadContext;
        return { ctx, released };
    }

    it('keeps the RECEIPT for each bound texture and gives it back on unload', async () => {
        const loader = new MaterialAssetLoader();
        const { ctx, released } = makeCtxWithTexture();

        const result = await loader.load(MAT_PATH, ctx);
        // The acquisition is recorded, not the path: a hot update between load
        // and unload makes one path name two eras, and a release addressed by
        // path gives back the older one — a stranger's.
        expect(result.textureLeases?.map((l) => l.key))
            .toEqual(['texture:assets/materials/missing.png']);
        expect(Material.setUniform).toHaveBeenCalled();

        loader.unload(result, ctx);
        expect(released).toEqual([{ key: 'texture:assets/materials/missing.png', generation: 1 }]);
        expect(Material.release).toHaveBeenCalledWith(11);
    });
});

describe('MaterialAssetLoader built-in shader ref', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (Material.createFromAsset as ReturnType<typeof vi.fn>).mockReturnValue(11);
        (Material.compileShader as ReturnType<typeof vi.fn>).mockReturnValue(7);
    });

    function ctxFor(shader: string): LoadContext {
        const materialJson = JSON.stringify({ type: 'material', shader, properties: {} });
        return {
            catalog: { getBuildPath: (p: string) => p },
            // Only the material is ever read — a built-in shader has no file.
            loadText: vi.fn(async () => materialJson),
            loadTexture: vi.fn(),
        } as unknown as LoadContext;
    }

    it('compiles a `builtin:<id>` shader from its in-code template, reading no shader file', async () => {
        const loader = new MaterialAssetLoader();
        const ctx = ctxFor('builtin:sprite-unlit');

        const result = await loader.load(MAT_PATH, ctx);

        expect(result.shaderHandle).toBe(7);
        expect(ctx.loadText).toHaveBeenCalledTimes(1); // the material, never a shader file
        const compiledSrc = (Material.compileShader as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
        expect(compiledSrc).toContain('#pragma shader "Sprite Unlit"');
    });

    it('throws on an unknown built-in shader id', async () => {
        const loader = new MaterialAssetLoader();
        await expect(loader.load(MAT_PATH, ctxFor('builtin:does-not-exist'))).rejects.toThrow(/Unknown built-in shader/);
    });
});
