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

    it('declares no more textures than a Lit mesh shader has units for', () => {
        // Seven material units and unit 1, the one engine unit a shader that reads only its base texture leaves (ShaderParser::materialOverflowUnits).
        expect(textureParams(derived).length).toBeLessThanOrEqual(8);
    });

    it('reads the wet map as other ground does, in both languages', () => {
        expect(textureParams(derived)).toContain('u_wetMask');
        expect(derived).toMatch(/textureLod\(u_wetMask/);
        expect(derived).toMatch(/u_wetMask_s/);
    });

    it('keeps the three materials it lays by world position', () => {
        expect(textureParams(derived)).toEqual(expect.arrayContaining(['u_voxelMap1', 'u_voxelMap2', 'u_voxelMap3']));
    });
});
