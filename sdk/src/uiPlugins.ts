import { textPlugin } from './ui/TextPlugin';
import { uiMaskPlugin } from './ui/UIMaskPlugin';
import { uiInteractionPlugin } from './ui/UIInteractionPlugin';
import { uiLayoutPlugin } from './ui/UILayoutPlugin';
import { textInputPlugin } from './ui/TextInputPlugin';
import { imagePlugin } from './ui/ImagePlugin';
import { dragPlugin } from './ui/DragPlugin';
import { scrollViewPlugin } from './ui/ScrollViewPlugin';
import { focusPlugin } from './ui/FocusPlugin';
import { safeAreaPlugin } from './ui/SafeAreaPlugin';
import { uiRenderOrderPlugin } from './ui/UIRenderOrderPlugin';
import type { Plugin } from './app';

export const uiPlugins: Plugin[] = [
    textPlugin, uiMaskPlugin, uiLayoutPlugin,
    imagePlugin,
    uiInteractionPlugin, dragPlugin, scrollViewPlugin,
    textInputPlugin,
    focusPlugin, safeAreaPlugin,
    uiRenderOrderPlugin,
];
