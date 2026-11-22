// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, expect, it } from 'vitest';
import { applyUnderwaterToEffects, setUnderwaterState, currentUnderwater, lensReach, type UnderwaterState } from '../src/postprocess/underwater';
import type { BlendedEffect } from '../src/postprocess/volumeBlending';

const state = (extra: Partial<UnderwaterState> = {}): UnderwaterState => ({
    amount: 1, depth: 40, absorption: [0.4, 0.1, 0.05], density: 0.02, scatter: [0.02, 0.2, 0.3],
    plane: [0, 1, 0, 5], band: 0.4, causticStrength: 0.6, causticScale: 2, causticSpeed: 0.35, ...extra,
});
const blank = (): BlendedEffect => ({ enabled: true, uniforms: new Map(), textures: new Map(), colors: new Map() });

describe('lensReach', () => {
    it('is a few near planes: how high above the surface part of the lens can still be in it', () => {
        expect(lensReach(1)).toBe(2.5);
        expect(lensReach(0.1)).toBeCloseTo(0.25, 10);
        expect(lensReach(-3)).toBe(0);
    });
});

describe('applyUnderwaterToEffects', () => {
    it('does nothing out of the water', () => {
        const effects = new Map<string, BlendedEffect>();
        applyUnderwaterToEffects(effects, null);
        applyUnderwaterToEffects(effects, state({ amount: 0 }));
        expect(effects.size).toBe(0);
    });

    it('brings the effect, with the water\'s own numbers, to a scene that authored none', () => {
        const effects = new Map<string, BlendedEffect>();
        applyUnderwaterToEffects(effects, state());
        const e = effects.get('underwater')!;
        expect(e.enabled).toBe(true);
        expect(e.uniforms.get('u_density')).toBe(0.02);
        expect(e.uniforms.get('u_amount')).toBe(1);
        expect(e.uniforms.get('u_cameraDepth')).toBe(40);
        expect(e.colors.get('u_absorption')).toEqual({ r: 0.4, g: 0.1, b: 0.05, a: 1 });
        expect(e.colors.get('u_scatterColor')).toEqual({ r: 0.02, g: 0.2, b: 0.3, a: 1 });
        // The waterline: where the surface is at the camera, and how soft the line across the lens is.
        expect([e.uniforms.get('u_planeNx'), e.uniforms.get('u_planeNy'), e.uniforms.get('u_planeNz'), e.uniforms.get('u_planeD')]).toEqual([0, 1, 0, 5]);
        expect(e.uniforms.get('u_band')).toBe(0.4);
        // The surface's caustics, so the camera sees the light the surface draws.
        expect([e.uniforms.get('u_causticStrength'), e.uniforms.get('u_causticScale'), e.uniforms.get('u_causticSpeed')]).toEqual([0.6, 2, 0.35]);
    });

    it('keeps explicit overrides and fills each missing optical property from the same body', () => {
        const authored = blank();
        authored.uniforms.set('u_density', 0.5);
        authored.uniforms.set('u_amount', 0.5);
        authored.colors.set('u_absorption', { r: 1, g: 1, b: 1, a: 1 });
        const effects = new Map<string, BlendedEffect>([['underwater', authored]]);
        applyUnderwaterToEffects(effects, state({ amount: 0.5, depth: 7 }));
        expect(authored.uniforms.get('u_density')).toBe(0.5);
        expect(authored.colors.get('u_absorption')).toEqual({ r: 1, g: 1, b: 1, a: 1 });
        expect(authored.colors.get('u_scatterColor')).toEqual({ r: 0.02, g: 0.2, b: 0.3, a: 1 });
        // The authored amount is a ceiling on how much the effect shows, and the camera's own submersion scales it.
        expect(authored.uniforms.get('u_amount')).toBeCloseTo(0.25, 10);
        expect(authored.uniforms.get('u_cameraDepth')).toBe(7);
    });

    it('inherits surface optics when the volume only adjusts the light shafts', () => {
        const effect = blank();
        effect.uniforms.set('u_shaftStrength', 0.18);
        applyUnderwaterToEffects(new Map([['underwater', effect]]), state());
        expect(effect.uniforms.get('u_shaftStrength')).toBe(0.18);
        expect(effect.uniforms.get('u_density')).toBe(0.02);
        expect(effect.colors.get('u_absorption')).toEqual({ r: 0.4, g: 0.1, b: 0.05, a: 1 });
    });

    it('leaves an effect the scene switched off alone', () => {
        const off = blank();
        off.enabled = false;
        const effects = new Map<string, BlendedEffect>([['underwater', off]]);
        applyUnderwaterToEffects(effects, state());
        expect(off.uniforms.size).toBe(0);
    });
});

describe('the reported state', () => {
    it('is what was last set, and none after null', () => {
        setUnderwaterState(state({ depth: 12 }));
        expect(currentUnderwater()?.depth).toBe(12);
        setUnderwaterState(null);
        expect(currentUnderwater()).toBeNull();
    });
});
