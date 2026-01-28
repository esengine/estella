/**
 * @file index.ts
 * @brief ESEngine Web Loader
 *
 * @example
 * ```typescript
 * import { ESEngine } from '@esengine/web-loader';
 *
 * const engine = await ESEngine.load({
 *     modules: ['es_ui', 'es_font_bitmap'],
 *     basePath: './modules/',
 *     onProgress: (module, progress) => console.log(`${module}: ${progress}%`)
 * });
 *
 * // Access core module
 * const { core } = engine;
 *
 * // Load additional modules at runtime
 * await engine.loadModule('es_font_sdf');
 * ```
 */

// Types
export type {
    ModuleInfo,
    LoadedModule,
    LoaderOptions,
    EmscriptenModule,
    EmscriptenModuleOptions,
    EngineInstance,
    ModuleName,
    DynamicLibraryOptions,
} from './types';

export { MODULE_NAMES } from './types';

// Configuration
export {
    CORE_MODULE_NAME,
    SIDE_MODULES,
    getModuleConfig,
    getAvailableModules,
    isValidModuleName,
} from './config';

// Loader
export { ESEngineLoader } from './loader';

// Main API
export type { LoadOptions } from './presets';
export { ESEngine, load } from './presets';

export { ESEngine as default } from './presets';
