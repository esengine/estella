// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { expect, it, vi } from 'vitest';
import type { LoadContext } from '../src/asset/AssetLoader';
import { TilesetAssetLoader } from '../src/asset/loaders/TilesetAssetLoader';

it.each([
    ['../textures/ground.png', 'assets/textures/ground.png'],
    ['../textures/ground.png?v=2', 'assets/textures/ground.png'],
    ['..\\textures\\ground.png', 'assets/textures/ground.png'],
    ['ground.png', 'ground.png'],
    ['./ground.png', 'assets/maps/ground.png'],
    ['rock.png', 'assets/maps/rock.png'],
    ['@uuid:atlas', '@uuid:atlas'],
    ['assets/textures/ground.png', 'assets/textures/ground.png'],
    ['/ground.png', '/ground.png'],
])('loads the atlas %s with the tileset source address', async (texture, expected) => {
    const acquireTexture = vi.fn(async () => ({ value: { handle: 42, width: 32, height: 16 } }));
    const paths = new Set(['ground.png', 'assets/maps/ground.png', 'assets/maps/rock.png', 'assets/textures/ground.png']);
    const loadText = vi.fn(async () => JSON.stringify({ version: '1', texture, tileWidth: 16, tileHeight: 16, columns: 2 }));
    const ctx = {
        catalog: { getBuildPath: () => 'objects/a28.estileset' },
        sourceAddressOf: () => 'assets/maps/ground.estileset',
        assetTypeOf: (path: string) => paths.has(path) ? 'texture' : undefined,
        acquireTexture,
        loadText,
    } as unknown as LoadContext;
    const result = await new TilesetAssetLoader().registry.prepare('@uuid:tileset', ctx);
    expect(loadText).toHaveBeenCalledWith('objects/a28.estileset');
    expect(acquireTexture).toHaveBeenCalledWith(expected, true, 'imported');
    expect(result.published).toMatchObject({ resolved: { textureHandle: 42, textureWidth: 32, textureHeight: 16 } });
});
