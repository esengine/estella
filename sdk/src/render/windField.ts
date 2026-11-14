// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  windField.ts
 * @brief The air moving things leave behind: a `WindWake` body's wake and a `WindBurst`'s pressure front, which plants answer a moment later.
 *
 * @details A contact (`FoliageContact`, `SwayPusher`) parts plants while it is beside them. A fast body does more: it shoves the air, and a plant
 *          it passed is pushed over, springs back past upright and rings down after it has gone; a blast's front reaches a plant only when it has
 *          travelled that far. Both are a shove at a known moment, so the plant's answer is a damped spring's response to it — a function of the
 *          time since the shove alone, worked out where the plant is drawn, with nothing kept from one frame to the next.
 *
 *          A wake leaves a pass every half radius it travels (where, when, its velocity, its reach); a burst is a centre, a moment, a speed, a
 *          strength and a reach. The newest `WIND_PASSES` passes and `WIND_FRONTS` fronts still ringing are written each frame to every material
 *          that declares them: the `Foliage` shader reads them on the ground (x, z) and `sprite-sway` in the picture's plane (x, y). `windLean`
 *          is the same arithmetic on the CPU, for whatever leans a plant there.
 */
import type { App } from '../app/app';
import type { Entity } from '../types';
import { defineComponent, Transform, type TransformData } from '../ecs/component';
import { defineSystem, Schedule } from '../ecs/system';
import { Query } from '../ecs/query';
import { Res, Time, type TimeData } from '../ecs/resource';
import { isEditor, isPlayMode } from '../ecs/env';
import { Material } from './material';
import {
    WIND_FRONTS, WIND_FRONT_P_UNIFORMS, WIND_FRONT_UNIFORMS, WIND_PASSES, WIND_PASS_UNIFORMS, WIND_PASS_V_UNIFORMS, WIND_RING, springAt,
} from './windFieldShader';

export {
    WIND_FIELD_GLSL, WIND_FIELD_PARAMS, WIND_FIELD_WGSL, WIND_FRONTS, WIND_FRONT_P_UNIFORMS, WIND_FRONT_UNIFORMS, WIND_PASSES,
    WIND_PASS_UNIFORMS, WIND_PASS_V_UNIFORMS, WIND_RING, springAt,
} from './windFieldShader';

/** The fields of the `WindWake` component. @experimental */
export interface WindWakeData {
    /** How far to each side of its path the body shoves the air, in world units. */
    radius: number;
    /** How hard, as a share of its own speed: 1 shoves the air as fast as the body moves. */
    strength: number;
    /** Off: it leaves no wake. */
    enabled: boolean;
}

/**
 * Leaves a wake in the air as this entity moves: plants it passes are pushed along its path, spring back and ring down after it has gone.
 *
 * @experimental
 */
export const WindWake = defineComponent<WindWakeData>('WindWake', { radius: 2, strength: 1, enabled: true }, {
    fields: {
        radius: { min: 0.01, unit: 'wu', tooltip: 'How far to each side of its path the body shoves the air.' },
        strength: { min: 0, max: 4, step: 0.01, tooltip: 'How hard, as a share of its own speed: 1 shoves the air as fast as the body moves.' },
    },
});

/** The fields of the `WindBurst` component. @experimental */
export interface WindBurstData {
    /** How hard the front shoves, in world units a second (the same measure as a wake's). */
    strength: number;
    /** How fast the front travels outward, in world units a second. */
    speed: number;
    /** How far it travels before it is spent, in world units. */
    reach: number;
}

/**
 * A pressure front from this entity's position the moment it appears: a ring that travels outward and pushes each plant over as it reaches it.
 * Put it on a blast, a landing or a roar; it fires once, when the entity gains it.
 *
 * @experimental
 */
export const WindBurst = defineComponent<WindBurstData>('WindBurst', { strength: 20, speed: 40, reach: 30 }, {
    fields: {
        strength: { min: 0, step: 0.5, unit: 'wu/s', tooltip: 'How hard the front shoves, in world units a second.' },
        speed: { min: 0.01, step: 1, unit: 'wu/s', tooltip: 'How fast the front travels outward.' },
        reach: { min: 0.01, unit: 'wu', tooltip: 'How far it travels before it is spent.' },
    },
});

/** A place a wake shoved the air: where (world), when (the frame clock, seconds), the air's velocity times its strength, and its reach. */
export interface WindPass { x: number; y: number; z: number; t0: number; vx: number; vy: number; vz: number; radius: number }
/** A burst: its centre (world), when it went off, how fast its front travels, how hard it shoves and how far it reaches. */
export interface WindFront { x: number; y: number; z: number; t0: number; speed: number; strength: number; reach: number }

/**
 * The air's push at a point at time `t`, as the shaders work it out: on the ground (`'xz'`, a 3D scene) or in the picture's plane (`'xy'`, 2D).
 * The answer is in that plane's two axes.
 */
export function windLean(
    plane: 'xz' | 'xy', at: { x: number; y: number; z?: number }, t: number,
    passes: readonly WindPass[], fronts: readonly WindFront[],
): { x: number; y: number } {
    const ground = (p: { x: number; y: number; z?: number }): [number, number] => plane === 'xz' ? [p.x, p.z ?? 0] : [p.x, p.y];
    const [ax, ay] = ground(at);
    let lx = 0;
    let ly = 0;
    for (const p of passes) {
        if (p.radius <= 0) continue;
        const [px, py] = ground(p);
        const [vx, vy] = plane === 'xz' ? [p.vx, p.vz] : [p.vx, p.vy];
        let f = Math.min(Math.max(1 - Math.hypot(ax - px, ay - py) / p.radius, 0), 1);
        f = f * f * (3 - 2 * f) * springAt(t - p.t0);
        lx += vx * f;
        ly += vy * f;
    }
    for (const fr of fronts) {
        if (fr.strength <= 0) continue;
        const [cx, cy] = ground(fr);
        const dx = ax - cx;
        const dy = ay - cy;
        const len = Math.hypot(dx, dy);
        if (len < 1e-3) continue;
        const e = Math.min(Math.max(len / Math.max(fr.reach, 1e-3), 0), 1);
        const amp = fr.strength * (1 - e * e * (3 - 2 * e)) * springAt(t - fr.t0 - len / Math.max(fr.speed, 1e-3));
        lx += dx / len * amp;
        ly += dy / len * amp;
    }
    return { x: lx, y: ly };
}

/** What the field keeps between frames: the passes and fronts still ringing, and where each wake last left a pass. */
export interface WindMemory {
    passes: WindPass[];
    fronts: WindFront[];
    last: Map<number, { x: number; y: number; z: number; t: number }>;
}

export const windMemory = (): WindMemory => ({ passes: [], fronts: [], last: new Map() });

/** Starts a pressure front at `at` now (`t`, the frame clock). */
export function addWindFront(memory: WindMemory, at: { x: number; y: number; z: number }, t: number, burst: WindBurstData): void {
    memory.fronts.push({ x: at.x, y: at.y, z: at.z, t0: t, speed: burst.speed, strength: burst.strength, reach: burst.reach });
}

/**
 * Follows the wakes for one frame at time `t`: each body that has moved half its radius since its last pass leaves one, with the velocity it
 * moved at in between. Drops what has rung down; a front is spent once it has crossed its reach and rung down there.
 */
export function stepWind(
    memory: WindMemory, bodies: readonly { id: number; x: number; y: number; z: number; radius: number; strength: number }[], t: number,
): void {
    const seen = new Set<number>();
    for (const b of bodies) {
        seen.add(b.id);
        const was = memory.last.get(b.id);
        if (!was) { memory.last.set(b.id, { x: b.x, y: b.y, z: b.z, t }); continue; }
        const dx = b.x - was.x;
        const dy = b.y - was.y;
        const dz = b.z - was.z;
        if (Math.hypot(dx, dy, dz) < b.radius * 0.5) continue;
        const dt = Math.max(t - was.t, 1e-3);
        const k = b.strength / dt;
        memory.passes.push({ x: (b.x + was.x) / 2, y: (b.y + was.y) / 2, z: (b.z + was.z) / 2, t0: (t + was.t) / 2, vx: dx * k, vy: dy * k, vz: dz * k, radius: b.radius });
        was.x = b.x; was.y = b.y; was.z = b.z; was.t = t;
    }
    for (const id of [...memory.last.keys()]) if (!seen.has(id)) memory.last.delete(id);
    memory.passes = memory.passes.filter((p) => t - p.t0 < WIND_RING);
    memory.fronts = memory.fronts.filter((f) => t - f.t0 < f.reach / Math.max(f.speed, 1e-3) + WIND_RING);
}

/** The values the shaders take: the newest passes and fronts, unused ones shoving nothing. */
export function windUniforms(memory: WindMemory, t: number): Map<string, { x: number; y: number; z: number; w: number }> {
    const out = new Map<string, { x: number; y: number; z: number; w: number }>();
    const passes = [...memory.passes].sort((a, b) => b.t0 - a.t0).slice(0, WIND_PASSES);
    const fronts = [...memory.fronts].sort((a, b) => b.t0 - a.t0).slice(0, WIND_FRONTS);
    for (let i = 0; i < WIND_PASSES; i++) {
        const p = passes[i];
        out.set(WIND_PASS_UNIFORMS[i]!, p ? { x: p.x, y: p.y, z: p.z, w: t - p.t0 } : { x: 0, y: 0, z: 0, w: 0 });
        out.set(WIND_PASS_V_UNIFORMS[i]!, p ? { x: p.vx, y: p.vy, z: p.vz, w: p.radius } : { x: 0, y: 0, z: 0, w: 0 });
    }
    for (let i = 0; i < WIND_FRONTS; i++) {
        const f = fronts[i];
        out.set(WIND_FRONT_UNIFORMS[i]!, f ? { x: f.x, y: f.y, z: f.z, w: t - f.t0 } : { x: 0, y: 0, z: 0, w: 0 });
        out.set(WIND_FRONT_P_UNIFORMS[i]!, f ? { x: f.speed, y: f.strength, z: f.reach, w: 0 } : { x: 0, y: 0, z: 0, w: 0 });
    }
    return out;
}

const memories = new WeakMap<App, WindMemory>();

/**
 * Starts a pressure front at `at` (world) now, as a `WindBurst` does when an entity gains it: for a blast, a landing or a roar from code.
 *
 * @experimental
 */
export function emitWindBurst(app: App, at: { x: number; y: number; z: number }, burst: Partial<WindBurstData> = {}): void {
    const memory = memories.get(app);
    if (!memory) return;
    const time = app.hasResource(Time) ? app.getResource(Time).elapsed : 0;
    addWindFront(memory, at, time, { strength: 20, speed: 40, reach: 30, ...burst });
}

/** Installs the system that tells materials about the field. Returns what clears it. */
export function installWindField(app: App): () => void {
    const memory = windMemory();
    memories.set(app, memory);
    let written = false;
    const names = [...WIND_PASS_UNIFORMS, ...WIND_PASS_V_UNIFORMS, ...WIND_FRONT_UNIFORMS, ...WIND_FRONT_P_UNIFORMS];
    const clear = (): void => {
        memory.passes = [];
        memory.fronts = [];
        memory.last.clear();
        if (!written) return;
        written = false;
        for (const material of Material.materialsDeclaring(names[0]!)) {
            for (const name of names) Material.setUniform(material, name, { x: 0, y: 0, z: 0, w: 0 });
        }
    };
    const fired = new Set<number>();
    const system = defineSystem(
        [Query(WindWake, Transform), Query(WindBurst, Transform), Res(Time)],
        (wakes: Iterable<[Entity, WindWakeData, TransformData]>, bursts: Iterable<[Entity, WindBurstData, TransformData]>, time: TimeData) => {
            if (isEditor() && !isPlayMode()) { clear(); fired.clear(); return; }
            const t = time.elapsed;
            const live = new Set<number>();
            for (const [entity, burst, transform] of bursts) {
                live.add(entity as number);
                if (fired.has(entity as number)) continue;
                fired.add(entity as number);
                addWindFront(memory, transform.worldPosition, t, burst);
            }
            for (const id of [...fired]) if (!live.has(id)) fired.delete(id);
            const bodies = [];
            for (const [entity, wake, transform] of wakes) {
                if (!wake.enabled || wake.radius <= 0 || wake.strength <= 0) continue;
                const p = transform.worldPosition;
                bodies.push({ id: entity as number, x: p.x, y: p.y, z: p.z, radius: wake.radius, strength: wake.strength });
            }
            stepWind(memory, bodies, t);
            if (memory.passes.length === 0 && memory.fronts.length === 0) {
                if (written) clear();
                return;
            }
            const values = windUniforms(memory, t);
            written = true;
            for (const material of Material.materialsDeclaring(names[0]!)) {
                for (const [name, value] of values) Material.setUniform(material, name, value);
            }
        },
        { name: 'WindFieldSystem' },
    );
    app.addSystemToSchedule(Schedule.PostUpdate, system);
    return () => { clear(); memories.delete(app); };
}
