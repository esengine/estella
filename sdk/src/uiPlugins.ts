// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { textPlugin } from './ui/text/plugin';
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
import type { Plugin } from './app';

// `textPlugin` now renders the Text component via the dynamic SDF glyph atlas
// (REARCH_GUI P1.4d); the legacy Canvas2D-per-entity path is retired.
export const uiPlugins: Plugin[] = [
    textPlugin, uiMaskPlugin, uiLayoutPlugin,
    imagePlugin,
    uiInteractionPlugin, uiBehaviorPlugin, dragPlugin, scrollViewPlugin,
    textInputPlugin,
    focusPlugin, safeAreaPlugin,
    uiRenderOrderPlugin,
];
