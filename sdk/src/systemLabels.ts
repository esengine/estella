/**
 * @file    systemLabels.ts
 * @brief   System and plugin name constants for ordering dependencies
 */

export const PluginName = {
    UILayout: 'uiLayout',
    UIInteraction: 'uiInteraction',
    UIRenderOrder: 'uiRenderOrder',
    UIMask: 'uiMask',
    CollectionView: 'collectionView',
    Text: 'text',
    Image: 'image',
    Focus: 'focus',
    DataBinding: 'dataBinding',
    ScrollView: 'scrollView',
    Dropdown: 'dropdown',
    ProgressBar: 'progressBar',
    Slider: 'slider',
    Toggle: 'toggle',
    Drag: 'drag',
    SafeArea: 'safeArea',
    TextInput: 'textInput',
    StateMachine: 'stateMachine',
    LayoutGroup: 'layoutGroup',
    FanLayout: 'fanLayout',
    Selectable: 'selectable',
    LinearLayout: 'linearLayout',
    GridLayout: 'gridLayout',
} as const;

export const SystemLabel = {
    UILayout: 'UILayoutSystem',
    UILayoutLate: 'UILayoutLateSystem',
    UIRenderOrder: 'UIRenderOrderSystem',
    UIInteraction: 'UIInteractionSystem',
    Button: 'ButtonSystem',
    ScrollView: 'ScrollViewSystem',
    CollectionView: 'CollectionViewSystem',
    ListView: 'ListViewSystem',
    Text: 'TextSystem',
    Image: 'ImageSystem',
    Focus: 'FocusSystem',
    Tween: 'TweenSystem',
} as const;
