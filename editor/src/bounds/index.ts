/**
 * @file    bounds/index.ts
 * @brief   Bounds module exports and initialization
 */

export * from './BoundsProvider';
export { registerBoundsProvider, getEntityBounds, lockBuiltinBoundsProviders, clearExtensionBoundsProviders } from './BoundsRegistry';

import { registerBoundsProvider } from './BoundsRegistry';
import { spriteBoundsProvider } from './SpriteBoundsProvider';
import { textBoundsProvider } from './TextBoundsProvider';
import { uiRectBoundsProvider } from './UIRectBoundsProvider';
import { spineAnimationBoundsProvider } from './SpineAnimationBoundsProvider';

export function initBoundsProviders(): void {
    registerBoundsProvider('UIRect', uiRectBoundsProvider);
    registerBoundsProvider('Sprite', spriteBoundsProvider);
    registerBoundsProvider('Text', textBoundsProvider);
    registerBoundsProvider('SpineAnimation', spineAnimationBoundsProvider);
}
