// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A KTX2 texture is sampled as colour or as data by its own sRGB setting.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

const { rm } = vi.hoisted(() => ({
    rm: { createTextureFromKTX2: vi.fn(() => ({ handle: 3, width: 4, height: 4 })) },
}));
vi.mock('../src/wasm/resourceManager', () => ({
    requireResourceManager: () => rm,
    provideTextureContent: () => {},
}));

import { TextureLoader } from '../src/asset/loaders/TextureLoader';
import { setLinearColorSpace } from '../src/ecs/env';

const KTX2 = new Uint8Array([0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const ctx = {
    backend: { fetchBinary: async () => KTX2.buffer.slice(0) },
    catalog: { getBuildPath: (p: string) => p },
} as never;

async function srgbFor(settings?: { srgb?: boolean }): Promise<boolean> {
    rm.createTextureFromKTX2.mockClear();
    await new TextureLoader(null).loadDetached('a.ktx2', ctx, false, settings);
    return (rm.createTextureFromKTX2.mock.calls[0] as unknown[])[1] as boolean;
}

describe('a KTX2 texture under the linear pipeline', () => {
    afterEach(() => setLinearColorSpace(false));

    it('is decoded as colour unless its settings say it holds data', async () => {
        setLinearColorSpace(true);
        expect(await srgbFor()).toBe(true);
        expect(await srgbFor({ srgb: true })).toBe(true);
        // A normal map decoded as colour would bend every texel below one.
        expect(await srgbFor({ srgb: false })).toBe(false);
    });

    it('is never decoded as colour when the pipeline is not linear', async () => {
        expect(await srgbFor()).toBe(false);
    });
});
