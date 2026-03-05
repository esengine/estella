/**
 * @file    bounds/index.ts
 * @brief   Bounds module exports and initialization
 */

export * from './BoundsProvider';
export { registerBoundsProvider, getEntityBounds, lockBuiltinBoundsProviders, clearExtensionBoundsProviders } from './BoundsRegistry';
