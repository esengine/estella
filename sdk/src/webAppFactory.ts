// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { createWebApp as _createWebApp, type WebAppOptions } from './app';
import type { App } from './app';
import type { ESEngineModule } from './wasm';
import { uiPlugins } from './uiPlugins';
import { animationPlugin } from './animation';
import { audioPlugin } from './audio';
import { particlePlugin } from './particle';
import { tilemapPlugin } from './tilemap';
import { postProcessPlugin } from './postprocess';
import { timelinePlugin } from './timeline';
import { timerPlugin } from './timer';
import { lifecyclePlugin } from './lifecycle';
import { SpinePlugin, WebSpineWasmProvider } from './spine';
import type { SpineWasmProvider } from './spine';

export { uiPlugins };
export { textPlugin, TextPlugin } from './ui/text/plugin';
export { uiMaskPlugin, UIMaskPlugin } from './ui/UIMaskPlugin';
export { uiInteractionPlugin, UIInteractionPlugin } from './ui/UIInteractionPlugin';
export { uiLayoutPlugin, UILayoutPlugin } from './ui/UILayoutPlugin';
export { uiRenderOrderPlugin, UIRenderOrderPlugin } from './ui/UIRenderOrderPlugin';
export { textInputPlugin, TextInputPlugin } from './ui/TextInputPlugin';

export { dragPlugin, DragPlugin } from './ui/DragPlugin';
export { focusPlugin, FocusPlugin } from './ui/FocusPlugin';
export { safeAreaPlugin, SafeAreaPlugin } from './ui/SafeAreaPlugin';

export { PhysicsPlugin, PhysicsEvents, Physics, loadPhysicsModule } from './physics';
export { AnimationPlugin, animationPlugin } from './animation';
export { AudioPlugin, audioPlugin } from './audio';
export { ParticlePlugin, particlePlugin } from './particle';
export { PostProcessPlugin, postProcessPlugin } from './postprocess';
export { TimelinePlugin, timelinePlugin, registerTimelineAsset, parseTimelineAsset, Timeline, TimelineApi, TimelinePlayer, type TimelinePlayerData } from './timeline';
// Authoring + pure-TS evaluation surface for the editor Sequencer (REARCH_ANIMATION).
export {
    sampleTimeline, sampleTimelineInWorld, evaluateChannel, applyWrapMode,
    serializeTimelineAsset, serializeTimelineToJson, resolveChildEntity, parseAnimationClip,
    TrackType, InterpType, WrapMode,
    type SampleWorld, type SampleDeps, type SampleOptions,
    type TimelineAsset, type Track, type PropertyTrack, type PropertyChannel, type Keyframe,
    type SpriteAnimTrack, type AudioTrack, type ActivationTrack, type SpineTrack, type AnimFramesTrack,
} from './timeline';

export interface CreateWebAppOptions extends WebAppOptions {
    spineProvider?: SpineWasmProvider;
    /**
     * Base URL the per-version spine side modules (spine38.js/.wasm, …) are served
     * from — usually the same directory as esengine.wasm. When set (and no explicit
     * spineProvider is given) a WebSpineWasmProvider is wired so 3.8/4.1 assets load
     * in the browser. Without either, only the engine-linked 4.2 runs.
     */
    wasmBaseUrl?: string;
}

const basePlugins = [timerPlugin, lifecyclePlugin(), animationPlugin, audioPlugin, particlePlugin, tilemapPlugin, postProcessPlugin, timelinePlugin];

export function createWebApp(module: ESEngineModule, options?: CreateWebAppOptions): App {
    const spineProvider = options?.spineProvider
        ?? (options?.wasmBaseUrl ? new WebSpineWasmProvider(options.wasmBaseUrl) : undefined);
    const spinePlugin = new SpinePlugin(spineProvider);
    const plugins = [...uiPlugins, ...basePlugins, spinePlugin, ...(options?.plugins ?? [])];
    return _createWebApp(module, { ...options, plugins });
}
