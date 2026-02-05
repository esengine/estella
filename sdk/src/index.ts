/**
 * @file    index.ts
 * @brief   ESEngine SDK - Web entry point (auto-initializes Web platform)
 */

// Initialize Web platform
import { setPlatform, webAdapter } from './platform';
setPlatform(webAdapter);

// Re-export everything from core
export * from './core';
