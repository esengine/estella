/**
 * @file    renderPipeline.ts
 * @brief   Unified render pipeline for runtime and editor
 */

import type { CppRegistry } from './wasm';
import { Renderer } from './renderer';
import { PostProcess } from './postprocess';
import { Draw } from './draw';
import { getDrawCallbacks } from './customDraw';

export interface RenderParams {
    registry: { _cpp: CppRegistry };
    viewProjection: Float32Array;
    width: number;
    height: number;
    elapsed: number;
}

export class RenderPipeline {
    render(params: RenderParams): void {
        const { registry, viewProjection, width, height, elapsed } = params;

        Renderer.resize(width, height);

        const usePostProcess = PostProcess.isInitialized()
            && PostProcess.getPassCount() > 0
            && !PostProcess.isBypassed();

        if (usePostProcess) {
            PostProcess.resize(width, height);
            PostProcess.begin();
        }

        Renderer.begin(viewProjection);
        Renderer.submitSprites(registry);
        Renderer.submitSpine(registry);
        Renderer.end();

        const cbs = getDrawCallbacks();
        if (cbs.size > 0) {
            Draw.begin(viewProjection);
            for (const fn of cbs.values()) {
                try {
                    fn(elapsed);
                } catch (e) {
                    console.warn('[CustomDraw]', e);
                }
            }
            Draw.end();
        }

        if (usePostProcess) {
            PostProcess.end();
        }
    }
}
