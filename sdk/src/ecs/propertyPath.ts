// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    propertyPath.ts
 * @brief   Address a component field by `"Component.dot.path"` and read/write it.
 *
 * The generic reflection writer: UI gears drive per-page values through it, and
 * the `property.set` action lets authored data write any field of any component.
 * It grew up under `ui/util/` but nothing in it is UI — it speaks the component
 * registry — so it lives here, where a core action can reach it.
 *
 * UI writes preserve the authored value. Timeline curves share the field lookup
 * and convert numbers for boolean destinations. TimelineEvaluator handles fields
 * such as Transform.rotation.angle with their component-specific writer.
 */
import type { World } from './world';
import type { Entity } from '../types';
import { getComponent, type AnyComponentDef } from './component';

/** @internal Store the edited readback without replacing unrelated asset fields. */
export const commitPropertyEdit = Symbol('commit property edit');

export function getNestedProperty(obj: Record<string, any>, path: string): unknown {
    const parts = path.split('.');
    let target: any = obj;
    for (const part of parts) {
        if (target == null || typeof target !== 'object') return undefined;
        target = target[part];
    }
    return target;
}

/** @internal Resolve the object receiving an assignment to an existing field. */
export function resolvePropertyTarget(obj: Record<string, any>, parts: readonly string[]): Record<string, any> | null {
    if (obj == null || typeof obj !== 'object') return null;
    let target = obj;
    for (let i = 0; i < parts.length - 1; i++) {
        target = target[parts[i]];
        if (target == null || typeof target !== 'object') return null;
    }
    return parts[parts.length - 1] in target ? target : null;
}

export function setNestedProperty(obj: Record<string, any>, path: string, value: unknown): boolean {
    const parts = path.split('.');
    const target = resolvePropertyTarget(obj, parts);
    if (!target) return false;
    target[parts[parts.length - 1]] = value;
    return true;
}

export interface ParsedPropertyPath {
    componentName: string;
    fieldPath: string;
}

export function parsePropertyPath(path: string): ParsedPropertyPath | null {
    const dotIndex = path.indexOf('.');
    if (dotIndex === -1) return null;
    return {
        componentName: path.substring(0, dotIndex),
        fieldPath: path.substring(dotIndex + 1),
    };
}

export function getEntityProperty(world: World, entity: Entity, path: string): unknown {
    const parsed = parsePropertyPath(path);
    if (!parsed) return undefined;
    const componentDef = getComponent(parsed.componentName);
    if (!componentDef || !world.has(entity, componentDef)) return undefined;
    const data = world.get(entity, componentDef) as Record<string, any>;
    return getNestedProperty(data, parsed.fieldPath);
}

/** @internal Assign an authored value to an existing component field. */
export function setComponentProperty(world: World, entity: Entity, component: AnyComponentDef, path: string, value: unknown): boolean {
    const data = world.get(entity, component);
    const parts = path.split('.');
    const target = resolvePropertyTarget(data, parts);
    if (!target) return false;
    target[parts[parts.length - 1]] = value;
    if (world[commitPropertyEdit]) world[commitPropertyEdit](entity, component, data, parts[0]);
    else world.insert(entity, component, data);
    return true;
}

export function setEntityProperty(world: World, entity: Entity, path: string, value: unknown): boolean {
    const parsed = parsePropertyPath(path);
    if (!parsed) return false;
    const componentDef = getComponent(parsed.componentName);
    if (!componentDef || !world.has(entity, componentDef)) return false;
    return setComponentProperty(world, entity, componentDef, parsed.fieldPath, value);
}
