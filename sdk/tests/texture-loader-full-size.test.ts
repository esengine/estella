// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, expect, it, vi } from 'vitest';
import type { LoadContext, TextureResult } from '../src/asset/AssetLoader';

vi.mock('../src/wasm/resourceManager', () => ({
    requireResourceManager: () => ({ registerTextureWithPath: vi.fn(), adoptTextureContent: () => true, releaseTexture: vi.fn() }),
}));
import { TextureLoader } from '../src/asset/loaders/TextureLoader';

const context = { catalog: { getBuildPath: (p: string) => p } } as unknown as LoadContext;

function loaderDecoding(results: TextureResult[]) {
    const loader = new TextureLoader(null);
    const internal = loader as unknown as { decodeFile_: (...args: unknown[]) => Promise<TextureResult> };
    vi.spyOn(internal, 'decodeFile_').mockImplementation(async () => results.shift()!);
    return loader;
}

describe('the full size a texture loader keeps for a texture', () => {
    it('is what a decode at full size gave, once the texture first loaded as something smaller', async () => {
        const loader = loaderDecoding([
            { handle: 7, width: 4, height: 4 },
            { handle: 8, width: 1024, height: 512 },
            { handle: 9, width: 256, height: 128, fullWidth: 1024, fullHeight: 512 },
        ]);
        await loader.load('assets/models/hull_color.png', context);
        expect(loader.fullSize(7)).toEqual({ width: 4, height: 4 });
        await loader.resize(7, 0, context);
        expect(loader.fullSize(7)).toEqual({ width: 1024, height: 512 });
        await loader.resize(7, 256, context);
        expect(loader.fullSize(7)).toEqual({ width: 1024, height: 512 });
    });
});
