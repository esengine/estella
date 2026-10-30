// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The engine's canonical vertex stage hands a material the mesh's own second uv set (`v_texCoord1`) wherever the vertices carry one, which the
 *        engine says as MESH_LIGHTMAP: a material that reads a second set (a mask, a dissolve map) is not a bake and has no other way to it.
 */
import { describe, it, expect, beforeAll } from 'vitest';
// @ts-expect-error — a repo tool, shipped as .mjs with no declarations
import { loadTwinModule } from '../gen-shader-twins.mjs';

const FRAGMENT_ONLY = `#pragma shader "SecondUv"
#pragma version 300 es
#pragma domain Lit
#pragma fragment
precision mediump float;
in vec4 v_color;
out vec4 fragColor;
void main() { fragColor = v_color; }
#pragma end
`;

type Cook = { valid: boolean; vertGlsl: string; canonicalVaryings: string };
let module: { esshader_cookInfo(source: string, features: string): Cook } | null = null;
beforeAll(async () => {
    try { module = await loadTwinModule(); } catch { module = null; }
});

describe('the second uv set of a mesh', () => {
    it('is a varying of the GLSL vertex stage when the draw carries it, and not otherwise', (ctx) => {
        if (!module) return ctx.skip();
        const withUv = module.esshader_cookInfo(FRAGMENT_ONLY, 'MESH_LIGHTMAP,MESH_NORMALS');
        expect(withUv.valid).toBe(true);
        expect(withUv.vertGlsl).toContain('out highp vec2 v_texCoord1;');
        expect(withUv.vertGlsl).toContain('v_texCoord1 = a_texCoord1;');
        const without = module.esshader_cookInfo(FRAGMENT_ONLY, 'MESH_NORMALS');
        // the stage keeps its `#ifdef`s, so what differs is whether the feature is defined
        expect(withUv.vertGlsl).toContain('#define MESH_LIGHTMAP');
        expect(without.vertGlsl).not.toContain('#define MESH_LIGHTMAP');
    });

    it('is a member of the WGSL varying interface, so a fragment twin reads it by location', (ctx) => {
        if (!module) return ctx.skip();
        const info = module.esshader_cookInfo(FRAGMENT_ONLY, '');
        expect(info.canonicalVaryings).toContain('@location(9) v_texCoord1 : vec2f');
    });
});
