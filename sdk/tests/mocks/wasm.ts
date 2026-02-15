import type { ESEngineModule, CppRegistry, CppResourceManager } from '../../src/wasm';
import type { Entity } from '../../src/types';

export function createMockModule(): ESEngineModule {
    const entities = new Set<Entity>();
    const components = new Map<Entity, Map<string, any>>();
    let nextEntity = 1;

    const registry: CppRegistry = {
        createEntity: () => {
            const entity = nextEntity++;
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

    const resourceManager: CppResourceManager = {
        loadTexture: () => 1,
        releaseTexture: () => {},
        getTextureSize: () => ({ width: 100, height: 100 }),
        loadBitmapFont: () => 1,
        releaseBitmapFont: () => {},
    };

    return {
        getRegistry: () => registry,
        getResourceManager: () => resourceManager,
        GL: {} as any,
    } as ESEngineModule;
}
