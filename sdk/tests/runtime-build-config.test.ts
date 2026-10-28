// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The runtime tuning a project can declare: what the parser keeps, and that the defaults it compares against are the engine's own.
 */
import { describe, it, expect } from 'vitest';
import { RUNTIME_BUILD_DEFAULTS, RuntimeConfig, parseRuntimeBuildConfig } from '../src/defaults';
import { packagedRuntimeInit } from '../src/runtime/packagedRuntime';

describe('packagedRuntimeInit', () => {
    it('hands the declared tuning to initRuntime, which is where every host applies it', () => {
        const runtime = { assetLoadTimeout: 60000 };
        expect(packagedRuntimeInit({ runtime }).runtime).toBe(runtime);
        expect(packagedRuntimeInit({}).runtime).toBeUndefined();
    });
});

describe('RUNTIME_BUILD_DEFAULTS', () => {
    it('are what the engine starts with, so "differs from the default" means differs from what runs', () => {
        const { sceneTransitionColor, ...numbers } = RUNTIME_BUILD_DEFAULTS;
        expect(sceneTransitionColor).toBe('#000000');
        expect(RuntimeConfig.sceneTransitionColor).toEqual({ r: 0, g: 0, b: 0, a: 1 });
        for (const [key, value] of Object.entries(numbers)) {
            expect((RuntimeConfig as Record<string, unknown>)[key], key).toBe(value);
        }
    });
});

describe('parseRuntimeBuildConfig', () => {
    it('keeps nothing for nothing, and for anything that is not an object', () => {
        expect(parseRuntimeBuildConfig(undefined)).toEqual({});
        expect(parseRuntimeBuildConfig(null)).toEqual({});
        expect(parseRuntimeBuildConfig([1, 2])).toEqual({});
        expect(parseRuntimeBuildConfig('x')).toEqual({});
    });

    it('drops a value equal to the default, since absence is how a default is written', () => {
        expect(parseRuntimeBuildConfig({ ...RUNTIME_BUILD_DEFAULTS })).toEqual({});
    });

    it('holds a number to its range and an integer field to whole numbers', () => {
        expect(parseRuntimeBuildConfig({ maxFixedSteps: 0, assetLoadTimeout: 5, textureCacheBudget: -1 })).toEqual({
            maxFixedSteps: 1, assetLoadTimeout: 1000, textureCacheBudget: 0,
        });
        expect(parseRuntimeBuildConfig({ maxFixedSteps: 12.6 })).toEqual({ maxFixedSteps: 13 });
        expect(parseRuntimeBuildConfig({ maxDeltaTime: 99 })).toEqual({ maxDeltaTime: 5 });
        expect(parseRuntimeBuildConfig({ maxDeltaTime: 0.5 })).toEqual({ maxDeltaTime: 0.5 });
    });

    it('drops a field of the wrong type or a non-finite number', () => {
        expect(parseRuntimeBuildConfig({
            maxDeltaTime: '1', maxFixedSteps: Number.NaN, textCanvasSize: Infinity, defaultFontFamily: 4, sceneTransitionColor: 'red',
        })).toEqual({});
    });

    it('takes a six-digit colour in lower case and refuses one with alpha', () => {
        expect(parseRuntimeBuildConfig({ sceneTransitionColor: '#FFAA00' })).toEqual({ sceneTransitionColor: '#ffaa00' });
        expect(parseRuntimeBuildConfig({ sceneTransitionColor: '#ffaa0080' })).toEqual({});
    });

    it('takes a font family unless it is blank, absurdly long or the engine\'s own', () => {
        expect(parseRuntimeBuildConfig({ defaultFontFamily: 'Noto Sans SC' })).toEqual({ defaultFontFamily: 'Noto Sans SC' });
        expect(parseRuntimeBuildConfig({ defaultFontFamily: '  ' })).toEqual({});
        expect(parseRuntimeBuildConfig({ defaultFontFamily: 'x'.repeat(201) })).toEqual({});
        expect(parseRuntimeBuildConfig({ defaultFontFamily: 'Arial' })).toEqual({});
    });
});
