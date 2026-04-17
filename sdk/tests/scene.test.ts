import { describe, it, expect, vi, beforeEach } from 'vitest';
import { World } from '../src/world';
import { createMockModule } from './mocks/wasm';
import { defineComponent, defineBuiltin, Name, Camera } from '../src/component';
import { INVALID_ENTITY } from '../src/types';
import {
    loadSceneData,
    loadSceneWithAssets,
    loadComponent,
    remapEntityFields,
    findEntityByName,
    updateCameraAspectRatio,
    getComponentAssetFields,
    getComponentAssetFieldDescriptors,
    getComponentSpineFieldDescriptor,
    type SceneData,
    type SceneComponentData,
} from '../src/scene';
import type { Entity } from '../src/types';
import { discoverSceneAssets } from '../src/asset/discoverAssets';
import { getAssetFields, initBuiltinAssetFields } from '../src/asset/AssetFieldRegistry';
import { initResourceManager, shutdownResourceManager } from '../src/resourceManager';

initBuiltinAssetFields();

const Transform = defineBuiltin('Transform', {
    position: { x: 0, y: 0, z: 0 },
    rotation: { w: 1, x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
});

const UIRect = defineBuiltin('UIRect', {
    anchorMin: { x: 0, y: 0 },
    anchorMax: { x: 1, y: 1 },
    offsetMin: { x: 0, y: 0 },
    offsetMax: { x: 0, y: 0 },
    size: { x: 100, y: 100 },
    pivot: { x: 0.5, y: 0.5 },
});

const UIMask = defineBuiltin('UIMask', {
    mode: 0,
    enabled: true,
});

const Sprite = defineBuiltin('Sprite', {
    texture: 0,
    color: { x: 1, y: 1, z: 1, w: 1 },
    size: { x: 100, y: 100 },
    material: 0,
});

const Slider = defineBuiltin('Slider', {
    fillEntity: 0,
    handleEntity: 0,
    value: 0,
}, { entityFields: ['fillEntity', 'handleEntity'] });

describe('Scene', () => {
    let world: World;

    beforeEach(() => {
        const module = createMockModule();
        world = new World();
        world.connectCpp(module.getRegistry(), module);
        initResourceManager(module.getResourceManager());
    });

    // =========================================================================
    // Component Asset Field Registry
    // =========================================================================

    describe('Component Asset Field Registry', () => {
        it('should return asset fields for registered components', () => {
            const fields = getComponentAssetFields('Sprite');
            expect(fields).toContain('texture');
            expect(fields).toContain('material');
        });

        it('should return empty array for unregistered component', () => {
            const fields = getComponentAssetFields('NonExistent');
            expect(fields).toEqual([]);
        });

        it('should include spine fields when present', () => {
            const fields = getComponentAssetFields('SpineAnimation');
            expect(fields).toContain('skeletonPath');
            expect(fields).toContain('atlasPath');
            expect(fields).toContain('material');
        });

        it('should return field descriptors with type info', () => {
            const descriptors = getComponentAssetFieldDescriptors('Sprite');
            expect(descriptors).toEqual([
                { field: 'texture', type: 'texture' },
                { field: 'material', type: 'material' },
            ]);
        });

        it('should return empty array for unregistered descriptors', () => {
            expect(getComponentAssetFieldDescriptors('NonExistent')).toEqual([]);
        });

        it('should return spine field descriptor', () => {
            const spine = getComponentSpineFieldDescriptor('SpineAnimation');
            expect(spine).toEqual({
                skeletonField: 'skeletonPath',
                atlasField: 'atlasPath',
            });
        });

        it('should return null spine descriptor for non-spine component', () => {
            expect(getComponentSpineFieldDescriptor('Sprite')).toBeNull();
        });

    });

    // =========================================================================
    // remapEntityFields
    // =========================================================================

    describe('remapEntityFields', () => {
        it('should remap entity references using entityMap', () => {
            const compData: SceneComponentData = {
                type: 'Slider',
                data: { fillEntity: 10, handleEntity: 20, value: 0.5 },
            };
            const entityMap = new Map<number, Entity>([
                [10, 100 as Entity],
                [20, 200 as Entity],
            ]);

            remapEntityFields(compData, entityMap);

            expect(compData.data.fillEntity).toBe(100);
            expect(compData.data.handleEntity).toBe(200);
            expect(compData.data.value).toBe(0.5);
        });

        it('should set INVALID_ENTITY for missing entity references', () => {
            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
            const compData: SceneComponentData = {
                type: 'Slider',
                data: { fillEntity: 999, handleEntity: 0 },
            };
            const entityMap = new Map<number, Entity>();

            remapEntityFields(compData, entityMap);

            expect(compData.data.fillEntity).toBe(INVALID_ENTITY);
            expect(warnSpy).toHaveBeenCalledWith(
                expect.stringContaining('Entity reference not found'),
            );
            warnSpy.mockRestore();
        });

        it('should not remap INVALID_ENTITY (0) references', () => {
            const compData: SceneComponentData = {
                type: 'Slider',
                data: { fillEntity: INVALID_ENTITY, handleEntity: INVALID_ENTITY },
            };
            const entityMap = new Map<number, Entity>();

            remapEntityFields(compData, entityMap);

            expect(compData.data.fillEntity).toBe(INVALID_ENTITY);
            expect(compData.data.handleEntity).toBe(INVALID_ENTITY);
        });

        it('should skip components without entity fields', () => {
            const compData: SceneComponentData = {
                type: 'Transform',
                data: { x: 10, y: 20 },
            };
            const entityMap = new Map<number, Entity>();

            remapEntityFields(compData, entityMap);

            expect(compData.data.x).toBe(10);
            expect(compData.data.y).toBe(20);
        });

        it('should skip non-number entity field values', () => {
            const compData: SceneComponentData = {
                type: 'Slider',
                data: { fillEntity: 'not-a-number', handleEntity: null },
            };
            const entityMap = new Map<number, Entity>();

            remapEntityFields(compData, entityMap);

            expect(compData.data.fillEntity).toBe('not-a-number');
            expect(compData.data.handleEntity).toBeNull();
        });
    });

    // =========================================================================
    // loadComponent
    // =========================================================================

    describe('loadComponent', () => {
        it('should load a known component', () => {
            const entity = world.spawn();
            loadComponent(world, entity, {
                type: 'Transform',
                data: { position: { x: 10, y: 20, z: 0 } },
            });

            const transform = world.get(entity, Transform);
            expect(transform.position.x).toBe(10);
            expect(transform.position.y).toBe(20);
        });

        it('should convert LocalTransform to Transform', () => {
            const entity = world.spawn();
            const compData: SceneComponentData = {
                type: 'LocalTransform',
                data: { position: { x: 5, y: 5, z: 0 } },
            };
            loadComponent(world, entity, compData);

            expect(compData.type).toBe('Transform');
            expect(world.has(entity, Transform)).toBe(true);
        });

        it('should convert WorldTransform to Transform', () => {
            const entity = world.spawn();
            const compData: SceneComponentData = {
                type: 'WorldTransform',
                data: {},
            };
            loadComponent(world, entity, compData);

            expect(compData.type).toBe('Transform');
        });

        it('should convert legacy UIRect anchor to anchorMin/anchorMax', () => {
            const entity = world.spawn();
            loadComponent(world, entity, {
                type: 'UIRect',
                data: { anchor: { x: 0.5, y: 0.5 } },
            });

            const rect = world.get(entity, UIRect);
            expect(rect.anchorMin).toEqual({ x: 0.5, y: 0.5 });
            expect(rect.anchorMax).toEqual({ x: 0.5, y: 0.5 });
        });

        it('should not overwrite existing anchorMin with legacy anchor', () => {
            const compData = {
                type: 'UIRect',
                data: {
                    anchor: { x: 0, y: 0 },
                    anchorMin: { x: 0.1, y: 0.1 },
                    anchorMax: { x: 0.9, y: 0.9 },
                } as Record<string, unknown>,
            };

            expect(compData.data.anchorMin).toEqual({ x: 0.1, y: 0.1 });
            expect(compData.data.anchor).toBeDefined();

            // When anchorMin exists, anchor field is NOT converted
            // (anchor stays in data, conversion is skipped)
            loadComponent(world, world.spawn(), {
                type: 'UIRect',
                data: { anchorMin: { x: 0.1, y: 0.1 }, anchorMax: { x: 0.9, y: 0.9 } },
            });

            const entity = world.getEntitiesWithComponents([UIRect])[0];
            const rect = world.get(entity, UIRect);
            expect(rect.anchorMin).toEqual({ x: 0.1, y: 0.1 });
        });

        it('should convert UIMask mode string "scissor" to 0', () => {
            const entity = world.spawn();
            loadComponent(world, entity, {
                type: 'UIMask',
                data: { mode: 'scissor' },
            });

            const mask = world.get(entity, UIMask);
            expect(mask.mode).toBe(0);
        });

        it('should convert UIMask mode string "stencil" to 1', () => {
            const entity = world.spawn();
            loadComponent(world, entity, {
                type: 'UIMask',
                data: { mode: 'stencil' },
            });

            const mask = world.get(entity, UIMask);
            expect(mask.mode).toBe(1);
        });

        it('should warn for unknown component type', () => {
            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
            const entity = world.spawn();
            loadComponent(world, entity, {
                type: 'NonExistentComponent',
                data: {},
            }, 'TestEntity');

            expect(warnSpy).toHaveBeenCalledWith(
                expect.stringContaining('Unknown component type: NonExistentComponent'),
            );
            expect(warnSpy).toHaveBeenCalledWith(
                expect.stringContaining('on entity "TestEntity"'),
            );
            warnSpy.mockRestore();
        });

        it('should warn without entity name when not provided', () => {
            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
            const entity = world.spawn();
            loadComponent(world, entity, {
                type: 'NonExistentComponent',
                data: {},
            });

            expect(warnSpy).toHaveBeenCalledWith(
                expect.stringContaining('Unknown component type: NonExistentComponent'),
            );
            warnSpy.mockRestore();
        });
    });

    // =========================================================================
    // loadSceneData (sync)
    // =========================================================================

    describe('loadSceneData', () => {
        it('should spawn entities and return entity map', () => {
            const sceneData: SceneData = {
                version: '1.0',
                name: 'TestScene',
                entities: [
                    {
                        id: 0,
                        name: 'Root',
                        parent: null,
                        children: [1],
                        components: [],
                    },
                    {
                        id: 1,
                        name: 'Child',
                        parent: 0,
                        children: [],
                        components: [],
                    },
                ],
            };

            const entityMap = loadSceneData(world, sceneData);

            expect(entityMap.size).toBe(2);
            expect(entityMap.has(0)).toBe(true);
            expect(entityMap.has(1)).toBe(true);
        });

        it('should assign Name component to entities', () => {
            const sceneData: SceneData = {
                version: '1.0',
                name: 'TestScene',
                entities: [{
                    id: 0,
                    name: 'MyEntity',
                    parent: null,
                    children: [],
                    components: [],
                }],
            };

            const entityMap = loadSceneData(world, sceneData);
            const entity = entityMap.get(0)!;
            const name = world.get(entity, Name);
            expect(name.value).toBe('MyEntity');
        });

        it('should set up parent-child hierarchy', () => {
            const setParentSpy = vi.spyOn(world, 'setParent');
            const sceneData: SceneData = {
                version: '1.0',
                name: 'TestScene',
                entities: [
                    { id: 0, name: 'Root', parent: null, children: [1], components: [] },
                    { id: 1, name: 'Child', parent: 0, children: [], components: [] },
                ],
            };

            const entityMap = loadSceneData(world, sceneData);

            expect(setParentSpy).toHaveBeenCalledWith(
                entityMap.get(1),
                entityMap.get(0),
            );
        });

        it('should skip invisible entities', () => {
            const sceneData: SceneData = {
                version: '1.0',
                name: 'TestScene',
                entities: [
                    { id: 0, name: 'Visible', parent: null, children: [], components: [], visible: true },
                    { id: 1, name: 'Hidden', parent: null, children: [], components: [], visible: false },
                ],
            };

            const entityMap = loadSceneData(world, sceneData);

            expect(entityMap.size).toBe(1);
            expect(entityMap.has(0)).toBe(true);
            expect(entityMap.has(1)).toBe(false);
        });

        it('should load components for each entity', () => {
            const sceneData: SceneData = {
                version: '1.0',
                name: 'TestScene',
                entities: [{
                    id: 0,
                    name: 'WithTransform',
                    parent: null,
                    children: [],
                    components: [
                        { type: 'Transform', data: { position: { x: 10, y: 20, z: 0 } } },
                    ],
                }],
            };

            const entityMap = loadSceneData(world, sceneData);
            const entity = entityMap.get(0)!;
            const transform = world.get(entity, Transform);
            expect(transform.position.x).toBe(10);
        });

        it('should handle empty scene', () => {
            const sceneData: SceneData = {
                version: '1.0',
                name: 'EmptyScene',
                entities: [],
            };

            const entityMap = loadSceneData(world, sceneData);
            expect(entityMap.size).toBe(0);
        });

        it('should remap entity fields during component loading', () => {
            const sceneData: SceneData = {
                version: '1.0',
                name: 'SliderScene',
                entities: [
                    {
                        id: 0,
                        name: 'SliderRoot',
                        parent: null,
                        children: [1, 2],
                        components: [
                            { type: 'Slider', data: { fillEntity: 1, handleEntity: 2, value: 0.5 } },
                        ],
                    },
                    { id: 1, name: 'Fill', parent: 0, children: [], components: [] },
                    { id: 2, name: 'Handle', parent: 0, children: [], components: [] },
                ],
            };

            const entityMap = loadSceneData(world, sceneData);
            const root = entityMap.get(0)!;
            const slider = world.get(root, Slider);

            expect(slider.fillEntity).toBe(entityMap.get(1));
            expect(slider.handleEntity).toBe(entityMap.get(2));
        });

        it('should handle parent reference to non-existent entity gracefully', () => {
            const sceneData: SceneData = {
                version: '1.0',
                name: 'BrokenParent',
                entities: [
                    { id: 0, name: 'Orphan', parent: 999, children: [], components: [] },
                ],
            };

            const entityMap = loadSceneData(world, sceneData);
            expect(entityMap.size).toBe(1);
        });
    });

    // =========================================================================
    // loadSceneWithAssets (async)
    // =========================================================================

    describe('loadSceneWithAssets', () => {
        let nextTextureHandle: number;
        let nextMaterialHandle: number;
        let nextFontHandle: number;

        beforeEach(() => {
            nextTextureHandle = 100;
            nextMaterialHandle = 200;
            nextFontHandle = 300;
        });

        function createMockAssets(overrides?: {
            textureHandleMap?: Map<string, number>;
            materialHandleMap?: Map<string, number>;
            fontHandleMap?: Map<string, number>;
            failTextures?: Set<string>;
            failMaterials?: Set<string>;
            failFonts?: Set<string>;
            failSpines?: Set<string>;
        }) {
            const preloadSceneAssets = vi.fn().mockImplementation(async (sceneData: SceneData) => {
                const discovered = discoverSceneAssets(sceneData);

                const textureHandles = new Map<string, number>();
                const materialHandles = new Map<string, number>();
                const fontHandles = new Map<string, number>();

                const texturePaths = discovered.byType.get('texture') ?? new Set<string>();
                for (const path of texturePaths) {
                    if (overrides?.failTextures?.has(path)) {
                        console.warn(`[Assets] Failed to load texture: ${path}`, new Error('load failed'));
                        textureHandles.set(path, 0);
                    } else {
                        const handle = overrides?.textureHandleMap?.get(path) ?? nextTextureHandle++;
                        textureHandles.set(path, handle);
                    }
                }

                const materialPaths = discovered.byType.get('material') ?? new Set<string>();
                for (const path of materialPaths) {
                    if (overrides?.failMaterials?.has(path)) {
                        console.warn(`[Assets] Failed to load material: ${path}`, new Error('load failed'));
                        materialHandles.set(path, 0);
                    } else {
                        const handle = overrides?.materialHandleMap?.get(path) ?? nextMaterialHandle++;
                        materialHandles.set(path, handle);
                    }
                }

                const fontPaths = discovered.byType.get('font') ?? new Set<string>();
                for (const path of fontPaths) {
                    if (overrides?.failFonts?.has(path)) {
                        console.warn(`[Assets] Failed to load font: ${path}`, new Error('load failed'));
                        fontHandles.set(path, 0);
                    } else {
                        const handle = overrides?.fontHandleMap?.get(path) ?? nextFontHandle++;
                        fontHandles.set(path, handle);
                    }
                }

                for (const pair of discovered.spines) {
                    const key = `${pair.skeleton}:${pair.atlas}`;
                    if (overrides?.failSpines?.has(key)) {
                        console.warn(`[Assets] Failed to load spine: ${pair.skeleton}`, new Error('load failed'));
                    }
                }

                return { textureHandles, materialHandles, fontHandles, releaseCallbacks: [] };
            });

            const resolveSceneAssetPaths = vi.fn().mockImplementation(
                (sceneData: SceneData, result: { textureHandles: Map<string, number>; materialHandles: Map<string, number>; fontHandles: Map<string, number> }) => {
                    for (const entity of sceneData.entities) {
                        for (const comp of entity.components) {
                            const fields = getAssetFields(comp.type) as { field: string; type: string }[];
                            for (const { field, type } of fields) {
                                const value = comp.data[field];
                                if (typeof value !== 'string' || !value) continue;
                                switch (type) {
                                    case 'texture':
                                        comp.data[field] = result.textureHandles.get(value) ?? 0;
                                        break;
                                    case 'material':
                                        comp.data[field] = result.materialHandles.get(value) ?? 0;
                                        break;
                                    case 'font':
                                        comp.data[field] = result.fontHandles.get(value) ?? 0;
                                        break;
                                }
                            }
                        }
                    }
                },
            );

            return {
                preloadSceneAssets,
                resolveSceneAssetPaths,
            } as any;
        }

        it('should load scene without assets when no assets option', async () => {
            const sceneData: SceneData = {
                version: '1.0',
                name: 'NoAssets',
                entities: [{
                    id: 0,
                    name: 'Root',
                    parent: null,
                    children: [],
                    components: [{ type: 'Transform', data: {} }],
                }],
            };

            const entityMap = await loadSceneWithAssets(world, sceneData);
            expect(entityMap.size).toBe(1);
        });

        it('should preload textures and replace path with handle', async () => {
            const mockAssets = createMockAssets({
                textureHandleMap: new Map([['hero.png', 42]]),
            });
            const sceneData: SceneData = {
                version: '1.0',
                name: 'WithTexture',
                entities: [{
                    id: 0,
                    name: 'SpriteEntity',
                    parent: null,
                    children: [],
                    components: [
                        { type: 'Sprite', data: { texture: 'hero.png', material: 0 } },
                    ],
                }],
            };

            await loadSceneWithAssets(world, sceneData, { assets: mockAssets });

            expect(mockAssets.preloadSceneAssets).toHaveBeenCalledWith(sceneData, undefined);
            const entity = world.getEntitiesWithComponents([Sprite])[0];
            const sprite = world.get(entity, Sprite);
            expect(sprite.texture).toBe(42);
        });

        it('should preload materials and replace path with handle', async () => {
            const mockAssets = createMockAssets({
                materialHandleMap: new Map([['custom.mat', 55]]),
            });
            const sceneData: SceneData = {
                version: '1.0',
                name: 'WithMaterial',
                entities: [{
                    id: 0,
                    name: 'SpriteEntity',
                    parent: null,
                    children: [],
                    components: [
                        { type: 'Sprite', data: { texture: 0, material: 'custom.mat' } },
                    ],
                }],
            };

            await loadSceneWithAssets(world, sceneData, { assets: mockAssets });

            const entity = world.getEntitiesWithComponents([Sprite])[0];
            const sprite = world.get(entity, Sprite);
            expect(sprite.material).toBe(55);
        });

        it('should preload bitmap fonts and replace path with handle', async () => {
            const mockAssets = createMockAssets({
                fontHandleMap: new Map([['arial.fnt', 77]]),
            });

            defineBuiltin('BitmapText', { font: 0, text: '' });

            const sceneData: SceneData = {
                version: '1.0',
                name: 'WithFont',
                entities: [{
                    id: 0,
                    name: 'TextEntity',
                    parent: null,
                    children: [],
                    components: [
                        { type: 'BitmapText', data: { font: 'arial.fnt' } },
                    ],
                }],
            };

            await loadSceneWithAssets(world, sceneData, { assets: mockAssets });

            expect(mockAssets.preloadSceneAssets).toHaveBeenCalledWith(sceneData, undefined);
        });

        it('should call preloadSceneAssets for spine assets', async () => {
            const mockAssets = createMockAssets();
            const sceneData: SceneData = {
                version: '1.0',
                name: 'WithSpine',
                entities: [{
                    id: 0,
                    name: 'SpineEntity',
                    parent: null,
                    children: [],
                    components: [{
                        type: 'SpineAnimation',
                        data: {
                            skeletonPath: 'hero.skel',
                            atlasPath: 'hero.atlas',
                            material: 0,
                        },
                    }],
                }],
            };

            await loadSceneWithAssets(world, sceneData, { assets: mockAssets });
            expect(mockAssets.preloadSceneAssets).toHaveBeenCalledWith(sceneData, undefined);
        });

        it('should handle texture load failure gracefully', async () => {
            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
            const mockAssets = createMockAssets({
                failTextures: new Set(['missing.png']),
            });

            const sceneData: SceneData = {
                version: '1.0',
                name: 'FailedTexture',
                entities: [{
                    id: 0,
                    name: 'SpriteEntity',
                    parent: null,
                    children: [],
                    components: [
                        { type: 'Sprite', data: { texture: 'missing.png', material: 0 } },
                    ],
                }],
            };

            await loadSceneWithAssets(world, sceneData, { assets: mockAssets });

            expect(warnSpy).toHaveBeenCalledWith(
                expect.stringContaining('Failed to load texture'),
                expect.any(Error),
            );
            const entity = world.getEntitiesWithComponents([Sprite])[0];
            const sprite = world.get(entity, Sprite);
            expect(sprite.texture).toBe(0);
            warnSpy.mockRestore();
        });

        it('should handle material load failure gracefully', async () => {
            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
            const mockAssets = createMockAssets({
                failMaterials: new Set(['bad.mat']),
            });

            const sceneData: SceneData = {
                version: '1.0',
                name: 'FailedMaterial',
                entities: [{
                    id: 0,
                    name: 'SpriteEntity',
                    parent: null,
                    children: [],
                    components: [
                        { type: 'Sprite', data: { texture: 0, material: 'bad.mat' } },
                    ],
                }],
            };

            await loadSceneWithAssets(world, sceneData, { assets: mockAssets });

            expect(warnSpy).toHaveBeenCalledWith(
                expect.stringContaining('Failed to load material'),
                expect.any(Error),
            );
            const entity = world.getEntitiesWithComponents([Sprite])[0];
            const sprite = world.get(entity, Sprite);
            expect(sprite.material).toBe(0);
            warnSpy.mockRestore();
        });

        it('should handle font load failure gracefully', async () => {
            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
            const mockAssets = createMockAssets({
                failFonts: new Set(['bad.fnt']),
            });

            const sceneData: SceneData = {
                version: '1.0',
                name: 'FailedFont',
                entities: [{
                    id: 0,
                    name: 'TextEntity',
                    parent: null,
                    children: [],
                    components: [
                        { type: 'BitmapText', data: { font: 'bad.fnt' } },
                    ],
                }],
            };

            await loadSceneWithAssets(world, sceneData, { assets: mockAssets });

            expect(warnSpy).toHaveBeenCalledWith(
                expect.stringContaining('Failed to load font'),
                expect.any(Error),
            );
            warnSpy.mockRestore();
        });

        it('should warn on failed spine load', async () => {
            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
            const mockAssets = createMockAssets({
                failSpines: new Set(['bad.skel:bad.atlas']),
            });

            const sceneData: SceneData = {
                version: '1.0',
                name: 'FailedSpine',
                entities: [{
                    id: 0,
                    name: 'SpineEntity',
                    parent: null,
                    children: [],
                    components: [{
                        type: 'SpineAnimation',
                        data: { skeletonPath: 'bad.skel', atlasPath: 'bad.atlas', material: 0 },
                    }],
                }],
            };

            await loadSceneWithAssets(world, sceneData, { assets: mockAssets });
            expect(warnSpy).toHaveBeenCalledWith(
                expect.stringContaining('Failed to load spine'),
                expect.any(Error),
            );
            warnSpy.mockRestore();
        });

        it('should apply textureMetadata sliceBorder via applyTextureMetadata', async () => {
            const mockAssets = createMockAssets({
                textureHandleMap: new Map([['border.png', 10]]),
            });

            const sceneData: SceneData = {
                version: '1.0',
                name: 'WithMetadata',
                entities: [{
                    id: 0,
                    name: 'Entity',
                    parent: null,
                    children: [],
                    components: [
                        { type: 'Sprite', data: { texture: 'border.png', material: 0 } },
                    ],
                }],
                textureMetadata: {
                    'border.png': {
                        version: '1.0',
                        type: 'texture',
                        sliceBorder: { left: 10, right: 10, top: 5, bottom: 5 },
                    },
                },
            };

            await loadSceneWithAssets(world, sceneData, { assets: mockAssets });

            expect(mockAssets.preloadSceneAssets).toHaveBeenCalledWith(sceneData, undefined);
            expect(mockAssets.resolveSceneAssetPaths).toHaveBeenCalled();
        });

        it('should skip invisible entities during asset preloading', async () => {
            const mockAssets = createMockAssets();
            const sceneData: SceneData = {
                version: '1.0',
                name: 'InvisibleAssets',
                entities: [{
                    id: 0,
                    name: 'Hidden',
                    parent: null,
                    children: [],
                    components: [
                        { type: 'Sprite', data: { texture: 'hidden.png', material: 0 } },
                    ],
                    visible: false,
                }],
            };

            await loadSceneWithAssets(world, sceneData, { assets: mockAssets });

            const result = await mockAssets.preloadSceneAssets.mock.results[0].value;
            expect(result.textureHandles.size).toBe(0);
        });

        it('should replace multiple asset fields on the same component', async () => {
            const mockAssets = createMockAssets({
                textureHandleMap: new Map([['hero.png', 11]]),
                materialHandleMap: new Map([['glow.mat', 22]]),
            });

            const sceneData: SceneData = {
                version: '1.0',
                name: 'MultiField',
                entities: [{
                    id: 0,
                    name: 'Entity',
                    parent: null,
                    children: [],
                    components: [
                        { type: 'Sprite', data: { texture: 'hero.png', material: 'glow.mat' } },
                    ],
                }],
            };

            await loadSceneWithAssets(world, sceneData, { assets: mockAssets });

            const entity = world.getEntitiesWithComponents([Sprite])[0];
            const sprite = world.get(entity, Sprite);
            expect(sprite.texture).toBe(11);
            expect(sprite.material).toBe(22);
        });

        it('should not modify numeric asset values (already handles)', async () => {
            const mockAssets = createMockAssets();
            const sceneData: SceneData = {
                version: '1.0',
                name: 'NumericAsset',
                entities: [{
                    id: 0,
                    name: 'Entity',
                    parent: null,
                    children: [],
                    components: [
                        { type: 'Sprite', data: { texture: 5, material: 0 } },
                    ],
                }],
            };

            await loadSceneWithAssets(world, sceneData, { assets: mockAssets });

            const entity = world.getEntitiesWithComponents([Sprite])[0];
            const sprite = world.get(entity, Sprite);
            expect(sprite.texture).toBe(5);
            expect(sprite.material).toBe(0);
        });
    });

    // =========================================================================
    // findEntityByName
    // =========================================================================

    describe('findEntityByName', () => {
        it('should find entity by name', () => {
            const entity = world.spawn();
            world.insert(entity, Name, { value: 'Player' });

            const found = findEntityByName(world, 'Player');
            expect(found).toBe(entity);
        });

        it('should return null when entity not found', () => {
            const found = findEntityByName(world, 'NonExistent');
            expect(found).toBeNull();
        });

        it('should return last match when multiple entities have same name', () => {
            const e1 = world.spawn();
            world.insert(e1, Name, { value: 'Duplicate' });
            const e2 = world.spawn();
            world.insert(e2, Name, { value: 'Duplicate' });

            const found = findEntityByName(world, 'Duplicate');
            expect(found).toBe(e2);
        });
    });

    // =========================================================================
    // updateCameraAspectRatio
    // =========================================================================

    describe('updateCameraAspectRatio', () => {
        it('should update camera aspect ratio', () => {
            const entity = world.spawn();
            world.insert(entity, Camera, { aspectRatio: 1.0, nearPlane: 0.1, farPlane: 100 });

            updateCameraAspectRatio(world, 16 / 9);

            const camera = world.get(entity, Camera);
            expect(camera.aspectRatio).toBeCloseTo(16 / 9);
        });

        it('should update all cameras', () => {
            const e1 = world.spawn();
            world.insert(e1, Camera, { aspectRatio: 1.0 });
            const e2 = world.spawn();
            world.insert(e2, Camera, { aspectRatio: 1.0 });

            updateCameraAspectRatio(world, 2.0);

            expect(world.get(e1, Camera).aspectRatio).toBe(2.0);
            expect(world.get(e2, Camera).aspectRatio).toBe(2.0);
        });

        it('should do nothing when no cameras exist', () => {
            expect(() => updateCameraAspectRatio(world, 1.5)).not.toThrow();
        });
    });
});
