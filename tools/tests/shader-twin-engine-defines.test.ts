// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A twin carries both branches of a symbol the ENGINE defines when it assembles the shader (MESH_NORMALS, ES_GBUFFER), not
 *        only of the switches and features the shader declares. Translated without them, a Lit mesh shader's twin took the 2D branch
 *        for good: it read a flat normal and drew unlit on WebGPU while the same shader was shaded on WebGL.
 */
import { describe, it, expect, beforeAll } from 'vitest';
// @ts-expect-error — a repo tool, shipped as .mjs with no declarations
import { deriveTwin, loadTwinModule, testedSymbols } from '../gen-shader-twins.mjs';

const LIT = `#pragma shader "LitNormalTest"
#pragma version 300 es
#pragma domain Lit

#pragma fragment
precision highp float;
in vec4 v_color;
in vec2 v_texCoord;
in highp vec2 v_worldPos;
#ifdef MESH_NORMALS
in highp vec3 v_worldNormal;
in highp vec3 v_worldXYZ;
#endif
out vec4 fragColor;
void main() {
#ifdef MESH_NORMALS
    vec3 N = normalize(v_worldNormal);
#else
    vec3 N = vec3(0.0, 0.0, 1.0);
#endif
    fragColor = vec4(v_color.rgb * max(N.y, 0.0), 1.0);
}
#pragma end
`;

describe('testedSymbols', () => {
    it('names what the authored GLSL tests and does not define itself', () => {
        const src = `#pragma fragment
#define OWN 1
#ifdef MESH_NORMALS
#endif
#ifndef ES_GBUFFER
#endif
#if defined(SKINNED) && defined(OWN)
#endif
#if LIT
#endif
#if __VERSION__ > 300
#endif
#ifdef GL_ES
#endif
#pragma end
#pragma fragment wgsl
#ifdef ONLY_IN_WGSL
#endif
#pragma end
`;
        expect(testedSymbols(src)).toEqual(['MESH_NORMALS', 'ES_GBUFFER', 'SKINNED', 'LIT']);
    });

    it('is nothing for a shader that tests nothing', () => {
        expect(testedSymbols('#pragma fragment\nvoid main() {}\n#pragma end\n')).toEqual([]);
    });
});

let module: unknown = null;
beforeAll(async () => {
    try { module = await loadTwinModule(); } catch { module = null; }
});

describe('the twin of a Lit mesh shader', () => {
    it('reads the mesh normal where the engine defines MESH_NORMALS, and the flat one where it does not', async (ctx) => {
        if (!module) return ctx.skip();
        const r = await deriveTwin(module, LIT, {});
        expect(r.status).toBe('generated');
        const frag = /#pragma fragment wgsl full\n([\s\S]*?)#pragma end/.exec(r.text)![1]!;
        expect(frag).toContain('#ifdef MESH_NORMALS');
        const [on, off] = frag.split('#else');
        expect(on).toContain('v_worldNormal');
        expect(off).not.toContain('v_worldNormal');
        // The engine's own parser takes the twin with the symbol defined, as it assembles a mesh draw.
        expect((module as { esshader_cookInfo(s: string, f: string): { valid: boolean } }).esshader_cookInfo(r.text, 'MESH_NORMALS').valid).toBe(true);
    });
});
