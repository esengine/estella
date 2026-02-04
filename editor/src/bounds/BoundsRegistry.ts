/**
 * @file    BoundsRegistry.ts
 * @brief   Registry for component bounds providers
 */

import type { Bounds, BoundsProvider } from './BoundsProvider';

const providers = new Map<string, BoundsProvider>();

export function registerBoundsProvider(componentType: string, provider: BoundsProvider): void {
    providers.set(componentType, provider);
}

export function getEntityBounds(components: { type: string; data: any }[]): Bounds {
    for (const comp of components) {
        const provider = providers.get(comp.type);
        if (provider) {
            const bounds = provider.getBounds(comp.data);
            if (bounds) return bounds;
        }
    }
    return { width: 50, height: 50 };
}
