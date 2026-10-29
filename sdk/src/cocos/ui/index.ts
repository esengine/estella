// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    cocos/ui/index.ts
 * @brief   Cocos's built-in UI components, as views on the engine's. Importing this registers their adapters.
 */
export { UITransform, uiTransformDef, ensureUITransform } from './uiTransform';
export { Label, LabelOutline, LabelShadow } from './label';
export { Sprite, UIOpacity } from './sprite';
export { Button, EventHandler, declareButton } from './button';
export { Widget, alignWidget } from './widget';
export { Layout } from './layout';
export { getVisibleSize, setVisibleSize } from './screen';
