// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A shader's batch textures, `uniform sampler2D u_textures[N]`, split for WGSL at units 0..N-1, whatever N it declares.
 */
import { describe, it, expect } from 'vitest';
// @ts-expect-error — a repo tool, shipped as .mjs with no declarations
import { adaptGlsl } from '../gen-shader-twins.mjs';

const stage = (decl: string, reads: string) => `#version 300 es
precision mediump float;
in vec2 v_texCoord;
${decl}
out vec4 fragColor;
void main() { fragColor = ${reads}; }
`;

describe('batch textures in a twin', () => {
    it('declares only the units a shader that reads one texture declares', () => {
        const out: string = adaptGlsl(stage('uniform sampler2D u_textures[1];', 'texture(u_textures[0], v_texCoord)'), []);
        expect(out).toContain('es_bt0_est');
        expect(out).toContain('texture(sampler2D(es_bt0_est, es_bt0_ess), v_texCoord)');
        expect(out).not.toMatch(/es_bt[1-7]/);
        expect(out).not.toMatch(/\bu_textures\b/);
    });

    it('still declares all eight for the usual u_textures[8]', () => {
        const out: string = adaptGlsl(stage('uniform sampler2D u_textures[8];', 'texture(u_textures[3], v_texCoord)'), []);
        for (let u = 0; u < 8; u++) expect(out).toContain(`es_bt${u}_est`);
    });

    it('refuses a count the engine has no units for', () => {
        expect(() => adaptGlsl(stage('uniform sampler2D u_textures[9];', 'texture(u_textures[0], v_texCoord)'), [])).toThrow(/1 to 8/);
        expect(() => adaptGlsl(stage('uniform sampler2D u_textures[0];', 'vec4(1.0)'), [])).toThrow(/1 to 8/);
    });
});
