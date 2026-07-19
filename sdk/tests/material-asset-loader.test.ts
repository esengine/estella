// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/material', () => ({
    Material: {
        createFromAsset: vi.fn().mockReturnValue(11),
        setUniform: vi.fn(),
        tex: vi.fn((handle: number) => ({ kind: 'tex', handle })),
        compileShader: vi.fn().mockReturnValue(7),
        release: vi.fn(),
    },
}));

import { MaterialAssetLoader } from '../src/asset/loaders/MaterialAssetLoader';
import { Material } from '../src/material';
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
        loadTexture: vi.fn().mockRejectedValue(new Error('404 not found')),
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
