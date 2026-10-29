// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    cocos/host.ts
 * @brief   Declaring a script class, and running its lifecycle.
 *
 * Declaring a class (`@ccclass`) does two things, both through the engine's own mechanisms. It defines an Estella component
 * carrying the class's `@property` values — the data a scene or prefab stores and the inspector edits — and it registers a
 * system, the way `defineBehavior` does, that finds the entities carrying that component and drives the instances' lifecycle.
 * There is no second runtime: the instances are plain objects held in `registry.ts`, and the frame loop is the engine's.
 *
 * Lifecycle is presence-diffed against the live query rather than tracked by events, so a component removed or an entity
 * despawned by a system that ran earlier is still seen, and an entity switched off (which drops out of the query but keeps its
 * component) is told apart from one that is gone.
 */
import { defineComponent } from '../ecs/component';
import { Schedule, defineSystem, addSystemToSchedule, GetWorld } from '../ecs/system';
import { Query, Mut } from '../ecs/query';
import { Res, Time } from '../ecs/resource';
import type { World } from '../ecs/world';
import type { Entity } from '../types';
import { log } from '../util/logger';
import { Color, Vec2, Vec3 } from './math';
import { Node, setCurrentWorld } from './node';
import {
    COMPONENT_PREFIX, classInfoOf, dropInstance, instancesOfClass, instancesOn, nodeOf, registerClassInfo, setInstantiator, storeInstance,
    type ClassInfo, type ComponentCtor, type PropertyKind, type PropertySpec,
} from './registry';

/** A property as the decorator recorded it: its kind may still be unknown, to be read off the class's own initializer. */
export interface RawPropertySpec {
    name: string;
    kind?: PropertyKind;
    type?: unknown;
    array?: boolean;
}

/** The kind a value implies, for a property that named no type. */
function inferKind(value: unknown): PropertyKind {
    if (typeof value === 'number') return 'number';
    if (typeof value === 'string') return 'string';
    if (typeof value === 'boolean') return 'boolean';
    if (value instanceof Vec3) return 'vec3';
    if (value instanceof Vec2) return 'vec2';
    if (value instanceof Color) return 'color';
    if (value instanceof Node) return 'node';
    return 'json';
}
import type { Component } from './component';

/** The value a freshly declared component carries for one property: what the class's own initializer gave, in the form the engine stores. */
function storedDefault(spec: PropertySpec, value: unknown): unknown {
    if (spec.array) return Array.isArray(value) && spec.kind !== 'node' && spec.kind !== 'component' ? structuredClone(value) : [];
    switch (spec.kind) {
        case 'number': return typeof value === 'number' ? value : 0;
        case 'string': return typeof value === 'string' ? value : '';
        case 'boolean': return typeof value === 'boolean' ? value : false;
        case 'node':
        case 'component': return 0;
        case 'asset': return '';
        case 'vec2': return value instanceof Vec2 ? { x: value.x, y: value.y } : { x: 0, y: 0 };
        case 'vec3': return value instanceof Vec3 ? { x: value.x, y: value.y, z: value.z } : { x: 0, y: 0, z: 0 };
        case 'color': return value instanceof Color ? { r: value.r, g: value.g, b: value.b, a: value.a } : { r: 255, g: 255, b: 255, a: 255 };
        default: return value === undefined ? null : structuredClone(value);
    }
}

/** What a stored value becomes on an instance. */
function liveValue(world: World, spec: PropertySpec, stored: unknown): unknown {
    const one = (v: unknown): unknown => {
        switch (spec.kind) {
            case 'node': return typeof v === 'number' && v > 0 ? nodeOf(world, v as Entity) : null;
            case 'component': {
                if (typeof v !== 'number' || v <= 0) return null;
                const node = nodeOf(world, v as Entity);
                return typeof spec.type === 'function' ? node.getComponent(spec.type as ComponentCtor) : null;
            }
            case 'vec2': return v && typeof v === 'object' ? new Vec2((v as Vec2).x, (v as Vec2).y) : new Vec2();
            case 'vec3': return v && typeof v === 'object' ? new Vec3((v as Vec3).x, (v as Vec3).y, (v as Vec3).z) : new Vec3();
            case 'color': return v && typeof v === 'object' ? new Color((v as Color).r, (v as Color).g, (v as Color).b, (v as Color).a) : new Color();
            default: return v;
        }
    };
    return spec.array && Array.isArray(stored) ? stored.map(one) : one(stored);
}

function call(inst: Component, hook: 'onLoad' | 'onEnable' | 'start' | 'onDisable' | 'onDestroy'): void;
function call(inst: Component, hook: 'update' | 'lateUpdate', dt: number): void;
function call(inst: Component, hook: keyof Component, dt?: number): void {
    const fn = (inst as unknown as Record<string, ((dt?: number) => void) | undefined>)[hook];
    if (typeof fn !== 'function') return;
    try {
        fn.call(inst, dt);
    } catch (err) {
        log.error('cocos', `${inst.name}.${String(hook)} threw`, err);
    }
}

function instantiate(world: World, entity: Entity, ctor: ComponentCtor): Component | null {
    const info = classInfoOf(ctor);
    if (!info || !world.valid(entity) || !world.has(entity, info.def)) return null;
    const previous = setCurrentWorld(world);
    try {
        const inst = new ctor();
        inst._world = world;
        inst._entity = entity;
        inst.node = nodeOf(world, entity);
        // Stored before `onLoad`: a `getComponent` inside it must find this instance, not make a second.
        storeInstance(world, entity, ctor, inst);

        const data = world.get(entity, info.def) as Record<string, unknown>;
        if (typeof data.enabled === 'boolean') inst.enabled = data.enabled;
        for (const spec of info.props) {
            if (spec.name in data) (inst as unknown as Record<string, unknown>)[spec.name] = liveValue(world, spec, data[spec.name]);
        }
        inst._loaded = true;
        call(inst, 'onLoad');
        return inst;
    } finally {
        setCurrentWorld(previous);
    }
}
setInstantiator(instantiate);

/** Run the per-frame part of one instance: enable/disable as its activity changes, then `start` once, then the timers and `update`. */
function drive(world: World, entity: Entity, inst: Component, dt: number): void {
    const active = inst.enabled && world.isEntityActive(entity);
    if (active && !inst._enabledApplied) {
        inst._enabledApplied = true;
        call(inst, 'onEnable');
    } else if (!active && inst._enabledApplied) {
        inst._enabledApplied = false;
        call(inst, 'onDisable');
    }
    if (!active) return;
    if (!inst._started) {
        inst._started = true;
        call(inst, 'start');
    }
    try {
        inst._tickTimers(dt);
    } catch (err) {
        log.error('cocos', `${inst.name} timer threw`, err);
    }
    call(inst, 'update', dt);
}

function destroyInstance(world: World, entity: Entity, ctor: Function, inst: Component): void {
    if (inst._enabledApplied) {
        inst._enabledApplied = false;
        call(inst, 'onDisable');
    }
    inst._destroyed = true;
    inst.unscheduleAllCallbacks();
    call(inst, 'onDestroy');
    dropInstance(world, entity, ctor);
}

/**
 * Declare a script class: define its component, register it, and register the system that drives it.
 * @param specs The class's `@property` fields, with their kinds settled.
 */
export function declareClass(ctor: ComponentCtor, name: string, raw: RawPropertySpec[]): ClassInfo {
    // The class's own initializers say what each property starts as, which is what Cocos reads to fill its inspector.
    let probe: Record<string, unknown> | null = null;
    try { probe = new ctor() as unknown as Record<string, unknown>; } catch { probe = null; }

    const specs: PropertySpec[] = raw.map((r) => ({ ...r, kind: r.kind ?? inferKind(probe?.[r.name]) }));
    const defaults: Record<string, unknown> = { enabled: true };
    for (const spec of specs) defaults[spec.name] = storedDefault(spec, probe?.[spec.name]);

    const componentName = COMPONENT_PREFIX + name;
    const entityFields = specs.filter((s) => s.kind === 'node' || s.kind === 'component').map((s) => s.name);
    const def = defineComponent(componentName, defaults, entityFields.length ? { entityFields } : undefined);
    const info: ClassInfo = { ctor, name, componentName, def, props: specs };
    registerClassInfo(info);

    const hasLate = typeof (ctor.prototype as Component).lateUpdate === 'function';

    const update = defineSystem(
        [Query(Mut(def)), Res(Time), GetWorld()],
        (q, time, world) => {
            const previous = setCurrentWorld(world);
            try {
                const seen = new Set<Entity>();
                for (const [entity] of q) {
                    seen.add(entity);
                    const inst = instancesOn(world, entity)?.get(ctor) ?? instantiate(world, entity, ctor);
                    if (inst) drive(world, entity, inst, time.delta);
                }
                // Instances the query did not return are either switched off (still carrying the component) or gone.
                for (const [entity, inst] of instancesOfClass(world, ctor)) {
                    if (seen.has(entity)) continue;
                    if (world.valid(entity) && world.has(entity, def)) drive(world, entity, inst, time.delta);
                    else destroyInstance(world, entity, ctor, inst);
                }
            } finally {
                setCurrentWorld(previous);
            }
        },
        { name: `Cocos:${name}`, touches: { opaque: true } },
    );
    addSystemToSchedule(Schedule.Update, update);

    if (hasLate) {
        const late = defineSystem(
            [Query(Mut(def)), Res(Time), GetWorld()],
            (q, time, world) => {
                const previous = setCurrentWorld(world);
                try {
                    for (const [entity] of q) {
                        const inst = instancesOn(world, entity)?.get(ctor);
                        if (inst && inst._started && inst.enabled && world.isEntityActive(entity)) call(inst, 'lateUpdate', time.delta);
                    }
                } finally {
                    setCurrentWorld(previous);
                }
            },
            { name: `Cocos:${name}:late`, touches: { opaque: true } },
        );
        addSystemToSchedule(Schedule.PostUpdate, late);
    }
    return info;
}

export { Node };
