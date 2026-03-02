import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../src/scene', () => ({
    loadSceneWithAssets: vi.fn().mockResolvedValue(new Map()),
}));

vi.mock('../src/customDraw', () => ({
    registerDrawCallback: vi.fn(),
    unregisterDrawCallback: vi.fn(),
}));

vi.mock('../src/postprocess', () => ({
    PostProcess: {
        addPass: vi.fn().mockReturnValue(0),
        removePass: vi.fn(),
        setEnabled: vi.fn(),
        bind: vi.fn(),
        unbind: vi.fn(),
    },
    PostProcessStack: vi.fn(),
}));

vi.mock('../src/material', () => ({
    Material: {
        release: vi.fn(),
        createShader: vi.fn(),
    },
    defineResource: vi.fn(),
}));

vi.mock('../src/draw', () => ({
    Draw: {
        setLayer: vi.fn(),
        setDepth: vi.fn(),
        rect: vi.fn(),
    },
}));

vi.mock('../src/resource', () => ({
    defineResource: vi.fn((_init: unknown, name?: string) => ({
        _id: Symbol(name ?? 'Resource'),
        _name: name ?? 'Resource',
        _default: _init,
    })),
}));

vi.mock('../src/component', () => ({
    SceneOwner: Symbol('SceneOwner'),
    Sprite: Symbol('Sprite'),
    SpineAnimation: Symbol('SpineAnimation'),
    BitmapText: Symbol('BitmapText'),
}));

vi.mock('../src/asset/AssetPlugin', () => ({
    Assets: Symbol('Assets'),
}));

vi.mock('../src/defaults', () => ({
    RuntimeConfig: {
        sceneTransitionDuration: 0.5,
        sceneTransitionColor: { r: 0, g: 0, b: 0, a: 1 },
    },
}));

import { SceneManagerState, wrapSceneSystem } from '../src/sceneManager';
import { SceneOwner, Sprite, SpineAnimation, BitmapText } from '../src/component';
import { loadSceneWithAssets } from '../src/scene';
import { registerDrawCallback, unregisterDrawCallback } from '../src/customDraw';
import { PostProcess } from '../src/postprocess';
import { Material } from '../src/material';

function createMockApp() {
    const entities = new Map<number, Map<symbol, any>>();
    let nextEntity = 1;
    const resources = new Map<any, any>();

    const world = {
        spawn: vi.fn(() => {
            const e = nextEntity++;
            entities.set(e, new Map());
            return e;
        }),
        despawn: vi.fn((e: number) => entities.delete(e)),
        valid: vi.fn((e: number) => entities.has(e)),
        has: vi.fn((e: number, comp: symbol) => entities.get(e)?.has(comp) ?? false),
        get: vi.fn((e: number, comp: symbol) => entities.get(e)?.get(comp)),
        insert: vi.fn((e: number, comp: symbol, data: any) => {
            if (!entities.has(e)) entities.set(e, new Map());
            entities.get(e)!.set(comp, data);
        }),
    };

    return {
        world,
        hasResource: vi.fn((key: any) => resources.has(key)),
        getResource: vi.fn((key: any) => resources.get(key)),
        addSystemToSchedule: vi.fn(),
        _entities: entities,
        _resources: resources,
    };
}

function makeSceneData() {
    return {
        version: '1.0',
        name: 'TestScene',
        entities: [],
    };
}

describe('SceneManager', () => {
    let app: ReturnType<typeof createMockApp>;
    let manager: SceneManagerState;

    beforeEach(() => {
        vi.clearAllMocks();
        app = createMockApp();
        manager = new SceneManagerState(app as any);
    });

    // =========================================================================
    // Registration & initial scene
    // =========================================================================
    describe('registration & initial scene', () => {
        it('register stores config by name', () => {
            manager.register({ name: 'main' });
            expect(manager.getScene('main')).toBeNull();
            // Does not throw when loading a registered scene
            expect(() => manager.register({ name: 'main' })).not.toThrow();
        });

        it('setInitial / getInitial', () => {
            expect(manager.getInitial()).toBeNull();
            manager.setInitial('main');
            expect(manager.getInitial()).toBe('main');
        });

        it('load unregistered scene throws "not registered"', async () => {
            await expect(manager.load('unknown')).rejects.toThrow('not registered');
        });

        it('loadAdditive unregistered scene throws "not registered"', async () => {
            await expect(manager.loadAdditive('unknown')).rejects.toThrow('not registered');
        });
    });

    // =========================================================================
    // Scene loading
    // =========================================================================
    describe('scene loading', () => {
        it('load() with inline data sets status=running and activeScene', async () => {
            manager.register({ name: 'level1', data: makeSceneData() });
            const ctx = await manager.load('level1');
            expect(ctx.name).toBe('level1');
            expect(manager.getActive()).toBe('level1');
            expect(manager.getSceneStatus('level1')).toBe('running');
        });

        it('load() with already-loaded scene returns existing context', async () => {
            manager.register({ name: 'level1', data: makeSceneData() });
            const ctx1 = await manager.load('level1');
            const ctx2 = await manager.load('level1');
            expect(ctx2).toBe(ctx1);
        });

        it('load() adds entities via SceneOwner when loadSceneWithAssets returns entities', async () => {
            const entityMap = new Map<number, number>();
            entityMap.set(100, 1);
            entityMap.set(200, 2);
            vi.mocked(loadSceneWithAssets).mockResolvedValueOnce(entityMap);

            // Pre-create the entities in the mock world so valid() returns true
            app._entities.set(1, new Map());
            app._entities.set(2, new Map());

            manager.register({ name: 'level1', data: makeSceneData() });
            const ctx = await manager.load('level1');
            expect(ctx.entities.size).toBe(2);
            expect(app.world.insert).toHaveBeenCalledWith(
                1, SceneOwner, { scene: 'level1', persistent: false }
            );
        });

        it('loadAdditive() adds to additive scenes', async () => {
            manager.register({ name: 'ui', data: makeSceneData() });
            manager.register({ name: 'main', data: makeSceneData() });
            await manager.load('main');
            await manager.loadAdditive('ui');

            expect(manager.isLoaded('ui')).toBe(true);
            expect(manager.getLoaded()).toContain('ui');
        });

        it('loadAdditive() for already-loaded scene reuses instance', async () => {
            manager.register({ name: 'ui', data: makeSceneData() });
            const ctx1 = await manager.loadAdditive('ui');
            const ctx2 = await manager.loadAdditive('ui');
            expect(ctx2).toBe(ctx1);
        });

        it('duplicate load() while loading returns same promise', async () => {
            let resolveLoad!: (val: Map<number, number>) => void;
            vi.mocked(loadSceneWithAssets).mockReturnValueOnce(
                new Promise(r => { resolveLoad = r; })
            );

            manager.register({ name: 'level1', data: makeSceneData() });
            const p1 = manager.load('level1');
            const p2 = manager.load('level1');

            resolveLoad(new Map());
            const [ctx1, ctx2] = await Promise.all([p1, p2]);
            expect(ctx1).toBe(ctx2);
        });

        it('load() calls setup callback', async () => {
            const setup = vi.fn();
            manager.register({ name: 'level1', data: makeSceneData(), setup });
            await manager.load('level1');
            expect(setup).toHaveBeenCalledTimes(1);
        });
    });

    // =========================================================================
    // Scene unloading
    // =========================================================================
    describe('scene unloading', () => {
        it('unload() despawns entities', async () => {
            const entityMap = new Map([[100, 1]]);
            vi.mocked(loadSceneWithAssets).mockResolvedValueOnce(entityMap);
            app._entities.set(1, new Map());

            manager.register({ name: 'level1', data: makeSceneData() });
            await manager.load('level1');

            await manager.unload('level1');
            expect(app.world.despawn).toHaveBeenCalledWith(1);
        });

        it('unload() keeps persistent entities by default', async () => {
            const entityMap = new Map([[100, 1], [200, 2]]);
            vi.mocked(loadSceneWithAssets).mockResolvedValueOnce(entityMap);
            app._entities.set(1, new Map());
            app._entities.set(2, new Map());

            manager.register({ name: 'level1', data: makeSceneData() });
            await manager.load('level1');

            // Mark entity 1 as persistent
            const ownerData1 = app._entities.get(1)!.get(SceneOwner);
            ownerData1.persistent = true;
            app._entities.get(1)!.set(SceneOwner, ownerData1);

            await manager.unload('level1');
            // Entity 1 should NOT be despawned (persistent)
            expect(app.world.despawn).not.toHaveBeenCalledWith(1);
            // Entity 2 should be despawned (not persistent)
            expect(app.world.despawn).toHaveBeenCalledWith(2);
        });

        it('unload() with keepPersistent=false despawns all entities', async () => {
            const entityMap = new Map([[100, 1]]);
            vi.mocked(loadSceneWithAssets).mockResolvedValueOnce(entityMap);
            app._entities.set(1, new Map());

            manager.register({ name: 'level1', data: makeSceneData() });
            await manager.load('level1');

            // Mark as persistent
            const ownerData = app._entities.get(1)!.get(SceneOwner);
            ownerData.persistent = true;
            app._entities.get(1)!.set(SceneOwner, ownerData);

            await manager.unload('level1', { keepPersistent: false });
            expect(app.world.despawn).toHaveBeenCalledWith(1);
        });

        it('unload() cleans up draw callbacks', async () => {
            manager.register({ name: 'level1', data: makeSceneData() });
            const ctx = await manager.load('level1');

            ctx.registerDrawCallback('myDraw', () => {});
            await manager.unload('level1');
            expect(unregisterDrawCallback).toHaveBeenCalledWith('myDraw');
        });

        it('unload() removes postprocess passes', async () => {
            manager.register({ name: 'level1', data: makeSceneData() });
            const ctx = await manager.load('level1');

            ctx.addPostProcessPass('bloom', 42 as any);
            await manager.unload('level1');
            expect(PostProcess.removePass).toHaveBeenCalledWith('bloom');
        });

        it('unload() releases material handles from loadedAssets', async () => {
            vi.mocked(loadSceneWithAssets).mockImplementationOnce(
                async (_world, _data, options) => {
                    if (options?.collectAssets) {
                        options.collectAssets.materialHandles.add(10);
                        options.collectAssets.materialHandles.add(20);
                    }
                    return new Map();
                }
            );

            manager.register({ name: 'level1', data: makeSceneData() });
            await manager.load('level1');
            await manager.unload('level1');

            expect(Material.release).toHaveBeenCalledWith(10);
            expect(Material.release).toHaveBeenCalledWith(20);
        });

        it('unload() clears activeScene if unloaded scene was active', async () => {
            manager.register({ name: 'level1', data: makeSceneData() });
            await manager.load('level1');
            expect(manager.getActive()).toBe('level1');

            await manager.unload('level1');
            expect(manager.getActive()).toBeNull();
        });

        it('unload() calls cleanup callback', async () => {
            const cleanup = vi.fn();
            manager.register({ name: 'level1', data: makeSceneData(), cleanup });
            await manager.load('level1');
            await manager.unload('level1');
            expect(cleanup).toHaveBeenCalledTimes(1);
        });

        it('unload() non-existent scene is a no-op', async () => {
            await expect(manager.unload('nonexistent')).resolves.toBeUndefined();
        });
    });

    // =========================================================================
    // Scene switching
    // =========================================================================
    describe('scene switching', () => {
        it('switchTo() unloads old scene and loads new scene', async () => {
            manager.register({ name: 'level1', data: makeSceneData() });
            manager.register({ name: 'level2', data: makeSceneData() });

            await manager.load('level1');
            expect(manager.getActive()).toBe('level1');

            await manager.switchTo('level2');
            expect(manager.getActive()).toBe('level2');
            expect(manager.isLoaded('level1')).toBe(false);
        });

        it('switchTo() during transition is ignored', async () => {
            manager.register({ name: 'level1', data: makeSceneData() });
            manager.register({ name: 'level2', data: makeSceneData() });
            manager.register({ name: 'level3', data: makeSceneData() });

            await manager.load('level1');

            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

            // Start a switch that won't resolve immediately
            let resolveLoad!: (val: Map<number, number>) => void;
            vi.mocked(loadSceneWithAssets).mockReturnValueOnce(
                new Promise(r => { resolveLoad = r; })
            );
            const p1 = manager.switchTo('level2');

            // This should be ignored
            await manager.switchTo('level3');
            expect(warnSpy).toHaveBeenCalled();

            resolveLoad(new Map());
            await p1;
            expect(manager.getActive()).toBe('level2');
            warnSpy.mockRestore();
        });

        it('switchTo() with transition=none does direct switch', async () => {
            manager.register({ name: 'level1', data: makeSceneData() });
            manager.register({ name: 'level2', data: makeSceneData() });
            await manager.load('level1');

            await manager.switchTo('level2', { transition: 'none' });
            expect(manager.getActive()).toBe('level2');
            expect(registerDrawCallback).not.toHaveBeenCalledWith(
                '__scene_transition_overlay__',
                expect.any(Function)
            );
        });

        it('switching_ is reset even if load fails', async () => {
            manager.register({ name: 'level1', data: makeSceneData() });
            await manager.load('level1');

            // Attempt to switch to an unregistered scene (will throw)
            await expect(manager.switchTo('nonexistent')).rejects.toThrow('not registered');

            // switching_ should be reset, so another switch should work
            manager.register({ name: 'level2', data: makeSceneData() });
            await manager.switchTo('level2');
            expect(manager.getActive()).toBe('level2');
        });

        it('switchTo() to same scene as active does not unload', async () => {
            manager.register({ name: 'level1', data: makeSceneData() });
            await manager.load('level1');

            await manager.switchTo('level1');
            expect(manager.getActive()).toBe('level1');
            expect(manager.isLoaded('level1')).toBe(true);
        });
    });

    // =========================================================================
    // Pause / Resume
    // =========================================================================
    describe('pause / resume', () => {
        it('pause() sets status=paused and adds to pausedScenes', async () => {
            manager.register({ name: 'level1', data: makeSceneData() });
            await manager.load('level1');

            manager.pause('level1');
            expect(manager.getSceneStatus('level1')).toBe('paused');
            expect(manager.isPaused('level1')).toBe(true);
        });

        it('pause() on non-running scene is no-op', async () => {
            manager.register({ name: 'level1', data: makeSceneData() });
            await manager.load('level1');

            manager.pause('level1');
            expect(manager.isPaused('level1')).toBe(true);

            // Pause again should be no-op (already paused, not 'running')
            manager.pause('level1');
            expect(manager.isPaused('level1')).toBe(true);
        });

        it('pause() on non-loaded scene is no-op', () => {
            manager.pause('nonexistent');
            expect(manager.isPaused('nonexistent')).toBe(false);
        });

        it('resume() sets status=running and removes from pausedScenes', async () => {
            manager.register({ name: 'level1', data: makeSceneData() });
            await manager.load('level1');

            manager.pause('level1');
            manager.resume('level1');
            expect(manager.getSceneStatus('level1')).toBe('running');
            expect(manager.isPaused('level1')).toBe(false);
        });

        it('resume() on non-paused scene is no-op', async () => {
            manager.register({ name: 'level1', data: makeSceneData() });
            await manager.load('level1');
            // Already running, resume should be no-op
            manager.resume('level1');
            expect(manager.getSceneStatus('level1')).toBe('running');
        });

        it('pause() disables postprocess passes', async () => {
            manager.register({ name: 'level1', data: makeSceneData() });
            const ctx = await manager.load('level1');
            ctx.addPostProcessPass('bloom', 1 as any);

            manager.pause('level1');
            expect(PostProcess.setEnabled).toHaveBeenCalledWith('bloom', false);
        });

        it('resume() re-enables postprocess passes', async () => {
            manager.register({ name: 'level1', data: makeSceneData() });
            const ctx = await manager.load('level1');
            ctx.addPostProcessPass('bloom', 1 as any);

            manager.pause('level1');
            vi.mocked(PostProcess.setEnabled).mockClear();

            manager.resume('level1');
            expect(PostProcess.setEnabled).toHaveBeenCalledWith('bloom', true);
        });
    });

    // =========================================================================
    // Sleep / Wake
    // =========================================================================
    describe('sleep / wake', () => {
        function setupEntityWithComponents(entityId: number) {
            const entityComponents = new Map<symbol, any>();
            entityComponents.set(Sprite, { color: { r: 1, g: 1, b: 1, a: 0.8 } });
            entityComponents.set(SpineAnimation, { color: { r: 1, g: 1, b: 1, a: 0.6 } });
            entityComponents.set(BitmapText, { color: { r: 1, g: 1, b: 1, a: 0.9 } });
            app._entities.set(entityId, entityComponents);
        }

        it('sleep() sets status=sleeping and saves entity alphas', async () => {
            const entityMap = new Map([[100, 1]]);
            vi.mocked(loadSceneWithAssets).mockResolvedValueOnce(entityMap);
            setupEntityWithComponents(1);

            manager.register({ name: 'level1', data: makeSceneData() });
            await manager.load('level1');

            manager.sleep('level1');
            expect(manager.getSceneStatus('level1')).toBe('sleeping');
            expect(manager.isSleeping('level1')).toBe(true);

            // Alpha should be set to 0
            const sprite = app._entities.get(1)!.get(Sprite);
            expect(sprite.color.a).toBe(0);
        });

        it('sleep() only on running scenes', async () => {
            manager.register({ name: 'level1', data: makeSceneData() });
            await manager.load('level1');
            manager.pause('level1');

            manager.sleep('level1');
            // Should still be paused, not sleeping
            expect(manager.getSceneStatus('level1')).toBe('paused');
            expect(manager.isSleeping('level1')).toBe(false);
        });

        it('sleep() on non-loaded scene is no-op', () => {
            manager.sleep('nonexistent');
            expect(manager.isSleeping('nonexistent')).toBe(false);
        });

        it('wake() restores alphas from savedAlphas', async () => {
            const entityMap = new Map([[100, 1]]);
            vi.mocked(loadSceneWithAssets).mockResolvedValueOnce(entityMap);
            setupEntityWithComponents(1);

            manager.register({ name: 'level1', data: makeSceneData() });
            await manager.load('level1');

            manager.sleep('level1');
            manager.wake('level1');

            expect(manager.getSceneStatus('level1')).toBe('running');
            expect(manager.isSleeping('level1')).toBe(false);

            const sprite = app._entities.get(1)!.get(Sprite);
            expect(sprite.color.a).toBe(0.8);

            const spine = app._entities.get(1)!.get(SpineAnimation);
            expect(spine.color.a).toBe(0.6);

            const bt = app._entities.get(1)!.get(BitmapText);
            expect(bt.color.a).toBe(0.9);
        });

        it('wake() only on sleeping scenes', async () => {
            manager.register({ name: 'level1', data: makeSceneData() });
            await manager.load('level1');
            // Running scene, wake should be no-op
            manager.wake('level1');
            expect(manager.getSceneStatus('level1')).toBe('running');
        });

        it('wake() disables postprocess passes on sleep and re-enables on wake', async () => {
            manager.register({ name: 'level1', data: makeSceneData() });
            const ctx = await manager.load('level1');
            ctx.addPostProcessPass('blur', 2 as any);

            manager.sleep('level1');
            expect(PostProcess.setEnabled).toHaveBeenCalledWith('blur', false);

            vi.mocked(PostProcess.setEnabled).mockClear();
            manager.wake('level1');
            expect(PostProcess.setEnabled).toHaveBeenCalledWith('blur', true);
        });
    });

    // =========================================================================
    // Query methods
    // =========================================================================
    describe('query methods', () => {
        it('getActive() returns active scene name', async () => {
            expect(manager.getActive()).toBeNull();
            manager.register({ name: 'level1', data: makeSceneData() });
            await manager.load('level1');
            expect(manager.getActive()).toBe('level1');
        });

        it('getActiveScenes() returns all running scenes', async () => {
            manager.register({ name: 'main', data: makeSceneData() });
            manager.register({ name: 'ui', data: makeSceneData() });

            await manager.load('main');
            await manager.loadAdditive('ui');

            const active = manager.getActiveScenes();
            expect(active).toContain('main');
            expect(active).toContain('ui');
            expect(active).toHaveLength(2);
        });

        it('getActiveScenes() excludes paused scenes', async () => {
            manager.register({ name: 'main', data: makeSceneData() });
            manager.register({ name: 'ui', data: makeSceneData() });

            await manager.load('main');
            await manager.loadAdditive('ui');

            manager.pause('ui');
            const active = manager.getActiveScenes();
            expect(active).toContain('main');
            expect(active).not.toContain('ui');
        });

        it('getLoaded() returns all loaded scene names', async () => {
            manager.register({ name: 'level1', data: makeSceneData() });
            manager.register({ name: 'level2', data: makeSceneData() });

            await manager.load('level1');
            await manager.loadAdditive('level2');

            const loaded = manager.getLoaded();
            expect(loaded).toContain('level1');
            expect(loaded).toContain('level2');
        });

        it('getLoadOrder() returns load order', async () => {
            manager.register({ name: 'level1', data: makeSceneData() });
            manager.register({ name: 'level2', data: makeSceneData() });

            await manager.load('level1');
            await manager.loadAdditive('level2');

            expect(manager.getLoadOrder()).toEqual(['level1', 'level2']);
        });

        it('bringToTop() moves scene to end of loadOrder', async () => {
            manager.register({ name: 'level1', data: makeSceneData() });
            manager.register({ name: 'level2', data: makeSceneData() });
            manager.register({ name: 'level3', data: makeSceneData() });

            await manager.load('level1');
            await manager.loadAdditive('level2');
            await manager.loadAdditive('level3');

            manager.bringToTop('level1');
            expect(manager.getLoadOrder()).toEqual(['level2', 'level3', 'level1']);
        });

        it('bringToTop() on non-loaded scene is no-op', () => {
            manager.bringToTop('nonexistent');
            expect(manager.getLoadOrder()).toEqual([]);
        });

        it('getScene() returns context or null', async () => {
            expect(manager.getScene('nonexistent')).toBeNull();

            manager.register({ name: 'level1', data: makeSceneData() });
            await manager.load('level1');
            expect(manager.getScene('level1')).not.toBeNull();
        });

        it('getSceneStatus() returns status or null', async () => {
            expect(manager.getSceneStatus('nonexistent')).toBeNull();

            manager.register({ name: 'level1', data: makeSceneData() });
            await manager.load('level1');
            expect(manager.getSceneStatus('level1')).toBe('running');
        });

        it('isActive() returns correct value', async () => {
            manager.register({ name: 'level1', data: makeSceneData() });
            expect(manager.isActive('level1')).toBe(false);
            await manager.load('level1');
            expect(manager.isActive('level1')).toBe(true);
        });

        it('isLoaded() returns correct value', async () => {
            manager.register({ name: 'level1', data: makeSceneData() });
            expect(manager.isLoaded('level1')).toBe(false);
            await manager.load('level1');
            expect(manager.isLoaded('level1')).toBe(true);
        });
    });

    // =========================================================================
    // wrapSceneSystem
    // =========================================================================
    describe('wrapSceneSystem', () => {
        it('wrapped system only runs when scene status is running', async () => {
            manager.register({ name: 'level1', data: makeSceneData() });
            await manager.load('level1');

            const innerFn = vi.fn();
            const system = {
                _id: Symbol('test'),
                _name: 'testSystem',
                _params: [],
                _fn: innerFn,
            };

            // We need to set up getResource to return the manager
            const { SceneManager } = await import('../src/sceneManager');
            app.getResource.mockImplementation((key: any) => {
                if (key === SceneManager || key?._name === 'SceneManager') return manager;
                return undefined;
            });

            const wrapped = wrapSceneSystem(app as any, 'level1', system as any);
            (wrapped._fn as Function)();
            expect(innerFn).toHaveBeenCalledTimes(1);
        });

        it('wrapped system is skipped when scene is paused', async () => {
            manager.register({ name: 'level1', data: makeSceneData() });
            await manager.load('level1');
            manager.pause('level1');

            const innerFn = vi.fn();
            const system = {
                _id: Symbol('test'),
                _name: 'testSystem',
                _params: [],
                _fn: innerFn,
            };

            const { SceneManager } = await import('../src/sceneManager');
            app.getResource.mockImplementation((key: any) => {
                if (key === SceneManager || key?._name === 'SceneManager') return manager;
                return undefined;
            });

            const wrapped = wrapSceneSystem(app as any, 'level1', system as any);
            (wrapped._fn as Function)();
            expect(innerFn).not.toHaveBeenCalled();
        });

        it('wrapped system name includes scene name', () => {
            const system = {
                _id: Symbol('test'),
                _name: 'movement',
                _params: [],
                _fn: vi.fn(),
            };

            const wrapped = wrapSceneSystem(app as any, 'level1', system as any);
            expect(wrapped._name).toBe('movement@level1');
        });
    });

    // =========================================================================
    // Transition (fade)
    // =========================================================================
    describe('transition (fade)', () => {
        it('isTransitioning() returns false initially', () => {
            expect(manager.isTransitioning()).toBe(false);
        });

        it('switchTo with fade starts transition', async () => {
            manager.register({ name: 'level1', data: makeSceneData() });
            manager.register({ name: 'level2', data: makeSceneData() });
            await manager.load('level1');

            const onStart = vi.fn();
            manager.switchTo('level2', { transition: 'fade', duration: 1.0, onStart });

            // Allow microtask to run
            await Promise.resolve();

            expect(manager.isTransitioning()).toBe(true);
            expect(onStart).toHaveBeenCalled();
            expect(registerDrawCallback).toHaveBeenCalledWith(
                '__scene_transition_overlay__',
                expect.any(Function)
            );
        });

        it('updateTransition with dt progresses elapsed', async () => {
            manager.register({ name: 'level1', data: makeSceneData() });
            manager.register({ name: 'level2', data: makeSceneData() });
            await manager.load('level1');

            manager.switchTo('level2', { transition: 'fade', duration: 1.0 });
            await Promise.resolve();

            expect(manager.isTransitioning()).toBe(true);

            // Progress but not past half duration
            manager.updateTransition(0.2);
            expect(manager.isTransitioning()).toBe(true);
        });

        it('fade-out completes at half duration and switches to fade-in', async () => {
            manager.register({ name: 'level1', data: makeSceneData() });
            manager.register({ name: 'level2', data: makeSceneData() });
            await manager.load('level1');

            manager.switchTo('level2', { transition: 'fade', duration: 1.0 });
            await Promise.resolve();

            // Advance past half (0.5)
            manager.updateTransition(0.6);

            // Allow async scene switch to complete
            await new Promise(r => setTimeout(r, 10));

            // Should still be transitioning (in fade-in phase now)
            // If the fade-in hasn't completed, it should still be transitioning
            // The elapsed was reset to 0 for fade-in, then 0 < 0.5 so still transitioning
            expect(manager.isTransitioning()).toBe(true);
        });

        it('fade-in completes and resolves transition', async () => {
            manager.register({ name: 'level1', data: makeSceneData() });
            manager.register({ name: 'level2', data: makeSceneData() });
            await manager.load('level1');

            const onComplete = vi.fn();
            const promise = manager.switchTo('level2', {
                transition: 'fade',
                duration: 1.0,
                onComplete,
            });
            await Promise.resolve();

            // Complete fade-out (half = 0.5)
            manager.updateTransition(0.6);
            await new Promise(r => setTimeout(r, 10));

            // Complete fade-in (half = 0.5)
            manager.updateTransition(0.6);

            expect(manager.isTransitioning()).toBe(false);
            expect(onComplete).toHaveBeenCalled();
            expect(unregisterDrawCallback).toHaveBeenCalledWith('__scene_transition_overlay__');

            await promise;
        });

        it('switchTo with fade is ignored during active transition', async () => {
            manager.register({ name: 'level1', data: makeSceneData() });
            manager.register({ name: 'level2', data: makeSceneData() });
            manager.register({ name: 'level3', data: makeSceneData() });
            await manager.load('level1');

            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

            manager.switchTo('level2', { transition: 'fade', duration: 1.0 });
            await Promise.resolve();

            // Second switch should be ignored
            await manager.switchTo('level3');
            expect(warnSpy).toHaveBeenCalled();
            warnSpy.mockRestore();
        });
    });

    // =========================================================================
    // SceneContext methods
    // =========================================================================
    describe('SceneContext', () => {
        it('spawn() creates entity with SceneOwner', async () => {
            manager.register({ name: 'level1', data: makeSceneData() });
            const ctx = await manager.load('level1');

            const entity = ctx.spawn();
            expect(app.world.spawn).toHaveBeenCalled();
            expect(ctx.entities.has(entity)).toBe(true);
            expect(app.world.insert).toHaveBeenCalledWith(
                entity, SceneOwner, { scene: 'level1', persistent: false }
            );
        });

        it('despawn() removes entity from context', async () => {
            manager.register({ name: 'level1', data: makeSceneData() });
            const ctx = await manager.load('level1');

            const entity = ctx.spawn();
            ctx.despawn(entity);
            expect(app.world.despawn).toHaveBeenCalledWith(entity);
            expect(ctx.entities.has(entity)).toBe(false);
        });

        it('setPersistent() updates SceneOwner data', async () => {
            manager.register({ name: 'level1', data: makeSceneData() });
            const ctx = await manager.load('level1');

            const entity = ctx.spawn();
            ctx.setPersistent(entity, true);

            const lastInsertCall = app.world.insert.mock.calls[
                app.world.insert.mock.calls.length - 1
            ];
            expect(lastInsertCall[2].persistent).toBe(true);
        });

        it('removePostProcessPass() removes pass from instance tracking', async () => {
            manager.register({ name: 'level1', data: makeSceneData() });
            const ctx = await manager.load('level1');

            ctx.addPostProcessPass('bloom', 1 as any);
            ctx.removePostProcessPass('bloom');
            expect(PostProcess.removePass).toHaveBeenCalledWith('bloom');
        });
    });

    // =========================================================================
    // reset()
    // =========================================================================
    describe('reset()', () => {
        it('clears all loaded scenes and configs', async () => {
            manager.register({ name: 'level1', data: makeSceneData() });
            manager.register({ name: 'level2', data: makeSceneData() });
            await manager.load('level1');
            await manager.loadAdditive('level2');

            manager.reset();

            expect(manager.getActive()).toBeNull();
            expect(manager.getLoaded()).toEqual([]);
            expect(manager.getLoadOrder()).toEqual([]);
            expect(manager.getScene('level1')).toBeNull();
            expect(manager.getScene('level2')).toBeNull();
        });

        it('clears initial scene', async () => {
            manager.setInitial('level1');
            manager.reset();
            expect(manager.getInitial()).toBeNull();
        });

        it('clears paused and sleeping sets', async () => {
            manager.register({ name: 'level1', data: makeSceneData() });
            manager.register({ name: 'level2', data: makeSceneData() });
            await manager.load('level1');
            await manager.loadAdditive('level2');
            manager.pause('level1');
            manager.sleep('level2');

            manager.reset();

            expect(manager.isPaused('level1')).toBe(false);
            expect(manager.isSleeping('level2')).toBe(false);
        });

        it('unregisters draw callbacks from loaded scenes', async () => {
            manager.register({ name: 'level1', data: makeSceneData() });
            const ctx = await manager.load('level1');
            ctx.registerDrawCallback('myDraw', () => {});

            manager.reset();
            expect(unregisterDrawCallback).toHaveBeenCalledWith('myDraw');
        });

        it('unbinds post process from loaded scenes', async () => {
            manager.register({ name: 'level1', data: makeSceneData() });
            const ctx = await manager.load('level1');
            const mockStack = { setAllPassesEnabled: vi.fn() };
            ctx.bindPostProcess(42 as any, mockStack as any);

            manager.reset();
            expect(PostProcess.unbind).toHaveBeenCalledWith(42);
        });

        it('does not despawn entities', async () => {
            const entityMap = new Map([[100, 1]]);
            vi.mocked(loadSceneWithAssets).mockResolvedValueOnce(entityMap);
            app._entities.set(1, new Map());

            manager.register({ name: 'level1', data: makeSceneData() });
            await manager.load('level1');

            manager.reset();
            expect(app.world.despawn).not.toHaveBeenCalled();
        });

        it('clears transition state', async () => {
            manager.register({ name: 'level1', data: makeSceneData() });
            manager.register({ name: 'level2', data: makeSceneData() });
            await manager.load('level1');

            manager.switchTo('level2', { transition: 'fade', duration: 1.0 });
            await Promise.resolve();
            expect(manager.isTransitioning()).toBe(true);

            manager.reset();
            expect(manager.isTransitioning()).toBe(false);
            expect(unregisterDrawCallback).toHaveBeenCalledWith('__scene_transition_overlay__');
        });

        it('allows re-registration and loading after reset', async () => {
            manager.register({ name: 'level1', data: makeSceneData() });
            await manager.load('level1');

            manager.reset();

            manager.register({ name: 'level1', data: makeSceneData() });
            const ctx = await manager.load('level1');
            expect(ctx.name).toBe('level1');
            expect(manager.getActive()).toBe('level1');
        });
    });
});
