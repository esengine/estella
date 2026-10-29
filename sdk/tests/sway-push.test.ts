// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Plants that part for a body: which eight bodies the sway shader is told of, and that both shader languages lean a plant away from them.
 */
import { describe, expect, it } from 'vitest';
import { SWAY_PUSHERS, SWAY_PUSH_UNIFORMS, nearestPushers } from '../src/render/swayPush';
import { builtinShaderTemplate } from '../src/render/builtinShaders';

const body = (x: number, y: number, radius = 40, strength = 1) => ({ x, y, radius, strength });

describe('the bodies plants lean away from', () => {
    it('are the eight nearest the camera, nearest first, the rest left out', () => {
        const bodies = Array.from({ length: 12 }, (_, i) => body(100 * (i + 1), 0));
        const values = nearestPushers(bodies, { x: 0, y: 0 });
        expect(values).toHaveLength(SWAY_PUSHERS);
        expect(values.map((v) => v.x)).toEqual([100, 200, 300, 400, 500, 600, 700, 800]);
        expect(values[0]).toEqual({ x: 100, y: 0, z: 40, w: 1 });
    });

    it('fill the slots they do not use with a body that reaches nowhere', () => {
        const values = nearestPushers([body(5, 6, 30, 0.5)], { x: 0, y: 0 });
        expect(values[0]).toEqual({ x: 5, y: 6, z: 30, w: 0.5 });
        for (const v of values.slice(1)) expect(v).toEqual({ x: 0, y: 0, z: 0, w: 0 });
    });

    it('leave out a body with no reach or no strength', () => {
        const values = nearestPushers([body(1, 1, 0), body(2, 2, 40, 0), body(3, 3)], { x: 0, y: 0 });
        expect(values[0]!.x).toBe(3);
        expect(values[1]!.z).toBe(0);
    });
});

describe('the sway shader', () => {
    const source = builtinShaderTemplate('sprite-sway')!.source;

    it('declares the eight bodies, and leans a plant away from each in both languages', () => {
        for (const name of SWAY_PUSH_UNIFORMS) expect(source).toContain(`#pragma param ${name} vec4`);
        expect(source).toContain('#pragma param u_swayPushStrength');
        expect((source.match(/push \+= swayPush\(u_swayPush\d, v_worldPos\);/g) ?? []).length).toBe(8);
        expect((source.match(/push = push \+ swayPush\(mc\.u_swayPush\d, v\.v_worldPos\);/g) ?? []).length).toBe(8);
        // Away from the body is the way the gust already leans a plant, and the tip moves, not the foot.
        expect(source).toContain('- push.x * u_swayPushStrength * tip');
        expect(source).toContain('- push.x * mc.u_swayPushStrength * tip');
    });
});
