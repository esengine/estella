// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    cocos/prefabs.ts
 * @brief   `instantiate(prefab)` and `instantiate(node)`.
 *
 * Cocos's `instantiate` answers a node at once, because its prefabs are loaded before a script can hold them. The engine's
 * prefab spawn is asynchronous for the same reason the other way round: loading is what it does. The bridge is the engine's
 * *prepared prefab* (prefab/preparedPrefab.ts) — load once, with every asset the prefab names, then spawn synchronously any
 * number of times. A script that holds a `Prefab` (a `@property(Prefab)` field) causes that preparation to start, so by the time
 * a click handler runs it is ready; an `instantiate` before then says so rather than returning something half made.
 *
 * What comes back is out of the scene until it is given a parent, as in Cocos: the entity is made, held switched off, and let in
 * by the first `addChild` (see `markDetached` in node.ts).
 */
import { Schedule, defineSystem, addSystemToSchedule, GetWorld } from '../ecs/system';
import { Res } from '../ecs/resource';
import { Assets } from '../asset/AssetPlugin';
import type { Assets as AssetsClass } from '../asset/Assets';
import { preparePrefab, spawnPrepared, type PreparedPrefab } from '../prefab/preparedPrefab';
import { getComponent } from '../ecs/component';
import { Children, Name, Parent } from '../ecs/component';
import { loadSceneData, serializeEntityComponents, SCENE_FORMAT_VERSION, type SceneData } from '../scene/scene';
import type { World } from '../ecs/world';
import type { Entity } from '../types';
import { log } from '../util/logger';
import { Node, getCurrentWorld, markDetached } from './node';
import { Prefab, preparedPrefabs } from './assets';

const assetsOf = new WeakMap<World, AssetsClass>();
const wanted = new Set<string>();
const inFlight = new Set<string>();

/** The engine's asset loader for a world, once the frame loop has seen it. */
export function assetsFor(world: World | null): AssetsClass | undefined { return world ? assetsOf.get(world) : undefined; }

/** Start preparing the prefab at @p path, once the engine's asset loader is there to do it. */
export function requestPrepare(path: string): void {
    if (path && !preparedPrefabs.has(path) && !inFlight.has(path)) wanted.add(path);
}

/** Hand the layer a prefab already prepared (a host that loaded it its own way, or a test). */
export function providePrefab(path: string, prepared: PreparedPrefab): void {
    preparedPrefabs.set(path, prepared);
}

/** Prepare a prefab and answer when it is ready to `instantiate`. */
export function loadPrefab(path: string, world: World | null = getCurrentWorld()): Promise<Prefab> {
    const assets = world ? assetsOf.get(world) : undefined;
    if (preparedPrefabs.has(path)) return Promise.resolve(new Prefab(path));
    if (!assets) return Promise.reject(new Error(`cocos compat: cannot load prefab "${path}": the engine's asset loader is not running`));
    return preparePrefab(assets, path).then((p) => { preparedPrefabs.set(path, p); return new Prefab(path); });
}

function drain(assets: AssetsClass): void {
    for (const path of wanted) {
        wanted.delete(path);
        inFlight.add(path);
        preparePrefab(assets, path)
            .then((p) => { preparedPrefabs.set(path, p); })
            .catch((err) => { log.warn('cocos', `prefab "${path}" could not be prepared: ${String(err)}`); })
            .finally(() => { inFlight.delete(path); });
    }
}

/** The system that learns where the asset loader is and starts the preparations scripts asked for. */
export function declarePrefabSystem(): void {
    const system = defineSystem(
        [Res(Assets), GetWorld()],
        (assets, world) => {
            if (!assets) return;
            assetsOf.set(world, assets as AssetsClass);
            if (wanted.size > 0) drain(assets as AssetsClass);
        },
        { name: 'Cocos:Prefabs', touches: { opaque: true } },
    );
    addSystemToSchedule(Schedule.First, system);
}

// ---------------------------------------------------------------------------------------------------------------------
// instantiate
// ---------------------------------------------------------------------------------------------------------------------

function subtreeOf(world: World, root: Entity): Entity[] {
    const out: Entity[] = [];
    const visit = (e: Entity): void => {
        out.push(e);
        for (const c of world.tryGet(e, Children)?.entities ?? []) visit(c);
    };
    visit(root);
    return out;
}

/** A copy of a node and everything under it, as a new parentless node. References to nodes outside the subtree are kept. */
function cloneNode(src: Node): Node {
    const world = src._world;
    const ids = subtreeOf(world, src._entity);
    const inside = new Set<number>(ids as unknown as number[]);
    const external = new Map<number, Entity>();
    const entities = ids.map((entity) => {
        const components = serializeEntityComponents(world, entity);
        for (const c of components) {
            const def = getComponent(c.type);
            for (const field of def?.entityFields ?? []) {
                const value = (c.data as Record<string, unknown>)[field];
                for (const ref of Array.isArray(value) ? value : [value]) {
                    if (typeof ref === 'number' && ref > 0 && !inside.has(ref) && world.valid(ref as Entity)) external.set(ref, ref as Entity);
                }
            }
        }
        const parent = entity === src._entity ? null : (world.tryGet(entity, Parent)?.entity ?? null);
        return {
            id: entity as unknown as number,
            name: world.tryGet(entity, Name)?.value ?? '',
            parent: parent as unknown as number | null,
            children: (world.tryGet(entity, Children)?.entities ?? []) as unknown as number[],
            components,
            visible: true,
        };
    });
    const scene = { version: SCENE_FORMAT_VERSION, name: src.name, entities } as unknown as SceneData;
    const map = loadSceneData(world, scene, external);
    return Node.for(world, map.get(src._entity as unknown as number)!);
}

/**
 * A new node from a prefab or a copy of an existing node.
 *
 * @throws when given a prefab that has not finished loading: unlike Cocos, which has loaded it by the time a script holds it, the
 * engine loads on demand, and returning an empty node would hide that.
 */
export function instantiate<T extends Node | Prefab>(original: T): Node;
export function instantiate(original: Node | Prefab | null | undefined): Node {
    if (original instanceof Node) {
        const copy = cloneNode(original);
        markDetached(original._world, copy._entity);
        return copy;
    }
    if (original instanceof Prefab) {
        const prepared = original._prepared as PreparedPrefab | undefined;
        if (!prepared) {
            requestPrepare(original.path);
            throw new Error(`cocos compat: instantiate: prefab "${original.path}" is not loaded yet — hold it in a @property(Prefab) field so it loads with the scene, or await loadPrefab(path) first`);
        }
        const world = getCurrentWorld();
        if (!world) throw new Error('cocos compat: instantiate outside a running scene (no world is current)');
        const { root } = spawnPrepared(world, prepared);
        markDetached(world, root);
        return Node.for(world, root);
    }
    throw new Error('cocos compat: instantiate takes a Prefab or a Node');
}
