// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    systemLabels.ts
 * @brief   System and plugin name constants for ordering dependencies
 */

export const PluginName = {
    UILayout: 'uiLayout',
    UIInteraction: 'uiInteraction',
    UIRenderOrder: 'uiRenderOrder',
    UIVisibility: 'uiVisibility',
    UIMask: 'uiMask',
    Text: 'text',
    Focus: 'focus',
    Drag: 'drag',
    SafeArea: 'safeArea',
    TextInput: 'textInput',
} as const;

export const SystemLabel = {
    UILayout: 'UILayoutSystem',
    UILayoutLate: 'UILayoutLateSystem',
    RectAnchors: 'RectAnchorsSystem',
    RectAnchorsLate: 'RectAnchorsLateSystem',
    UIRenderOrder: 'UIRenderOrderSystem',
    UIInteraction: 'UIInteractionSystem',
    VirtualControls: 'VirtualControlsSystem',
    ListView: 'ListViewSystem',
    Text: 'TextSystem',
    Focus: 'FocusSystem',
    Tween: 'TweenSystem',
    Animator: 'AnimatorSystem',
    SpriteAnimator: 'SpriteAnimatorSystem',
} as const;
