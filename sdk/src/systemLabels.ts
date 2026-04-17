/**
 * @file    systemLabels.ts
 * @brief   System and plugin name constants for ordering dependencies
 */

export const PluginName = {
    UILayout: 'uiLayout',
    UIInteraction: 'uiInteraction',
    UIRenderOrder: 'uiRenderOrder',
    UIMask: 'uiMask',
    Text: 'text',
    Image: 'image',
    Focus: 'focus',
    ScrollView: 'scrollView',
    Dropdown: 'dropdown',
    ProgressBar: 'progressBar',
    Slider: 'slider',
    Toggle: 'toggle',
    Drag: 'drag',
    SafeArea: 'safeArea',
    TextInput: 'textInput',
    StateMachine: 'stateMachine',
} as const;

export const SystemLabel = {
    UILayout: 'UILayoutSystem',
    UILayoutLate: 'UILayoutLateSystem',
    UIRenderOrder: 'UIRenderOrderSystem',
    UIInteraction: 'UIInteractionSystem',
    Button: 'ButtonSystem',
    ScrollView: 'ScrollViewSystem',
    ListView: 'ListViewSystem',
    Text: 'TextSystem',
    Image: 'ImageSystem',
    Focus: 'FocusSystem',
    Tween: 'TweenSystem',
} as const;
