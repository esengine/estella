// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    cocos/registry.ts
 * @brief   What the compatibility layer knows: the script classes that were declared, and the live instance of each on each entity.
 *
 * A Cocos component is a class instance per node; Estella's components are data. The bridge is two-sided: a declared class
 * becomes an Estella component carrying its `@property` values (so a scene, a prefab and the inspector can hold them, and the
 * ordinary save/load/undo machinery applies), and the instance lives here, created the first time something asks for it and
 * dropped when the entity or the component goes.
 *
 * This file holds data and the two operations on it that everything else needs. It imports no engine system, so the classes in
 * `component.ts` and `node.ts` can both depend on it without depending on each other.
 */
import type { World } from '../ecs/world';
import type { ComponentDef } from '../ecs/component';
import type { Entity } from '../types';
import type { Component } from './component';
import type { Node } from './node';

/** A script class, as `new` sees it. */
export type ComponentCtor<T extends Component = Component> = new (...args: any[]) => T;

/** What a `@property` field holds, which decides how its stored value becomes the instance's value. */
export type PropertyKind =
    | 'number' | 'string' | 'boolean'
    | 'node'       // an entity reference, made a Node
    | 'component'  // an entity reference, made the instance of `type` on it
    | 'asset'      // a project-relative path
    | 'vec2' | 'vec3' | 'color'
    | 'json';      // anything else: kept as it is

export interface PropertySpec {
    name: string;
    kind: PropertyKind;
    /** The class a `node`/`component`/`asset` property names, when it named one. */
    type?: unknown;
    /** For a list of values, the kind of each. */
    array?: boolean;
}

export interface ClassInfo {
    ctor: ComponentCtor;
    /** The class name as the script wrote it (`@ccclass('Name')` or the class's own name). */
    name: string;
    /** The Estella component name a scene stores: the class name under a prefix that keeps it clear of the engine's own. */
    componentName: string;
    def: ComponentDef<any>;
    props: PropertySpec[];
}

/** Every Estella component name a compat class takes starts with this, so a script class named like an engine component cannot collide. */
export const COMPONENT_PREFIX = 'Cocos.';

const byCtor = new Map<Function, ClassInfo>();
const byName = new Map<string, ClassInfo>();

export function registerClassInfo(info: ClassInfo): void {
    byCtor.set(info.ctor, info);
    byName.set(info.name, info);
    byName.set(info.componentName, info);
}

export function classInfoOf(ctor: Function): ClassInfo | undefined {
    return byCtor.get(ctor);
}

/** A class by the name a script or a scene gives it: either the class name or the component name. */
export function classInfoNamed(name: string): ClassInfo | undefined {
    return byName.get(name);
}

export function allClassInfos(): IterableIterator<ClassInfo> {
    return byCtor.values();
}

/** Forget every declaration (a test seam: classes are process-wide, as they are in Cocos). */
export function resetClassRegistry(): void {
    byCtor.clear();
    byName.clear();
}

// ---------------------------------------------------------------------------------------------------------------------
// Live instances.
// ---------------------------------------------------------------------------------------------------------------------

const instances = new WeakMap<World, Map<Entity, Map<Function, Component>>>();

export function instancesOn(world: World, entity: Entity): Map<Function, Component> | undefined {
    return instances.get(world)?.get(entity);
}

/** Every live instance of one class in a world, by entity. */
export function instancesOfClass(world: World, ctor: Function): Array<[Entity, Component]> {
    const out: Array<[Entity, Component]> = [];
    const perEntity = instances.get(world);
    if (!perEntity) return out;
    for (const [entity, byClass] of perEntity) {
        const inst = byClass.get(ctor);
        if (inst) out.push([entity, inst]);
    }
    return out;
}

export function storeInstance(world: World, entity: Entity, ctor: Function, inst: Component): void {
    let perEntity = instances.get(world);
    if (!perEntity) instances.set(world, (perEntity = new Map()));
    let byClass = perEntity.get(entity);
    if (!byClass) perEntity.set(entity, (byClass = new Map()));
    byClass.set(ctor, inst);
}

export function dropInstance(world: World, entity: Entity, ctor: Function): void {
    const perEntity = instances.get(world);
    const byClass = perEntity?.get(entity);
    if (!byClass) return;
    byClass.delete(ctor);
    if (byClass.size === 0) perEntity!.delete(entity);
}

// ---------------------------------------------------------------------------------------------------------------------
// The two late-bound pieces. `Node` and `ensureInstance` need each other, and a cycle of imports is worse than a setter.
// ---------------------------------------------------------------------------------------------------------------------

let nodeFactory: ((world: World, entity: Entity) => Node) | null = null;
export function setNodeFactory(factory: (world: World, entity: Entity) => Node): void {
    nodeFactory = factory;
}
export function nodeOf(world: World, entity: Entity): Node {
    if (!nodeFactory) throw new Error('cocos compat: Node was not loaded; import from "esengine/cocos"');
    return nodeFactory(world, entity);
}

let instantiator: ((world: World, entity: Entity, ctor: ComponentCtor) => Component | null) | null = null;
export function setInstantiator(fn: (world: World, entity: Entity, ctor: ComponentCtor) => Component | null): void {
    instantiator = fn;
}
let activitySync: ((world: World, entity: Entity) => void) | null = null;
export function setActivitySync(fn: (world: World, entity: Entity) => void): void {
    activitySync = fn;
}
/**
 * A node joined an active parent, or was switched on or off: its scripts' `onLoad`, `onEnable` and `onDisable` run now, as they do in
 * Cocos, and not on the next frame (a script that sets a value right after `addChild` would otherwise be undone by an `onEnable` that
 * runs later).
 */
export function syncActivity(world: World, entity: Entity): void {
    activitySync?.(world, entity);
}
/** The instance of @p ctor on @p entity, made (and its `onLoad` run) if the entity has the component and it has none yet; null if the entity does not have it. */
export function ensureInstance(world: World, entity: Entity, ctor: ComponentCtor): Component | null {
    const existing = instancesOn(world, entity)?.get(ctor);
    if (existing) return existing;
    return instantiator ? instantiator(world, entity, ctor) : null;
}
