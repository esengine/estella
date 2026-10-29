// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  `cc.ParticleSystem` as the engine's `ParticleEmitter`.
 *
 * Cocos describes a system as a main block plus optional modules (shape, size/colour/rotation over lifetime, texture animation, ...), each
 * value a range that is a constant, two constants, or a curve. The emitter carries a start and an end value per quantity, and for a
 * colour or size that changes in more than a straight line, an authored gradient (`colorGradient`) or curve (`sizeCurve`) that the sim
 * samples by age. What the emitter has no field for is counted, so the gap is a list.
 */
import type { CocosAssetEntry } from './assets';
import type { ImportReport } from './report';

type Raw = Record<string, unknown>;
const isObj = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);

export interface ParticleContext {
    report: ImportReport;
    /** A material's main texture and whether it blends additively; null when the project has no such material. */
    material?(uuid: string): { texture: CocosAssetEntry | null; additive: boolean } | null;
    assetRef(entry: CocosAssetEntry): string;
}

export interface Range { min: number; max: number }

/** One keyframe track's value at time @p t (0..1), linear between the keys. */
function sampleKeys(keys: Array<{ time: number; value: number }>, t: number): number {
    if (keys.length === 0) return 0;
    const sorted = [...keys].sort((a, b) => a.time - b.time);
    if (t <= sorted[0]!.time) return sorted[0]!.value;
    const last = sorted[sorted.length - 1]!;
    if (t >= last.time) return last.value;
    for (let i = 1; i < sorted.length; i++) {
        const b = sorted[i]!;
        if (t <= b.time) {
            const a = sorted[i - 1]!;
            const f = b.time === a.time ? 0 : (t - a.time) / (b.time - a.time);
            return a.value + (b.value - a.value) * f;
        }
    }
    return last.value;
}

function splineAt(spline: unknown, t: number): number | null {
    if (!isObj(spline)) return null;
    const values = spline._values;
    if (!Array.isArray(values)) return null;
    const keys = values.filter(isObj).map((k) => ({ time: num(k.time, 0), value: num(k.value, 0) }));
    return keys.length ? sampleKeys(keys, t) : null;
}

/** A `cc.CurveRange` evaluated at time @p t of its domain (emission time for a start value, lifetime for an over-lifetime one). */
export function curveRange(v: unknown, t: number, fallback = 0): Range {
    if (!isObj(v)) return { min: fallback, max: fallback };
    const mult = num(v.multiplier, 1);
    switch (num(v.mode, 0)) {
        case 1: {
            const s = splineAt(v.spline, t);
            return s === null ? { min: fallback, max: fallback } : { min: s * mult, max: s * mult };
        }
        case 2: {
            const a = splineAt(v.splineMin, t);
            const b = splineAt(v.splineMax, t);
            return a === null || b === null ? { min: fallback, max: fallback } : { min: a * mult, max: b * mult };
        }
        case 3: {
            const lo = num(v.constantMin, fallback);
            const hi = num(v.constantMax, fallback);
            return { min: Math.min(lo, hi), max: Math.max(lo, hi) };
        }
        default: {
            const c = num(v.constant, fallback);
            return { min: c, max: c };
        }
    }
}

type Rgba = [number, number, number, number];

function colorOf(v: unknown): Rgba {
    const c = isObj(v) ? v : {};
    return [num(c.r, 255) / 255, num(c.g, 255) / 255, num(c.b, 255) / 255, num(c.a, 255) / 255];
}

/** A `cc.Gradient` at time @p t. Colour and alpha have their own keys. */
function gradientAt(g: unknown, t: number): Rgba {
    if (!isObj(g)) return [1, 1, 1, 1];
    const ck = (Array.isArray(g.colorKeys) ? g.colorKeys : []).filter(isObj).map((k) => ({ time: num(k.time, 0), c: colorOf(k.color) }));
    const ak = (Array.isArray(g.alphaKeys) ? g.alphaKeys : []).filter(isObj).map((k) => ({ time: num(k.time, 0), value: num(k.alpha, 255) / 255 }));
    const rgb: [number, number, number] = [1, 1, 1];
    for (let i = 0; i < 3; i++) rgb[i] = ck.length ? sampleKeys(ck.map((k) => ({ time: k.time, value: k.c[i]! })), t) : 1;
    return [rgb[0], rgb[1], rgb[2], ak.length ? sampleKeys(ak, t) : 1];
}

/** A `cc.GradientRange` at time @p t: a colour, or the gradient (or the first of a pair of them). */
function gradientRange(v: unknown, t: number): Rgba {
    if (!isObj(v)) return [1, 1, 1, 1];
    switch (num(v._mode, 0)) {
        case 1: return gradientAt(v.gradient, t);
        case 2: return colorOf(v.colorMin);
        case 3: return gradientAt(v.gradientMin, t);
        case 4: return gradientAt(v.gradient, t);
        default: return colorOf(v.color);
    }
}

const mid = (r: Range): number => (r.min + r.max) / 2;

/** The times at which a gradient range changes, ends included, in order. */
function gradientTimes(v: unknown): number[] {
    const times = new Set<number>([0, 1]);
    if (isObj(v)) {
        for (const g of [v.gradient, v.gradientMin]) {
            if (!isObj(g)) continue;
            for (const list of [g.colorKeys, g.alphaKeys]) {
                for (const k of Array.isArray(list) ? list : []) {
                    if (isObj(k)) times.add(Math.min(1, Math.max(0, num(k.time, 0))));
                }
            }
        }
    }
    return [...times].sort((a, b) => a - b);
}

/** The colour over a particle's life: the start colour times the over-lifetime gradient, as stops the sim samples by age. */
function colorStops(start: Rgba, over: unknown): Array<{ t: number; color: Raw }> {
    return gradientTimes(over).map((t) => {
        const g = gradientRange(over, t);
        return { t, color: { r: start[0] * g[0], g: start[1] * g[1], b: start[2] * g[2], a: start[3] * g[3] } };
    });
}

/** A size-over-lifetime curve as the engine's keyframes (value times the start size). Two curves are averaged at every key time. */
function sizeKeys(v: unknown): Array<{ time: number; value: number; inTangent: number; outTangent: number }> | null {
    if (!isObj(v)) return null;
    const mode = num(v.mode, 0);
    const mult = num(v.multiplier, 1);
    const read = (spline: unknown): Array<{ time: number; value: number; inTangent: number; outTangent: number }> | null => {
        if (!isObj(spline) || !Array.isArray(spline._values)) return null;
        const keys = spline._values.filter(isObj).map((k) => ({
            time: num(k.time, 0), value: num(k.value, 0) * mult, inTangent: num(k.inTangent, 0) * mult, outTangent: num(k.outTangent, 0) * mult,
        }));
        return keys.length ? keys : null;
    };
    if (mode === 1) return read(v.spline);
    if (mode === 2) {
        const lo = read(v.splineMin);
        const hi = read(v.splineMax);
        if (!lo || !hi) return lo ?? hi;
        const times = [...new Set([...lo, ...hi].map((k) => k.time))].sort((a, b) => a - b);
        return times.map((time) => ({ time, value: (sampleKeys(lo, time) + sampleKeys(hi, time)) / 2, inTangent: 0, outTangent: 0 }));
    }
    const k = mid(curveRange(v, 0, 1));
    return [{ time: 0, value: k, inTangent: 0, outTangent: 0 }, { time: 1, value: k, inTangent: 0, outTangent: 0 }];
}

/** Cocos's emitter shapes in the engine's numbering. */
const SHAPE: Record<number, number> = { 0: 2 /* Box */, 1: 1 /* Circle */, 2: 3 /* Cone */, 3: 4 /* Sphere */, 4: 5 /* Hemisphere */ };

export function particleSystem(c: { enabled: boolean; data: Raw }, ctx: ParticleContext, where: string): { type: string; data: Raw } {
    const d = c.data;
    const note = (code: string): void => ctx.report.note(code, where);
    let partial = false;
    const lose = (code: string): void => { partial = true; note(code); };

    const lifetime = curveRange(d.startLifetime, 0, 1);
    const speed = curveRange(d.startSpeed, 0, 0);
    const size = curveRange(d.startSize, 0, 1);
    const rotation = curveRange(d.startRotationZ ?? d.startRotation, 0, 0);
    const rate = curveRange(d.rateOverTime, 0, 0);
    const gravity = curveRange(d.gravityModifier, 0, 0);

    const out: Raw = {
        enabled: c.enabled,
        looping: d.loop === true,
        playOnStart: d.playOnAwake !== false,
        duration: num(d.duration, 5),
        maxParticles: Math.max(1, Math.trunc(num(d._capacity, 100))),
        rate: mid(rate),
        lifetimeMin: lifetime.min,
        lifetimeMax: lifetime.max,
        speedMin: speed.min,
        speedMax: speed.max,
        startSizeMin: size.min,
        startSizeMax: size.max,
        rotationMin: rotation.min,
        rotationMax: rotation.max,
        gravity: { x: 0, y: -9.8 * mid(gravity), z: 0 },
        simulationSpace: num(d._simulationSpace, 1) === 0 ? 1 /* Local */ : 0 /* World */,
    };
    if (num(d.simulationSpeed, 1) !== 1) lose('particle-simulation-speed');
    if (mid(curveRange(d.startDelay, 0, 0)) > 0) lose('particle-start-delay');
    if (mid(curveRange(d.rateOverDistance, 0, 0)) > 0) lose('particle-rate-over-distance');

    // colour: the start colour times the over-lifetime gradient, sampled by age
    const start = gradientRange(d.startColor, 0);
    const colorModule = isObj(d._colorOverLifetimeModule) && d._colorOverLifetimeModule._enable === true ? d._colorOverLifetimeModule : null;
    const stops = colorStops(start, colorModule?.color);
    out.startColor = stops[0]!.color;
    out.endColor = stops[stops.length - 1]!.color;
    if (colorModule && stops.length > 2) out.colorGradient = { stops };

    // size over lifetime multiplies the start size by the curve's value at the particle's age
    const sizeModule = isObj(d._sizeOvertimeModule) && d._sizeOvertimeModule._enable === true ? d._sizeOvertimeModule : null;
    out.endSizeMin = size.min;
    out.endSizeMax = size.max;
    const keys = sizeModule ? sizeKeys(sizeModule.size) : null;
    if (keys) {
        out.sizeCurve = { keys };
        const end = sampleKeys(keys, 1);
        out.endSizeMin = size.min * end;
        out.endSizeMax = size.max * end;
    }

    const rotationModule = isObj(d._rotationOvertimeModule) && d._rotationOvertimeModule._enable === true ? d._rotationOvertimeModule : null;
    if (rotationModule) {
        const spin = curveRange(rotationModule.z, 0, 0);
        out.angularVelocityMin = spin.min;
        out.angularVelocityMax = spin.max;
    }

    // where particles start
    const shape = isObj(d._shapeModule) && d._shapeModule._enable === true ? d._shapeModule : null;
    if (shape) {
        out.shape = SHAPE[num(shape._shapeType, 2)] ?? 3;
        out.shapeRadius = num(shape.radius, 1);
        out.shapeAngle = num(shape.angle, 25);
        const scale = isObj(shape._scale) ? shape._scale : isObj(shape.scale) ? shape.scale : null;
        if (scale) out.shapeSize = { x: num(scale.x, 1), y: num(scale.y, 1), z: num(scale.z, 1) };
    } else {
        out.shape = 0; // Point
    }

    // bursts: the engine repeats one burst on an interval
    const bursts = (Array.isArray(d.bursts) ? d.bursts : []).filter(isObj);
    if (bursts.length > 0) {
        const b = bursts[0]!;
        out.burstCount = Math.round(mid(curveRange(b.count, 0, 0)));
        out.burstInterval = Math.max(num(b.repeatInterval, 1), 0.01);
        if (bursts.length > 1 || num(b._time, 0) > 0) lose('particle-bursts');
    }

    // a sheet of frames played over a life
    const sheet = isObj(d._textureAnimationModule) && d._textureAnimationModule._enable === true ? d._textureAnimationModule : null;
    if (sheet) {
        const cols = Math.max(1, Math.trunc(num(sheet.numTilesX, 1)));
        const rows = Math.max(1, Math.trunc(num(sheet.numTilesY, 1)));
        out.spriteColumns = cols;
        out.spriteRows = rows;
        out.spriteFPS = (cols * rows * Math.max(1, num(sheet.cycleCount, 1))) / Math.max(mid(lifetime), 0.001);
    }

    // the material says what is drawn and how it blends
    const matUuid = ((Array.isArray(d._materials) ? d._materials[0] : undefined) as Raw | undefined)?.__uuid__;
    const material = typeof matUuid === 'string' ? ctx.material?.(matUuid) ?? null : null;
    if (material) {
        if (material.texture) out.texture = ctx.assetRef(material.texture);
        out.blendMode = material.additive ? 1 : 0;
    } else {
        lose('particle-no-material');
    }

    for (const [module, code] of [
        ['_velocityOvertimeModule', 'particle-velocity-over-time'], ['_forceOvertimeModule', 'particle-force-over-time'],
        ['_limitVelocityOvertimeModule', 'particle-limit-velocity'], ['_noiseModule', 'particle-noise'], ['_trailModule', 'particle-trail'],
    ] as const) {
        const m = d[module];
        if (isObj(m) && m._enable === true) lose(code);
    }
    const renderer = isObj(d.renderer) ? d.renderer : null;
    const renderMode = renderer ? num(renderer._renderMode, 0) : 0;
    if (renderMode === 1) {
        out.renderMode = 1; // Stretched
        out.velocityScale = num(renderer?._velocityScale, 0);
        out.lengthScale = num(renderer?._lengthScale, 1);
    } else if (renderMode !== 0) {
        lose('particle-render-mode'); // horizontal, vertical and mesh particles have no counterpart
    }

    ctx.report.component('cc.ParticleSystem', partial ? 'partial' : 'mapped');
    return { type: 'ParticleEmitter', data: out };
}
