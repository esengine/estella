// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, expect, it } from 'vitest';
import { MODEL } from '../src/render/builtinShaders';
import { deriveVoxelGround } from '../src/voxel/voxelShader';

/** The material texture params a shader declares: each takes one of a handful of units, and one past the last gets none. */
const textureParams = (source: string): string[] =>
    [...source.matchAll(/^#pragma param (\w+) texture/gm)].map((m) => m[1]!);

describe('Voxel Ground, derived from the Model shader', () => {
    const derived = deriveVoxelGround(MODEL);

    it('declares no more textures than a shader has units for', () => {
        // What the Model shader gains, Voxel Ground (which adds three maps of its own) must give up, or its last texture is dropped
        // and the shader no longer compiles on WebGPU.
        expect(textureParams(derived).length).toBeLessThanOrEqual(7);
    });

    it('has no wet map to read, and nothing in either language still names one', () => {
        expect(textureParams(derived)).not.toContain('u_wetMask');
        expect(derived).not.toMatch(/textureLod\(u_wetMask|u_wetMask_s/);
    });

    it('keeps the three materials it lays by world position', () => {
        expect(textureParams(derived)).toEqual(expect.arrayContaining(['u_voxelMap1', 'u_voxelMap2', 'u_voxelMap3']));
    });
});
