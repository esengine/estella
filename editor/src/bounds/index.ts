/**
 * @file    bounds/index.ts
 * @brief   Bounds module exports and initialization
 */

export * from './BoundsProvider';
export * from './BoundsRegistry';

import { registerBoundsProvider } from './BoundsRegistry';
import { spriteBoundsProvider } from './SpriteBoundsProvider';
import { textBoundsProvider } from './TextBoundsProvider';

export function initBoundsProviders(): void {
    registerBoundsProvider('Sprite', spriteBoundsProvider);
    registerBoundsProvider('Text', textBoundsProvider);
}
