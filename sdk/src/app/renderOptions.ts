// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    renderOptions.ts
 * @brief   What a project declares about its frame, handed to whichever core runs it.
 *
 * One function per moment and one caller per core, so the web and native apps cannot drift. They did: the native road read only
 * packagedRuntimeInit, so every field of packagedAppOptions was dropped on a device with no error. A linear project showed its
 * linear values unencoded, far too dark, and its output transform, MSAA, quality and layer sorting never arrived either.
 */
import { setLinearColorSpace } from '../ecs/env';
import { outputTransformCode, type OutputTransform } from '../postprocess';
import { installQuality } from '../render/qualityRuntime';
import { ScreenScaling, SCREEN_FIT_OFF, type ScreenScalingData } from '../camera/ScreenScaling';
import { RenderResolution } from '../camera/presentPlan';
import type { QualityConfig } from '../render/quality';
import type { App } from './app';

/** The engine entry points these reach, by the names the wasm module and the native host's API share. */
export interface RenderOptionsApi {
    renderer_setColorSpace?(linear: number): void;
    renderer_setYSortLayers?(layers: number): void;
    renderer_setDepthLayers?(layers: number): void;
    postprocess_setOutputTransform?(code: number): void;
    postprocess_setMsaaSamples?(samples: number): void;
}

export interface RenderOptions {
    colorSpace?: 'gamma' | 'linear';
    ySortLayers?: number;
    depthLayers?: number;
    outputTransform?: OutputTransform;
    msaaSamples?: number;
    screenFit?: ScreenScalingData;
    quality?: QualityConfig;
}

/**
 * Before any shader compiles: they compile against it. Always applied, not only when set, since the renderer outlives an App across a
 * realm reload and a fresh App must reset a prior session's mode.
 */
export function applyColorSpace(api: RenderOptionsApi, options: RenderOptions | undefined): void {
    setLinearColorSpace(options?.colorSpace === 'linear');
    api.renderer_setColorSpace?.(options?.colorSpace === 'linear' ? 1 : 0);
}

/**
 * Once the renderer exists: the post-process pipeline is created by it, and a curve declared before it exists reaches nothing. Always
 * applied, for the same reason as the colour space.
 */
export function applyFrameOptions(api: RenderOptionsApi, options: RenderOptions | undefined): void {
    api.renderer_setYSortLayers?.((options?.ySortLayers ?? 0) >>> 0);
    api.renderer_setDepthLayers?.((options?.depthLayers ?? 0) >>> 0);
    api.postprocess_setOutputTransform?.(outputTransformCode(options?.outputTransform));
    api.postprocess_setMsaaSamples?.((options?.msaaSamples ?? 4) >>> 0);
}

/** Once the App's plugins are in: what the options install as resources on it. */
export function applyAppOptions(app: App, options: RenderOptions | undefined): void {
    // Project camera fit: only install the resource when the project opts in (a real scaleMode). Absent, CameraPlugin.resolveFitSource
    // sees no resource and keeps the legacy Canvas-or-raw fit, so an unconfigured game is unchanged. Either opt-in installs it: the
    // render policy needs no camera fit, it takes the camera's world height whatever produced it.
    if (options?.screenFit
        && (options.screenFit.scaleMode > SCREEN_FIT_OFF
            || (options.screenFit.renderPolicy ?? RenderResolution.Surface) !== RenderResolution.Surface)) {
        app.insertResource(ScreenScaling, { ...options.screenFit });
    }
    if (options?.quality) installQuality(app, options.quality, options.msaaSamples ?? 4);
}
