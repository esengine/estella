// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The Model shader's shading layers — clear coat, sheen, anisotropy, translucency, thin film, index of refraction,
 *        transmission — are declared once and read by both languages.
 *
 * The two stages are written apart, so a layer one of them forgot reads as a parameter that does nothing on one backend.
 * This holds each layer's parameter to the block and to both stages, and the surface they fill to the same lighting call.
 */
import { describe, it, expect } from 'vitest';
import { builtinShaderTemplate } from '../src/render/builtinShaders';
import { withWgslTwin } from '../src/shaders/wgsl/twin';

const source = builtinShaderTemplate('model')!.source;
// The WGSL is the one a WebGPU device is given: written from the GLSL as the shader compiles.
const twinned = withWgslTwin(source);
const split = twinned.indexOf('#pragma fragment wgsl');
const [glsl, wgsl] = [twinned.slice(0, split), twinned.slice(split)];

const LAYERS = [
    'u_ior', 'u_specular', 'u_clearcoat', 'u_clearcoatRoughness', 'u_sheenColor', 'u_sheenRoughness', 'u_anisotropy',
    'u_anisotropyRotation', 'u_translucency', 'u_translucencyColor', 'u_thickness', 'u_transmission', 'u_attenuationColor',
    'u_iridescence', 'u_iridescenceIor', 'u_iridescenceThickness', 'u_subsurface', 'u_refractionStrength',
];

describe('the Model shader\'s shading layers', () => {
    it.each(LAYERS)('declares %s as a material parameter and reads it in both stages', (name) => {
        expect(source).toContain(`#pragma param ${name} `);
        expect(glsl).toContain(name);
        expect(wgsl).toContain(`mc.${name}`);
    });

    it('defaults every layer to off, so a material that says nothing is the plain surface', () => {
        for (const name of ['u_clearcoat', 'u_anisotropy', 'u_translucency', 'u_transmission', 'u_iridescence']) {
            expect(source).toMatch(new RegExp(`#pragma param ${name} float default\\(0\\)`));
        }
        expect(source).toMatch(/#pragma param u_sheenColor color default\(0,0,0,1\)/);
        // glTF's own defaults, which are not zero.
        expect(source).toMatch(/#pragma param u_ior float default\(1\.5\)/);
        expect(source).toMatch(/#pragma param u_specular float default\(1\)/);
    });

    it('uses the isotropic surface when the texture has no valid anisotropy direction', () => {
        for (const stage of [glsl, wgsl]) {
            const length = stage.indexOf('dot(T, T)');
            const guard = stage.indexOf('axisLength2 >', length);
            const lobe = stage.indexOf('ext.aniso =', guard);
            expect(length).toBeGreaterThan(0);
            expect(guard).toBeGreaterThan(length);
            expect(lobe).toBeGreaterThan(guard);
            expect(lobe).toBeLessThan(stage.indexOf('}', guard));
        }
    });

    it('hands the filled surface to the lighting, in each language', () => {
        expect(glsl).toMatch(/applyLightingSurface\([^;]*, ext\)/);
        expect(wgsl).toMatch(/applyLightingSurface\([^;]*, ext\)/);
    });

    it('lights the coat by the surface\'s own normal, not the bump map\'s', () => {
        expect(glsl).toMatch(/ext\.coatN = vec4\(Ng, 0\.0\)/);
        expect(wgsl).toMatch(/ext\.coatN = vec4f\(Ng, 0\.0\)/);
    });

    it('lets transmission through as coverage, with no refraction of what is behind', () => {
        expect(glsl).toMatch(/alpha \*= 1\.0 - u_transmission/);
        expect(wgsl).toMatch(/alpha \*= 1\.0 - \(?mc\.u_transmission/);
    });
});
