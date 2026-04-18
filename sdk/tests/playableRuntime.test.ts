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
            setAssetResolver: vi.fn(),
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
});
