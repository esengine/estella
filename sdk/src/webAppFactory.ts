import { createWebApp as _createWebApp, type WebAppOptions } from './app';
import type { App } from './app';
import type { ESEngineModule } from './wasm';
import { uiPlugins } from './uiPlugins';

export { uiPlugins };
export { textPlugin, TextPlugin } from './ui/TextPlugin';
export { uiMaskPlugin, UIMaskPlugin } from './ui/UIMaskPlugin';
export { uiInteractionPlugin, UIInteractionPlugin } from './ui/UIInteractionPlugin';
export { uiLayoutPlugin, UILayoutPlugin } from './ui/UILayoutPlugin';
export { textInputPlugin, TextInputPlugin } from './ui/TextInputPlugin';

export { PhysicsPlugin, PhysicsEvents, Physics, loadPhysicsModule } from './physics';

export function createWebApp(module: ESEngineModule, options?: WebAppOptions): App {
    return _createWebApp(module, { plugins: uiPlugins, ...options });
}
