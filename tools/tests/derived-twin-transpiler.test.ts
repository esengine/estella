// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A shader the runtime's transpiler can write is served and cooked as its author wrote it: no WGSL is written into it here,
 *        since the device that draws through WebGPU writes the same as it compiles (esengine/wgsl).
 */
import { describe, it, expect } from 'vitest';
// @ts-expect-error — a repo tool, shipped as .mjs with no declarations
import { withDerivedTwin } from '../lib/derivedTwin.mjs';

const LIT = `#pragma shader "Served"
#pragma version 300 es
#pragma domain Lit
#pragma param u_tint color default(1,1,1,1)

#pragma fragment
precision highp float;
in vec4 v_color;
#ifdef MESH_NORMALS
in highp vec3 v_worldNormal;
#endif
out vec4 fragColor;
void main() {
#ifdef MESH_NORMALS
    vec3 N = normalize(v_worldNormal);
#else
    vec3 N = vec3(0.0, 0.0, 1.0);
#endif
    fragColor = vec4(v_color.rgb * u_tint.rgb * max(N.y, 0.2), 1.0);
}
#pragma end
`;

describe('withDerivedTwin', () => {
    it('hands on a shader the runtime transpiles as it was written, with no WGSL in it', async () => {
        const out: string = await withDerivedTwin(LIT);
        expect(out).toBe(LIT);
        expect(out).not.toContain('wgsl');
    });
});
