// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    worldUnits.ts
 * @brief   What one world unit is, and the defaults that follow it.
 *
 * @details A 3D project says how many world units make a metre (Project Settings → Physics → 3D, `world3d.unitsPerMeter`):
 *          100 — a unit is a centimetre — unless it says otherwise, and 1 for a scene in metres such as an imported glTF.
 *          Every default that is a length, a speed or an acceleration is written once, at that reference of 100 a metre,
 *          and is scaled by the project's own: a character controller is a 1.6 m person, a first-person walk 3.2 m/s and a
 *          particle half a metre across in either kind of project. Before, those defaults were written in whichever unit
 *          their author had in mind — the character's in metres under a solver that reads centimetres, a 3 mm capsule; the
 *          first person's in centimetres in a metre scene, a 3.2 km/s walk.
 *
 *          A value a scene states is never scaled: only what a default fills in is.
 */

/** The scale every world-unit default is written at: 100 units a metre, a unit a centimetre. */
export const REFERENCE_UNITS_PER_METER = 100;

let unitsPerMeter = REFERENCE_UNITS_PER_METER;
let epoch = 0;
const listeners = new Set<(unitsPerMeter: number) => void>();

/** Calls `fn` now and on every change: how the renderer learns what a metre is (inverse-square lights measure in it). */
export function onWorldUnitsPerMeter(fn: (unitsPerMeter: number) => void): () => void {
    listeners.add(fn);
    fn(unitsPerMeter);
    return () => listeners.delete(fn);
}

/**
 * Set the project's units per metre. Called before a scene loads (by the runtime from the project's config, by the
 * editor when a project opens or the setting changes), so the defaults it fills in are the project's.
 */
export function setWorldUnitsPerMeter(value: number): void {
    const v = Number.isFinite(value) && value > 0 ? value : REFERENCE_UNITS_PER_METER;
    if (v === unitsPerMeter) return;
    unitsPerMeter = v;
    epoch++;
    for (const fn of listeners) fn(v);
}

/** The project's units per metre. */
export function worldUnitsPerMeter(): number {
    return unitsPerMeter;
}

/** What a reference-scale default is multiplied by: 1 in a centimetre project, 0.01 in a metre one. */
export function worldUnitScale(): number {
    return unitsPerMeter / REFERENCE_UNITS_PER_METER;
}

/** Bumped on every change, so a cache of scaled defaults knows it is stale. */
export function worldUnitEpoch(): number {
    return epoch;
}

/**
 * The world-unit fields of the engine's own components whose defaults come from C++ (generated), so cannot carry
 * the flag in their TS definition. A component defined in TS names its own in `ComponentMetadata.worldUnitFields`.
 */
export const BUILTIN_WORLD_UNIT_FIELDS: Readonly<Record<string, readonly string[]>> = {
    CharacterController3D: ['radius', 'halfHeight', 'stepHeight', 'snapDown'],
    BoxCollider3D: ['halfExtents', 'center'],
    SphereCollider3D: ['radius', 'center'],
    CapsuleCollider3D: ['radius', 'halfHeight', 'center'],
    ParticleEmitter: [
        'shapeRadius', 'shapeSize', 'speedMin', 'speedMax', 'startSizeMin', 'startSizeMax', 'endSizeMin', 'endSizeMax',
        'gravity', 'addedVelocityMin', 'addedVelocityMax', 'speedLimit', 'noiseStrength', 'trailWidth', 'trailMinDistance',
        'collisionThickness', 'collisionMaxDistance',
    ],
};

type Rec = Record<string, unknown>;

/** `defaults` with each named field multiplied by `scale` (a number, or each axis of a vector). */
export function scaleWorldUnitFields<T>(defaults: T, fields: readonly string[], scale: number): T {
    if (scale === 1 || fields.length === 0) return defaults;
    const out = { ...(defaults as Rec) };
    for (const f of fields) {
        const v = out[f];
        if (typeof v === 'number') out[f] = v * scale;
        else if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
            const axes = { ...(v as Rec) };
            for (const k of ['x', 'y', 'z', 'w']) if (typeof axes[k] === 'number') axes[k] = (axes[k] as number) * scale;
            out[f] = axes;
        }
    }
    return out as T;
}

/**
 * The defaults a component hands out now: its reference-scale ones, scaled to the project's units. Cached until the
 * scale changes; at the reference scale the very object it was defined with.
 */
export function worldUnitDefaults<T>(raw: T, fields: readonly string[]): () => T {
    let cached: T = raw, at = -1;
    return () => {
        if (fields.length === 0 || worldUnitScale() === 1) return raw;
        if (at !== epoch) { cached = scaleWorldUnitFields(raw, fields, worldUnitScale()); at = epoch; }
        return cached;
    };
}
