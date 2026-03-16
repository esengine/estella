import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSceneManager, mockApp, mockAssetServer, SceneManagerSymbol, mockDbEntries } = vi.hoisted(() => {
    const SceneManagerSymbol = { _name: 'SceneManager' };

    const mockSceneManager = {
        register: vi.fn(),
        reset: vi.fn(),
    };

    const mockAssetServer = {
        baseUrl: '',
        setAssetRefResolver: vi.fn(),
    };

    const mockApp = {
        hasResource: vi.fn().mockReturnValue(true),
        getResource: vi.fn((key: any) => {
            if (key?._name === 'SceneManager') return mockSceneManager;
            return mockAssetServer;
        }),
        world: {
            spawn: vi.fn(() => 1),
            despawn: vi.fn(),
            valid: vi.fn(() => true),
            has: vi.fn(() => false),
            get: vi.fn(),
            tryGet: vi.fn(() => null),
            insert: vi.fn(),
            remove: vi.fn(),
            getAllEntities: vi.fn(() => []),
            getComponentTypes: vi.fn(() => []),
            onSpawn: vi.fn(() => () => {}),
            onDespawn: vi.fn(() => () => {}),
        },
        tick: vi.fn(),
        setPaused: vi.fn(),
    };

    const mockDbEntries = [
        { uuid: 'u1', path: 'assets/scenes/main.esscene', type: 'json' },
        { uuid: 'u2', path: 'assets/scenes/level1.esscene', type: 'json' },
        { uuid: 'u3', path: 'assets/textures/bg.png', type: 'image' },
        { uuid: 'u4', path: 'assets/scenes/bonus.esscene', type: 'json' },
    ];

    return { mockSceneManager, mockApp, mockAssetServer, SceneManagerSymbol, mockDbEntries };
});

vi.mock('esengine', () => ({
    Assets: { _name: 'Assets' },
    Name: Symbol('Name'),
    Parent: Symbol('Parent'),
    Children: Symbol('Children'),
    SceneManager: SceneManagerSymbol,
    Audio: { stopAll: vi.fn() },
    audioPlugin: { stopAllSources: vi.fn() },
    getComponent: vi.fn(() => null),
    getComponentAssetFields: vi.fn(() => []),
    getAllAssetExtensions: vi.fn(() => new Set(['.png', '.jpg', '.esscene', '.json'])),
    registerAssetBuildTransform: vi.fn(),
}));

vi.mock('../renderer/SharedRenderContext', () => ({
    getSharedRenderContext: vi.fn(() => ({
        app_: mockApp,
        pathResolver_: {
            getProjectDir: vi.fn(() => '/project'),
        },
        sceneManager_: {
            getEntityMap: vi.fn(() => new Map()),
            loadScene: vi.fn().mockResolvedValue(undefined),
        },
        enterPlayMode: vi.fn(),
        exitPlayMode: vi.fn().mockResolvedValue(undefined),
    })),
}));

vi.mock('../store/EditorStore', () => ({
    getEditorStore: vi.fn(() => ({
        takeSnapshot: vi.fn(() => ({ scene: {} })),
        restoreSnapshot: vi.fn(),
        scene: { entities: [] },
    })),
}));

vi.mock('../context/EditorContext', () => ({
    getEditorInstance: vi.fn(() => null),
    getEditorContext: vi.fn(() => ({
        fs: { toAssetUrl: vi.fn((p: string) => `asset://${p}`) },
    })),
}));

const mockContainer = (() => {
    const stores = new Map<any, Map<string, any>>();
    return {
        provide: (token: any, key: string, value: any) => {
            if (!stores.has(token)) stores.set(token, new Map());
            stores.get(token)!.set(key, value);
        },
        get: (token: any, key: string) => stores.get(token)?.get(key),
        has: () => false,
        getAll: () => new Map(),
    };
})();

vi.mock('../container/EditorContainer', () => ({
    getEditorContainer: vi.fn(() => mockContainer),
    setEditorContainer: vi.fn(),
}));

vi.mock('../services/ScriptInjector', () => ({
    ScriptInjector: vi.fn().mockImplementation(() => ({
        inject: vi.fn(),
        dispose: vi.fn(),
    })),
}));

vi.mock('../asset', () => ({
    getAssetDatabase: vi.fn(() => ({
        getAllEntries: vi.fn(() => mockDbEntries[Symbol.iterator]()),
    })),
    isUUID: vi.fn(() => false),
}));

import { getPlayModeService, PlayModeService } from '../services/PlayModeService';
import { PLAY_MODE_SERVICE, SCRIPT_SERVICE } from '../container/tokens';

describe('PlayModeService — SceneManager integration', () => {
    let service: ReturnType<typeof getPlayModeService>;

    beforeEach(() => {
        vi.clearAllMocks();
        mockContainer.provide(SCRIPT_SERVICE, 'default', {
            reload: vi.fn(),
            getCompiledScripts: vi.fn(() => null),
        });
        mockContainer.provide(PLAY_MODE_SERVICE, 'default', new PlayModeService());
        service = getPlayModeService();
    });

    it('registers all .esscene files from AssetDatabase on enter()', async () => {
        await service.enter();

        expect(mockSceneManager.register).toHaveBeenCalledTimes(3);
        expect(mockSceneManager.register).toHaveBeenCalledWith({
            name: 'main',
            path: 'assets/scenes/main.esscene',
        });
        expect(mockSceneManager.register).toHaveBeenCalledWith({
            name: 'level1',
            path: 'assets/scenes/level1.esscene',
        });
        expect(mockSceneManager.register).toHaveBeenCalledWith({
            name: 'bonus',
            path: 'assets/scenes/bonus.esscene',
        });
    });

    it('does not register non-.esscene assets', async () => {
        await service.enter();

        const registeredNames = mockSceneManager.register.mock.calls.map(
            (c: any[]) => c[0].name
        );
        expect(registeredNames).not.toContain('bg');
    });

    it('calls SceneManager.reset() on exit()', async () => {
        await service.enter();
        await service.exit();

        expect(mockSceneManager.reset).toHaveBeenCalledTimes(1);
    });

    it('reset() is called before snapshot restore', async () => {
        const callOrder: string[] = [];
        mockSceneManager.reset.mockImplementation(() => callOrder.push('reset'));

        const { getEditorStore } = await import('../store/EditorStore');
        vi.mocked(getEditorStore).mockReturnValue({
            takeSnapshot: vi.fn(() => ({ scene: {} })),
            restoreSnapshot: vi.fn(() => callOrder.push('restore')),
            scene: { entities: [] },
        } as any);

        await service.enter();
        await service.exit();

        expect(callOrder.indexOf('reset')).toBeLessThan(callOrder.indexOf('restore'));
    });
});
