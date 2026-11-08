// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { ImportedNode } from './modelImport';

/** Bounded, data-only bridge schema; extras never instantiate arbitrary components or code. */
export function readGltfParticle(extras: unknown, name: string, warnings: string[]): ImportedNode['particle'] {
    const raw = (extras as any)?.estella?.particle;
    if (!raw) return undefined;
    const emitter: Record<string, unknown> = {}, units: Record<string, unknown> = {};
    const fail = () => { warnings.push(name + ': invalid estella particle data; emitter skipped'); return undefined; };
    if (!raw.emitter || !raw.units || typeof raw.emitter !== 'object' || typeof raw.units !== 'object') return fail();
    for (const key of ['maxParticles', 'rate', 'duration', 'lifetimeMin', 'lifetimeMax', 'shape', 'shapeRadius', 'renderMode', 'blendMode']) {
        const v = raw.emitter[key];
        if (!Number.isFinite(v) || v < 0) return fail();
        emitter[key] = v;
    }
    if (!Number.isInteger(emitter.maxParticles) || Number(emitter.maxParticles) < 1 || Number(emitter.maxParticles) > 16384
        || ![0,1,2,3,4,5].includes(Number(emitter.shape)) || ![0,1].includes(Number(emitter.renderMode))
        || !Number.isInteger(emitter.blendMode) || Number(emitter.blendMode) > 9) return fail();
    if (Number(emitter.lifetimeMax) < Number(emitter.lifetimeMin) || Number(emitter.lifetimeMax) <= 0) return fail();
    for (const key of ['looping', 'playOnStart', 'enabled']) emitter[key] = raw.emitter[key] === true;
    emitter.simulationSpace = 0;
    const vector = (v: any, keys: string[]) => v && keys.every(k => Number.isFinite(v[k]));
    for (const [key, keys] of [['shapeSize', ['x','y','z']], ['startColor',['r','g','b','a']], ['endColor',['r','g','b','a']]] as const) {
        if (!vector(raw.emitter[key], [...keys])) return fail();
        emitter[key] = Object.fromEntries(keys.map(k => [k, raw.emitter[key][k]]));
    }
    for (const key of ['startSizeMin','startSizeMax','endSizeMin','endSizeMax','speedMin','speedMax']) {
        if (!Number.isFinite(raw.units[key]) || raw.units[key] < 0) return fail();
        units[key] = raw.units[key];
    }
    if (!vector(raw.units.gravity, ['x','y','z'])) return fail();
    units.gravity = { x: raw.units.gravity.x, y: raw.units.gravity.y, z: raw.units.gravity.z };
    if (Array.isArray(raw.emitter.bursts)) {
        if (raw.emitter.bursts.length > 256 || !raw.emitter.bursts.every((b: any) => b && Number.isFinite(b.time) && b.time >= 0
            && Number.isInteger(b.count) && b.count >= 0 && b.count <= Number(emitter.maxParticles))) return fail();
        emitter.bursts = raw.emitter.bursts.map((b: any) => ({ time: b.time, count: b.count }));
    }
    if (raw.emitter.sizeCurve) {
        const keys = raw.emitter.sizeCurve.keys;
        if (!Array.isArray(keys) || keys.length > 256 || !keys.every((k: any) => k && Number.isFinite(k.time) && k.time >= 0 && k.time <= 1 && Number.isFinite(k.value) && k.value >= 0)) return fail();
        emitter.sizeCurve = { keys: keys.map((k: any) => ({ time: k.time, value: k.value, interpolation: 'linear' })) };
    }
    if (raw.emitter.colorGradient) {
        const stops = raw.emitter.colorGradient.stops;
        if (!Array.isArray(stops) || stops.length > 256 || !stops.every((s: any) => s && Number.isFinite(s.t) && s.t >= 0 && s.t <= 1 && vector(s.color,['r','g','b','a']))) return fail();
        emitter.colorGradient = { stops: stops.map((s: any) => ({ t: s.t, color: { r:s.color.r,g:s.color.g,b:s.color.b,a:s.color.a } })) };
    }
    return { emitter, units };
}
