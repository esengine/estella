// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    EditorViewLighting.ts
 * @brief   The editor viewport's own lighting and exposure — view state, like EditorView.
 *
 * @details "Scene lighting" shows the scene by the lights it carries. "Studio preview"
 *          replaces them, for the eye only, with a neutral sky, a key and a fill, so a
 *          model the scene left dark can be read while it is authored. The exposure is
 *          a second, independent control: a stop count applied where the frame is
 *          written out, the same exp2(EV) the post-process exposure uses.
 *
 *          None of it is a scene entity, none of it is serialized, and it reaches the
 *          engine only while the editor view is active — a packaged build never inserts
 *          the view, never calls the engine setters, and so renders by the scene's own
 *          settings. Play mode deactivates the view and with it every override here.
 */
import { defineResource } from '../ecs/resource';
import type { ESEngineModule } from '../wasm';
import {
    readSceneLights, sceneEnvironment, carriesEnvironment,
    type EnvironmentLightEntity, type SceneAmbientLight,
} from '../lightmap/environmentLight';

export type EditorLightingMode = 'scene' | 'studio';

export interface EditorViewLightingData {
    mode: EditorLightingMode;
    /** Degrees about +Y that the key and the fill turn together. */
    rotation: number;
    keyIntensity: number;
    fillIntensity: number;
    /** Scales the neutral sky. Never the scene's Ambient: that light is not consulted. */
    skyIntensity: number;
    /** Draw the scene's environment as the background while studio-lit. */
    showSky: boolean;
    /** Preview exposure in stops, independent of the mode. 0 is exact identity. */
    exposure: number;
}

export const DEFAULT_EDITOR_VIEW_LIGHTING: EditorViewLightingData = {
    mode: 'scene', rotation: 0, keyIntensity: 0.8, fillIntensity: 0.3,
    skyIntensity: 1, showSky: false, exposure: 0,
};

export const EDITOR_EXPOSURE_RANGE = { min: -6, max: 6 } as const;

export const EditorViewLighting = defineResource<EditorViewLightingData>(
    { ...DEFAULT_EDITOR_VIEW_LIGHTING }, 'EditorViewLighting');

/** True when the view differs from the game's own settings in any way. */
export function editorViewLightingIsOverriding(data: EditorViewLightingData): boolean {
    return data.mode === 'studio' || data.exposure !== 0;
}

/** The game's own settings: studio off and exposure at zero. The rig's tuning is kept. */
export function resetEditorViewLighting(data: EditorViewLightingData): EditorViewLightingData {
    return { ...data, mode: 'scene', exposure: 0 };
}

/** The numbers the engine setters take, so the push and its tests share one reading. */
export function editorViewLightingArgs(data: EditorViewLightingData, viewActive: boolean): {
    mode: number; rotation: number; key: number; fill: number; sky: number; showSky: boolean; exposure: number;
} {
    // An inactive view (play mode, a packaged build) carries no override at all.
    if (!viewActive) return { mode: 0, rotation: 0, key: 0, fill: 0, sky: 1, showSky: false, exposure: 0 };
    const finite = (v: number, fallback: number) => (Number.isFinite(v) ? v : fallback);
    return {
        mode: data.mode === 'studio' ? 1 : 0,
        rotation: finite(data.rotation, 0),
        key: Math.max(0, finite(data.keyIntensity, 0)),
        fill: Math.max(0, finite(data.fillIntensity, 0)),
        sky: Math.max(0, finite(data.skyIntensity, 1)),
        showSky: data.showSky,
        exposure: Math.min(EDITOR_EXPOSURE_RANGE.max, Math.max(EDITOR_EXPOSURE_RANGE.min, finite(data.exposure, 0))),
    };
}

/**
 * Pushes the view's lighting to the engine, once per change. Returns the key it last
 * pushed, so a caller skips the crossing while nothing moved.
 */
export function pushEditorViewLighting(
    module: ESEngineModule | null,
    data: EditorViewLightingData,
    viewActive: boolean,
    lastKey: string,
): string {
    const a = editorViewLightingArgs(data, viewActive);
    const key = `${a.mode}|${a.rotation}|${a.key}|${a.fill}|${a.sky}|${a.showSky}|${a.exposure}`;
    // A module that does not carry the setters (an older core) is simply not
    // overridden; the key still advances so it is not asked every frame.
    if (key === lastKey || !module) return lastKey;
    module.renderer_setViewLighting?.(a.mode, a.rotation, a.key, a.fill, a.sky, a.showSky);
    module.postprocess_setViewExposure?.(a.exposure);
    return key;
}

export type SkyUnavailable = 'no-ambient' | 'no-environment' | 'missing' | 'off' | 'unusable';
export type SceneDark = 'no-lights' | 'no-enabled-light';

/** What a scene gives the studio preview to say about itself. */
export interface StudioPreviewReport {
    /** Non-Ambient lights that are visible, enabled and have intensity. */
    sceneLights: number;
    /** The environment the scene's own frame would use, or null. */
    environment: SceneAmbientLight | null;
    /** Why there is no environment to show as a sky, or null when there is one. */
    skyUnavailable: SkyUnavailable | null;
    /** Why the scene alone would read dark, or null when it has light. */
    sceneDark: SceneDark | null;
}

/**
 * The actual reasons, read from the scene document: nothing here guesses at what the
 * engine did. The Lighting panel uses it to say why a toggle is disabled or why the
 * scene looks dark without the studio.
 */
export function studioPreviewReport(
    entities: readonly EnvironmentLightEntity[],
    exists: (ref: string) => boolean,
): StudioPreviewReport {
    const { ambient, direct, total } = readSceneLights(entities, exists);
    const { effective } = sceneEnvironment(ambient);
    const named = ambient.filter((l) => l.environment !== null);

    let skyUnavailable: SkyUnavailable | null = null;
    if (!effective) {
        if (ambient.length === 0) skyUnavailable = 'no-ambient';
        else if (named.length === 0) skyUnavailable = 'no-environment';
        else if (named.every((l) => l.environmentMissing)) skyUnavailable = 'missing';
        else if (named.some((l) => l.skipped !== null && !carriesEnvironment(l))) skyUnavailable = 'off';
        else skyUnavailable = 'unusable';
    }

    let sceneDark: SceneDark | null = null;
    if (direct === 0 && !ambient.some(light => light.skipped === null)) {
        sceneDark = total === 0 ? 'no-lights' : 'no-enabled-light';
    }
    return { sceneLights: direct, environment: effective, skyUnavailable, sceneDark };
}
