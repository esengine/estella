// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The Hair shader names its shadow density to the frame and hands it to the lighting, in both languages.
 *
 * The density param is what makes the frame fit a cascade to the hair, and the global the shader sets is what the
 * shadow lookup reads: if either side drops out the hair shadows like any surface again, with nothing to say so.
 */
import { describe, it, expect } from 'vitest';
import { builtinShaderTemplate } from '../src/render/builtinShaders';
import { CHARACTER_SHADER_TEMPLATES } from '../src/character/characterShaders';
import { withWgslTwin } from '../src/shaders/wgsl/twin';

const hair = CHARACTER_SHADER_TEMPLATES.find(t => t.id === 'hair')!;
const source = hair.source;
// The WGSL is the one a WebGPU device is given: written from the GLSL as the shader compiles.
const twinned = withWgslTwin(source);
const split = twinned.indexOf('#pragma fragment wgsl');
const [glsl, wgsl] = [twinned.slice(0, split), twinned.slice(split)];

describe('the Hair shader and its shadow', () => {
    it('declares the density param and makes it the hair-shadow param', () => {
        expect(source).toMatch(/#pragma param u_hairShadow float default\(0\)/);
        expect(source).toMatch(/#pragma hairshadow u_hairShadow/);
    });

    it('sets the lighting global from the param, before it lights, in each language', () => {
        expect(glsl.indexOf('g_hairShadow = u_hairShadow;')).toBeGreaterThan(0);
        expect(glsl.indexOf('g_hairShadow = u_hairShadow;')).toBeLessThan(glsl.indexOf('applyLightingSurface('));
        expect(wgsl.indexOf('g_hairShadow = mc.u_hairShadow;')).toBeGreaterThan(0);
        expect(wgsl.indexOf('g_hairShadow = mc.u_hairShadow;')).toBeLessThan(wgsl.indexOf('applyLightingSurface('));
    });

    it('hands the strand diffuse weight to the lighting', () => {
        expect(glsl).toMatch(/ext\.strand = vec4\(u_strandDiffuse/);
        expect(wgsl).toMatch(/ext\.strand = vec4f\(mc\.u_strandDiffuse/);
    });

    it('is not a pragma any other built-in shader uses', () => {
        for (const id of ['model', 'skin']) expect(builtinShaderTemplate(id)?.source ?? '').not.toMatch(/#pragma hairshadow/);
    });
});
