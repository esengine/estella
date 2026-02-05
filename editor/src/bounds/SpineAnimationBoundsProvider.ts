/**
 * @file    SpineAnimationBoundsProvider.ts
 * @brief   Bounds provider for SpineAnimation component
 */

import type { Bounds, BoundsProvider } from './BoundsProvider';

const DEFAULT_SPINE_SIZE = 200;

export const spineAnimationBoundsProvider: BoundsProvider = {
    getBounds(data: any): Bounds | null {
        if (data?.bounds?.width && data?.bounds?.height) {
            return { width: data.bounds.width, height: data.bounds.height };
        }

        const scale = data?.skeletonScale ?? 1;
        const size = DEFAULT_SPINE_SIZE * scale;
        return { width: size, height: size };
    }
};
