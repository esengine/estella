import type { Bounds, BoundsProvider } from './BoundsProvider';
import { getEditorContainer } from '../container';
import { BOUNDS_PROVIDER } from '../container/tokens';

export function registerBoundsProvider(componentType: string, provider: BoundsProvider): void {
    getEditorContainer().provide(BOUNDS_PROVIDER, componentType, provider);
}

export function getEntityBounds(components: { type: string; data: any }[]): Bounds {
    const container = getEditorContainer();
    for (const comp of components) {
        const provider = container.get(BOUNDS_PROVIDER, comp.type);
        if (provider) {
            const bounds = provider.getBounds(comp.data);
            if (bounds) return bounds;
        }
    }
    return { width: 0, height: 0 };
}
