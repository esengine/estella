// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    EditorViewShading.ts
 * @brief   How the editor viewport shades its meshes — view state, beside EditorViewLighting.
 *
 * @details Clay and albedo are questions asked of the scene while it is authored: "is this
 *          the right shape", "is this the right texture". Like the view's lighting it is
 *          no scene entity and is never serialized, and it reaches the engine only while
 *          the editor view is the one drawing, so play mode and a packaged build always
 *          render each mesh as authored.
 */
import { defineResource } from '../ecs/resource';
import { Renderer, type ViewShading } from '../render/renderer';
import { EDITOR_VIEW_ENTITY } from './uiLayoutRect';

export interface EditorViewShadingData {
    mode: ViewShading;
    /** The one skinned entity to colour by a joint's weights, and the joint (an index into its bind matrices). */
    weights: { entity: number; joint: number } | null;
    /** The entities the view outlines as selected (Renderer.setViewSelection). */
    selection?: readonly number[];
}

export const DEFAULT_EDITOR_VIEW_SHADING: EditorViewShadingData = { mode: 'shaded', weights: null, selection: [] };

export const EditorViewShading = defineResource<EditorViewShadingData>(
    { ...DEFAULT_EDITOR_VIEW_SHADING }, 'EditorViewShading');

/** The mode the engine is to use: an inactive view (play mode, a shipped game) carries no override. */
export function editorViewShadingMode(data: EditorViewShadingData, viewActive: boolean): ViewShading {
    return viewActive ? data.mode : 'shaded';
}

/**
 * Pushes the view's shading to the engine, once per change. Returns the mode it last
 * pushed, so a caller skips the crossing while nothing moved.
 */
export function editorViewWeightsKey(data: EditorViewShadingData, viewActive: boolean): string {
    return viewActive && data.weights ? `${data.weights.entity}:${data.weights.joint}` : '';
}

/** Pushes the skin-weight target to the engine, once per change; returns the key it pushed. */
export function pushEditorViewWeights(data: EditorViewShadingData, viewActive: boolean, lastKey: string): string {
    const key = editorViewWeightsKey(data, viewActive);
    if (key === lastKey) return lastKey;
    const target = viewActive ? data.weights : null;
    Renderer.setViewSkinWeights(EDITOR_VIEW_ENTITY >>> 0, target ? target.entity : null, target?.joint ?? 0);
    return key;
}

/**
 * Pushes the view's selection outline to the engine, once per change and before the frame draws it; returns the key it
 * pushed. Pushed from anywhere later in the frame, a change would show a frame late, and a viewport drawn on demand
 * would keep the old outline until something else asked for a frame.
 */
export function pushEditorViewSelection(data: EditorViewShadingData, viewActive: boolean, lastKey: string): string {
    const ids = viewActive ? data.selection ?? [] : [];
    const key = ids.join(',');
    if (key === lastKey) return lastKey;
    Renderer.setViewSelection(EDITOR_VIEW_ENTITY >>> 0, ids);
    return key;
}

export function pushEditorViewShading(
    data: EditorViewShadingData,
    viewActive: boolean,
    last: ViewShading | null,
): ViewShading {
    const mode = editorViewShadingMode(data, viewActive);
    if (mode !== last) Renderer.setViewShading(EDITOR_VIEW_ENTITY >>> 0, mode);
    return mode;
}
