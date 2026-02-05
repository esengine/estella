/**
 * @file    UIRect.ts
 * @brief   UIRect component for UI layout with anchor and pivot
 */

import { defineComponent } from '../component';
import type { Vec2 } from '../types';

// =============================================================================
// UIRect Component Data
// =============================================================================

export interface UIRectData {
    size: Vec2;
    anchor: Vec2;
    pivot: Vec2;
}

// =============================================================================
// UIRect Component Definition
// =============================================================================

export const UIRect = defineComponent<UIRectData>('UIRect', {
    size: { x: 100, y: 100 },
    anchor: { x: 0.5, y: 0.5 },
    pivot: { x: 0.5, y: 0.5 },
});
