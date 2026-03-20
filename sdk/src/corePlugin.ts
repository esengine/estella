import type { Plugin } from './app';
import { initResourceManager, shutdownResourceManager } from './resourceManager';
import { initDrawAPI, shutdownDrawAPI } from './draw';
import { clearDrawCallbacks } from './customDraw';
import { initMaterialAPI, shutdownMaterialAPI } from './material';
import { initGeometryAPI, shutdownGeometryAPI } from './geometry';
import { initPostProcessAPI, shutdownPostProcessAPI } from './postprocess';
import { initRendererAPI, shutdownRendererAPI } from './renderer';
import { initGLDebugAPI, shutdownGLDebugAPI } from './glDebug';
import { initCameraAPI, shutdownCameraAPI } from './camera/Camera';

export const corePlugin: Plugin = {
    name: 'engineCore',

    build(app) {
        const module = app.wasmModule!;
        initResourceManager(module.getResourceManager());
        initDrawAPI(module);
        initGeometryAPI(module);
        initMaterialAPI(module);
        initPostProcessAPI(module);
        initRendererAPI(module);
        initGLDebugAPI(module);
        initCameraAPI(app);
    },

    cleanup() {
        clearDrawCallbacks();
        shutdownCameraAPI();
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
