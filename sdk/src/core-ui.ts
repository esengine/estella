// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    core-ui.ts
 * @brief   UI layer surface (text, UINode box, renderer, interactables, layout).
 *
 * Most application code reaches for `Text` / `UINode` / `Interactable`
 * directly. The `withChildEntity` / `setEntityColor`-style helpers are
 * engine-internal glue re-exported for now so that the UILayout /
 * UIInteraction plugins that ship in the SDK can consume them; they are
 * not intended to be part of the stable public API.
 *
 * Re-exported wholesale by `core.ts`.
 */

export {
    Text,
    TextAlign,
    TextVerticalAlign,
    TextOverflow,
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
    AnimOverride,
    UIEvents,
    UIEventQueue,
    makeInteractable,
    UICameraInfo,
    screenToUiWorld,
    uiHitTestWorld,
    /** @internal fill-sprite sizing helper used by widget composition, unstable */
    syncFillSpriteSize,
    TextInput,
    FillMethod,
    FillOrigin,
    Draggable,
    DragState,
    FillDirection,
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
    /** @internal entity-tree helper for widget composition */
    withChildEntity,
    /** @internal state-driven tint helper used by widget state-visuals */
    setEntityColor,
    /** @internal component-toggle helper used by widget state-visuals */
    setEntityEnabled,
    /** @internal color math; prefer explicit Color objects in game code */
    colorScale,
    /** @internal color math; prefer explicit Color objects in game code */
    colorWithAlpha,
    /** @internal per-entity state map used by interaction behaviour */
    EntityStateMap,
    // Theme design tokens
    DARK_TOKENS,
    getTheme,
    setTheme,
    themeColors,
    type ThemeTokens,
    type ThemeColors,
} from './ui';
