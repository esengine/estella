/**
 * @file    env.ts
 * @brief   Run-mode accessors (editor vs runtime, edit vs play).
 *
 * State lives on {@link AppContext} (see context.ts) so it is app-scoped and
 * isolates with `setDefaultContext`, rather than as a module global. These
 * functions are the stable public surface; gameplay systems gate on
 * {@link playModeOnly}.
 */
import { getDefaultContext } from './context';

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
