/**
 * @file presets.ts
 * @brief ESEngine loader entry point
 */

import type { EngineInstance } from './types';
import { ESEngineLoader } from './loader';

export interface LoadOptions {
    modules: string[];
    basePath: string;
    onProgress?: (module: string, progress: number) => void;
}

/**
 * Load ESEngine with specified modules.
 *
 * @example
 * ```typescript
 * const engine = await ESEngine.load({
 *     modules: ['es_ui', 'es_font_bitmap'],
 *     basePath: './modules/'
 * });
 * ```
 */
export async function load(options: LoadOptions): Promise<EngineInstance> {
    return ESEngineLoader.init({
        modules: options.modules,
        basePath: options.basePath,
        onProgress: options.onProgress,
    });
}

export const ESEngine = {
    load,
} as const;
