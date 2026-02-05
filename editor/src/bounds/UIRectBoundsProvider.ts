/**
 * @file    UIRectBoundsProvider.ts
 * @brief   Bounds provider for UIRect component
 */

import type { Bounds, BoundsProvider } from './BoundsProvider';

export const uiRectBoundsProvider: BoundsProvider = {
    getBounds(data: any): Bounds | null {
        if (data?.size?.x > 0 && data?.size?.y > 0) {
            return { width: data.size.x, height: data.size.y };
        }
        return null;
    }
};
