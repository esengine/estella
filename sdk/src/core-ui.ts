// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    core-ui.ts
 * @brief   The stable UI surface promoted into the top-level `esengine`
 *          namespace (text, UINode box visuals, interaction, layout, theme).
 *
 * This is the curated *public* UI API. The complete UI module surface — which
 * also includes low-level text/atlas internals and engine-internal composition
 * glue (e.g. `EntityStateMap`, `ensureComponent`) — lives in
 * `./ui` and is imported module-directly by the SDK code that needs it. Those
 * internals are intentionally NOT re-exported here, so the public `esengine`
 * namespace stays a stable, intentional surface.
 *
 * Re-exported wholesale by `core.ts`.
 */

export {
    Text,
    TextAlign,
    TextVerticalAlign,
    TextOverflow,
    TextRenderMode,
    UINode,
    UIVisual,
    UIVisualType,
    UILayoutGeneration,
    UIMask,
    textPlugin,
    DefaultImageResolver,
    setImageResolver,
    getImageResolver,
    parseRichText,
    type ImageResolver,
    type ResolvedImage,
    type RichTextRun,
    type TextSegment,
    type ImageSegment,
    intersectRects,
    invertMatrix4,
    screenToWorld,
    pointInWorldRect,
    pointInOBB,
    quaternionToAngle2D,
    Interactable,
    UIInteraction,
    UIEvents,
    UIEventQueue,
    UICameraInfo,
    screenToUiWorld,
    uiWorldToScreen,
    uiHitTestWorld,
    uiPickWorld,
    uiPickAllWorld,
    TextInput,
    FillMethod,
    FillOrigin,
    Draggable,
    DragState,
    Focusable,
    FocusManager,
    FocusManagerState,
    SafeArea,
    type TextData,
    type UIMaskData,
    type MaskMode,
    type ScreenRect,
    type InteractableData,
    type UIInteractionData,
    type UIEvent,
    type UIEventType,
    type UIEventHandler,
    type Unsubscribe,
    type UICameraData,
    type TextInputData,
    type UIVisualData,
    type UILayoutGenerationData,
    type DraggableData,
    type DragStateData,
    type FocusableData,
    type SafeAreaData,
    // Theme design tokens
    DARK_TOKENS,
    LIGHT_TOKENS,
    getTheme,
    setTheme,
    themeColors,
    themeType,
    type ThemeTokens,
    type ThemeColors,
    type ThemeType,
    // Live re-theming
    ThemeStyle,
    markThemed,
    applyThemeToWorld,
    switchTheme,
    type ThemeStyleData,
    type ColorRole,
    // Reactive data binding
    signal,
    derived,
    bind,
    type Signal,
    type ReadonlySignal,
} from './ui';

// ─── Controllers + Gears (shared UI state) ───────────────────────────────────
// A UIController is a named enum of pages scoped to a UI root; UIGears bind a
// component field to per-page values (snap or tween). The curated authoring
// surface — components, the page-control helpers, and the gear builder.
export {
    UIController,
    UIGear,
    interactionController,
    controllerState,
    INTERACTION_CONTROLLER,
    INTERACTION_PAGES,
    gearBinding,
    setControllerPage,
    getControllerPage,
    findControllerOwner,
    bindControllerPage,
    readFieldPath,
    writeFieldPath,
    type UIControllerData,
    type ControllerState,
    type UIGearData,
    type GearBinding,
    type GearValue,
    type GearTween,
} from './ui';

// ─── UI code-composition surface ─────────────────────────────────────────────
// Promoted so UI can be built in code, not just authored in the editor:
// flexbox config, dimension helpers, node/visual/text builders, and the widget
// factories.
export {
    // Dimensions
    px,
    percent,
    auto,
    isAuto,
    DimensionUnit,
    type Dimension,
    // UINode layout enums
    UIPositionType,
    AlignSelf,
    // Flex container
    FlexContainer,
    FlexDirection,
    FlexWrap,
    JustifyContent,
    AlignItems,
    AlignContent,
    type FlexContainerData,
    // Anchor presets (authoring shortcuts over the box fields)
    AnchorAxis,
    ANCHOR_AXES,
    anchorPresetFields,
    detectAnchor,
    type AnchorPreset,
    type AnchorFields,
    // Builders
    buildUINode,
    buildUIVisual,
    buildText,
    spawnUIEntity,
    setUIVisible,
    FILL_AXIS,
    type LinearFillDirection,
    type UINodeInit,
    type UIVisualInit,
    type TextInit,
    type UIEntityInit,
    // Widget factories
    createButton,
    setButtonState,
    themeButtonStates,
    type ButtonOptions,
    type ButtonStateVisual,
    createToggle,
    type ToggleOptions,
    type ToggleHandle,
    createSlider,
    type SliderOptions,
    type SliderHandle,
    createProgress,
    type ProgressOptions,
    type ProgressHandle,
    createDialog,
    type DialogOptions,
    type DialogHandle,
    createDropdown,
    type DropdownOptions,
    type DropdownHandle,
    // Data-driven virtualized list / grid: the ergonomic factory plus the
    // collection primitives it composes, as escape hatches.
    createListView,
    type CreateListViewOptions,
    type ListViewHandle,
    type ListItemTemplate,
    type ListLayoutSpec,
    ListView,
    type ListViewOptions,
    ScrollContainer,
    KineticScroll,
    ArrayDataSource,
    arrayDataSource,
    type DataSource,
    LinearLayoutProvider,
    GridLayoutProvider,
    type LayoutProvider,
    widgetToPrefab,
    BUILTIN_UI_PREFABS,
    BUILTIN_UI_WIDGET_NAMES,
} from './ui';
