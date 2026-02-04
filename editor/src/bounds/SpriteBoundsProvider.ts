/**
 * @file    SpriteBoundsProvider.ts
 * @brief   Bounds provider for Sprite component
 */

import type { Bounds, BoundsProvider } from './BoundsProvider';

export const spriteBoundsProvider: BoundsProvider = {
    getBounds(data: any): Bounds | null {
        if (data?.size?.x && data?.size?.y) {
            return { width: data.size.x, height: data.size.y };
        }
        return null;
    }
};
