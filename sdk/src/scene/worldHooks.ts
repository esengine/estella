// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { AnyComponentDef } from '../ecs/component';
import type { World } from '../ecs/world';
import type { Entity } from '../types';

export type WorldHooks<K, V> = WeakMap<World, Map<K, { value: V }>>;

/** A replaced installation keeps its own cleanup from removing its successor. */
export function installWorldHook<K, V>(worlds: WorldHooks<K, V>, world: World, key: K, value: V): () => void {
    let hooks = worlds.get(world);
    if (!hooks) worlds.set(world, hooks = new Map());
    const installation = { value };
    hooks.set(key, installation);
    return () => {
        if (hooks.get(key) !== installation) return;
        hooks.delete(key);
        if (hooks.size === 0) worlds.delete(world);
    };
}

/** A filter may update the detached payload, or return false to omit a generated component. */
export type SceneExportFilter = (entity: Entity, component: string, data: Record<string, unknown>) => void | false;

const exportFilters: WorldHooks<SceneExportFilter, SceneExportFilter> = new WeakMap();

/** @internal */
export function registerWorldSceneExportFilter(world: World, filter: SceneExportFilter): () => void {
    return installWorldHook(exportFilters, world, filter, filter);
}

export function shouldExportComponent(world: World, entity: Entity, component: string, data: Record<string, unknown>): boolean {
    const filters = exportFilters.get(world);
    if (filters) for (const filter of filters.keys()) {
        if (filter(entity, component, data) === false) return false;
    }
    return true;
}

type ComponentInitializer = (world: World, entity: Entity) => void;
const initializers: WorldHooks<AnyComponentDef, ComponentInitializer> = new WeakMap();

/** An initializer sees every component of its entity, regardless of their order in a scene or prefab. */
export function registerSceneComponentInitializer(world: World, component: AnyComponentDef, initialize: ComponentInitializer): void {
    if (initializers.get(world)?.get(component)?.value !== initialize) {
        installWorldHook(initializers, world, component, initialize);
    }
}

export function initializeSceneComponents(world: World, entity: Entity): void {
    const hooks = initializers.get(world);
    if (!hooks) return;
    for (const [component, hook] of hooks) {
        if (world.has(entity, component)) hook.value(world, entity);
    }
}
