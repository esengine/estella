import { textPlugin } from './ui/TextPlugin';
import { uiMaskPlugin } from './ui/UIMaskPlugin';
import { uiInteractionPlugin } from './ui/UIInteractionPlugin';
import { uiLayoutPlugin } from './ui/UILayoutPlugin';
import { textInputPlugin } from './ui/TextInputPlugin';
import { imagePlugin } from './ui/ImagePlugin';
import { togglePlugin } from './ui/TogglePlugin';
import { progressBarPlugin } from './ui/ProgressBarPlugin';
import { dragPlugin } from './ui/DragPlugin';
import { scrollViewPlugin } from './ui/ScrollViewPlugin';
import { sliderPlugin } from './ui/SliderPlugin';
import { focusPlugin } from './ui/FocusPlugin';
import { safeAreaPlugin } from './ui/SafeAreaPlugin';
import { listViewPlugin } from './ui/ListViewPlugin';
import { dropdownPlugin } from './ui/DropdownPlugin';
import type { Plugin } from './app';

export const uiPlugins: Plugin[] = [
    textPlugin, uiMaskPlugin, uiLayoutPlugin,
    imagePlugin, progressBarPlugin,
    uiInteractionPlugin, dragPlugin, scrollViewPlugin, sliderPlugin,
    togglePlugin, textInputPlugin,
    focusPlugin, safeAreaPlugin, listViewPlugin, dropdownPlugin,
];
