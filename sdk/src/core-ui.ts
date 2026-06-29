// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    core-ui.ts
 * @brief   The stable UI surface promoted into the top-level `esengine`
 *          namespace (text, UINode box visuals, interaction, layout, theme).
 *
 * This is the curated *public* UI API. The complete UI module surface — which
 * also includes low-level text/atlas internals and engine-internal composition
 * glue (e.g. `withChildEntity`, `setEntityColor`, `EntityStateMap`) — lives in
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
    uiWorldToScreen,
    uiHitTestWorld,
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
    // Theme design tokens
    DARK_TOKENS,
    getTheme,
    setTheme,
    themeColors,
    type ThemeTokens,
    type ThemeColors,
} from './ui';
