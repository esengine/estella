// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { beforeEach, expect, it, vi } from 'vitest';
import type { LoadContext } from '../src/asset/AssetLoader';

const host = vi.hoisted(() => ({ registerFont: vi.fn(), releaseBitmapFont: vi.fn() }));
vi.mock('../src/platform/base', () => ({ getPlatform: () => ({ registerFont: host.registerFont }) }));
vi.mock('../src/wasm/resourceManager', () => ({
    requireResourceManager: () => ({ releaseBitmapFont: host.releaseBitmapFont }),
}));
import { FontAssetLoader } from '../src/asset/loaders/FontAssetLoader';
import { projectFontFamily, registerProjectFont, resetProjectFonts } from '../src/ui/text/font-registry';

const path = 'assets/fonts/Body.ttf';
const context = () => ({
    catalog: { getBuildPath: (value: string) => value },
    loadBinary: vi.fn(async () => new ArrayBuffer(16)),
}) as unknown as LoadContext;
beforeEach(() => {
    resetProjectFonts();
    host.registerFont.mockReset().mockResolvedValue(undefined);
    host.releaseBitmapFont.mockReset();
});

it('loads the staged outline format when its manifest address is an extensionless alias', async () => {
    const ctx = context();
    ctx.sourceAddressOf = () => 'body';
    const loader = new FontAssetLoader();
    const font = await loader.load('blobs/1f.woff2', ctx);
    try {
        expect(ctx.loadBinary).toHaveBeenCalledWith('blobs/1f.woff2');
        expect(font.path).toBe('body');
        expect(projectFontFamily(font.handle)).toBe(font.family);
    } finally { loader.unload(font); }
});

it('keeps font eras independent when an older result retires after replacement', async () => {
    const loader = new FontAssetLoader();
    const old = await loader.load(path, context());
    const current = await loader.load(path, context());
    expect(current.handle).not.toBe(old.handle);
    expect(current.family).not.toBe(old.family);
    expect(projectFontFamily(old.handle)).toBe(old.family);
    loader.unload(old);
    expect(projectFontFamily(old.handle)).toBeNull();
    expect(projectFontFamily(current.handle)).toBe(current.family);
    loader.unload(old);
    expect(host.releaseBitmapFont).not.toHaveBeenCalled();
    loader.unload(current);
    expect(projectFontFamily(current.handle)).toBeNull();
    const next = registerProjectFont(path, 'next');
    expect(next).not.toBe(current.handle);
    expect(projectFontFamily(next)).toBe('next');
});

it('does not withdraw a live font when its replacement registration fails', async () => {
    const loader = new FontAssetLoader();
    const old = await loader.load(path, context());
    host.registerFont.mockRejectedValueOnce(new Error('invalid font'));
    await expect(loader.load(path, context())).rejects.toThrow('invalid font');
    expect(projectFontFamily(old.handle)).toBe(old.family);
    expect(registerProjectFont(path, old.family!)).toBe(old.handle);
});

it('retires a late superseded load without detaching the faster replacement', async () => {
    const loader = new FontAssetLoader();
    let finish!: () => void;
    host.registerFont.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    const pending = loader.load(path, context());
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    const current = await loader.load(path, context());
    finish();
    const late = await pending;
    expect(late.family).not.toBe(current.family);
    loader.unload(late);
    expect(projectFontFamily(current.handle)).toBe(current.family);
});
