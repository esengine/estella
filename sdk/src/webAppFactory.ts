import { createWebApp as _createWebApp, type WebAppOptions } from './app';
import type { App } from './app';
import type { ESEngineModule } from './wasm';
import { uiPlugins } from './uiPlugins';
import { animationPlugin } from './animation';
import { audioPlugin } from './audio';
import { particlePlugin } from './particle';

export { uiPlugins };
export { textPlugin, TextPlugin } from './ui/TextPlugin';
export { uiMaskPlugin, UIMaskPlugin } from './ui/UIMaskPlugin';
export { uiInteractionPlugin, UIInteractionPlugin } from './ui/UIInteractionPlugin';
export { uiLayoutPlugin, UILayoutPlugin } from './ui/UILayoutPlugin';
export { uiRenderOrderPlugin, UIRenderOrderPlugin } from './ui/UIRenderOrderPlugin';
export { textInputPlugin, TextInputPlugin } from './ui/TextInputPlugin';

export { imagePlugin, ImagePlugin } from './ui/ImagePlugin';
export { progressBarPlugin, ProgressBarPlugin } from './ui/ProgressBarPlugin';
export { sliderPlugin, SliderPlugin } from './ui/SliderPlugin';
export { togglePlugin, TogglePlugin } from './ui/TogglePlugin';
export { dragPlugin, DragPlugin } from './ui/DragPlugin';
export { scrollViewPlugin, ScrollViewPlugin } from './ui/ScrollViewPlugin';
export { focusPlugin, FocusPlugin } from './ui/FocusPlugin';
export { safeAreaPlugin, SafeAreaPlugin } from './ui/SafeAreaPlugin';
export { listViewPlugin, ListViewPlugin } from './ui/ListViewPlugin';
export { dropdownPlugin, DropdownPlugin } from './ui/DropdownPlugin';
export { layoutGroupPlugin, LayoutGroupPlugin } from './ui/LayoutGroupPlugin';

export { PhysicsPlugin, PhysicsEvents, Physics, loadPhysicsModule } from './physics';
export { AnimationPlugin, animationPlugin } from './animation';
export { AudioPlugin, audioPlugin } from './audio';
export { ParticlePlugin, particlePlugin } from './particle';

const defaultPlugins = [...uiPlugins, animationPlugin, audioPlugin, particlePlugin];

export function createWebApp(module: ESEngineModule, options?: WebAppOptions): App {
    return _createWebApp(module, { plugins: defaultPlugins, ...options });
}
