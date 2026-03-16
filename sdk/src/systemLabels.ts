/**
 * @file    systemLabels.ts
 * @brief   System name constants for ordering dependencies
 */

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
