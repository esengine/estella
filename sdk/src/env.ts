// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    env.ts
 * @brief   Run-mode accessors (editor vs runtime, edit vs play).
 *
 * State lives on {@link AppContext} (see context.ts) so it is app-scoped and
 * isolates with `setDefaultContext`, rather than as a module global. These
 * functions are the stable public surface; gameplay systems gate on
 * {@link playModeOnly}.
 */
import { getDefaultContext } from './ecs/context';

export function setEditorMode(active: boolean): void {
    getDefaultContext().editorMode = active;
}

export function isEditor(): boolean {
    return getDefaultContext().editorMode;
}

export function isRuntime(): boolean {
    return !getDefaultContext().editorMode;
}

export function setPlayMode(active: boolean): void {
    getDefaultContext().playMode = active;
}

export function isPlayMode(): boolean {
    return getDefaultContext().playMode;
}

/**
 * Run condition for gameplay (simulation-advancing) systems: true outside an
 * editor, or inside an editor only while play mode is active. In editor edit
 * mode it returns false, freezing gameplay while render/transform/layout
 * systems (which do not use this gate) keep ticking.
 */
export function playModeOnly(): boolean {
    const ctx = getDefaultContext();
    return !ctx.editorMode || ctx.playMode;
}

// FX authoring preview: the ONE exception to the edit-mode freeze — effect
// simulations (particles, motion trails) may advance in edit mode so they are
// live while being tuned. Deliberately a module global rather than AppContext
// state: only an editor's edit realm ever flips it (play realms and shipped
// runtimes are separate module instances where it stays false and playModeOnly
// rules alone), and it must survive a context reset (the editor re-syncs its
// own toggle, not the context lifecycle).
let fxEditPreview = false;

/** Editor-only: advance FX simulations (particles, trails) in edit mode. */
export function setFxEditPreview(enabled: boolean): void {
    fxEditPreview = enabled;
}

export function isFxEditPreview(): boolean {
    return fxEditPreview;
}

/** Run condition for FX systems: gameplay rules, plus the authoring preview. */
export function fxPreviewOrPlayMode(): boolean {
    return fxEditPreview || playModeOnly();
}

// =============================================================================
// Color space (project rendering.colorSpace)
// =============================================================================

let linearColor = false;

/** Declared at app creation, before textures upload / shaders compile. */
export function setLinearColorSpace(linear: boolean): void {
    linearColor = linear;
}

/** Whether the renderer runs the linear-light pipeline this session. */
export function linearColorSpace(): boolean {
    return linearColor;
}
