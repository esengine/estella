// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, expect, it } from 'vitest';
import { MODEL } from '../src/render/builtinShaders';
import { deriveGroundBlend } from '../src/render/groundBlendShader';
import { deriveVoxelGround } from '../src/voxel/voxelShader';
import { hasWgslTwin } from '../src/render/modelDetail';

/** MODEL as a package that draws only through WebGL ships it: its WGSL sections cut (pipeline/src/bundle/glOnlyShaders.ts). */
const glOnly = (s: string) => s.replace(/^[ \t]*#pragma (?:vertex|fragment|vertexoffset) wgsl[^\n]*\n[\s\S]*?^[ \t]*#pragma end[^\n]*\n?/gm, '');

describe('shaders made from Model, in a package with no WGSL', () => {
    it('are made from its GLSL alone, which is the same GLSL the full source makes', () => {
        const model = glOnly(MODEL);
        expect(hasWgslTwin(MODEL)).toBe(true);
        expect(hasWgslTwin(model)).toBe(false);
        for (const derive of [deriveGroundBlend, deriveVoxelGround]) {
            const gl = derive(model);
            expect(hasWgslTwin(gl)).toBe(false);
            expect(gl).toBe(glOnly(derive(MODEL)));
        }
    });
});
