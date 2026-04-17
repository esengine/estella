/**
 * @file    core.ts
 * @brief   ESEngine SDK — public API barrel (no platform initialization)
 *
 * The actual exports live in topic-grouped files (`core-runtime` / `core-render`
 * / `core-ui` / `core-content` / `core-sys`). This file is just the aggregate
 * entry point consumed by `index.ts` / `index.wechat.ts`. Splitting makes the
 * 900+ symbol surface navigable by domain instead of one flat list.
 *
 * External consumers import from the package root (`esengine`) — not from
 * any of the `core-*` files directly.
 */

export * from './core-runtime';
export * from './core-render';
export * from './core-ui';
export * from './core-content';
export * from './core-sys';
