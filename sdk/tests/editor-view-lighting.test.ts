// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * The editor view's lighting is VIEW state: it reaches the engine only while the editor eye
 * is the one drawing, it never carries a value the engine cannot take, and the scene's
 * own reasons for being dark are read from the document, not guessed.
 */
import { describe, it, expect } from 'vitest';
import {
    DEFAULT_EDITOR_VIEW_LIGHTING, EDITOR_EXPOSURE_RANGE, editorViewLightingArgs,
    editorViewLightingIsOverriding, resetEditorViewLighting, studioPreviewReport,
} from '../src/camera/EditorViewLighting';
import { pushEditorViewLighting } from '../src/camera/EditorViewLighting';
import type { EnvironmentLightEntity } from '../src/lightmap';

const studio = { ...DEFAULT_EDITOR_VIEW_LIGHTING, mode: 'studio' as const, exposure: 1.5, rotation: 30 };

describe('what reaches the engine', () => {
    it('is the neutral state whenever the editor eye is not drawing', () => {
        expect(editorViewLightingArgs(studio, false)).toEqual({
            mode: 0, rotation: 0, key: 0, fill: 0, sky: 1, showSky: false, exposure: 0,
        });
    });

    it('is the studio rig while it is, with every number made safe', () => {
        const a = editorViewLightingArgs({ ...studio, keyIntensity: -3, fillIntensity: Number.NaN, exposure: 40 }, true);
        expect(a.mode).toBe(1);
        expect(a.rotation).toBe(30);
        expect(a.key).toBe(0);
        expect(a.fill).toBe(0);
        expect(a.exposure).toBe(EDITOR_EXPOSURE_RANGE.max);
    });

    it('crosses into the engine once per change, and leaves the old core alone', () => {
        const calls: unknown[][] = [];
        const module = {
            renderer_setViewLighting: (...a: unknown[]) => calls.push(['light', ...a]),
            postprocess_setViewExposure: (...a: unknown[]) => calls.push(['ev', ...a]),
        } as never;
        let key = '';
        key = pushEditorViewLighting(module, studio, true, key);
        key = pushEditorViewLighting(module, studio, true, key);
        expect(calls).toHaveLength(2);
        // Play mode deactivates the eye: the very next frame is the game's own.
        key = pushEditorViewLighting(module, studio, false, key);
        expect(calls.slice(2)).toEqual([['light', 0, 0, 0, 0, 1, false], ['ev', 0]]);
        expect(() => pushEditorViewLighting({} as never, studio, true, '')).not.toThrow();
    });
});

describe('returning to the game', () => {
    it('is studio off and exposure zero, and nothing else', () => {
        expect(editorViewLightingIsOverriding(DEFAULT_EDITOR_VIEW_LIGHTING)).toBe(false);
        expect(editorViewLightingIsOverriding(studio)).toBe(true);
        expect(editorViewLightingIsOverriding({ ...DEFAULT_EDITOR_VIEW_LIGHTING, exposure: -1 })).toBe(true);
        expect(resetEditorViewLighting(studio)).toEqual({ ...studio, mode: 'scene', exposure: 0 });
    });
});

let next = 1;
const light = (data: Record<string, unknown>, visible?: boolean): EnvironmentLightEntity =>
    ({ id: next++, name: `L${next}`, ...(visible === undefined ? {} : { visible }), components: [{ type: 'Light', data }] });
const all = (): boolean => true;

describe('why the scene is dark, from the document', () => {
    it('says a scene with no lights has none', () => {
        const r = studioPreviewReport([], all);
        expect(r.sceneDark).toBe('no-lights');
        expect(r.skyUnavailable).toBe('no-ambient');
    });

    it('is not dark when a light shines, and says so only about what is missing', () => {
        const r = studioPreviewReport([light({ type: 1 })], all);
        expect(r.sceneLights).toBe(1);
        expect(r.sceneDark).toBeNull();
        expect(r.skyUnavailable).toBe('no-ambient');
    });

    it('names a disabled light as no light', () => {
        expect(studioPreviewReport([light({ type: 1, enabled: false })], all).sceneDark).toBe('no-enabled-light');
    });

    it('reports a scene as dark when its only direct lights are inactive or non-finite', () => {
        const group = { id: next++, name: 'Off group', components: [{ type: 'Disabled', data: {} }] };
        const child = { ...light({ type: 1 }), parent: group.id };
        const infinite = light({ type: 1, intensity: Infinity });
        expect(studioPreviewReport([child, group, infinite], all)).toMatchObject({
            sceneLights: 0, sceneDark: 'no-enabled-light',
        });
    });

    it('tells apart an Ambient that names nothing, one that names a missing file, and a usable one', () => {
        expect(studioPreviewReport([light({ type: 2 })], all)).toMatchObject({ skyUnavailable: 'no-environment', sceneDark: null });
        expect(studioPreviewReport([light({ type: 2, environment: 'a.esenv' })], () => false)).toMatchObject({
            skyUnavailable: 'missing', sceneDark: null,
        });
        const ok = studioPreviewReport([light({ type: 2, environment: 'a.esenv' })], all);
        expect(ok.skyUnavailable).toBeNull();
        expect(ok.environment).not.toBeNull();
        expect(ok.sceneDark).toBeNull();
    });
});
