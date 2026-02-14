/**
 * @file    index.ts
 * @brief   ESEngine SDK - Web entry point (auto-initializes Web platform)
 */

import { setPlatform, webAdapter } from './platform';
setPlatform(webAdapter);

export * from './core';
export * from './webAppFactory';
