// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A light's colour reaches a bake as the frame lights with it: linearized
 *        in a linear project, as written in a gamma one.
 */
import { describe, it, expect } from 'vitest';
import { bakeLightOf } from '../src/lightmap';

const GREY = { type: 1, color: { r: 0.5, g: 0.5, b: 0.5, a: 1 }, intensity: 2 };
const AT: [number, number, number] = [0, 0, 0];
const FACING = { x: 0, y: 0, z: 0, w: 1 };

describe('a baked light\'s colour', () => {
    it('is linearized in a linear project, as the frame does', () => {
        expect(bakeLightOf(GREY, AT, FACING, true)?.lamp?.color[0]).toBeCloseTo(0.21404, 4);
        expect(bakeLightOf({ ...GREY, type: 2 }, AT, FACING, true)?.ambient?.[0]).toBeCloseTo(0.42808, 4);
    });

    it('is taken as written in a gamma project', () => {
        expect(bakeLightOf(GREY, AT, FACING, false)?.lamp?.color[0]).toBe(0.5);
    });
});
