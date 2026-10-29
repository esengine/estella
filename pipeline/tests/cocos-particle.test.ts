// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A Cocos particle system as the engine's ParticleEmitter.
 *
 * The data below is the shape of a real system (a stun effect from the client project): constants, a burst, a cone, a colour fade and a size
 * curve. The output is checked against the engine's own validator, since the offline document validators do not look at field types.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import path from 'node:path';
import { ImportReport } from '../src/import/cocos/report';
import { curveRange, particleSystem, type ParticleContext } from '../src/import/cocos/particle';

const SDK = path.resolve(__dirname, '../../sdk/src');
type Validate = (name: string, defaults: unknown, data: unknown, assetFields?: unknown) => { field: string; expected: string; value: unknown }[];
let validate: Validate;
let registry: Record<string, { _default: unknown; assetFields?: unknown }>;

beforeAll(async () => {
    validate = (await import(/* @vite-ignore */ path.join(SDK, 'util/validation.ts'))).validateComponentData as Validate;
    registry = await import(/* @vite-ignore */ path.join(SDK, 'ecs/component.ts'));
});

const constant = (c: number) => ({ __type__: 'cc.CurveRange', mode: 0, constant: c, multiplier: 1 });
const between = (a: number, b: number) => ({ __type__: 'cc.CurveRange', mode: 3, constantMin: a, constantMax: b, multiplier: 1 });
const curve = (values: Array<[number, number]>, multiplier = 1) => ({
    __type__: 'cc.CurveRange', mode: 1, multiplier, spline: { _values: values.map(([time, value]) => ({ time, value })) },
});
const rgba = (r: number, g: number, b: number, a: number) => ({ __type__: 'cc.Color', r, g, b, a });

function system(over: Record<string, unknown> = {}) {
    return {
        enabled: true,
        data: {
            startColor: { _mode: 0, color: rgba(255, 191, 112, 255) },
            startSize: constant(0.6), startSpeed: between(1, 3), startRotationZ: constant(0), startLifetime: constant(1),
            duration: 1, loop: false, playOnAwake: true, gravityModifier: constant(0.5), rateOverTime: constant(0),
            bursts: [{ _time: 0, count: constant(12), repeatInterval: 0.5 }], _capacity: 30, _simulationSpace: 0,
            _shapeModule: { _enable: true, _shapeType: 2, radius: 0.5, angle: 20 },
            _colorOverLifetimeModule: {
                _enable: true,
                color: { _mode: 1, gradient: { colorKeys: [{ time: 0, color: rgba(255, 255, 255, 255) }, { time: 1, color: rgba(255, 128, 0, 255) }], alphaKeys: [{ time: 0, alpha: 255 }, { time: 1, alpha: 0 }] } },
            },
            _sizeOvertimeModule: { _enable: true, size: curve([[0, 1], [1, 0.5]]) },
            _materials: [{ __uuid__: 'mat' }],
            ...over,
        },
    };
}

function convert(over: Record<string, unknown> = {}) {
    const report = new ImportReport();
    const ctx: ParticleContext = {
        report,
        material: () => ({ texture: null, additive: true }),
        assetRef: () => 'assets/cocos/spark.png',
    };
    const out = particleSystem(system(over), ctx, 'fx.prefab');
    return { out, report: report.toJSON() };
}

describe('a particle system', () => {
    it('becomes an emitter with the data the engine accepts', () => {
        const { out } = convert();
        expect(out.type).toBe('ParticleEmitter');
        const def = registry.ParticleEmitter;
        expect(def).toBeDefined();
        const errors = validate('ParticleEmitter', def!._default, out.data, def!.assetFields);
        expect(errors).toEqual([]);
    });

    it('carries emission, lifetime, speed, size, gravity and space', () => {
        const d = convert().out.data as Record<string, any>;
        expect(d.maxParticles).toBe(30);
        expect(d.looping).toBe(false);
        expect(d.burstCount).toBe(12);
        expect(d.burstInterval).toBe(0.5);
        expect([d.speedMin, d.speedMax]).toEqual([1, 3]);
        expect(d.lifetimeMin).toBe(1);
        expect(d.gravity.y).toBeCloseTo(-4.9, 5);
        expect(d.simulationSpace).toBe(1);   // Cocos Local is the engine's Local (1)
        expect(d.shape).toBe(3);             // Cone
        expect(d.shapeRadius).toBe(0.5);
        expect(d.blendMode).toBe(1);
    });

    it('eases the colour and the size from their values at the two ends of a life', () => {
        const d = convert().out.data as Record<string, any>;
        expect(d.startColor.a).toBeCloseTo(1, 5);
        expect(d.endColor.a).toBeCloseTo(0, 5);
        expect(d.endColor.g).toBeCloseTo((191 / 255) * (128 / 255), 4);
        expect([d.startSizeMin, d.endSizeMin]).toEqual([0.6, 0.3]);
    });

    it('keeps a fade that rises and falls as a gradient the sim samples by age, and a size curve as keys', () => {
        const fade = { _mode: 1, gradient: { colorKeys: [], alphaKeys: [{ time: 0, alpha: 0 }, { time: 0.5, alpha: 255 }, { time: 1, alpha: 0 }] } };
        const swell = curve([[0, 0.2], [0.5, 1], [1, 0.1]]);
        const { out, report } = convert({ _colorOverLifetimeModule: { _enable: true, color: fade }, _sizeOvertimeModule: { _enable: true, size: swell } });
        const d = out.data as Record<string, any>;
        expect(d.colorGradient.stops.map((s: any) => [s.t, Math.round(s.color.a * 100) / 100])).toEqual([[0, 0], [0.5, 1], [1, 0]]);
        expect(d.sizeCurve.keys.map((k: any) => [k.time, k.value])).toEqual([[0, 0.2], [0.5, 1], [1, 0.1]]);
        expect(report.components['cc.ParticleSystem']).toEqual({ mapped: 1, partial: 0, unmapped: 0 });
        const def = registry.ParticleEmitter!;
        expect(validate('ParticleEmitter', def._default, d, def.assetFields)).toEqual([]);
    });

    it('maps a stretched billboard with its scales, and counts the render modes it cannot draw', () => {
        const stretched = convert({ renderer: { _renderMode: 1, _velocityScale: 1, _lengthScale: 7 } });
        const d = stretched.out.data as Record<string, any>;
        expect([d.renderMode, d.velocityScale, d.lengthScale]).toEqual([1, 1, 7]);
        expect(stretched.report.components['cc.ParticleSystem']).toEqual({ mapped: 1, partial: 0, unmapped: 0 });
        const def = registry.ParticleEmitter!;
        expect(validate('ParticleEmitter', def._default, d, def.assetFields)).toEqual([]);

        const mesh = convert({ renderer: { _renderMode: 4 } });
        expect(mesh.report.notes['particle-render-mode']?.count).toBe(1);
        expect((mesh.out.data as Record<string, any>).renderMode).toBeUndefined();
    });

    it('counts the modules the emitter has no field for', () => {
        const { report } = convert({ _noiseModule: { _enable: true }, _trailModule: { _enable: true } });
        expect(report.notes['particle-noise']?.count).toBe(1);
        expect(report.notes['particle-trail']?.count).toBe(1);
    });

    it('is fully mapped when nothing was left out', () => {
        const { report } = convert();
        expect(report.components['cc.ParticleSystem']).toEqual({ mapped: 1, partial: 0, unmapped: 0 });
    });
});

describe('a curve range', () => {
    it('is read as a constant, two constants, or a curve at the asked time', () => {
        expect(curveRange(constant(2), 0)).toEqual({ min: 2, max: 2 });
        expect(curveRange(between(1, 3), 0)).toEqual({ min: 1, max: 3 });
        expect(curveRange(curve([[0, 0], [1, 10]], 2), 0.5).min).toBeCloseTo(10, 5);
    });
});
