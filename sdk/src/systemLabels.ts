/**
 * @file    systemLabels.ts
 * @brief   System and plugin name constants for ordering dependencies
 */

export const PluginName = {
    UILayout: 'uiLayout',
    UIInteraction: 'uiInteraction',
    CollectionView: 'collectionView',
    Text: 'text',
    Image: 'image',
    Focus: 'focus',
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
