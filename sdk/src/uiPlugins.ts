import { textPlugin } from './ui/TextPlugin';
import { uiMaskPlugin } from './ui/UIMaskPlugin';
import { uiInteractionPlugin } from './ui/UIInteractionPlugin';
import { uiBehaviorPlugin } from './ui/plugin';
import { uiLayoutPlugin } from './ui/UILayoutPlugin';
import { textInputPlugin } from './ui/TextInputPlugin';
import { imagePlugin } from './ui/ImagePlugin';
import { dragPlugin } from './ui/DragPlugin';
import { scrollViewPlugin } from './ui/ScrollViewPlugin';
import { focusPlugin } from './ui/FocusPlugin';
import { safeAreaPlugin } from './ui/SafeAreaPlugin';
import { uiRenderOrderPlugin } from './ui/UIRenderOrderPlugin';
import { uiTextPlugin } from './ui/text/plugin';
import type { Plugin } from './app';

export const uiPlugins: Plugin[] = [
    textPlugin, uiMaskPlugin, uiLayoutPlugin,
    imagePlugin,
    uiInteractionPlugin, uiBehaviorPlugin, dragPlugin, scrollViewPlugin,
    textInputPlugin,
    focusPlugin, safeAreaPlugin,
    uiRenderOrderPlugin,
    // REARCH_GUI P1.3c: SDF glyph-atlas text path. Opt-in via the UIText
    // component; renders nothing unless an entity carries one.
    uiTextPlugin,
];
