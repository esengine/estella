// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/runtimeLoader', () => ({
    initRuntime: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/asset/AssetPlugin', () => ({
    Assets: Symbol('Assets'),
}));

import { initPlayableRuntime } from '../src/playableRuntime';
import type { PlayableRuntimeConfig } from '../src/playableRuntime';
import { initRuntime } from '../src/runtimeLoader';
import { Assets } from '../src/asset/AssetPlugin';

function createMockConfig(overrides?: Partial<PlayableRuntimeConfig>): PlayableRuntimeConfig {
    const canvas = { width: 320, height: 480 } as HTMLCanvasElement;
    const mockApp = {
        getResource: vi.fn().mockReturnValue({
            registerEmbeddedAssets: vi.fn(),
            setEmbeddedOnly: vi.fn(),
            setAssetResolver: vi.fn(),   // Audio
            setRefResolver: vi.fn(),     // VideoPlayer
        }),
        hasResource: vi.fn().mockReturnValue(true),
        run: vi.fn(),
    } as any;

    return {
        app: mockApp,
        module: {} as any,
        canvas,
        assets: {},
        scenes: [
            { name: 'main', data: { version: '1', name: 'main', entities: [] } as any },
        ],
        firstScene: 'main',
        ...overrides,
    };
}

describe('initPlayableRuntime', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('passes scenes array and firstScene to initRuntime', async () => {
        const scenes = [
            { name: 'level1', data: { version: '1', name: 'level1', entities: [] } as any },
            { name: 'level2', data: { version: '1', name: 'level2', entities: [] } as any },
        ];
        const config = createMockConfig({ scenes, firstScene: 'level1' });

        await initPlayableRuntime(config);

        expect(initRuntime).toHaveBeenCalledWith(
            expect.objectContaining({
                scenes,
                firstScene: 'level1',
            }),
        );
    });

    it('PlayableRuntimeConfig requires scenes and firstScene fields', async () => {
        const config = createMockConfig();

        await initPlayableRuntime(config);

        const call = vi.mocked(initRuntime).mock.calls[0][0];
        expect(call.scenes).toEqual(config.scenes);
        expect(call.firstScene).toBe('main');
    });

    it('calls app.run() after initRuntime', async () => {
        const config = createMockConfig();

        await initPlayableRuntime(config);

        expect(config.app.run).toHaveBeenCalled();
    });

    // Path-style refs resolve via in-memory aliases onto the embedded map: the
    // alias keys share the data-URL strings (no duplication), and every channel
    // (fetch backend, image decode, audio) reads the same map.
    it('aliases assetPathMap logical paths onto the embedded assets', async () => {
        const config = createMockConfig({
            assets: { '@uuid:aaaa': 'data:text/plain;base64,QQ==' },
            assetPathMap: { 'assets/m.esmaterial': '@uuid:aaaa', 'assets/missing.png': '@uuid:zzzz' },
        });

        await initPlayableRuntime(config);

        const call = vi.mocked(initRuntime).mock.calls[0][0];
        const backend = call.source.backend as { resolveUrl(p: string): string };
        expect(backend.resolveUrl('assets/m.esmaterial')).toBe('data:text/plain;base64,QQ==');
        expect(backend.resolveUrl('/assets/m.esmaterial')).toBe('data:text/plain;base64,QQ==');
        // The original key still resolves; unknown targets alias nothing.
        expect(backend.resolveUrl('@uuid:aaaa')).toBe('data:text/plain;base64,QQ==');
    });

    // A single-file playable makes NO external requests — its `file://` page is a
    // null origin whose sibling fetches are CORS-blocked. Video is the newest
    // asset channel, so it must resolve through the SAME embedded map as every
    // other subsystem: the clip ref maps to its inlined data URL.
    it('wires the video ref resolver to the embedded data-URL map', async () => {
        const config = createMockConfig({
            assets: { 'assets/video/clip.mp4': 'data:video/mp4;base64,AAAA' },
        });

        await initPlayableRuntime(config);

        const resolver = (config.app.getResource() as { setRefResolver: ReturnType<typeof vi.fn> })
            .setRefResolver.mock.calls[0][0] as (ref: string) => string;
        expect(resolver('assets/video/clip.mp4')).toBe('data:video/mp4;base64,AAAA');
        expect(resolver('assets/nope.mp4')).toBe('assets/nope.mp4'); // passthrough, no external fetch key
    });
});
