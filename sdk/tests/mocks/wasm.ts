// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { ESEngineModule, CppRegistry, CppResourceManager } from '../../src/wasm';
import type { Entity } from '../../src/types';

/**
 * The mock module, plus the handful of setters that stand in for computation the
 * mock does not do. `setUINodeHiddenInTree` is the layout pass's verdict, which a
 * test states instead of solving.
 */
export interface MockModule extends ESEngineModule {
    setUINodeHiddenInTree(entity: Entity, hidden: boolean): void;
}

export function createMockModule(): MockModule {
    const entities = new Set<Entity>();
    const components = new Map<Entity, Map<string, any>>();
    let nextEntity = 1;

    const baseRegistry = {
        create: () => {
            const entity = nextEntity++ as Entity;
            entities.add(entity);
            components.set(entity, new Map());
            return entity;
        },

        destroy: (entity: Entity) => {
            entities.delete(entity);
            components.delete(entity);
        },

        valid: (entity: Entity) => {
            return entities.has(entity);
        },

        entityCount: () => entities.size,

        setParent: (_child: Entity, _parent: Entity) => {},

        delete: () => {},
        removeParent: (_entity: Entity) => {},

        // Legacy names used by some internal code paths
        createEntity: () => {
            const entity = nextEntity++ as Entity;
            entities.add(entity);
            components.set(entity, new Map());
            return entity;
        },

        destroyEntity: (entity: Entity) => {
            entities.delete(entity);
            components.delete(entity);
        },

        isValid: (entity: Entity) => {
            return entities.has(entity);
        },

        getEntitiesWithComponents: (componentNames: string[]) => {
            const result: Entity[] = [];
            for (const [entity, comps] of components.entries()) {
                if (componentNames.every(name => comps.has(name))) {
                    result.push(entity);
                }
            }
            return result;
        },

        hasComponent: (entity: Entity, componentName: string) => {
            return components.get(entity)?.has(componentName) ?? false;
        },

        insertComponent: (entity: Entity, componentName: string, data: any) => {
            const entityComps = components.get(entity);
            if (entityComps) {
                entityComps.set(componentName, data);
            }
        },

        removeComponent: (entity: Entity, componentName: string) => {
            components.get(entity)?.delete(componentName);
        },

        getComponentData: (entity: Entity, componentName: string) => {
            return components.get(entity)?.get(componentName);
        },
    };

    const registry = new Proxy(baseRegistry, {
        get(target, prop: string) {
            if (prop in target) {
                return (target as any)[prop];
            }
            if (prop.startsWith('add')) {
                const name = prop.slice(3);
                return (entity: Entity, data: any) => {
                    components.get(entity)?.set(name, JSON.parse(JSON.stringify(data)));
                };
            }
            if (prop.startsWith('get') && prop !== 'getEntitiesWithComponents' && prop !== 'getComponentData') {
                const name = prop.slice(3);
                return (entity: Entity) => {
                    const data = components.get(entity)?.get(name);
                    return data ? JSON.parse(JSON.stringify(data)) : undefined;
                };
            }
            if (prop.startsWith('has') && prop !== 'hasComponent') {
                const name = prop.slice(3);
                return (entity: Entity) => {
                    return components.get(entity)?.has(name) ?? false;
                };
            }
            if (prop.startsWith('remove') && prop !== 'removeComponent' && prop !== 'removeParent') {
                const name = prop.slice(6);
                return (entity: Entity) => {
                    components.get(entity)?.delete(name);
                };
            }
            return undefined;
        },
    }) as unknown as CppRegistry;

    const resourceManager: CppResourceManager = {
        loadTexture: () => 1,
        releaseTexture: () => {},
        getTextureSize: () => ({ width: 100, height: 100 }),
        getTextureDimensions: () => ({ width: 100, height: 100 }),
        loadBitmapFont: () => 1,
        releaseBitmapFont: () => {},
        setTextureMetadata: () => {},
        setTextureBudget: () => {},
        registerTextureWithPath: () => {},
        acquireTextureByPath: () => 0,
        invalidateTexturePath: () => false,
        trimTextureCache: () => 0,
        getResourceStats: () => ({
            shaderCount: 0, textureCount: 0, vertexBufferCount: 0, indexBufferCount: 0,
            cacheHits: 0, cacheMisses: 0,
            textureBytes: 0, textureBudget: 0, textureEvictableCount: 0,
        }),
    };

    // `hidden_in_tree_` is layout output, not a stored field, so the mock cannot
    // derive it — a test that needs it says what the layout pass resolved via
    // `setUINodeHiddenInTree`. Default false: a node nobody spoke for is on screen.
    const hiddenInTree = new Map<Entity, boolean>();

    return {
        getRegistry: () => registry,
        getResourceManager: () => resourceManager,
        getUINodeHiddenInTree: (_registry: unknown, entity: Entity) => hiddenInTree.get(entity) ?? false,
        setUINodeHiddenInTree: (entity: Entity, hidden: boolean) => { hiddenInTree.set(entity, hidden); },
        GL: {} as any,
    } as MockModule;
}
