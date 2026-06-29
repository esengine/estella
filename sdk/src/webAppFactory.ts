// SPDX-License-Identifier: Apache-2.0
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
import { SpinePlugin } from './spine';
import { createFetchSideModuleHost, type SideModuleHost } from './sideModules';

export { uiPlugins };
// The single composed UI pipeline; the concept plugins below are
// re-exported for granular/advanced wiring.
export { uiPlugin, UIPlugin } from './ui/ui-plugin';
export { textPlugin, TextPlugin } from './ui/text/plugin';
export { uiMaskPlugin, UIMaskPlugin } from './ui/render/mask';
export { uiInteractionPlugin, UIInteractionPlugin } from './ui/input/interaction';
export { uiLayoutPlugin, UILayoutPlugin } from './ui/layout/layout';
export { uiRenderOrderPlugin, UIRenderOrderPlugin } from './ui/render/render-order';
export { textInputPlugin, TextInputPlugin } from './ui/text/text-input-plugin';

export { dragPlugin, DragPlugin } from './ui/input/drag';
export { focusPlugin, FocusPlugin } from './ui/input/focus';
export { safeAreaPlugin, SafeAreaPlugin } from './ui/layout/safe-area';

export { PhysicsPlugin, PhysicsEvents, Physics, loadPhysicsModule } from './physics';
export { AnimationPlugin, animationPlugin } from './animation';
export { AudioPlugin, audioPlugin } from './audio';
export { ParticlePlugin, particlePlugin } from './particle';
export { PostProcessPlugin, postProcessPlugin } from './postprocess';
export { TimelinePlugin, timelinePlugin, registerTimelineAsset, parseTimelineAsset, Timeline, TimelineApi, TimelinePlayer, type TimelinePlayerData } from './timeline';
// Authoring + pure-TS evaluation surface for the editor Sequencer.
export {
    sampleTimeline, sampleTimelineInWorld, evaluateChannel, applyWrapMode,
    serializeTimelineAsset, serializeTimelineToJson, resolveChildEntity, parseAnimationClip,
    TrackType, InterpType, WrapMode,
    type SampleWorld, type SampleDeps, type SampleOptions,
    type TimelineAsset, type Track, type PropertyTrack, type PropertyChannel, type Keyframe,
    type SpriteAnimTrack, type AudioTrack, type ActivationTrack, type SpineTrack, type AnimFramesTrack,
} from './timeline';

export interface CreateWebAppOptions extends WebAppOptions {
    /**
     * Convenience for the fetch realms (editor / web / desktop): the base URL the
     * side-module artifacts (physics.wasm, spine38.js/.wasm, …) are served from —
     * usually the same directory as esengine.wasm. Builds a fetch {@link SideModuleHost}
     * when no explicit `sideModules` is given. Realms that inline their modules
     * (playable / WeChat) pass `sideModules` directly instead.
     */
    wasmBaseUrl?: string;
}

const basePlugins = [timerPlugin, lifecyclePlugin(), animationPlugin, audioPlugin, particlePlugin, tilemapPlugin, postProcessPlugin, timelinePlugin];

export function createWebApp(module: ESEngineModule, options?: CreateWebAppOptions): App {
    const sideModules: SideModuleHost | undefined = options?.sideModules
        ?? (options?.wasmBaseUrl ? createFetchSideModuleHost(options.wasmBaseUrl) : undefined);
    // SpinePlugin builds its per-version SpineManager from app.sideModules in build().
    const spinePlugin = new SpinePlugin();
    const plugins = [...uiPlugins, ...basePlugins, spinePlugin, ...(options?.plugins ?? [])];
    return _createWebApp(module, { ...options, sideModules, plugins });
}
