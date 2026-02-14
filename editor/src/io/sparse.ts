import type { ComponentData } from '../types/SceneTypes';
import { getDefaultComponentData } from '../schemas/ComponentSchemas';

function deepEqual(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
        return false;
    }

    const keysA = Object.keys(a as Record<string, unknown>);
    const keysB = Object.keys(b as Record<string, unknown>);
    if (keysA.length !== keysB.length) return false;

    for (const key of keysA) {
        if (!deepEqual(
            (a as Record<string, unknown>)[key],
            (b as Record<string, unknown>)[key],
        )) {
            return false;
        }
    }
    return true;
}

export function stripComponentDefaults(components: ComponentData[]): ComponentData[] {
    return components.map(comp => {
        const defaults = getDefaultComponentData(comp.type);
        if (!defaults || Object.keys(defaults).length === 0) {
            return { type: comp.type, data: { ...comp.data } };
        }

        const sparse: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(comp.data)) {
            if (!(key in defaults) || !deepEqual(value, defaults[key])) {
                sparse[key] = value;
            }
        }
        return { type: comp.type, data: sparse };
    });
}

export function mergeComponentDefaults(component: ComponentData): void {
    const defaults = getDefaultComponentData(component.type);
    if (defaults && Object.keys(defaults).length > 0) {
        component.data = { ...defaults, ...component.data };
    }
}
