// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    core-plugins.ts
 * @brief   ESEngine SDK — plugin wiring surface (manual plugin composition)
 *
 * Everything a host needs to compose an App plugin-by-plugin instead of using
 * the batteries-included factories in `webAppFactory.ts`. Content-module
 * plugins that double as feature surfaces (audio, video, particles, …) live in
 * their domain barrels (`core-content` / `core-sys`); this file holds the UI
 * pipeline and the side-module plugins, whose only job is wiring.
 *
 * Side-module policy: physics and spine ship as separate wasm side-modules.
 * Their full APIs live on the `esengine/physics` / `esengine/spine` subpaths;
 * the main barrel mirrors exactly the wiring layer (plugin, events, resource,
 * loader) so `createWebApp`-style hosts can register them without a subpath
 * import.
 */

// The single composed UI pipeline; the concept plugins below are
// re-exported for granular/advanced wiring.
export { uiPlugins } from './app/uiPlugins';
export { uiPlugin, UIPlugin } from './ui/ui-plugin';
export { textPlugin, TextPlugin } from './ui/text/plugin';
export { uiMaskPlugin, UIMaskPlugin } from './ui/render/mask';
export { uiInteractionPlugin, UIInteractionPlugin } from './ui/input/interaction';
export { uiLayoutPlugin, UILayoutPlugin } from './ui/layout/layout';
export { uiRenderOrderPlugin, UIRenderOrderPlugin } from './ui/render/render-order';
export { uiVisibilityPlugin, UIVisibilityPlugin } from './ui/core/visibility';
export { textInputPlugin, TextInputPlugin } from './ui/text/text-input-plugin';
export { dragPlugin, DragPlugin } from './ui/input/drag';
export { focusPlugin, FocusPlugin } from './ui/input/focus';
export { safeAreaPlugin, SafeAreaPlugin } from './ui/layout/safe-area';

export { Physics2DPlugin, Physics2DEvents, Physics2D, loadPhysicsModule } from './physics';
// The contact event names, mirrored into the main barrel: an editor palette (or
// game code) must be able to spell `trigger_enter` without importing the side
// module, since the wire is authored whether or not physics is loaded.
export { Physics2DEventType, type Physics2DContactEventData } from './physics';
// Beside the 2D solver's and for its reason: the native host maps every
// `esengine/*` import onto ONE global, so a symbol the main entry does not carry
// reaches a game that imports the subpath as `undefined`.
export { Physics3DPlugin, Physics3DEvents, Physics3D } from './physics3d';
export { SpinePlugin, SpineEvents, Spine } from './spine';
// DragonBones beside it, and in the barrel for the same reason: the native entry
// collapses every `esengine*` import onto ONE global, so a game reaching
// `Res(DragonBones)` through `esengine/dragonbones` finds nothing on a device
// unless the resource is here too.
export { DragonBonesPlugin, dragonBonesPlugin, DragonBones } from './dragonbones';

export { PostProcessPlugin, postProcessPlugin } from './postprocess';
