import type { ESEngineModule, CppRegistry, CppResourceManager } from '../../src/wasm';
import type { Entity } from '../../src/types';

export function createMockModule(): ESEngineModule {
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
        loadBitmapFont: () => 1,
        releaseBitmapFont: () => {},
        setTextureMetadata: () => {},
    };

    return {
        getRegistry: () => registry,
        getResourceManager: () => resourceManager,
        GL: {} as any,
    } as ESEngineModule;
}
