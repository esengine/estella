/**
 * @file    SpriteBoundsProvider.ts
 * @brief   Bounds provider for Sprite component
 */

import type { Bounds, BoundsProvider } from './BoundsProvider';

export const spriteBoundsProvider: BoundsProvider = {
    getBounds(data: any): Bounds | null {
        if (data?.size?.x && data?.size?.y) {
            const pivotX = data.pivot?.x ?? 0.5;
            const pivotY = data.pivot?.y ?? 0.5;
            return {
                width: data.size.x,
                height: data.size.y,
                offsetX: (0.5 - pivotX) * data.size.x,
                offsetY: (0.5 - pivotY) * data.size.y,
            };
        }
        return null;
    }
};
