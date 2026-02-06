/**
 * @file    index.ts
 * @brief   Asset module exports
 */

export { AssetPathResolver } from './AssetPathResolver';
export type { PathValidationResult } from './AssetPathResolver';

export { AssetLoader } from './AssetLoader';
export type { LoadResult } from './AssetLoader';

export { EditorAssetServer } from './EditorAssetServer';

import { AssetPathResolver } from './AssetPathResolver';

let globalPathResolver: AssetPathResolver | null = null;

export function getGlobalPathResolver(): AssetPathResolver {
    if (!globalPathResolver) {
        globalPathResolver = new AssetPathResolver();
    }
    return globalPathResolver;
}
