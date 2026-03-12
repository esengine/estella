import type { World } from '../world';
import type { Entity } from '../types';
import { getComponent } from '../component';

export function getNestedProperty(obj: Record<string, any>, path: string): unknown {
    const parts = path.split('.');
    let target: any = obj;
    for (const part of parts) {
        if (target == null || typeof target !== 'object') return undefined;
        target = target[part];
    }
    return target;
}

export function setNestedProperty(obj: Record<string, any>, path: string, value: unknown): boolean {
    const parts = path.split('.');
    let target = obj;
    for (let i = 0; i < parts.length - 1; i++) {
        target = target[parts[i]];
        if (target == null || typeof target !== 'object') return false;
    }
    const lastKey = parts[parts.length - 1];
    if (!(lastKey in target)) return false;
    target[lastKey] = value;
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

export function setEntityProperty(world: World, entity: Entity, path: string, value: unknown): boolean {
    const parsed = parsePropertyPath(path);
    if (!parsed) return false;
    const componentDef = getComponent(parsed.componentName);
    if (!componentDef || !world.has(entity, componentDef)) return false;
    const data = world.get(entity, componentDef) as Record<string, any>;
    if (!setNestedProperty(data, parsed.fieldPath, value)) return false;
    world.insert(entity, componentDef, data);
    return true;
}
