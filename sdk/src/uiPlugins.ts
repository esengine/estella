import { textPlugin } from './ui/TextPlugin';
import { uiMaskPlugin } from './ui/UIMaskPlugin';
import { uiInteractionPlugin } from './ui/UIInteractionPlugin';
import { uiLayoutPlugin } from './ui/UILayoutPlugin';
import { textInputPlugin } from './ui/TextInputPlugin';
import type { Plugin } from './app';

export const uiPlugins: Plugin[] = [
    textPlugin, uiMaskPlugin, uiLayoutPlugin,
    uiInteractionPlugin, textInputPlugin,
];
