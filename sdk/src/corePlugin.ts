// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { Plugin } from './app';
import { initResourceManager, shutdownResourceManager, setTextureBudget, trimTextureCache } from './wasm/resourceManager';
import { platformOnMemoryWarning } from './platform/base';
import { RuntimeConfig } from './defaults';
import { initDrawAPI, shutdownDrawAPI } from './render/draw';
import { clearDrawCallbacks } from './render/customDraw';
import { initMaterialAPI, shutdownMaterialAPI } from './render/material';
import { initGeometryAPI, shutdownGeometryAPI } from './render/geometry';
import { initPostProcessAPI, shutdownPostProcessAPI } from './postprocess';
import { initRendererAPI, shutdownRendererAPI } from './render/renderer';
import { initGLDebugAPI, shutdownGLDebugAPI } from './render/glDebug';
import { CameraView, CameraViewAPI } from './camera/Camera';

let offMemoryWarning: (() => void) | null = null;

export const corePlugin: Plugin = {
    name: 'engineCore',

    build(app) {
        const module = app.wasmModule!;
        initResourceManager(module.getResourceManager(), module);
        // Texture residency cache: released textures stay evictable in the C++
        // pool up to this byte budget, so the next load revives them instead of
        // re-decoding. Without this call the pool default (0) frees at once.
        setTextureBudget(RuntimeConfig.textureCacheBudget);
        // OS memory pressure → drop the texture warm cache. Held textures are
        // untouched; only the revive shortcut is sacrificed until it refills.
        offMemoryWarning = platformOnMemoryWarning(() => {
            trimTextureCache();
        });
        initDrawAPI(module);
        initGeometryAPI(module);
        initMaterialAPI(module);      // the module IS the core here (see engineApi)
        initPostProcessAPI(module);
        initRendererAPI(module);
        initGLDebugAPI(module);
        app.insertResource(CameraView, new CameraViewAPI(app));
    },

    cleanup() {
        offMemoryWarning?.();
        offMemoryWarning = null;
        clearDrawCallbacks();
        shutdownGLDebugAPI();
        shutdownRendererAPI();
        shutdownPostProcessAPI();
        shutdownGeometryAPI();
        shutdownMaterialAPI();
        shutdownDrawAPI();
        shutdownResourceManager();
    },
};

export const DEFAULT_UI_CAMERA_INFO = {
    viewProjection: new Float32Array(16),
    vpX: 0, vpY: 0, vpW: 0, vpH: 0,
    screenW: 0, screenH: 0,
    worldLeft: 0, worldBottom: 0, worldRight: 0, worldTop: 0,
    worldMouseX: 0, worldMouseY: 0,
    valid: false,
} as const;
