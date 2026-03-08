import type { ComponentData } from './types';

export function cloneComponents(components: ComponentData[]): ComponentData[] {
    return components.map(c => ({
        type: c.type,
        data: JSON.parse(JSON.stringify(c.data)),
    }));
}

export function cloneComponentData(data: Record<string, unknown>): Record<string, unknown> {
    return JSON.parse(JSON.stringify(data));
}
