/**
 * @file config.ts
 * @brief Module configuration for ESEngine
 */

import type { ModuleInfo } from './types';

export const CORE_MODULE_NAME = 'esengine_core';

export const SIDE_MODULES: Record<string, ModuleInfo> = {
    es_ui_core: {
        name: 'es_ui_core',
        description: 'UI core system (context, renderer, layout)',
        file: 'es_ui_core.wasm',
        dependencies: [],
    },
    es_ui_widgets: {
        name: 'es_ui_widgets',
        description: 'UI widgets (Button, Label, TextField, etc.)',
        file: 'es_ui_widgets.wasm',
        dependencies: ['es_ui_core'],
    },
    es_ui_docking: {
        name: 'es_ui_docking',
        description: 'UI docking system (editor only)',
        file: 'es_ui_docking.wasm',
        dependencies: ['es_ui_core'],
    },
    es_font_sdf: {
        name: 'es_font_sdf',
        description: 'SDF font rendering (high quality)',
        file: 'es_font_sdf.wasm',
        dependencies: [],
    },
    es_font_bitmap: {
        name: 'es_font_bitmap',
        description: 'Bitmap font rendering (lightweight)',
        file: 'es_font_bitmap.wasm',
        dependencies: [],
    },
} as const;

export function getModuleConfig(name: string): ModuleInfo | undefined {
    return SIDE_MODULES[name];
}

export function getAvailableModules(): ModuleInfo[] {
    return Object.values(SIDE_MODULES);
}

export function isValidModuleName(name: string): boolean {
    return name in SIDE_MODULES;
}
