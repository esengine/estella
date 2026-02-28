import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrefabData, PrefabOverride, InstantiatePrefabOptions } from '../src/prefab';
import type { SceneData } from '../src/scene';
import type { World } from '../src/world';
import type { Entity } from '../src/types';

vi.mock('../src/scene', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../src/scene')>();
    return {
        ...actual,
        loadSceneWithAssets: vi.fn(),
    };
});

import { instantiatePrefab } from '../src/prefab';
import { loadSceneWithAssets, registerComponentEntityFields } from '../src/scene';

const mockLoadScene = vi.mocked(loadSceneWithAssets);

function createMockWorld(): World {
    const parentMap = new Map<Entity, Entity>();
    return {
        spawn: vi.fn(() => 0 as Entity),
        setParent: vi.fn((child: Entity, parent: Entity) => {
            parentMap.set(child, parent);
        }),
        insert: vi.fn(),
        get: vi.fn(),
    } as unknown as World;
}

function simplePrefab(overrides?: Partial<PrefabData>): PrefabData {
    return {
        version: '1.0',
        name: 'TestPrefab',
        rootEntityId: 0,
        entities: [
            {
                prefabEntityId: 0,
                name: 'Root',
                parent: null,
                children: [1],
                components: [
                    { type: 'Transform', data: { x: 0, y: 0 } },
                ],
                visible: true,
            },
            {
                prefabEntityId: 1,
                name: 'Child',
                parent: 0,
                children: [],
                components: [
                    { type: 'Sprite', data: { texture: 'test.png', color: 'red' } },
                ],
                visible: true,
            },
        ],
        ...overrides,
    };
}

describe('Prefab', () => {
    let world: World;
    let capturedSceneData: SceneData | null;

    beforeEach(() => {
        vi.clearAllMocks();
        world = createMockWorld();
        capturedSceneData = null;

        mockLoadScene.mockImplementation(async (_world, sceneData) => {
            capturedSceneData = sceneData;
            const entityMap = new Map<number, Entity>();
            for (const e of sceneData.entities) {
                entityMap.set(e.id, (e.id + 100) as Entity);
            }
            return entityMap;
        });
    });

    describe('instantiatePrefab - flat prefab', () => {
        it('should produce correct SceneData from a flat prefab', async () => {
            const prefab = simplePrefab();
            await instantiatePrefab(world, prefab);

            expect(capturedSceneData).not.toBeNull();
            expect(capturedSceneData!.version).toBe('1.0');
            expect(capturedSceneData!.name).toBe('TestPrefab');
            expect(capturedSceneData!.entities).toHaveLength(2);
        });

        it('should preserve entity IDs when no startId is provided', async () => {
            const prefab = simplePrefab();
            await instantiatePrefab(world, prefab);

            const ids = capturedSceneData!.entities.map(e => e.id);
            expect(ids).toEqual([0, 1]);
        });

        it('should preserve parent-child relationships', async () => {
            const prefab = simplePrefab();
            await instantiatePrefab(world, prefab);

            const root = capturedSceneData!.entities.find(e => e.id === 0)!;
            const child = capturedSceneData!.entities.find(e => e.id === 1)!;
            expect(root.parent).toBeNull();
            expect(child.parent).toBe(0);
        });

        it('should set root parent to null even if prefab has parent value', async () => {
            const prefab = simplePrefab();
            await instantiatePrefab(world, prefab);

            const root = capturedSceneData!.entities.find(e => e.id === 0)!;
            expect(root.parent).toBeNull();
        });

        it('should deep clone component data', async () => {
            const prefab = simplePrefab();
            await instantiatePrefab(world, prefab);

            const child = capturedSceneData!.entities.find(e => e.id === 1)!;
            child.components[0].data.texture = 'modified.png';
            expect(prefab.entities[1].components[0].data.texture).toBe('test.png');
        });

        it('should return root entity and entity map', async () => {
            const prefab = simplePrefab();
            const result = await instantiatePrefab(world, prefab);

            expect(result.root).toBe(100);
            expect(result.entities.size).toBe(2);
            expect(result.entities.get(0)).toBe(100);
            expect(result.entities.get(1)).toBe(101);
        });

        it('should filter children to only mapped entities', async () => {
            const prefab = simplePrefab();
            prefab.entities[0].children = [1, 999];
            await instantiatePrefab(world, prefab);

            const root = capturedSceneData!.entities.find(e => e.id === 0)!;
            expect(root.children).toEqual([1]);
        });

        it('should pass assetServer and assetBaseUrl to loadSceneWithAssets', async () => {
            const prefab = simplePrefab();
            const mockAssetServer = { loadPrefab: vi.fn() } as any;
            await instantiatePrefab(world, prefab, {
                assetServer: mockAssetServer,
                assetBaseUrl: '/assets',
            });

            expect(mockLoadScene).toHaveBeenCalledWith(
                world,
                expect.any(Object),
                { assetServer: mockAssetServer, assetBaseUrl: '/assets' },
            );
        });
    });

    describe('instantiatePrefab - parent option', () => {
        it('should call setParent when parent option is provided', async () => {
            const prefab = simplePrefab();
            const parentEntity = 42 as Entity;

            await instantiatePrefab(world, prefab, { parent: parentEntity });

            expect(world.setParent).toHaveBeenCalledWith(100, parentEntity);
        });

        it('should not call setParent when parent option is not provided', async () => {
            const prefab = simplePrefab();
            await instantiatePrefab(world, prefab);

            expect(world.setParent).not.toHaveBeenCalled();
        });
    });

    describe('property overrides', () => {
        it('should apply property override to matching component', async () => {
            const prefab = simplePrefab();
            const overrides: PrefabOverride[] = [{
                prefabEntityId: 1,
                type: 'property',
                componentType: 'Sprite',
                propertyName: 'color',
                value: 'blue',
            }];

            await instantiatePrefab(world, prefab, { overrides });

            const child = capturedSceneData!.entities.find(e => e.id === 1)!;
            const sprite = child.components.find(c => c.type === 'Sprite')!;
            expect(sprite.data.color).toBe('blue');
        });

        it('should not modify non-matching entity', async () => {
            const prefab = simplePrefab();
            const overrides: PrefabOverride[] = [{
                prefabEntityId: 0,
                type: 'property',
                componentType: 'Transform',
                propertyName: 'x',
                value: 99,
            }];

            await instantiatePrefab(world, prefab, { overrides });

            const child = capturedSceneData!.entities.find(e => e.id === 1)!;
            const sprite = child.components.find(c => c.type === 'Sprite')!;
            expect(sprite.data.color).toBe('red');
        });

        it('should ignore property override for non-existing component', async () => {
            const prefab = simplePrefab();
            const overrides: PrefabOverride[] = [{
                prefabEntityId: 1,
                type: 'property',
                componentType: 'NonExistent',
                propertyName: 'x',
                value: 42,
            }];

            await instantiatePrefab(world, prefab, { overrides });

            const child = capturedSceneData!.entities.find(e => e.id === 1)!;
            expect(child.components).toHaveLength(1);
            expect(child.components[0].type).toBe('Sprite');
        });
    });

    describe('name overrides', () => {
        it('should apply name override', async () => {
            const prefab = simplePrefab();
            const overrides: PrefabOverride[] = [{
                prefabEntityId: 1,
                type: 'name',
                value: 'RenamedChild',
            }];

            await instantiatePrefab(world, prefab, { overrides });

            const child = capturedSceneData!.entities.find(e => e.id === 1)!;
            expect(child.name).toBe('RenamedChild');
        });

        it('should ignore name override with non-string value', async () => {
            const prefab = simplePrefab();
            const overrides: PrefabOverride[] = [{
                prefabEntityId: 1,
                type: 'name',
                value: 42,
            }];

            await instantiatePrefab(world, prefab, { overrides });

            const child = capturedSceneData!.entities.find(e => e.id === 1)!;
            expect(child.name).toBe('Child');
        });
    });

    describe('visibility overrides', () => {
        it('should apply visibility override', async () => {
            const prefab = simplePrefab();
            const overrides: PrefabOverride[] = [{
                prefabEntityId: 1,
                type: 'visibility',
                value: false,
            }];

            await instantiatePrefab(world, prefab, { overrides });

            const child = capturedSceneData!.entities.find(e => e.id === 1)!;
            expect(child.visible).toBe(false);
        });

        it('should ignore visibility override with non-boolean value', async () => {
            const prefab = simplePrefab();
            const overrides: PrefabOverride[] = [{
                prefabEntityId: 1,
                type: 'visibility',
                value: 'false',
            }];

            await instantiatePrefab(world, prefab, { overrides });

            const child = capturedSceneData!.entities.find(e => e.id === 1)!;
            expect(child.visible).toBe(true);
        });
    });

    describe('component_added overrides', () => {
        it('should add a new component via override', async () => {
            const prefab = simplePrefab();
            const overrides: PrefabOverride[] = [{
                prefabEntityId: 1,
                type: 'component_added',
                componentData: { type: 'Health', data: { value: 50 } },
            }];

            await instantiatePrefab(world, prefab, { overrides });

            const child = capturedSceneData!.entities.find(e => e.id === 1)!;
            expect(child.components).toHaveLength(2);
            const health = child.components.find(c => c.type === 'Health')!;
            expect(health.data.value).toBe(50);
        });

        it('should not add duplicate component', async () => {
            const prefab = simplePrefab();
            const overrides: PrefabOverride[] = [{
                prefabEntityId: 1,
                type: 'component_added',
                componentData: { type: 'Sprite', data: { texture: 'new.png' } },
            }];

            await instantiatePrefab(world, prefab, { overrides });

            const child = capturedSceneData!.entities.find(e => e.id === 1)!;
            const sprites = child.components.filter(c => c.type === 'Sprite');
            expect(sprites).toHaveLength(1);
            expect(sprites[0].data.texture).toBe('test.png');
        });

        it('should deep clone component_added data', async () => {
            const componentData = { type: 'Health', data: { value: 50 } };
            const overrides: PrefabOverride[] = [{
                prefabEntityId: 1,
                type: 'component_added',
                componentData,
            }];

            await instantiatePrefab(world, simplePrefab(), { overrides });

            const child = capturedSceneData!.entities.find(e => e.id === 1)!;
            const health = child.components.find(c => c.type === 'Health')!;
            health.data.value = 999;
            expect(componentData.data.value).toBe(50);
        });

        it('should ignore component_added without componentData', async () => {
            const prefab = simplePrefab();
            const overrides: PrefabOverride[] = [{
                prefabEntityId: 1,
                type: 'component_added',
            }];

            await instantiatePrefab(world, prefab, { overrides });

            const child = capturedSceneData!.entities.find(e => e.id === 1)!;
            expect(child.components).toHaveLength(1);
        });
    });

    describe('component_removed overrides', () => {
        it('should remove a component via override', async () => {
            const prefab = simplePrefab();
            const overrides: PrefabOverride[] = [{
                prefabEntityId: 1,
                type: 'component_removed',
                componentType: 'Sprite',
            }];

            await instantiatePrefab(world, prefab, { overrides });

            const child = capturedSceneData!.entities.find(e => e.id === 1)!;
            expect(child.components).toHaveLength(0);
        });

        it('should ignore removal of non-existing component', async () => {
            const prefab = simplePrefab();
            const overrides: PrefabOverride[] = [{
                prefabEntityId: 1,
                type: 'component_removed',
                componentType: 'NonExistent',
            }];

            await instantiatePrefab(world, prefab, { overrides });

            const child = capturedSceneData!.entities.find(e => e.id === 1)!;
            expect(child.components).toHaveLength(1);
        });
    });

    describe('entity reference remapping', () => {
        beforeEach(() => {
            registerComponentEntityFields('Slider', ['fillEntity', 'handleEntity']);
        });

        it('should remap entity references in components', async () => {
            const prefab: PrefabData = {
                version: '1.0',
                name: 'SliderPrefab',
                rootEntityId: 0,
                entities: [
                    {
                        prefabEntityId: 0,
                        name: 'SliderRoot',
                        parent: null,
                        children: [1, 2],
                        components: [
                            { type: 'Slider', data: { fillEntity: 1, handleEntity: 2, value: 0.5 } },
                        ],
                        visible: true,
                    },
                    {
                        prefabEntityId: 1,
                        name: 'Fill',
                        parent: 0,
                        children: [],
                        components: [],
                        visible: true,
                    },
                    {
                        prefabEntityId: 2,
                        name: 'Handle',
                        parent: 0,
                        children: [],
                        components: [],
                        visible: true,
                    },
                ],
            };

            await instantiatePrefab(world, prefab);

            const root = capturedSceneData!.entities.find(e => e.id === 0)!;
            const slider = root.components.find(c => c.type === 'Slider')!;
            expect(slider.data.fillEntity).toBe(1);
            expect(slider.data.handleEntity).toBe(2);
            expect(slider.data.value).toBe(0.5);
        });

        it('should not remap zero entity references', async () => {
            const prefab: PrefabData = {
                version: '1.0',
                name: 'SliderPrefab',
                rootEntityId: 0,
                entities: [
                    {
                        prefabEntityId: 0,
                        name: 'SliderRoot',
                        parent: null,
                        children: [],
                        components: [
                            { type: 'Slider', data: { fillEntity: 0, handleEntity: 0, value: 0 } },
                        ],
                        visible: true,
                    },
                ],
            };

            await instantiatePrefab(world, prefab);

            const root = capturedSceneData!.entities.find(e => e.id === 0)!;
            const slider = root.components.find(c => c.type === 'Slider')!;
            expect(slider.data.fillEntity).toBe(0);
            expect(slider.data.handleEntity).toBe(0);
        });

        it('should skip components without entity fields', async () => {
            const prefab: PrefabData = {
                version: '1.0',
                name: 'Test',
                rootEntityId: 0,
                entities: [{
                    prefabEntityId: 0,
                    name: 'Root',
                    parent: null,
                    children: [],
                    components: [
                        { type: 'Transform', data: { x: 10, y: 20 } },
                    ],
                    visible: true,
                }],
            };

            await instantiatePrefab(world, prefab);

            const root = capturedSceneData!.entities.find(e => e.id === 0)!;
            expect(root.components[0].data.x).toBe(10);
        });
    });

    describe('nested prefabs', () => {
        it('should flatten nested prefab entities into parent', async () => {
            const childPrefab: PrefabData = {
                version: '1.0',
                name: 'ChildPrefab',
                rootEntityId: 0,
                entities: [{
                    prefabEntityId: 0,
                    name: 'NestedRoot',
                    parent: null,
                    children: [],
                    components: [{ type: 'Transform', data: { x: 5 } }],
                    visible: true,
                }],
            };

            const parentPrefab: PrefabData = {
                version: '1.0',
                name: 'ParentPrefab',
                rootEntityId: 0,
                entities: [
                    {
                        prefabEntityId: 0,
                        name: 'ParentRoot',
                        parent: null,
                        children: [1],
                        components: [{ type: 'Transform', data: { x: 0 } }],
                        visible: true,
                    },
                    {
                        prefabEntityId: 1,
                        name: 'NestedSlot',
                        parent: 0,
                        children: [],
                        components: [],
                        visible: true,
                        nestedPrefab: {
                            prefabPath: 'child.prefab',
                            overrides: [],
                        },
                    },
                ],
            };

            const mockAssetServer = {
                loadPrefab: vi.fn().mockResolvedValue(childPrefab),
            } as any;

            await instantiatePrefab(world, parentPrefab, { assetServer: mockAssetServer });

            expect(capturedSceneData!.entities).toHaveLength(2);
            const names = capturedSceneData!.entities.map(e => e.name);
            expect(names).toContain('ParentRoot');
            expect(names).toContain('NestedRoot');
        });

        it('should remap nested prefab entity IDs to avoid collisions', async () => {
            const childPrefab: PrefabData = {
                version: '1.0',
                name: 'ChildPrefab',
                rootEntityId: 0,
                entities: [
                    {
                        prefabEntityId: 0,
                        name: 'NestedRoot',
                        parent: null,
                        children: [1],
                        components: [],
                        visible: true,
                    },
                    {
                        prefabEntityId: 1,
                        name: 'NestedChild',
                        parent: 0,
                        children: [],
                        components: [],
                        visible: true,
                    },
                ],
            };

            const parentPrefab: PrefabData = {
                version: '1.0',
                name: 'ParentPrefab',
                rootEntityId: 0,
                entities: [
                    {
                        prefabEntityId: 0,
                        name: 'ParentRoot',
                        parent: null,
                        children: [1],
                        components: [],
                        visible: true,
                    },
                    {
                        prefabEntityId: 1,
                        name: 'NestedSlot',
                        parent: 0,
                        children: [],
                        components: [],
                        visible: true,
                        nestedPrefab: {
                            prefabPath: 'child.prefab',
                            overrides: [],
                        },
                    },
                ],
            };

            const mockAssetServer = {
                loadPrefab: vi.fn().mockResolvedValue(childPrefab),
            } as any;

            await instantiatePrefab(world, parentPrefab, { assetServer: mockAssetServer });

            const ids = capturedSceneData!.entities.map(e => e.id);
            const uniqueIds = new Set(ids);
            expect(uniqueIds.size).toBe(ids.length);
        });

        it('should set nested root parent to slot parent', async () => {
            const childPrefab: PrefabData = {
                version: '1.0',
                name: 'ChildPrefab',
                rootEntityId: 0,
                entities: [{
                    prefabEntityId: 0,
                    name: 'NestedRoot',
                    parent: null,
                    children: [],
                    components: [],
                    visible: true,
                }],
            };

            const parentPrefab: PrefabData = {
                version: '1.0',
                name: 'ParentPrefab',
                rootEntityId: 0,
                entities: [
                    {
                        prefabEntityId: 0,
                        name: 'ParentRoot',
                        parent: null,
                        children: [1],
                        components: [],
                        visible: true,
                    },
                    {
                        prefabEntityId: 1,
                        name: 'NestedSlot',
                        parent: 0,
                        children: [],
                        components: [],
                        visible: true,
                        nestedPrefab: {
                            prefabPath: 'child.prefab',
                            overrides: [],
                        },
                    },
                ],
            };

            const mockAssetServer = {
                loadPrefab: vi.fn().mockResolvedValue(childPrefab),
            } as any;

            await instantiatePrefab(world, parentPrefab, { assetServer: mockAssetServer });

            const nestedRoot = capturedSceneData!.entities.find(e => e.name === 'NestedRoot')!;
            expect(nestedRoot.parent).toBe(0);
        });

        it('should apply overrides to nested prefab entities', async () => {
            const childPrefab: PrefabData = {
                version: '1.0',
                name: 'ChildPrefab',
                rootEntityId: 0,
                entities: [{
                    prefabEntityId: 0,
                    name: 'NestedRoot',
                    parent: null,
                    children: [],
                    components: [{ type: 'Sprite', data: { color: 'red' } }],
                    visible: true,
                }],
            };

            const parentPrefab: PrefabData = {
                version: '1.0',
                name: 'ParentPrefab',
                rootEntityId: 0,
                entities: [
                    {
                        prefabEntityId: 0,
                        name: 'ParentRoot',
                        parent: null,
                        children: [1],
                        components: [],
                        visible: true,
                    },
                    {
                        prefabEntityId: 1,
                        name: 'NestedSlot',
                        parent: 0,
                        children: [],
                        components: [],
                        visible: true,
                        nestedPrefab: {
                            prefabPath: 'child.prefab',
                            overrides: [{
                                prefabEntityId: 0,
                                type: 'property',
                                componentType: 'Sprite',
                                propertyName: 'color',
                                value: 'green',
                            }],
                        },
                    },
                ],
            };

            const mockAssetServer = {
                loadPrefab: vi.fn().mockResolvedValue(childPrefab),
            } as any;

            await instantiatePrefab(world, parentPrefab, { assetServer: mockAssetServer });

            const nestedRoot = capturedSceneData!.entities.find(e => e.name === 'NestedRoot')!;
            const sprite = nestedRoot.components.find(c => c.type === 'Sprite')!;
            expect(sprite.data.color).toBe('green');
        });

        it('should detect circular reference', async () => {
            const selfRefPrefab: PrefabData = {
                version: '1.0',
                name: 'SelfRef',
                rootEntityId: 0,
                entities: [
                    {
                        prefabEntityId: 0,
                        name: 'Root',
                        parent: null,
                        children: [1],
                        components: [],
                        visible: true,
                    },
                    {
                        prefabEntityId: 1,
                        name: 'Nested',
                        parent: 0,
                        children: [],
                        components: [],
                        visible: true,
                        nestedPrefab: {
                            prefabPath: 'self.prefab',
                            overrides: [],
                        },
                    },
                ],
            };

            const mockAssetServer = {
                loadPrefab: vi.fn().mockResolvedValue(selfRefPrefab),
            } as any;

            await expect(
                instantiatePrefab(world, selfRefPrefab, { assetServer: mockAssetServer }),
            ).rejects.toThrow('Circular reference detected');
        });

        it('should throw when nesting depth exceeds maximum', async () => {
            const deepPrefab: PrefabData = {
                version: '1.0',
                name: 'Deep',
                rootEntityId: 0,
                entities: [
                    {
                        prefabEntityId: 0,
                        name: 'Root',
                        parent: null,
                        children: [1],
                        components: [],
                        visible: true,
                    },
                    {
                        prefabEntityId: 1,
                        name: 'Nested',
                        parent: 0,
                        children: [],
                        components: [],
                        visible: true,
                        nestedPrefab: {
                            prefabPath: 'deep.prefab',
                            overrides: [],
                        },
                    },
                ],
            };

            let callCount = 0;
            const mockAssetServer = {
                loadPrefab: vi.fn().mockImplementation(() => {
                    callCount++;
                    return Promise.resolve({
                        ...deepPrefab,
                        name: `Deep_${callCount}`,
                        entities: deepPrefab.entities.map(e => ({
                            ...e,
                            nestedPrefab: e.nestedPrefab
                                ? { ...e.nestedPrefab, prefabPath: `deep_${callCount}.prefab` }
                                : undefined,
                        })),
                    });
                }),
            } as any;

            await expect(
                instantiatePrefab(world, deepPrefab, { assetServer: mockAssetServer }),
            ).rejects.toThrow('nesting depth exceeded');
        });

        it('should throw when nested prefab requires AssetServer but none provided', async () => {
            const parentPrefab: PrefabData = {
                version: '1.0',
                name: 'Parent',
                rootEntityId: 0,
                entities: [
                    {
                        prefabEntityId: 0,
                        name: 'Root',
                        parent: null,
                        children: [1],
                        components: [],
                        visible: true,
                    },
                    {
                        prefabEntityId: 1,
                        name: 'Nested',
                        parent: 0,
                        children: [],
                        components: [],
                        visible: true,
                        nestedPrefab: {
                            prefabPath: 'child.prefab',
                            overrides: [],
                        },
                    },
                ],
            };

            await expect(
                instantiatePrefab(world, parentPrefab),
            ).rejects.toThrow('AssetServer required');
        });
    });

    describe('multiple overrides on same entity', () => {
        it('should apply multiple override types together', async () => {
            const prefab = simplePrefab();
            const overrides: PrefabOverride[] = [
                {
                    prefabEntityId: 1,
                    type: 'name',
                    value: 'RenamedChild',
                },
                {
                    prefabEntityId: 1,
                    type: 'property',
                    componentType: 'Sprite',
                    propertyName: 'color',
                    value: 'blue',
                },
                {
                    prefabEntityId: 1,
                    type: 'component_added',
                    componentData: { type: 'Health', data: { value: 100 } },
                },
            ];

            await instantiatePrefab(world, prefab, { overrides });

            const child = capturedSceneData!.entities.find(e => e.id === 1)!;
            expect(child.name).toBe('RenamedChild');
            expect(child.components.find(c => c.type === 'Sprite')!.data.color).toBe('blue');
            expect(child.components.find(c => c.type === 'Health')!.data.value).toBe(100);
        });
    });

    describe('nested prefab edge cases', () => {
        it('should set nested root parent to null when slot has null parent', async () => {
            const childPrefab: PrefabData = {
                version: '1.0',
                name: 'ChildPrefab',
                rootEntityId: 0,
                entities: [{
                    prefabEntityId: 0,
                    name: 'NestedRoot',
                    parent: null,
                    children: [],
                    components: [],
                    visible: true,
                }],
            };

            const parentPrefab: PrefabData = {
                version: '1.0',
                name: 'ParentPrefab',
                rootEntityId: 0,
                entities: [{
                    prefabEntityId: 0,
                    name: 'Slot',
                    parent: null,
                    children: [],
                    components: [],
                    visible: true,
                    nestedPrefab: {
                        prefabPath: 'child.prefab',
                        overrides: [],
                    },
                }],
            };

            const mockAssetServer = {
                loadPrefab: vi.fn().mockResolvedValue(childPrefab),
            } as any;

            await instantiatePrefab(world, parentPrefab, { assetServer: mockAssetServer });

            const nestedRoot = capturedSceneData!.entities.find(e => e.name === 'NestedRoot')!;
            expect(nestedRoot.parent).toBeNull();
        });

        it('should throw when root entity ID only appears in nested prefabs', async () => {
            const prefab: PrefabData = {
                version: '1.0',
                name: 'BadPrefab',
                rootEntityId: 99,
                entities: [{
                    prefabEntityId: 0,
                    name: 'Root',
                    parent: null,
                    children: [],
                    components: [],
                    visible: true,
                }],
            };

            await expect(
                instantiatePrefab(world, prefab),
            ).rejects.toThrow('Failed to resolve prefab root entity');
        });
    });

    describe('edge cases', () => {
        it('should handle prefab with single entity', async () => {
            const prefab: PrefabData = {
                version: '1.0',
                name: 'SingleEntity',
                rootEntityId: 0,
                entities: [{
                    prefabEntityId: 0,
                    name: 'OnlyEntity',
                    parent: null,
                    children: [],
                    components: [],
                    visible: true,
                }],
            };

            const result = await instantiatePrefab(world, prefab);

            expect(capturedSceneData!.entities).toHaveLength(1);
            expect(result.root).toBe(100);
        });

        it('should handle non-sequential entity IDs', async () => {
            const prefab: PrefabData = {
                version: '1.0',
                name: 'NonSequential',
                rootEntityId: 5,
                entities: [
                    {
                        prefabEntityId: 5,
                        name: 'Root',
                        parent: null,
                        children: [10],
                        components: [],
                        visible: true,
                    },
                    {
                        prefabEntityId: 10,
                        name: 'Child',
                        parent: 5,
                        children: [],
                        components: [],
                        visible: true,
                    },
                ],
            };

            await instantiatePrefab(world, prefab);

            expect(capturedSceneData!.entities).toHaveLength(2);
            const root = capturedSceneData!.entities.find(e => e.name === 'Root')!;
            const child = capturedSceneData!.entities.find(e => e.name === 'Child')!;
            expect(root.id).toBe(5);
            expect(child.id).toBe(10);
            expect(child.parent).toBe(5);
        });

        it('should handle empty overrides array', async () => {
            const prefab = simplePrefab();
            await instantiatePrefab(world, prefab, { overrides: [] });

            const child = capturedSceneData!.entities.find(e => e.id === 1)!;
            expect(child.name).toBe('Child');
            expect(child.components[0].data.color).toBe('red');
        });
    });
});
