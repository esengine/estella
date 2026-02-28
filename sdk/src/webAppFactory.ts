import { createWebApp as _createWebApp, type WebAppOptions } from './app';
import type { App } from './app';
import type { ESEngineModule } from './wasm';
import { uiPlugins } from './uiPlugins';
import { animationPlugin } from './animation';

export { uiPlugins };
export { textPlugin, TextPlugin } from './ui/TextPlugin';
export { uiMaskPlugin, UIMaskPlugin } from './ui/UIMaskPlugin';
export { uiInteractionPlugin, UIInteractionPlugin } from './ui/UIInteractionPlugin';
export { uiLayoutPlugin, UILayoutPlugin } from './ui/UILayoutPlugin';
export { uiRenderOrderPlugin, UIRenderOrderPlugin } from './ui/UIRenderOrderPlugin';
export { textInputPlugin, TextInputPlugin } from './ui/TextInputPlugin';

export { progressBarPlugin, ProgressBarPlugin } from './ui/ProgressBarPlugin';
export { sliderPlugin, SliderPlugin } from './ui/SliderPlugin';

export { PhysicsPlugin, PhysicsEvents, Physics, loadPhysicsModule } from './physics';
export { AnimationPlugin, animationPlugin } from './animation';
export { AudioPlugin, audioPlugin } from './audio';

const defaultPlugins = [...uiPlugins, animationPlugin];

export function createWebApp(module: ESEngineModule, options?: WebAppOptions): App {
    return _createWebApp(module, { plugins: defaultPlugins, ...options });
}
