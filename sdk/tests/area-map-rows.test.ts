// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    area-map-rows.test.ts
 * @brief   Every image laid over an area has its first row along the least z, whether a system reads it or a shader samples it.
 */
import { describe, expect, it } from 'vitest';
import { densityAt, type DensityMap } from '../src/foliage/cellBuild';
import { FOLIAGE_SHADER_TEMPLATE } from '../src/foliage/foliageShader';
import { TERRAIN_LAYERS_SHADER_TEMPLATE, TERRAIN_SHADER_TEMPLATE } from '../src/terrain/terrainShader';

describe('the rows of an image over an area', () => {
    it('a map a system reads has its first row at the least z', () => {
        const map: DensityMap = { width: 1, height: 2, values: new Uint8Array([255, 0]), originX: 0, originZ: 0, sizeX: 10, sizeZ: 10 };
        expect(densityAt(map, 5, 1)).toBeGreaterThan(0.8);
        expect(densityAt(map, 5, 9)).toBeLessThan(0.2);
    });

    it('a map a shader samples is read with v turned, in both languages, and never straight', () => {
        for (const [source, coords] of [[TERRAIN_SHADER_TEMPLATE.source, ['over', 'under']], [TERRAIN_LAYERS_SHADER_TEMPLATE.source, ['over', 'under']],
                                        [FOLIAGE_SHADER_TEMPLATE.source, ['over']]] as const) {
            for (const at of coords) {
                expect(source).toContain(`vec2(${at}.x, 1.0 - ${at}.y)`);
                expect(source).toContain(`vec2f(${at}.x, 1.0 - ${at}.y)`);
                expect(source).not.toContain(`, ${at}, 0.0)`);
                expect(source).not.toContain(`, ${at})`);
            }
        }
    });

    it('a layer read from the side takes its height through the strata warp, in both languages, and the warp is off by default', () => {
        const source = TERRAIN_LAYERS_SHADER_TEMPLATE.source;
        expect(source).toContain('#pragma param u_strataWarp float default(0)');
        // The ground is handed to the shared layer code with the bed's height in place of its own, and the sides read (z, y) and (x, y) of it.
        for (const read of ['tnLayers(paintA, paintB, vec3(Pw.x, bedY, Pw.z)', 'tnLayers(paintA, paintB, vec3f(Pw.x, bedY, Pw.z)',
            'tnPlain(at.zy / tile', 'tnPlain(at.xy / tile']) {
            expect(source).toContain(read);
        }
        expect(source).not.toContain('tnPlain(Pw.zy');
        expect(source).not.toContain('tnPlain(Pw.xy');
        expect(source).toContain('if (u_strataWarp > 0.0) bedY +=');
        expect(source).toContain('if (mc.u_strataWarp > 0.0) { bedY = bedY +');
    });

    it('a hex cell is turned by no more than the material says, in both shaders and both languages', () => {
        for (const source of [TERRAIN_SHADER_TEMPLATE.source, TERRAIN_LAYERS_SHADER_TEMPLATE.source]) {
            expect(source).toContain('#pragma param u_antiTileTurn float default(1)');
            expect(source).toContain('float a = r.x * 6.2831853 * u_antiTileTurn;');
            expect(source).toContain('let a = r.x * 6.2831853 * mc.u_antiTileTurn;');
            expect(source).not.toContain('r.x * 6.2831853;');
        }
    });
});
